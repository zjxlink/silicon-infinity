'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})}),context=await browser.newContext({viewport:{width:1500,height:1000},acceptDownloads:true}),page=await context.newPage(),passed=[],errors=[];let mobile;
 const out='test-results/browser';fs.mkdirSync(out,{recursive:true});page.on('pageerror',e=>errors.push(String(e)));
 const button=async(p,attribute,value)=>{const selector='['+attribute+'="'+value+'"]',inside=p.locator('#dialog[open] '+selector);await (await inside.count()?inside:p.locator(selector).filter({visible:true})).first().click();};
 const ws=(name,p=page)=>button(p,'data-workspace',name),act=(name,p=page)=>button(p,'data-action',name);
 const check=async(name,fn)=>{await fn();passed.push(name);console.log('PASS '+name);};
 const ready=async p=>{await p.goto(process.env.WORKSPACES_URL||'http://127.0.0.1:4173');await p.waitForFunction(()=>window.WorkspacesV4?.ui?.ready&&window.__lab);};
 async function close(p=page){if(await p.locator('#dialog[open]').count())await act('close-dialog',p);}
 async function touch(cdp,type,points){await cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map((p,i)=>({x:p.x,y:p.y,id:i+1,radiusX:3,radiusY:3}))});}
 async function dragTouch(cdp,a,b){await touch(cdp,'touchStart',[a]);for(let i=1;i<=6;i++)await touch(cdp,'touchMove',[{x:a.x+(b.x-a.x)*i/6,y:a.y+(b.y-a.y)*i/6}]);await touch(cdp,'touchEnd',[]);}
 let savedId,manualRevision,baseline;
 try{
  await ready(page);
  await check('manual save keeps an unapplied source draft and the exact running MCU state',async()=>{
   await page.evaluate(async()=>{await __lab.loadTemplate('smart-lamp');LabAPI.getRuntime().advance(1050n,{force:true});LabAPI.updateSignals();LabAPI.state.sources['instance:mcu']='; 未编译源码\nWAIT 30000';LabAPI.state.project.name='作品管理验收';LabAPI.changed();});
   baseline=await page.evaluate(()=>LabAPI.captureSession());await ws('save');await page.waitForSelector('.workspace-list');
   savedId=await page.evaluate(()=>WorkspacesV4.ui.activeId);const p=await page.evaluate(id=>WorkspacesV4.ui.store.get(id),savedId);manualRevision=p.manualRevisionId;
   assert.equal(p.revisions.find(r=>r.id===manualRevision).session.snapshot.time,'1050');assert.equal(p.revisions.find(r=>r.id===manualRevision).session.workspace.sources['instance:mcu'],'; 未编译源码\nWAIT 30000');
   assert.match(await page.locator('#save-state').textContent(),/手动保存/);
  });
  await check('save as and rename maintain separate project records',async()=>{
   await ws('save-as');await page.locator('#workspace-name').fill('独立副本');await ws('name-confirm');await page.waitForFunction(()=>WorkspacesV4.ui.store.list().some(x=>x.name==='独立副本'));
   const id=await page.evaluate(()=>WorkspacesV4.ui.activeId);assert.notEqual(id,savedId);await page.locator('[data-workspace="rename"][data-id="'+id+'"]').click();await page.locator('#workspace-name').fill('重新命名副本');await ws('name-confirm');assert.equal(await page.evaluate(id=>WorkspacesV4.ui.store.get(id).name,id),'重新命名副本');assert.equal(await page.evaluate(id=>WorkspacesV4.ui.store.get(id).name,savedId),'作品管理验收');
  });
  await check('history comparison displays actual object and source changes',async()=>{
   await close();await page.evaluate(()=>{LabAPI.state.sources['instance:mcu']='; 第二个源版本\nHALT';LabAPI.state.project.circuit.instances[0].label='电源新标签';LabAPI.changed();});await ws('list');
   await page.locator('[data-workspace="history"][data-id="'+savedId+'"]').click();await page.locator('#workspace-before').selectOption(manualRevision);await ws('compare');
   assert.match(await page.locator('#dialog-body').textContent(),/sources\/instance:mcu/);assert.match(await page.locator('#dialog-body').textContent(),/circuit\/instances/);
   assert.match(await page.locator('#dialog-body').textContent(),/第二个源版本/);
  });
  await check('restoring an older record resumes RAM and events while keeping draft unapplied',async()=>{
   await ws('history');await page.locator('[data-workspace="restore"][data-revision="'+manualRevision+'"]').click();await page.waitForFunction(()=>!document.querySelector('#dialog').open);
   const actual=await page.evaluate(()=>LabAPI.captureSession());assert.deepEqual(actual.snapshot,baseline.snapshot);assert.deepEqual(actual.workspace.sources,baseline.workspace.sources);assert.equal(await page.evaluate(()=>LabAPI.state.dirty),true);
  });
  await check('quota failure does not claim success or replace the current project',async()=>{
   const before=await page.evaluate(()=>LabAPI.captureSession()),raw=await page.evaluate(()=>WorkspacesV4.ui.store.raw());
   await page.evaluate(()=>{window.originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===WorkspacesV4.KEY)throw new DOMException('quota','QuotaExceededError');return originalSetItem.call(this,k,v);};});
   await ws('save');await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('未保存'));
   assert.deepEqual(await page.evaluate(()=>LabAPI.captureSession()),before);assert.equal(await page.evaluate(()=>WorkspacesV4.ui.store.raw()),raw);
   assert.match(await page.locator('#save-state').textContent(),/未保存/);await page.evaluate(()=>Storage.prototype.setItem=originalSetItem);
  });
  await check('delete requires confirmation, cancellation preserves records, and new creation is saved',async()=>{
   await ws('list');const count=await page.locator('.workspace-card').count();const id=await page.locator('[data-workspace="delete"]').last().getAttribute('data-id');
   await page.locator('[data-workspace="delete"][data-id="'+id+'"]').click();assert.equal(await page.evaluate(id=>!!WorkspacesV4.ui.store.get(id),id),true);await ws('list');assert.equal(await page.locator('.workspace-card').count(),count);
   await page.locator('[data-workspace="delete"][data-id="'+id+'"]').click();await ws('delete-confirm');assert.equal(await page.evaluate(id=>WorkspacesV4.ui.store.get(id),id),null);
   await ws('new');await page.locator('#workspace-name').fill('空白新作品');await ws('name-confirm');await page.waitForFunction(()=>LabAPI.state.project.name==='空白新作品');assert.equal(await page.evaluate(()=>LabAPI.state.project.circuit.instances.length),0);assert.ok(await page.evaluate(()=>WorkspacesV4.ui.store.get(WorkspacesV4.ui.activeId).manualRevisionId));
  });
  await check('page reload restores the selected project and export contains a complete session',async()=>{
   await close();await page.reload();await page.waitForFunction(()=>WorkspacesV4.ui?.ready&&LabAPI.state.project.name==='空白新作品');
   await ws('list');const pending=page.waitForEvent('download');await ws('export-current');const file=await pending,path=out+'/workspaces-v4-export.json';await file.saveAs(path);const payload=JSON.parse(fs.readFileSync(path,'utf8'));assert.equal(payload.format,'silicon-lab.session/1');assert.ok(payload.applied.project.definitions.length);assert.ok(payload.snapshot);await page.screenshot({path:out+'/workspaces-v4-desktop.png'});
  });
  await check('room presence blocks local save restore and new work without mutating current state',async()=>{
   await close();const before=await page.evaluate(()=>LabAPI.captureSession());await page.evaluate(()=>{window.realOnlineLab=window.OnlineLab;window.OnlineLab={room:{id:'guard-fixture'},connection:'offline',pending:true};});
   await ws('save');await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('退出协作房间'));
   const result=await page.evaluate(async()=>{try{await WorkspacesV4.ui.open(WorkspacesV4.ui.activeId);return false;}catch{return true;}});assert.equal(result,true);assert.deepEqual(await page.evaluate(()=>LabAPI.captureSession()),before);await page.evaluate(()=>window.OnlineLab=realOnlineLab);
  });
  await check('full MCU module upgrade previews real dependency changes and undo preserves both original instances',async()=>{
   await page.evaluate(async()=>{const C=CircuitLab,entries=[];for(const revision of [1,2]){const built=await LabLessons.build('smart-lamp'),program=built.project.firmware[0].id,source=Core8.SAMPLES.find(s=>s.id==='blinkButton').source.replace('WAIT 60000','WAIT '+(revision===1?60000:30000));built.project.firmware=[];await C.addFirmware(built.project,program,Core8.assemble(source).bytes);const module=await C.packageModule(built.project,'可升级灯板','test.workspace.module',{revision,sourceMap:{[program]:source}});entries.push({definition:module.definition,dependencies:module.definitions,module,project:built.project,sources:module.sourceMap,view:{positions:{}},created:revision});}await LabAPI.loadWorkspace({project:await C.createProject('升级宿主'),view:{positions:{}},sources:{}});LabAPI.state.library=entries;});
   const place=async()=>{await act('library');await page.locator('[data-place-chip="0"]').click();return page.evaluate(()=>LabAPI.state.selected.id);};
   const id=await place(),other=await place();await act('apply');await page.evaluate(id=>{LabAPI.selectItems([{type:'node',id}]);LabAPI.renderInspector();},id);
   const before=await page.evaluate(()=>LabAPI.captureSession());await act('preview-chip-upgrade');assert.match(await page.locator('#dialog-body').textContent(),/接口兼容/);assert.match(await page.locator('#dialog-body').textContent(),/definition/);assert.deepEqual(await page.evaluate(()=>LabAPI.captureSession()),before);
   await act('confirm-chip-upgrade');assert.equal(await page.evaluate(()=>LabAPI.state.dirty),true);assert.equal(await page.evaluate(id=>LabAPI.state.view.moduleOrigins[id].revision,id),2);assert.equal(await page.evaluate(id=>LabAPI.state.view.moduleOrigins[id].revision,other),1);assert.deepEqual(await page.evaluate(()=>LabAPI.getRuntime().snapshot()),before.snapshot);
   await act('undo');assert.deepEqual(await page.evaluate(()=>LabAPI.state.project),before.workspace.project);assert.deepEqual(await page.evaluate(()=>LabAPI.state.sources),before.workspace.sources);
   await act('preview-chip-upgrade');await act('confirm-chip-upgrade');await act('apply');const verdict=await page.evaluate(({id,other})=>{const C=CircuitLab,r=LabAPI.getRuntime();r.advance(30025n,{force:true});return {a:C.scalar(r.getPort(C.ep(id,'led'))),b:C.scalar(r.getPort(C.ep(other,'led'))),origins:LabAPI.bundle().view.moduleOrigins};},{id,other});assert.equal(verdict.a,0);assert.equal(verdict.b,1);assert.equal(verdict.origins[id].revision,2);
  });
  await check('renamed inactive project opens with its new name while historical records remain unchanged',async()=>{
   await ws('list');const id=await page.evaluate(()=>WorkspacesV4.ui.store.list().find(p=>p.id!==WorkspacesV4.ui.activeId).id),old=await page.evaluate(id=>WorkspacesV4.ui.store.get(id).revisions,id);await page.locator('[data-workspace="rename"][data-id="'+id+'"]').click();await page.locator('#workspace-name').fill('新的作品名称');await ws('name-confirm');await page.locator('[data-workspace="open"][data-id="'+id+'"]').click();assert.equal(await page.evaluate(()=>LabAPI.state.project.name),'新的作品名称');assert.deepEqual(await page.evaluate(id=>WorkspacesV4.ui.store.get(id).revisions,id),old);
  });
  await check('renaming through the existing project title updates the automatic project record',async()=>{
   await act('rename');await page.locator('#project-rename').fill('标题入口改名后保留');await act('save-name');await page.evaluate(()=>WorkspacesV4.ui.backup());const value=await page.evaluate(()=>({id:WorkspacesV4.ui.activeId,name:WorkspacesV4.ui.store.get(WorkspacesV4.ui.activeId).name}));assert.equal(value.name,'标题入口改名后保留');await page.evaluate(id=>WorkspacesV4.ui.open(id),value.id);assert.equal(await page.evaluate(()=>LabAPI.state.project.name),value.name);
  });
  await check('starting a course inside a chip clears its parent button and returning restores both hierarchy and runtime',async()=>{
   await page.evaluate(async()=>{await __lab.loadTemplate('smart-lamp');LabAPI.getRuntime().advance(503n,{force:true});LabAPI.getRuntime().setInput('button',1,700n);LabAPI.state.sources['instance:mcu']='; 父层草稿\nHALT';LabAPI.state.project.name='带现场的父层';LabAPI.changed();window.navRoot=LabAPI.captureSession();});
   await act('library');await act('library-standard');await page.locator('[data-standard-open]').first().click();assert.equal(await page.evaluate(()=>LabAPI.state.parents.length),1);await page.evaluate(async()=>{window.navInner=LabAPI.captureSession();await WorkspacesV4.ui.save();window.navSaved={id:WorkspacesV4.ui.activeId,revision:WorkspacesV4.ui.store.get(WorkspacesV4.ui.activeId).manualRevisionId};LabAPI.closeModal();await LabLearning.start('lamp');});
   assert.equal(await page.locator('[data-action="parent"]').isVisible(),false);assert.equal(await page.evaluate(()=>LabAPI.state.parents.length),0);await page.evaluate(()=>LabLearning.finish(true));assert.deepEqual(await page.evaluate(()=>LabAPI.captureSession()),await page.evaluate(()=>window.navInner));assert.equal(await page.locator('[data-action="parent"]').isVisible(),true);await act('parent');assert.deepEqual(await page.evaluate(()=>LabAPI.captureSession()),await page.evaluate(()=>window.navRoot));
  });
  await check('external workspaces and legacy sessions clear stale navigation while saved nested sessions restore it',async()=>{
   await page.evaluate(()=>LabAPI.restoreSession(window.navInner));await page.evaluate(async()=>LabAPI.loadWorkspace({project:await CircuitLab.createProject('独立的新作品'),view:{positions:{}},sources:{}}));assert.equal(await page.evaluate(()=>LabAPI.state.parents.length),0);assert.equal(await page.locator('[data-action="parent"]').isVisible(),false);
   await page.evaluate(async()=>{const old=JSON.parse(JSON.stringify(window.navInner));delete old.parents;await LabAPI.restoreSession(old);});assert.equal(await page.evaluate(()=>LabAPI.state.parents.length),0);
   await page.evaluate(()=>WorkspacesV4.ui.open(window.navSaved.id,window.navSaved.revision));assert.equal(await page.evaluate(()=>LabAPI.state.parents.length),1);assert.deepEqual(await page.evaluate(()=>LabAPI.captureSession()),await page.evaluate(()=>window.navInner));await act('parent');assert.deepEqual(await page.evaluate(()=>LabAPI.captureSession()),await page.evaluate(()=>window.navRoot));
  });
  await check('explicit large hardware advance yields to UI and Run cancels the remaining time',async()=>{
   await page.evaluate(async()=>{const C=CircuitLab,p=await C.createProject('可取消的大电路');C.addInput(p,'one','one',1);C.addInput(p,'zero','zero',0);for(let i=0;i<40;i++){const id='d'+i;C.createInstance(p,'std.dff/1',id);for(const port of ['d','en','reset'])C.addWire(p,id+port,C.boundary(port==='reset'?'zero':'one'),C.ep(id,port));}await LabAPI.loadWorkspace({project:p,view:{positions:{}},sources:{}});window.longAdvance=LabAPI.action('advance-100ms').then(()=>{window.longDone=true;});});
   await page.waitForFunction(()=>LabAPI.state.advancing===true);assert.match(await page.locator('#run-button').textContent(),/取消推进/);await act('run');await page.waitForFunction(()=>window.longDone);const stopped=await page.evaluate(()=>({time:LabAPI.getRuntime().time.toString(),advancing:LabAPI.state.advancing}));assert.ok(BigInt(stopped.time)>0n&&BigInt(stopped.time)<100000n);assert.equal(stopped.advancing,false);const after=stopped.time;await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>LabAPI.getRuntime().time.toString()),after);
  });
  const phone=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});mobile=await phone.newPage();mobile.on('pageerror',e=>errors.push(String(e)));await ready(mobile);const cdp=await phone.newCDPSession(mobile);
  await mobile.evaluate(async()=>{const C=CircuitLab,p=await C.createProject('触屏真实操作');C.addInput(p,'a','输入');C.addOutput(p,'y','输出');C.createInstance(p,'std.not/1','inv');await LabAPI.loadWorkspace({project:p,view:{positions:{'boundary:a':{x:50,y:60},inv:{x:320,y:60},'boundary:y':{x:590,y:60}}},sources:{}});});await mobile.waitForTimeout(150);
  await check('touch drag moves the node and tap-to-connect creates real signal flow',async()=>{
   const head=mobile.locator('[data-drag="inv"]'),box=await head.boundingBox(),old=await mobile.evaluate(()=>({...LabAPI.state.view.positions.inv}));await dragTouch(cdp,{x:box.x+box.width/2,y:box.y+8},{x:box.x+box.width/2+18,y:box.y+28});await mobile.waitForTimeout(350);assert.notDeepEqual(await mobile.evaluate(()=>LabAPI.state.view.positions.inv),old);
   const port=async(kind,id,name)=>{const handles=await mobile.locator('[data-endpoint]').all();for(const el of handles){const e=JSON.parse(await el.getAttribute('data-endpoint'));if(e.kind===kind&&e.port===name&&(kind==='boundary'||e.instance===id)){await el.tap();return;}}throw Error('missing port');};
   await port('boundary',null,'a');await port('instance','inv','in');await port('instance','inv','out');await port('boundary',null,'y');assert.equal(await mobile.evaluate(()=>LabAPI.state.project.circuit.wires.length),2);
   await act('apply',mobile);assert.equal(await mobile.evaluate(()=>CircuitLab.scalar(LabAPI.getRuntime().getPort(CircuitLab.boundary('y')))),1);
  });
  await check('two-finger pinch changes circuit zoom without moving nodes',async()=>{
   const stage=await mobile.locator('#stage').boundingBox(),x=stage.x+stage.width/2,y=stage.y+stage.height*.65,before=await mobile.evaluate(()=>({zoom:LabAPI.state.zoom,p:LabAPI.state.view.positions}));
   await touch(cdp,'touchStart',[{x:x-25,y},{x:x+25,y}]);await touch(cdp,'touchMove',[{x:x-60,y},{x:x+60,y}]);await touch(cdp,'touchEnd',[]);await mobile.waitForTimeout(100);
   const after=await mobile.evaluate(()=>({zoom:LabAPI.state.zoom,p:LabAPI.state.view.positions}));assert.ok(after.zoom>before.zoom+.05,'pinch must zoom the actual circuit');assert.deepEqual(after.p,before.p);
  });
  await check('one-finger canvas pan scrolls the circuit without moving nodes',async()=>{
   const stage=await mobile.locator('#stage').boundingBox(),before=await mobile.evaluate(()=>({left:document.querySelector('#stage').scrollLeft,top:document.querySelector('#stage').scrollTop,p:LabAPI.state.view.positions}));await dragTouch(cdp,{x:stage.x+stage.width*.75,y:stage.y+stage.height*.85},{x:stage.x+stage.width*.45,y:stage.y+stage.height*.60});const after=await mobile.evaluate(()=>({left:document.querySelector('#stage').scrollLeft,top:document.querySelector('#stage').scrollTop,p:LabAPI.state.view.positions}));assert.ok(after.left!==before.left||after.top!==before.top);assert.deepEqual(after.p,before.p);
  });
  await check('touch marquee selects real nodes and workspace controls fit mobile width',async()=>{
   await act('fit',mobile);await mobile.locator('[data-action="box-select"]').tap();const world=await mobile.locator('#world').boundingBox(),zoom=await mobile.evaluate(()=>LabAPI.state.zoom);
   await dragTouch(cdp,{x:world.x+25*zoom,y:world.y+35*zoom},{x:world.x+540*zoom,y:world.y+250*zoom});await mobile.waitForTimeout(200);assert.ok(await mobile.evaluate(()=>LabAPI.state.selection.length>=2));
   await ws('list',mobile);assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await mobile.screenshot({path:out+'/workspaces-v4-mobile.png'});
  });
  assert.deepEqual(errors,[]);
 }catch(e){errors.push(e.stack||String(e));console.error(e);process.exitCode=1;await (mobile||page).screenshot({path:out+'/workspaces-v4-failure.png'});}
 finally{fs.writeFileSync(out+'/workspaces-v4-results.json',JSON.stringify({browser:await browser.version(),passed,errors},null,2));console.log(JSON.stringify({passed:passed.length,errors},null,2));await browser.close();}
})();
