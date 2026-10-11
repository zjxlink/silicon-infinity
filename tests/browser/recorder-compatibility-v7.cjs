'use strict';
// Representative real-runtime workflow checks; isolated browser profiles only.
const {chromium,firefox,webkit}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.GAME_URL||'http://127.0.0.1:4173',out=path.resolve(__dirname,'../../qa/v0.7');
fs.mkdirSync(path.join(out,'recorder'),{recursive:true});
const engines=[
 {id:'edge',type:chromium,options:{executablePath:process.env.EDGE_PATH,channel:process.env.EDGE_PATH?undefined:'msedge'}},
 {id:'firefox',type:firefox,options:{}},
 {id:'webkit',type:webkit,options:{}}
];
const report={base,startedAt:new Date().toISOString(),engines:[]};
const save=()=>fs.writeFileSync(path.join(out,'recorder-compatibility.json'),JSON.stringify(report,null,2));
(async()=>{
 for(const engine of engines){
  const result={engine:engine.id,results:[],errors:[]};report.engines.push(result);let browser,page;
  try{
   browser=await engine.type.launch({headless:true,...engine.options});result.version=await browser.version();
   const context=await browser.newContext({viewport:{width:1500,height:1000},acceptDownloads:true});page=await context.newPage();
   page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(30000);page.on('pageerror',error=>result.errors.push(error.message));
   const test=async(name,fn)=>{let timer;try{await Promise.race([fn(),new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Scenario timeout: '+name)),60000))]);result.results.push({name,ok:true});console.log('PASS '+engine.id+' '+name);}catch(error){result.results.push({name,ok:false,error:error.message});throw error;}finally{clearTimeout(timer);save();}};
   const session=()=>page.evaluate(()=>LabAPI.captureSession()),inspect=()=>page.evaluate(()=>RecorderV7.inspect(LabAPI.getRuntime()));
   const action=async(name)=>{await page.locator('[data-rec="'+name+'"]').click();await page.waitForFunction(()=>!RecorderUIV7.busy);};
   const submit=async(value,sequence='')=>{await page.locator('#recorder-value').fill(String(value));await page.locator('#recorder-sequence').fill(String(sequence));await action('submit');};
   const load=(program='polling')=>page.evaluate(program=>RecorderUIV7.load('reference',program),program);
   const close=async()=>{if(await page.locator('#dialog[open]').count())await page.locator('#dialog [data-action="close-dialog"]').first().click();};
   await page.goto(base);await page.waitForFunction(()=>window.RecorderUIV7&&window.RecorderV7&&window.MilestonesUIV7&&window.TimelineUIV7&&LabAPI.state.project);await page.waitForSelector('#loading',{state:'hidden'});
   await page.evaluate(()=>LabAPI.pause());const original=await session();
   await test('real first sample and sequence deduplication',async()=>{
    await page.locator('[data-rec="open"]').click();await page.locator('[data-rec-load="reference"]').click();await page.waitForFunction(()=>!RecorderUIV7.busy&&RecorderUIV7.active);
    await submit(25);let state=await inspect();assert(state.initialized);assert.equal(state.count,1);assert.equal(state.records[0].raw,0x0119);
    await submit(99,1);state=await inspect();assert.equal(state.count,1);assert.equal(state.records[0].value,25);
    assert.equal(await page.evaluate(()=>LabAPI.getRuntime().inspect().instances.ram.hardware.memory[16]),0x0119);
   });
   await test('pause resume clear and eight-slot full behavior',async()=>{
    await action('pause-record');await submit(41,2);await submit(63,3);assert.equal((await inspect()).count,1);await action('record');assert.equal((await inspect()).records[1].value,63);
    await action('clear');let state=await inspect();assert.equal(state.count,0);assert.equal(state.status,2);assert.equal(state.clearToken,1);await action('record');assert.equal((await inspect()).count,0);
    for(let n=0;n<9;n++)await submit(n===7?255:n);
    state=await inspect();assert.equal(state.count,8);assert.equal(state.status,3);assert.equal(state.records[0].value,0);assert.equal(state.records[7].value,255);assert.equal(await page.locator('[data-rec-record]').count(),8);
   });
   await test('graphic timeline edits run a real isolated custom contract',async()=>{
    await page.locator('[role="tab"][data-rec-view="verify"]').click();const before=await session(),progress=await page.evaluate(()=>RecorderUIV7.progress);
    await action('timeline');await page.locator('#timeline-seed').fill('987');await page.locator('[data-tl="metadata"]').click();await page.locator('[data-tl="apply"]').click();await page.waitForFunction(()=>!document.querySelector('#timeline-v7').open);
    await action('verify-edited');const result=await page.evaluate(()=>RecorderUIV7.lastResult);assert(result.experimental);assert(result.result.ok);assert(result.result.checks.length>0);assert.deepEqual(await session(),before);assert.deepEqual(await page.evaluate(()=>RecorderUIV7.progress),progress);
   });
   await test('two saved implementations are freshly compared under the same contract',async()=>{
    await load();await page.evaluate(()=>RecorderUIV7.compare());await page.locator('#milestone-name').fill(engine.id+' · 轮询');await page.locator('[data-milestone="save-current"]').click();await page.waitForFunction(()=>document.querySelectorAll('.milestone-list article').length===1);await close();
    await load('subroutine');await page.evaluate(()=>RecorderUIV7.compare());await page.locator('#milestone-name').fill(engine.id+' · 子程序');await page.locator('[data-milestone="save-current"]').click();await page.waitForFunction(()=>document.querySelectorAll('.milestone-list article').length===2);await close();
    await page.evaluate(()=>RecorderUIV7.compare());const before=await session();await page.locator('[data-milestone="compare"]').click();await page.waitForFunction(()=>!MilestonesUIV7.busy&&!!MilestonesUIV7.lastResult);
    const comparison=await page.evaluate(()=>MilestonesUIV7.lastResult);assert.equal(comparison.candidates.length,2);assert(comparison.candidates.every(candidate=>candidate.status==='passed'));assert.deepEqual(await session(),before);await close();
   });
   await test('broken program fails without changing the live scene and return restores the original',async()=>{
    await page.evaluate(()=>{LabAPI.state.project.circuit.instances.find(node=>node.id==='cpu').parameters.source='HALT';LabAPI.state.sources['architecture:cpu']='HALT';LabAPI.changed();});const before=await session();const failed=await page.evaluate(()=>RecorderUIV7.verify('sample'));assert(!failed.ok);assert.deepEqual(await session(),before);
    await page.evaluate(()=>RecorderUIV7.restore());assert.deepEqual(await session(),original);await load();
   });
   await test('390px layout keeps actual records and all workflow tabs reachable',async()=>{
    await page.setViewportSize({width:390,height:844});await page.evaluate(()=>RecorderUIV7.view('application'));await submit(77);assert.equal((await inspect()).records[0].value,77);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));let tabs=await page.locator('.rec-tabs').boundingBox();assert(tabs.y>=0&&tabs.y+tabs.height<=844);assert.equal(await page.locator('.rec-content').evaluate(el=>getComputedStyle(el).overflowY),'auto');
    await page.locator('.rec-content').evaluate(el=>el.scrollTop=0);await page.screenshot({path:path.join(out,'recorder',engine.id+'-application-phone.png'),fullPage:true});
    await page.locator('[role="tab"][data-rec-view="verify"]').click();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));tabs=await page.locator('.rec-tabs').boundingBox();assert(tabs.y>=0&&tabs.y+tabs.height<=844);await page.screenshot({path:path.join(out,'recorder',engine.id+'-verification-phone.png'),fullPage:true});assert.deepEqual(result.errors,[]);
   });
  }catch(error){result.error=error.message;process.exitCode=1;console.error(engine.id,error);try{await page.screenshot({path:path.join(out,'recorder',engine.id+'-compatibility-failure.png'),fullPage:true,timeout:5000});fs.writeFileSync(path.join(out,'recorder',engine.id+'-compatibility-failure.txt'),await page.locator('body').innerText({timeout:5000}));}catch{}}
  finally{if(browser)await browser.close();save();}
 }
 report.finishedAt=new Date().toISOString();save();const rows=report.engines.flatMap(engine=>engine.results);console.log('Recorder compatibility V7: '+rows.filter(row=>row.ok).length+'/'+rows.length+' scenarios passed across '+report.engines.length+' engines');
})().catch(error=>{console.error(error);process.exitCode=1;save();});
