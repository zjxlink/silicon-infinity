/* Real browser interactions against the served game; fixture setup uses the public bridge. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 fs.mkdirSync('test-results/browser',{recursive:true});
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 const page=await browser.newPage({viewport:{width:1700,height:1080},acceptDownloads:true}),errors=[],passed=[];
 page.on('pageerror',e=>errors.push(String(e)));
 const act=async name=>page.locator('[data-action="'+name+'"]').filter({visible:true}).first().click();
 const test=async(name,fn)=>{await fn();passed.push(name);console.log('PASS '+name);};
 const head=id=>page.locator('[data-drag="'+id+'"]');
 const state=()=>page.evaluate(()=>({selected:LabAPI.state.selection,positions:LabAPI.state.view.positions,dirty:LabAPI.state.dirty,project:LabAPI.state.project,time:LabAPI.state.rt.inspect().time}));
 const fixture=async()=>{await page.evaluate(async()=>{const C=CircuitLab,p=await C.createProject('编辑器验证电路');C.addInput(p,'a','输入A',0);C.addOutput(p,'y','输出Y');C.createInstance(p,'std.not/1','inv','非门');C.createInstance(p,'std.and/1','aux','备用与门');C.addWire(p,'i',C.boundary('a'),C.ep('inv','in'));C.addWire(p,'o',C.ep('inv','out'),C.boundary('y'));await LabAPI.loadWorkspace({project:p,view:{positions:{'boundary:a':{x:60,y:70},inv:{x:310,y:70},'boundary:y':{x:570,y:70},aux:{x:310,y:360}}}});});await page.waitForFunction(()=>LabAPI.state.project.name==='编辑器验证电路');await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));};
 try{
  await page.goto(process.env.EDITOR_URL||'http://127.0.0.1:4173');await page.waitForFunction(()=>!!window.__lab&&!!window.LabAPI);
  await test('bridge is available and reports workspace/render/tick events from real operations',async()=>{
   await page.evaluate(()=>{window.editorEvents={workspace:0,render:0,tick:0};for(const k of Object.keys(editorEvents))document.addEventListener('lab:'+k,()=>editorEvents[k]++);});await fixture();await act('step');
   const events=await page.evaluate(()=>editorEvents);assert.ok(events.workspace>=1&&events.render>=1&&events.tick>=1);assert.equal((await state()).time,'1');
   assert.equal(await page.evaluate(()=>LabAPI.getWorkspace().project.name),'编辑器验证电路');
  });
  await test('Shift multi-selection, group drag and view-only undo/redo preserve actual simulation',async()=>{
   await fixture();await head('boundary:a').click();await head('inv').click({modifiers:['Shift']});assert.equal((await state()).selected.length,2);
   const before=await state(),box=await head('inv').boundingBox(),zoom=await page.evaluate(()=>LabAPI.state.zoom),snapshot=await page.evaluate(()=>LabAPI.getRuntime().snapshot());
   await page.mouse.move(box.x+box.width/2,box.y+14);await page.mouse.down();await page.mouse.move(box.x+box.width/2+80*zoom,box.y+14+50*zoom,{steps:8});await page.mouse.up();
   const moved=await state();for(const id of ['boundary:a','inv']){assert.equal(moved.positions[id].x-before.positions[id].x,80);assert.equal(moved.positions[id].y-before.positions[id].y,50);}assert.equal(moved.dirty,false);
   assert.deepEqual(await page.evaluate(()=>LabAPI.getRuntime().snapshot()),snapshot);
   await page.keyboard.press('Control+z');assert.deepEqual((await state()).positions,before.positions);await page.keyboard.press('Control+Shift+z');assert.deepEqual((await state()).positions,moved.positions);
  });
  await test('blank-canvas rectangle selects intersecting nodes and Shift-click removes one',async()=>{
   await fixture();const a=await page.locator('[data-node="boundary:a"]').boundingBox(),b=await page.locator('[data-node="inv"]').boundingBox();
   await page.mouse.move(a.x-10,a.y-10);await page.mouse.down();await page.mouse.move(b.x+b.width+10,Math.max(a.y+a.height,b.y+b.height)+10,{steps:9});await page.mouse.up();
   assert.deepEqual((await state()).selected.map(x=>x.id).sort(),['boundary:a','inv']);assert.equal(await page.locator('#selection-box').isHidden(),true);
   await head('inv').click({modifiers:['Shift']});assert.deepEqual((await state()).selected.map(x=>x.id),['boundary:a']);
  });
  await test('copy/paste preserves only internal wires and independent input behavior',async()=>{
   await fixture();await head('boundary:a').click();await head('inv').click({modifiers:['Shift']});await page.keyboard.press('Control+c');await page.waitForFunction(()=>!document.querySelector('[data-action="paste-selection"]').disabled);await page.keyboard.press('Control+v');await page.waitForFunction(()=>LabAPI.state.project.circuit.instances.length===3);
   const s=await state();assert.equal(s.project.circuit.inputs.length,2);assert.equal(s.project.circuit.wires.length,3);assert.equal(s.selected.length,2);
   const input=s.project.circuit.inputs.find(x=>x.id!=='a').id,inv=s.project.circuit.instances.find(x=>!['inv','aux'].includes(x.id)).id;
   await act('apply');assert.equal(await page.evaluate(id=>CircuitLab.scalar(LabAPI.getRuntime().getPort(CircuitLab.ep(id,'out'))),inv),1);
   await page.locator('[data-input="'+input+'"]').click();await act('step');
   assert.equal(await page.evaluate(id=>CircuitLab.scalar(LabAPI.getRuntime().getPort(CircuitLab.ep(id,'out'))),inv),0);
   assert.equal(await page.evaluate(()=>CircuitLab.scalar(LabAPI.getRuntime().getPort(CircuitLab.ep('inv','out')))),1);
  });
  await test('batch deletion removes incident wires atomically and supports undo/redo',async()=>{
   const before=await state();await page.keyboard.press('Delete');await page.waitForFunction(()=>LabAPI.state.project.circuit.instances.length===2);
   assert.equal((await state()).project.circuit.wires.length,2);await act('undo');assert.deepEqual((await state()).project,before.project);await act('redo');assert.equal((await state()).project.circuit.instances.length,2);await act('undo');
  });
  await test('automatic layout and orthogonal routing change geometry without restarting the circuit',async()=>{
   await fixture();await act('step');const before=await state(),snapshot=await page.evaluate(()=>LabAPI.getRuntime().snapshot());await act('auto-layout');const after=await state();assert.notDeepEqual(after.positions,before.positions);assert.deepEqual(after.project,before.project);assert.equal(after.dirty,false);assert.deepEqual(await page.evaluate(()=>LabAPI.getRuntime().snapshot()),snapshot);
   for(const d of await page.locator('[data-wire]').evaluateAll(es=>es.map(e=>e.getAttribute('d'))))assert.ok(d.includes('L ')&&!d.includes('C '));
   await act('undo');assert.deepEqual((await state()).positions,before.positions);await act('redo');assert.deepEqual((await state()).positions,after.positions);await act('route-wires');assert.ok((await page.locator('[data-wire]').first().getAttribute('d')).includes('C '));
  });
  await test('full MCU board clipboard moves dependencies and firmware across projects without aliasing',async()=>{
   await page.evaluate(async()=>{const b=await LabLessons.build('smart-lamp');await LabAPI.loadWorkspace(b);});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(r)));await page.keyboard.press('Control+a');await page.keyboard.press('Control+c');
   await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('已复制'));await act('new');await act('paste-selection');await page.waitForFunction(()=>LabAPI.state.project.circuit.instances.some(n=>n.bindings.firmware));
   await act('paste-selection');await page.waitForFunction(()=>LabAPI.state.project.circuit.instances.filter(n=>n.bindings.firmware).length===2);
   const s=await state(),cpus=s.project.circuit.instances.filter(n=>n.bindings.firmware);assert.notEqual(cpus[0].bindings.firmware,cpus[1].bindings.firmware);assert.notEqual(cpus[0].bindings.power,cpus[1].bindings.power);assert.equal((await page.evaluate(()=>CircuitLab.validate(LabAPI.state.project))).ok,true);
   await act('apply');await page.locator('[data-panel="terminal"]').click();await act('advance-100ms');
   const histories=await page.evaluate(()=>Object.values(LabAPI.getRuntime().inspect().terminals).map(t=>t.history.entries.filter(e=>e.kind==='byte').map(e=>e.byte)));assert.deepEqual(histories,[[66],[66]]);
   await head(cpus[0].id).click();await page.locator('[data-panel="inspect"]').click();await page.locator('.port-reference summary').click();assert.match(await page.locator('.port-reference').innerText(),/GPIO0/);assert.match(await page.locator('.port-reference').innerText(),/1042/);
   await page.evaluate(()=>{window.editorSaved=LabAPI.bundle();});await act('new');await page.evaluate(()=>LabAPI.loadWorkspace(editorSaved));assert.equal((await state()).project.firmware.length,2);
  });
  await test('duplicate a packaged module preserves independent nested firmware and source bindings',async()=>{
   await page.evaluate(async()=>{const b=await LabLessons.build('smart-lamp'),C=CircuitLab,p=await C.createProject('封装复制');const pkg=await C.packageModule(b.project,'灯板','user.editorLamp',{sourceMap:Object.fromEntries(b.project.firmware.map(f=>[f.id,b.source]))});const m=await C.placeModule(p,pkg,'board');await LabAPI.loadWorkspace({project:p,sources:m.sourceMap});});
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(r)));await head('board').click();await page.keyboard.press('Control+d');await page.waitForFunction(()=>LabAPI.state.project.circuit.instances.length===2);const p=(await state()).project;assert.notDeepEqual(p.circuit.instances[0].definition,p.circuit.instances[1].definition);
   await act('apply');await page.locator('[data-panel="terminal"]').click();await act('advance-100ms');assert.equal(await page.evaluate(()=>Object.keys(LabAPI.state.state.terminals).length),2);assert.deepEqual(await page.evaluate(()=>Object.values(LabAPI.state.state.terminals).map(t=>t.history.entries.filter(x=>x.kind==='byte').map(x=>x.byte))),[[66],[66]]);
  });
  await test('all run, manual advance and single-step controls honor the installed simulation driver',async()=>{
   await fixture();await page.evaluate(()=>{window.driverCalls=[];LabAPI.setSimulationDriver({advance(d,o){driverCalls.push('advance');return LabAPI.getRuntime().advance(d,o);},stepTick(){driverCalls.push('tick');return LabAPI.getRuntime().stepTick();},stepInstruction(p){driverCalls.push('instruction');return LabAPI.getRuntime().stepInstruction(p);}});});
   await act('step');await page.locator('[data-panel="terminal"]').click();await act('advance-1ms');await act('run');await page.waitForTimeout(150);await act('run');assert.ok(await page.evaluate(()=>driverCalls.includes('tick')&&driverCalls.filter(x=>x==='advance').length>=2));
   await page.evaluate(async()=>{await LabAPI.loadWorkspace(await LabLessons.build('smart-lamp'));});await act('step');assert.ok(await page.evaluate(()=>driverCalls.includes('instruction')));await page.evaluate(()=>LabAPI.setSimulationDriver(null));
  });
  await test('small-screen editing controls remain available and multi-selection operations work',async()=>{
   await page.setViewportSize({width:390,height:844});await fixture();await act('box-select');assert.equal(await page.locator('[data-action="box-select"]').getAttribute('aria-pressed'),'true');await act('select-all');assert.ok((await state()).selected.length>3);await act('copy-selection');await act('paste-selection');await page.waitForFunction(()=>LabAPI.state.project.circuit.instances.length===4);assert.equal(await page.locator('[data-action="undo"]').isVisible(),true);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await page.screenshot({path:'test-results/browser/editor-v3-mobile.png',fullPage:true});
  });
  assert.deepEqual(errors,[]);await page.setViewportSize({width:1700,height:1080});await fixture();await act('auto-layout');await page.screenshot({path:'test-results/browser/editor-v3-desktop.png',fullPage:true});
  fs.writeFileSync('test-results/browser/editor-v3.json',JSON.stringify({passed,errors},null,2));console.log(passed.length+' editor browser scenarios passed.');
 }catch(e){await page.screenshot({path:'test-results/browser/editor-v3-failure.png',fullPage:true});console.error(e);process.exitCode=1;}finally{await browser.close();}
})();
