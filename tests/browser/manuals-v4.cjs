'use strict';
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'test-results/browser'),passed=[],errors=[];
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
 const context=await browser.newContext({offline:true,serviceWorkers:'block',viewport:{width:1500,height:1000}}),page=await context.newPage();
 page.on('pageerror',e=>errors.push(String(e)));const url=pathToFileURL(path.join(process.env.RELEASE_ROOT||path.join(root,'game'),'index.html')).href;
 const close=async p=>{await p.locator('#manual-dialog [data-manual-close]').click();};
 const check=async(name,fn)=>{await fn();passed.push(name);console.log('PASS '+name);};
 const ready=async p=>{await p.goto(url);await p.waitForFunction(()=>window.__lab&&window.LabManualV4&&window.McuManualV4);};
 try{
  await ready(page);
  await check('offline top entry searches actual ALU documentation by model name',async()=>{
   await page.locator('.topnav [data-manual-open]').click();await page.locator('#manual-search').fill('std.alu8/1');assert.equal(await page.locator('#manual-results [data-manual-entry]').count(),1);await page.locator('#manual-results [data-manual-entry]').click();assert.match(await page.locator('#manual-content').innerText(),/std\.alu8\/1/);await close(page);
  });
  await check('ALU OP numeric reference is immediately visible and the port tooltip matches',async()=>{
   await page.evaluate(async()=>LabAPI.loadWorkspace(await HardwareV3.buildBoard('calculator8')));await page.locator('[data-node="alu"] .node-head').dispatchEvent('click');
   const quick=await page.locator('.manual-port-quick').innerText();assert.match(quick,/0.*1.*2/);assert.match(quick,/14\/15未定义/);
   const title=await page.locator('[data-node="alu"] [data-endpoint]').evaluateAll(es=>es.find(e=>JSON.parse(e.dataset.endpoint).port==='op').title);assert.match(title,/14\/15未定义/);
   await page.locator('[data-manual-instance="alu"]').click();const table=await page.locator('#manual-content table').first().innerText();assert.match(table,/15/);assert.match(table,/未定义/);await close(page);
  });
  await check('address and opcode search returns MCU reference and exact sections',async()=>{
   await page.locator('.topnav [data-manual-open]').click();await page.locator('#manual-search').fill('0x4000');assert.ok(await page.locator('[data-manual-entry="core8-1"]').count());await page.locator('[data-manual-entry="core8-1"]').click();assert.match(await page.locator('#manual-content').innerText(),/0x4000/);await page.locator('#manual-search').fill('IRET');assert.ok(await page.locator('[data-manual-entry="core8-2"]').count());await page.locator('[data-manual-entry="core8-2"]').click();assert.match(await page.locator('#manual-content').innerText(),/IRET/);await close(page);
  });
  await check('Core8 program panel opens the correct target manual without changing source',async()=>{
   await page.evaluate(async()=>__lab.loadTemplate('smart-lamp'));await page.locator('[data-panel="program"]').click();await page.locator('#source-editor').fill('; 未编译的草稿\nLDI R0, 7\nHALT');const before=await page.evaluate(()=>LabAPI.captureSession());await page.locator('#inspector-content [data-manual-open="core8/1"]').click();assert.match(await page.locator('#manual-content').innerText(),/Core8/);await close(page);assert.deepEqual(await page.evaluate(()=>LabAPI.captureSession()),before);assert.match(await page.locator('#source-editor').inputValue(),/未编译/);
  });
  await check('Build8 manual overlays the editor and preserves unsubmitted textarea and dialog',async()=>{
   await page.evaluate(async()=>{await LabAPI.loadWorkspace(await BuilderMCU.build('build8-calculator'));HardwareUIV3.openProgram('program_rom');});await page.locator('#build8-source').fill('LDI 123\nOUT\nHALT');const before=await page.evaluate(()=>LabAPI.captureSession());await page.locator('[data-manual-build-program]').click();assert.match(await page.locator('#manual-content').innerText(),/Build8/);assert.equal(await page.locator('#dialog').evaluate(e=>e.open),true);await close(page);assert.equal(await page.locator('#build8-source').inputValue(),'LDI 123\nOUT\nHALT');assert.deepEqual(await page.evaluate(()=>LabAPI.captureSession()),before);await page.locator('#dialog [data-action="close-dialog"]').first().click();
  });
  await check('Build8/2 program entry resolves its distinct MCU generation',async()=>{
   await page.evaluate(async()=>{await LabAPI.loadWorkspace(await McuV4.build(McuV4.SAMPLES[0].id));HardwareUIV3.openProgram('program_rom');});assert.equal(await page.locator('[data-manual-build-program]').getAttribute('data-manual-open'),'build8-2');await page.locator('[data-manual-build-program]').click();assert.match(await page.locator('#manual-content').innerText(),/Build8\/2/);await close(page);await page.locator('#dialog [data-action="close-dialog"]').first().click();
  });
  await check('custom chip displays its actual contract and escapes hostile names',async()=>{
   await page.evaluate(async()=>{const C=CircuitLab,p=await C.createProject('内部');C.addInput(p,'my_in','我的入口');C.addOutput(p,'my_out','我的出口');C.createInstance(p,'std.not/1','inv');C.addWire(p,'a',C.boundary('my_in'),C.ep('inv','in'));C.addWire(p,'b',C.ep('inv','out'),C.boundary('my_out'));const d=await C.encapsulate(p,'<img src=x onerror=alert(1)>','user.manual_test'),q=await C.createProject('自定义');q.definitions.push(d);q.locks.push(C.identity(d));C.createInstance(q,'user.manual_test','custom','<script>unsafe</script>');await LabAPI.loadWorkspace({project:q,view:{positions:{custom:{x:100,y:100}}},sources:{},lesson:null});});
   await page.locator('[data-panel="inspect"]').click();await page.locator('[data-node="custom"] .node-head').dispatchEvent('click');await page.locator('[data-manual-instance="custom"]').click();const text=await page.locator('#manual-content').innerText();assert.match(text,/当前契约/);assert.match(text,/my_in/);assert.match(text,/my_out/);assert.match(text,/<script>unsafe<\/script>/);assert.match(text,/user.manual_test/);assert.match(text,/时序、供电与复位/);assert.match(text,/combinational/);assert.match(text,/未声明/);assert.equal(await page.locator('#manual-content script,#manual-content img').count(),0);await close(page);
  });
  await check('reading and Escape preserve draft, applied snapshot, input queue and pending connection',async()=>{
   await page.evaluate(async()=>{await __lab.loadTemplate('smart-lamp');LabAPI.getRuntime().advance(1050n,{force:true});LabAPI.state.sources['instance:mcu']='; 未应用\nHALT';LabAPI.state.project.name='尚未应用的设计';LabAPI.changed();LabAPI.state.pending=CircuitLab.ep('mcu','GPIO1');LabAPI.getRuntime().setInput('button',1);});
   const before=await page.evaluate(()=>({session:LabAPI.captureSession(),pending:LabAPI.state.pending,room:OnlineLab.room,connection:OnlineLab.connection,running:LabAPI.isRunning()}));
   await page.locator('.topnav [data-manual-open]').click();await page.locator('#manual-search').fill('PWM');await page.locator('#manual-results [data-manual-entry]').first().click();await page.keyboard.press('Escape');assert.equal(await page.locator('#manual-dialog').evaluate(e=>e.open),false);assert.deepEqual(await page.evaluate(()=>({session:LabAPI.captureSession(),pending:LabAPI.state.pending,room:OnlineLab.room,connection:OnlineLab.connection,running:LabAPI.isRunning()})),before);
  });
  await check('reading a manual leaves an actively running simulation running',async()=>{
   await page.evaluate(async()=>__lab.loadTemplate('smart-lamp'));await page.locator('[data-action="run"]').click();const before=await page.evaluate(()=>LabAPI.getRuntime().time.toString());await page.locator('.topnav [data-manual-open]').click();await page.waitForFunction(t=>LabAPI.getRuntime().time>BigInt(t),before);assert.equal(await page.evaluate(()=>LabAPI.isRunning()),true);await close(page);assert.equal(await page.evaluate(()=>LabAPI.isRunning()),true);await page.evaluate(()=>LabAPI.stop());
  });
  await check('all 64 standard models have exact manuals and public entries cannot mutate the catalog',async()=>{
   const result=await page.evaluate(()=>{const all=LabManualV4.entries(),models=Object.keys(CircuitLab.catalog),missing=models.filter(m=>!all.some(e=>e.appliesTo.includes(m)));all[0].title='changed';return {count:models.length,missing,original:LabManualV4.entries()[0].title};});assert.equal(result.count,64);assert.deepEqual(result.missing,[]);assert.notEqual(result.original,'changed');
  });
  await page.locator('.topnav [data-manual-open]').click();await page.evaluate(()=>LabManualV4.open('std.alu8/1'));await page.screenshot({path:path.join(out,'manuals-v4-desktop.png')});await close(page);
  await check('standalone printable manual opens offline and filters actual address text',async()=>{const p=await context.newPage();await p.goto(pathToFileURL(path.join(root,'docs/CHIP-USER-MANUAL.html')).href);await p.locator('#search').fill('0x4000');assert.equal(await p.locator('article#core8-1').evaluate(e=>e.hidden),false);assert.match(await p.locator('article#core8-1').innerText(),/0x4000/);assert.ok(await p.locator('article[hidden]').count()>0);await p.close();});
  await check('390px touch screen can search, read, scroll and close without horizontal overflow',async()=>{
   const mobile=await browser.newContext({offline:true,serviceWorkers:'block',viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});const p=await mobile.newPage();p.on('pageerror',e=>errors.push(String(e)));await ready(p);await p.locator('.topnav [data-manual-open]').tap();await p.locator('#manual-search').fill('std.alu8/1');await p.locator('#manual-results [data-manual-entry]').tap();assert.match(await p.locator('#manual-content').innerText(),/15/);const widths=await p.evaluate(()=>({body:document.documentElement.scrollWidth,dialog:document.querySelector('#manual-dialog').scrollWidth,w:innerWidth}));assert.ok(widths.body<=widths.w,JSON.stringify(widths));assert.ok(widths.dialog<=widths.w,JSON.stringify(widths));await p.locator('#manual-content').evaluate(e=>e.scrollTop=300);assert.ok(await p.locator('#manual-content').evaluate(e=>e.scrollTop)>0);await p.screenshot({path:path.join(out,'manuals-v4-phone.png')});await close(p);await mobile.close();
  });
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'manuals-v4.json'),JSON.stringify({passed:passed.length,tests:passed,errors,offline:true},null,2));console.log(JSON.stringify({passed:passed.length,errors}));
 }catch(e){fs.writeFileSync(path.join(out,'manuals-v4.json'),JSON.stringify({passed:passed.length,tests:passed,errors,error:String(e)},null,2));await page.screenshot({path:path.join(out,'manuals-v4-failure.png')}).catch(()=>{});throw e;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
