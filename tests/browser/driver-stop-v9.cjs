'use strict';
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const out = path.resolve(__dirname, '../../qa/v0.9/driver-stop');
fs.mkdirSync(out, { recursive: true });
const results = [], errors = [];
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
  const context = await browser.newContext({ viewport: { width: 1536, height: 1040 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.stack || error.message));
  const test = async (name, fn) => {
    try { await fn(); results.push({ name, ok: true }); console.log('PASS ' + name); }
    catch (error) { results.push({ name, ok: false, error: error.stack || error.message }); throw error; }
  };
  const clear = () => page.evaluate(() => { window.driverCapture?.dispose(); window.driverCapture = null; TraceUIV9.close(); LabAPI.stop(); LabAPI.closeModal(); });
  const system = async id => { await clear(); await page.evaluate(async id => { await LabAPI.loadWorkspace(await SystemsV5.build(id)); LabAPI.pause(); }, id); };
  const arm = (time, paths) => page.evaluate(({ time, paths }) => { window.driverCapture = new TraceV9.Capture(LabAPI.getRuntime(), { paths, pre: 2, post: 0, trigger: { kind: 'time', value: String(time) } }).arm(); }, { time, paths });
  const advance = n => page.evaluate(async n => { const r = await LabAPI.advanceResponsive(BigInt(n), { force: true }); return { ...r, advanced: String(r.advanced), remaining: String(r.remaining) }; }, n);
  const recorder = async () => { await clear(); await page.evaluate(() => RecorderUIV7.load('reference', 'polling')); };
  const serial = async () => { await clear(); await page.evaluate(async () => { await LabAPI.loadWorkspace(await CustomArchitectureV6.build('serial-receiver')); LabAPI.pause(); }); };
  try {
    await page.goto(process.env.GAME_URL || 'http://127.0.0.1:4173');
    await page.waitForFunction(() => window.TraceV9 && window.RecorderUIV7 && window.SystemsUIV5 && LabAPI.state.rt);
    await page.waitForSelector('#loading', { state: 'hidden' });
    await test('final requested step preserves stopped=true with zero remaining time', async () => {
      await system('cpu-dma'); await arm(20, ['cpu', 'dma']);
      const result = await advance(20);
      assert.equal(result.advanced, '20'); assert.equal(result.remaining, '0'); assert.equal(result.stopped, true);
      assert.match(result.reason, /捕获/);
      assert.deepEqual(await page.evaluate(() => [String(LabAPI.getRuntime().time), driverCapture.status, LabAPI.isRunning()]), ['20', 'complete', false]);
    });
    await test('DMA trigger stops after its first segment without queuing an upward edge or advancing again', async () => {
      await system('dma-memory'); await page.evaluate(() => SystemsUIV5.open()); await arm(1, ['dma']);
      await page.locator('[data-systems="trigger"]').click(); await page.waitForFunction(() => !SystemsUIV5.busy);
      const observed = await page.evaluate(() => { const r = LabAPI.getRuntime(); return { time: String(r.time), input: CircuitLab.bits(r.inputs.dma_trigger), events: r.snapshot().events, dma: SystemsV5.inspect(r).instances.dma, matchesCapture: JSON.stringify(r.snapshot()) === JSON.stringify(driverCapture.final) }; });
      assert.equal(observed.time, '1'); assert.deepEqual(observed.input, [0]); assert.deepEqual(observed.events, []);
      assert.equal(observed.dma.completed, 0); assert.equal(observed.dma.done, 0); assert.equal(observed.matchesCapture, true);
      assert.equal(await page.locator('#systems-error').innerText(), '');
    });
    await test('ordinary DMA trigger still produces its edge and copies four real RAM words', async () => {
      await system('dma-memory'); await page.evaluate(() => SystemsUIV5.open());
      await page.locator('[data-systems="trigger"]').click(); await page.waitForFunction(() => !SystemsUIV5.busy);
      assert.equal(await page.evaluate(() => String(LabAPI.getRuntime().time)), '2');
      await page.locator('[data-systems="advance"]').click(); await page.waitForFunction(() => !SystemsUIV5.busy);
      const result = await page.evaluate(() => { const s = SystemsV5.inspect(LabAPI.getRuntime()); return { time: s.time, copied: s.instances.ram.memory.slice(64, 68), completed: s.instances.dma.completed, done: s.instances.dma.done }; });
      assert.equal(result.time, '102'); assert.deepEqual(result.copied, [17, 34, 51, 68]); assert.equal(result.completed, 4); assert.equal(result.done, 1);
    });
    await test('recorder initialization capture prevents sample submission and the second advance', async () => {
      await recorder(); await arm(400, ['cpu', 'ram']);
      const beforeInput = await page.evaluate(() => LabAPI.getRuntime().inputs.sample);
      await page.locator('#recorder-value').fill('25'); await page.locator('[data-rec="submit"]').click();
      await page.waitForFunction(() => !RecorderUIV7.busy);
      const observed = await page.evaluate(() => { const r = LabAPI.getRuntime(); return { time: String(r.time), input: r.inputs.sample, events: r.snapshot().events, recorder: RecorderV7.inspect(r), matchesCapture: JSON.stringify(r.snapshot()) === JSON.stringify(driverCapture.final) }; });
      assert.equal(observed.time, '400'); assert.deepEqual(observed.input, beforeInput); assert.deepEqual(observed.events, []);
      assert.equal(observed.recorder.initialized, true); assert.equal(observed.recorder.count, 0); assert.equal(observed.matchesCapture, true);
      assert.equal(await page.locator('#recorder-error').innerText(), '');
    });
    await test('ordinary recorder first and subsequent submissions still commit the chosen samples', async () => {
      await recorder(); await page.locator('#recorder-value').fill('25'); await page.locator('[data-rec="submit"]').click(); await page.waitForFunction(() => !RecorderUIV7.busy);
      let result = await page.evaluate(() => RecorderV7.inspect(LabAPI.getRuntime()));
      assert.equal(result.time, '800'); assert.equal(result.count, 1); assert.equal(result.records[0].value, 25);
      await page.locator('#recorder-value').fill('37'); await page.locator('[data-rec="submit"]').click(); await page.waitForFunction(() => !RecorderUIV7.busy);
      result = await page.evaluate(() => RecorderV7.inspect(LabAPI.getRuntime()));
      assert.equal(result.time, '1200'); assert.deepEqual(result.records.map(r => [r.sequence, r.value]), [[1, 25], [2, 37]]);
    });
    await test('serial send paused mid-byte reports queued remainder without falsely claiming eight edges', async () => {
      await serial(); await arm(8, ['controller']); await page.locator('#ca-byte').fill('165');
      await page.locator('[data-ca-action="send"]').click(); await page.waitForFunction(() => driverCapture.status === 'complete');
      const text = await page.locator('#toast').innerText(); assert.match(text, /发送已暂停/); assert.match(text, /剩余波形已排队/); assert.doesNotMatch(text, /已按 8 次/);
      const result = await page.evaluate(() => { const r = LabAPI.getRuntime(); return { time: String(r.time), count: r.inspect().instances.controller.hardware.count, future: r.snapshot().events.map(e => e.time) }; });
      assert.equal(result.time, '8'); assert.equal(result.count, 3); assert(result.future.length > 0); assert(result.future.every(t => BigInt(t) > 8n));
      await advance(11);
      assert.deepEqual(await page.evaluate(() => { const s = LabAPI.getRuntime().inspect().instances.controller.hardware; return [String(LabAPI.getRuntime().time), s.count, s.shift, s.fault]; }), ['19', 8, 165, null]);
    });
    await test('uninterrupted serial send retains its completion message and actual received byte', async () => {
      await serial(); await page.locator('#ca-byte').fill('60'); await page.locator('[data-ca-action="send"]').click();
      await page.waitForFunction(() => LabAPI.getRuntime().time === 19n);
      assert.match(await page.locator('#toast').innerText(), /已按 8 次真实时钟上升沿发送 60/);
      assert.deepEqual(await page.evaluate(() => { const s = LabAPI.getRuntime().inspect().instances.controller.hardware; return [s.count, s.shift, s.fault]; }), [8, 60, null]);
      await page.screenshot({ path: path.join(out, 'driver-stop.png') });
    });
    await test('no uncaught browser errors', async () => assert.deepEqual(errors, []));
  } catch (error) { console.error(error); process.exitCode = 1; await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }).catch(() => {}); }
  finally {
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ version: '0.9.0', results, passed: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, errors }, null, 2));
    console.log(JSON.stringify({ passed: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, errors }));
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
