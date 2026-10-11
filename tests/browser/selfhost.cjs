'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '../..');
const output = process.env.QA_OUT && path.resolve(process.env.QA_OUT);
const password = 'browser-integration-password', newPassword = 'updated-browser-password';
const results = [], errors = [];
let browser, application, directory, origin;

async function check(name, work) {
  await work(); results.push({ name, ok: true }); console.log(`PASS ${name}`);
}

function observe(page, label) {
  page.on('pageerror', error => errors.push({ page: label, type: 'pageerror', message: error.message }));
  page.on('console', message => {
    if (message.type() === 'error') errors.push({ page: label, type: 'console', message: message.text(), url: message.location().url });
  });
  page.on('response', response => {
    if (response.status() >= 400 && /\.(js|css)(?:\?|$)/.test(response.url())) errors.push({ page: label, type: 'asset', message: `${response.status()} ${response.url()}` });
  });
}

async function submit(page, form, values) {
  const locator = page.locator(`form[data-form="${form}"]`);
  await locator.waitFor({ state: 'visible' });
  for (const [name, value] of Object.entries(values)) await locator.locator(`[name="${name}"]`).fill(value);
  await locator.locator('button').click();
}

async function readyGame(page) {
  await page.waitForFunction(() => window.LabAPI?.state?.project && window.LabAPI.getRuntime() && document.querySelector('#loading')?.hidden);
}

async function screenshot(page, name) {
  if (output) await page.screenshot({ path: path.join(output, name), fullPage: true });
}

(async () => {
  try {
    if (output) fs.mkdirSync(output, { recursive: true });
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'silicon-ui-'));
    const { createApplication } = await import(pathToFileURL(path.join(root, 'selfhost/app.mjs')).href);
    application = await createApplication({ dataDir: directory, host: '127.0.0.1', port: 0, publicOrigin: '' });
    const address = await application.listen(); origin = `http://127.0.0.1:${address.port}`;
    const installedChrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
    const executablePath = process.env.CHROME_PATH || process.env.CHROMIUM_PATH || (process.platform === 'win32' && fs.existsSync(installedChrome) ? installedChrome : undefined);
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const memberContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const admin = await adminContext.newPage(), member = await memberContext.newPage();
    admin.setDefaultTimeout(15000); member.setDefaultTimeout(15000);
    observe(admin, 'admin'); observe(member, 'member');

    await check('first administrator is created through the visible setup form', async () => {
      await admin.goto(origin + '/account');
      await admin.locator('form[data-form="setup"]').waitFor();
      await screenshot(admin, 'account-setup-desktop.png');
      await admin.setViewportSize({ width: 390, height: 844 });
      assert(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await screenshot(admin, 'account-setup-mobile.png');
      await admin.setViewportSize({ width: 1440, height: 1000 });
      const setupToken = fs.readFileSync(path.join(directory, 'setup-token'), 'utf8').trim();
      await submit(admin, 'setup', { setupToken, username: 'browser-admin', password });
      await admin.locator('#panel-title').filter({ hasText: '你好，browser-admin' }).waitFor();
      assert.match(await admin.locator('#status').innerText(), /管理员已创建/);
      assert(await admin.locator('[data-action="invite"]').isVisible());
    });

    await check('admin invitation creates a second account in an independent browser session', async () => {
      await admin.locator('[data-action="invite"]').click();
      const invitation = admin.locator('#invite-result textarea');
      await invitation.waitFor(); const inviteToken = await invitation.inputValue();
      assert.match(inviteToken, /^[A-Za-z0-9_-]{43}$/);
      await member.goto(origin + '/account');
      await member.locator('[data-action="register"]').click();
      await submit(member, 'register', { inviteToken, username: 'browser-player', password });
      await member.locator('#panel-title').filter({ hasText: '你好，browser-player' }).waitFor();
      assert.equal(await member.locator('[data-action="invite"]').count(), 0);
      const adminCookie = (await adminContext.cookies()).find(cookie => cookie.name === 'silab_session');
      const memberCookie = (await memberContext.cookies()).find(cookie => cookie.name === 'silab_session');
      assert(adminCookie?.httpOnly && memberCookie?.httpOnly);
      assert.equal(adminCookie.sameSite, 'Lax'); assert.equal(memberCookie.sameSite, 'Lax');
      assert.notEqual(adminCookie.value, memberCookie.value);
      assert.equal(await member.evaluate(() => document.cookie.includes('silab_session')), false);
    });

    await check('default MCU workbench loads all 73 models and really advances the running circuit', async () => {
      await admin.locator('#return-game').click(); await readyGame(admin);
      const before = await admin.evaluate(() => ({ version: LabAPI.version, models: Object.keys(CircuitLab.catalog).length, lesson: LabAPI.state.lesson, instances: LabAPI.state.project.circuit.instances.length, time: LabAPI.getRuntime().time.toString(), manuals: LabManualV4.entries().length }));
      assert.equal(before.version, '0.9.0'); assert.equal(before.models, 73);
      assert.equal(before.lesson, 'smart-lamp'); assert(before.instances > 0); assert.equal(before.manuals, 93);
      await admin.locator('[data-action="step"]').click();
      await admin.waitForFunction(time => LabAPI.getRuntime().time > BigInt(time), before.time);
      const actual = await admin.evaluate(async () => {
        const runtime = LabAPI.getRuntime();
        await LabAPI.advanceResponsive(1048n - runtime.time, { force: true });
        LabAPI.stop(); LabAPI.updateSignals();
        const led = runtime.getPort('$.led');
        return { time: runtime.time.toString(), running: LabAPI.isRunning(), led: Number(BigInt(led.value) & 1n), known: Number(BigInt(led.knownMask) & 1n), powered: Number(BigInt(led.driveMask) & 1n), terminal: Object.values(runtime.inspect().terminals || {}).flatMap(terminal => terminal.history?.entries || []) };
      });
      assert.equal(actual.time, '1048'); assert.equal(actual.running, false);
      assert.equal(actual.led, 1); assert.equal(actual.known, 1); assert.equal(actual.powered, 1);
      assert(actual.terminal.some(event => event.kind === 'byte' && event.byte === 0x42), 'default MCU must send startup byte B');
      assert.equal(await admin.locator('[data-output="led"]').innerText(), '1');
      assert.match(await admin.locator('[data-led="led"]').getAttribute('class'), /\bon\b/);
      assert.match(await admin.locator('#terminal-log').innerText(), /1048\s*[µμ]s\s+B/);
      assert.match(await admin.locator('#virtual-time').innerText(), /1\.05\s*ms/);
      assert(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'desktop workbench should not overflow horizontally');
      const title = await admin.locator('#project-name').boundingBox();
      assert(title && title.width >= 160 && title.height <= 80, 'project title must retain enough room beside the toolbar');
      await admin.locator('#toast').waitFor({ state: 'hidden' });
      await screenshot(admin, 'workbench.png');
    });

    await check('game project title and canvas stay within a 390-pixel viewport', async () => {
      await admin.setViewportSize({ width: 390, height: 844 });
      assert(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      const title = await admin.locator('#project-name').boundingBox();
      assert(title && title.width > 120 && title.x >= 0 && title.x + title.width <= 391);
      assert(await admin.locator('#run-button').isVisible());
      await admin.setViewportSize({ width: 1440, height: 1000 });
    });

    await check('chip manual is searchable and explains ALU operation values', async () => {
      await admin.locator('.topnav [data-manual-open]').click();
      await admin.locator('#manual-search').fill('ALU');
      await admin.locator('#manual-results .manual-result').filter({ has: admin.locator('strong').filter({ hasText: /ALU/ }) }).first().click();
      const reference = await admin.locator('#manual-content').innerText();
      assert.match(reference, /ALU/); assert.match(reference, /op|操作/i); assert.match(reference, /0x|AND|加法/);
      await admin.locator('[data-manual-close]').click();
    });

    await check('standalone manual search executes under the server content-security policy', async () => {
      const manual = await adminContext.newPage(); observe(manual, 'standalone-manual');
      await manual.goto(origin + '/docs/CHIP-USER-MANUAL.html');
      assert.equal(await manual.locator('article').count(), 93);
      await manual.locator('#search').fill('0x4000');
      await manual.waitForFunction(() => document.querySelectorAll('article[hidden]').length > 0);
      const count = await manual.locator('article:visible').count(); assert(count > 0 && count < 93);
      assert.match(await manual.locator('#result-count').innerText(), new RegExp(`^${count} 篇匹配说明$`));
      assert.match(await manual.locator('article:visible').first().innerText(), /0x4000/i);
      await manual.close();
    });

    await check('account link opens another tab and preserves the active game design and execution state', async () => {
      const before = await admin.evaluate(() => JSON.stringify(LabAPI.captureSession()));
      const popupPromise = admin.waitForEvent('popup');
      await admin.locator('[data-selfhost-account]').click();
      const popup = await popupPromise; observe(popup, 'account-popup');
      await popup.waitForURL(origin + '/account');
      await popup.locator('#panel-title').filter({ hasText: '你好，browser-admin' }).waitFor();
      assert.equal(admin.url(), origin + '/game/');
      assert.equal(await admin.evaluate(() => JSON.stringify(LabAPI.captureSession())), before);
      await popup.close();
    });

    await check('account return link cannot be redirected outside this server with encoded control characters', async () => {
      const account = await adminContext.newPage(); observe(account, 'account-return');
      for (const destination of ['//evil.example', '/\t/evil.example', '/\\evil.example']) {
        await account.goto(origin + '/account?return_to=' + encodeURIComponent(destination));
        await account.locator('#return-game').waitFor();
        assert.equal(new URL(await account.locator('#return-game').getAttribute('href'), origin).origin, origin);
      }
      await account.close();
    });

    await check('both signed-in accounts can open their server chip library from the game UI', async () => {
      for (const [page, username] of [[admin, 'browser-admin'], [member, 'browser-player']]) {
        if (page === member) { await page.locator('#return-game').click(); await readyGame(page); }
        await page.locator('[data-selfhost-account]').filter({ hasText: username }).waitFor();
        await page.locator('.topnav [data-cloud="home"]').click();
        await page.locator('#dialog-title').filter({ hasText: '在线实验室' }).waitFor();
        await page.locator('#dialog [data-cloud="library"]').click();
        await page.locator('#dialog-title').filter({ hasText: '云端芯片库' }).waitFor();
        assert.match(await page.locator('#dialog-body').innerText(), /还没有可访问/);
        await page.locator('#dialog [data-action="close-dialog"]').click();
      }
    });

    await check('visible password change revokes login and accepts the new password through login form', async () => {
      await member.goto(origin + '/account');
      await member.locator('summary').filter({ hasText: '修改密码' }).click();
      await submit(member, 'password', { currentPassword: password, newPassword });
      await member.locator('form[data-form="login"]').waitFor();
      assert.match(await member.locator('#status').innerText(), /密码已更新/);
      assert.equal((await memberContext.cookies()).some(cookie => cookie.name === 'silab_session'), false);
      await submit(member, 'login', { username: 'browser-player', password: newPassword });
      await member.locator('#panel-title').filter({ hasText: '你好，browser-player' }).waitFor();
    });

    await check('account forms remain usable without horizontal overflow at 390 pixels', async () => {
      await member.setViewportSize({ width: 390, height: 844 });
      await member.locator('[data-action="logout"]').click();
      await member.locator('form[data-form="login"]').waitFor();
      assert(await member.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await member.locator('form[data-form="login"] button').click({ trial: true });
      await screenshot(member, 'account-mobile.png');
      await member.locator('[data-action="register"]').click();
      assert(await member.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      assert(await member.locator('input[name="inviteToken"]').isVisible());
    });

    await check('LAN-compatible UUID fallback boots a complete game when native randomUUID is absent', async () => {
      const lan = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      await lan.addInitScript(() => {
        Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, writable: true, configurable: true });
        window.__nativeUuidAbsent = typeof globalThis.crypto.randomUUID === 'undefined';
      });
      const page = await lan.newPage(); observe(page, 'lan-compatibility');
      await page.goto(origin + '/game/'); await readyGame(page);
      const state = await page.evaluate(() => ({ absent: window.__nativeUuidAbsent, uuid: crypto.randomUUID(), models: Object.keys(CircuitLab.catalog).length, online: !!document.querySelector('[data-cloud="home"]') }));
      assert(state.absent); assert.match(state.uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      assert.equal(state.models, 73); assert(state.online); await lan.close();
    });

    await check('all pages load without JavaScript, CSP or resource errors', async () => assert.deepEqual(errors, []));
  } catch (error) {
    results.push({ name: 'failure', ok: false, error: error.stack }); console.error(error);
    process.exitCode = 1;
  } finally {
    if (output) fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ browser: browser ? await browser.version() : null, results, errors }, null, 2));
    await browser?.close(); await application?.close();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  }
})();
