'use strict';
const {chromium}=require('playwright');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');

// Invoke from the source repository with RELEASE_ROOT pointing at an extracted
// release root or its dist directory. No server, cache, or personal browser data.
const repoRoot=path.resolve(__dirname,'../..');
const releaseRoot=path.resolve(process.env.RELEASE_ROOT||path.join(repoRoot,'game'));
const output=path.join(repoRoot,'test-results/browser');
const resultPath=path.join(output,'offline-v2-results.json');
const chipPath=path.join(output,'offline-v2-chip.json');
const passed=[],errors=[],networkRequests=[],contexts=[];
let browser,page,entrypoint;
const act=async(p,name)=>p.locator('[data-action="'+name+'"]').filter({visible:true}).first().click();
const advance=async p=>{await p.locator('[data-panel="terminal"]').click();await act(p,'advance-100ms');};
const snapshot=p=>p.evaluate(()=>__lab.runtime.snapshot());
const report=p=>p.evaluate(()=>__lab.runtime.inspect());
async function check(name,fn){await fn();passed.push(name);console.log('PASS '+name);}
async function freshPage(){
  const context=await browser.newContext({offline:true,serviceWorkers:'block',acceptDownloads:true,viewport:{width:1536,height:1000}});
  contexts.push(context);const p=await context.newPage();
  p.on('pageerror',e=>errors.push(e.stack||String(e)));
  p.on('request',r=>{if(/^https?:/i.test(r.url()))networkRequests.push(r.url());});
  await p.goto(pathToFileURL(entrypoint).href);
  await p.waitForFunction(()=>!!window.__lab&&!!window.Core8Plus);
  assert.equal(await p.evaluate(()=>navigator.onLine),false);
  assert.equal(await p.evaluate(()=>__lab.state.library.length),0,'new context starts with an empty personal library');
  return p;
}

(async()=>{
  fs.mkdirSync(output,{recursive:true});
  let editedSource,firmwareBefore,exportedPackage;
  try{
    entrypoint=[path.join(releaseRoot,'index.html'),path.join(releaseRoot,'dist/index.html')].find(f=>fs.existsSync(f));
    assert(entrypoint,'RELEASE_ROOT must contain index.html or dist/index.html');
    browser=await chromium.launch({...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{}),headless:true});

    await check('fresh offline file context loads Core8/2 with an empty library and no network dependency',async()=>{
      page=await freshPage();assert.match(page.url(),/^file:\/\//);
      assert.equal(await page.evaluate(()=>__lab.state.running),false);
      assert.deepEqual(networkRequests,[]);assert.deepEqual(errors,[]);
    });

    await check('offline I2C example executes firmware and reads25 from the connected sensor',async()=>{
      await act(page,'examples');await page.locator('[data-v2-example="i2c-temperature"]').click();
      await page.waitForFunction(()=>__lab.runtime.inspect().instances.mcu?.modelId==='core8/2');
      await advance(page);const r=await report(page);
      assert.equal(r.instances.mcu.fault,null);assert.equal(r.instances.mcu.ram[0],25);
      assert.equal(r.instances.mcu.plus.i2c.data,25);assert.equal(r.instances.mcu.plus.i2c.status,2);
      assert.equal(r.instances.peripheral.device.temperature,25);
      assert(r.terminals.terminal.history.entries.some(e=>e.kind==='byte'&&e.byte===25));
      assert(r.instances.mcu.history.some(e=>e.kind==='i2c'&&e.ok&&e.value===25));
    });

    await check('offline temperature edit is queued then actual I2C updates RAM and UART to65',async()=>{
      await page.locator('[data-node="peripheral"] .node-head').click();
      const input=page.locator('[data-sensor-temperature="peripheral"]');await input.fill('65');await input.press('Tab');
      const queued=await snapshot(page);assert.equal(queued.instances.mcu.cpu.ram[0],25);
      assert(queued.events.some(e=>e.type==='sensor-temperature'&&e.temperature===65));
      await advance(page);const r=await report(page);
      assert.equal(r.instances.peripheral.device.temperature,65);assert.equal(r.instances.mcu.ram[0],65);
      assert.equal(r.instances.mcu.plus.i2c.data,65);
      assert(r.instances.mcu.history.some(e=>e.kind==='i2c'&&e.ok&&e.value===65));
      assert(r.terminals.terminal.history.entries.some(e=>e.kind==='byte'&&e.byte===65));
    });

    await check('offline edited firmware and source export with complete board and locked sensor dependencies',async()=>{
      await page.locator('[data-panel="program"]').click();
      const editor=page.locator('#source-editor'),source=await editor.inputValue();assert(source.includes('WAIT 10000'));
      editedSource=source.replace('WAIT 10000','WAIT 7000');await editor.fill(editedSource);await act(page,'compile');
      await page.waitForFunction(()=>__lab.runtime.inspect().time==='0'&&!__lab.state.dirty);
      firmwareBefore=await page.evaluate(()=>__lab.state.project.firmware.find(f=>f.targetModel==='core8/2'));
      assert(firmwareBefore);assert.equal(firmwareBefore.data,await page.evaluate(source=>Array.from(Core8Plus.assemble(source).bytes,b=>b.toString(16).padStart(2,'0')).join(''),editedSource));
      await act(page,'encapsulate');await page.locator('#chip-name').fill('离线温度整板 v0.2');await act(page,'save-chip');
      await page.waitForSelector('[data-export-chip="0"]');
      const pending=page.waitForEvent('download');await page.locator('[data-export-chip="0"]').click();await (await pending).saveAs(chipPath);
      exportedPackage=JSON.parse(fs.readFileSync(chipPath,'utf8'));
      assert.equal(exportedPackage.format,'silicon-lab.chip/2');assert(exportedPackage.module);
      assert.equal(exportedPackage.module.sourceMap[firmwareBefore.id],editedSource);
      assert.deepEqual(exportedPackage.module.firmware.find(f=>f.id===firmwareBefore.id),firmwareBefore);
      const ids=new Set(exportedPackage.module.definitions.map(d=>d.model.id));
      for(const id of ['core8/2','std.i2c-temperature/1','io.terminal/1','std.vcc/1','std.gnd/1'])assert(ids.has(id),id+' travels with the board');
      assert(exportedPackage.module.definitions.every(d=>/^sha256:[0-9a-f]{64}$/.test(d.contentHash)));
      assert.deepEqual(exportedPackage.sources,exportedPackage.module.sourceMap);
      await contexts[0].close();
    });

    await check('another fresh offline context imports the chip without existing library or firmware',async()=>{
      page=await freshPage();const before=await snapshot(page);
      await page.locator('#file-input').setInputFiles(chipPath);await page.waitForFunction(()=>__lab.state.library.length===1);
      assert.deepEqual(await snapshot(page),before,'chip import preserves the current running board');
      const imported=await page.evaluate(()=>__lab.state.library[0]);
      assert.deepEqual(imported.module,exportedPackage.module);assert.equal(imported.sources[firmwareBefore.id],editedSource);
      await act(page,'close-dialog');await act(page,'new');await act(page,'library');await page.locator('[data-place-chip="0"]').click();await act(page,'apply');
      await page.waitForFunction(()=>!__lab.state.dirty);
      const placed=await page.evaluate(()=>({project:__lab.state.project,sources:__lab.state.sources}));
      const fw=placed.project.firmware.find(f=>f.targetModel==='core8/2');assert(fw);
      assert.equal(fw.data,firmwareBefore.data);assert.equal(fw.contentHash,firmwareBefore.contentHash);
      assert(Object.values(placed.sources).includes(editedSource));
    });

    await check('imported complete board cold starts real nested MCU and sensor and preserves editable source',async()=>{
      await advance(page);const r=await report(page),cpus=Object.entries(r.instances).filter(([,n])=>n.modelId==='core8/2'),sensors=Object.entries(r.instances).filter(([,n])=>n.modelId==='std.i2c-temperature/1');
      assert.equal(cpus.length,1);assert.equal(sensors.length,1);assert(cpus[0][0].includes('/'));
      assert.equal(cpus[0][1].ram[0],25,'a design package cold starts the sensor at25, not the prior session temperature65');
      assert.equal(cpus[0][1].fault,null);assert.equal(sensors[0][1].device.temperature,25);
      assert(cpus[0][1].history.some(e=>e.kind==='i2c'&&e.ok&&e.value===25));
      assert(Object.values(r.terminals).some(t=>t.history.entries.some(e=>e.kind==='byte'&&e.byte===25)));
      const before=await snapshot(page);await page.locator('[data-panel="program"]').click();await act(page,'open-observed-cpu');
      assert.equal(await page.locator('#source-editor').inputValue(),editedSource);
      await act(page,'parent');assert.deepEqual(await snapshot(page),before);
    });

    await check('offline imported module snapshot restores exact time, RAM, sensor, ROM and transaction state',async()=>{
      const before=await snapshot(page);
      await act(page,'snapshots');await act(page,'save-snapshot');await act(page,'close-dialog');
      await advance(page);assert.notEqual((await snapshot(page)).time,before.time);
      await act(page,'snapshots');await act(page,'restore-snapshot');
      assert.deepEqual(await snapshot(page),before);
      assert.equal(await page.evaluate(()=>__lab.state.project.firmware.find(f=>f.targetModel==='core8/2').data),firmwareBefore.data);
      await advance(page);const cpus=Object.values((await report(page)).instances).filter(n=>n.modelId==='core8/2');assert.equal(cpus[0].ram[0],25);assert.equal(cpus[0].fault,null);
    });

    assert.deepEqual(networkRequests,[],'both contexts must use only local release resources');
    assert.deepEqual(errors,[],'no page exceptions');
  }catch(e){
    errors.push(e.stack||String(e));console.error(e);process.exitCode=1;
    if(page&&!page.isClosed())await page.screenshot({path:path.join(output,'offline-v2-failure.png')}).catch(()=>{});
  }finally{
    const result={date:new Date().toISOString(),browser:browser?await browser.version():null,node:process.version,releaseRoot,entrypoint:entrypoint||null,offline:true,freshContexts:contexts.length,passedCount:passed.length,passed,networkRequests,errors};
    fs.writeFileSync(resultPath,JSON.stringify(result,null,2));console.log(JSON.stringify({passed:passed.length,errors,resultPath},null,2));
    for(const context of contexts)await context.close().catch(()=>{});
    if(browser)await browser.close();
  }
})();
