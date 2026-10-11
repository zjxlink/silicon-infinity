'use strict';
// Real browser + actual loopback cloud API. Fixtures are server-validated packages,
// never inserted into the database or supplied by request interception.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 const suffix=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7),query='分页验收-'+suffix;
 const context=await browser.newContext({viewport:{width:1440,height:1000},extraHTTPHeaders:{'oai-authenticated-user-id':'cloud-library-'+suffix}});
 const page=await context.newPage(),passed=[],errors=[],requests=[];
 const out='test-results/browser';fs.mkdirSync(out,{recursive:true});
 page.on('pageerror',e=>errors.push(e.stack||String(e)));
 page.on('request',r=>{const u=new URL(r.url());if(u.pathname==='/api/library')requests.push({method:r.method(),query:u.searchParams.get('q'),offset:Number(u.searchParams.get('offset')||0),body:r.method()==='POST'?r.postDataJSON():null});});
 const click=name=>page.locator('[data-cloud="'+name+'"]').filter({visible:true}).first().click();
 const title=()=>page.locator('#dialog .dialog-head h2');
 const count=()=>page.locator('[data-cloud-chip]').count();
 const waitPage=async(number,size)=>{await page.waitForFunction(({number,size})=>document.querySelector('.cloud-pagination span')?.textContent==='第 '+number+' 页'&&document.querySelectorAll('[data-cloud-chip]').length===size,{number,size});};
 const check=async(name,fn)=>{await fn();passed.push(name);console.log('PASS '+name);};
 let fixtures,firstPageIds;
 try{
  await page.goto(process.env.ONLINE_URL||'http://127.0.0.1:4174');
  await page.waitForFunction(()=>!!window.OnlineLab&&!!window.LabAPI?.state.project);
  await check('31 valid private immutable chips are published through the real server',async()=>{
   fixtures=await page.evaluate(async({suffix,query})=>{
    const C=window.CircuitLab,p=await C.createProject('分页夹具');
    C.addInput(p,'a','输入',0);C.addOutput(p,'y','输出');
    C.createInstance(p,'std.not/1','gate');
    C.addWire(p,'input',C.boundary('a'),C.ep('gate','in'));
    C.addWire(p,'output',C.ep('gate','out'),C.boundary('y'));
    const project=await C.importProject(p),rows=[];window.cloudLibraryFixtures=[];
    for(let i=0;i<31;i++){
     const name=query+' '+String(i).padStart(2,'0'),definition=await C.encapsulate(project,name,'user.page.'+suffix+'.'+i);
     const pkg={format:'silicon-lab.chip/2',definition,dependencies:project.definitions,project,view:{positions:{}},sources:{},module:null};
     const r=await fetch('/api/library',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestId:'fixture-'+i,package:pkg,title:name,description:query,visibility:'private',license:'private'})}),body=await r.json();
     if(r.status!==201)throw Error('Fixture '+i+': '+r.status+' '+JSON.stringify(body));
     window.cloudLibraryFixtures.push(pkg);rows.push({id:body.chipId,revision:body.revision,stable:definition.stableId,name});
    }return rows;
   },{suffix,query});
   assert.equal(fixtures.length,31);assert.ok(fixtures.every(x=>x.revision===1));assert.equal(new Set(fixtures.map(x=>x.id)).size,31);
  });
  await check('first page shows 30 search results and correct navigation availability',async()=>{
   await click('home');await click('library');await page.locator('#cloud-search').fill(query);await click('search');await waitPage(1,30);
   assert.equal(await page.locator('[data-cloud="library-previous"]').isDisabled(),true);
   assert.equal(await page.locator('[data-cloud="library-next"]').isDisabled(),false);
   firstPageIds=await page.locator('[data-cloud-chip]').evaluateAll(xs=>xs.map(x=>x.dataset.cloudChip));
   assert.ok(!firstPageIds.includes(fixtures[0].id),'earliest fixture must be beyond page one');
  });
  await check('next and previous pages preserve search and expose all 31 distinct chips',async()=>{
   await click('library-next');await waitPage(2,1);assert.equal(await page.locator('#cloud-search').inputValue(),query);
   assert.equal(await page.locator('[data-cloud-chip]').first().getAttribute('data-cloud-chip'),fixtures[0].id);
   assert.equal(await page.locator('[data-cloud="library-next"]').isDisabled(),true);
   assert.equal(await page.locator('[data-cloud="library-previous"]').isDisabled(),false);
   assert.equal(new Set([...firstPageIds,fixtures[0].id]).size,31);
   await click('library-previous');await waitPage(1,30);
   assert.deepEqual(await page.locator('[data-cloud-chip]').evaluateAll(xs=>xs.map(x=>x.dataset.cloudChip)),firstPageIds);
   assert.equal(await page.locator('#cloud-search').inputValue(),query);
  });
  await check('preview return retains page and query; a new search resets to page one',async()=>{
   await click('library-next');await waitPage(2,1);await page.locator('[data-cloud-chip]').click();await page.waitForSelector('#cloud-revision');
   await click('library');await waitPage(2,1);assert.equal(await page.locator('#cloud-search').inputValue(),query);
   await page.locator('#cloud-search').fill('missing-'+suffix);await click('search');await waitPage(1,0);
   assert.equal(await page.locator('[data-cloud="library-previous"]').isDisabled(),true);
   assert.equal(await page.locator('[data-cloud="library-next"]').isDisabled(),true);
   await page.locator('#cloud-search').fill(query);await click('search');await waitPage(1,30);
  });
  await check('renamed local chip scans stable identity across pages and publishes revision 2',async()=>{
   const oldRelease=await page.evaluate(async id=>(await (await fetch('/api/library/'+id+'?revision=1')).json()).release,fixtures[0].id);
   const renamed='改名后仍为同一作品-'+suffix;
   await page.evaluate(async name=>{
    const C=window.CircuitLab,pkg=structuredClone(window.cloudLibraryFixtures[0]);
    pkg.definition=structuredClone(await C.encapsulate(pkg.project,name,pkg.definition.stableId));
    pkg.definition.revision=2;pkg.definition.contentHash=C.hashDefinition(pkg.definition);
    await LabAPI.importFile(new File([JSON.stringify(pkg)],'renamed.chip.json',{type:'application/json'}));
   },renamed);
   await page.locator('[data-action="close-dialog"]').filter({visible:true}).first().click();
   await click('home');await click('library');await page.waitForSelector('#cloud-search');await click('publish');
   const localIndex=await page.evaluate(name=>LabAPI.state.library.findIndex(e=>e.definition.name===name),renamed);assert.ok(localIndex>=0);assert.equal(await page.evaluate(i=>LabAPI.state.library[i].definition.revision,localIndex),2);
   await page.locator('#cloud-entry').selectOption(String(localIndex));await page.locator('#cloud-description').fill(query);
   const requestStart=requests.length;
   const posted=page.waitForResponse(r=>r.url().endsWith('/api/library')&&r.request().method()==='POST');
   await click('publish-confirm');const response=await posted,result=await response.json();
   assert.equal(response.status(),201,JSON.stringify(result));assert.equal(result.chipId,fixtures[0].id);assert.equal(result.revision,2);
   await page.waitForSelector('#cloud-search');
   const scan=requests.slice(requestStart);assert.ok(scan.some(x=>x.method==='GET'&&x.offset>=30&&(x.query===null||x.query==='')),'scan must reach later pages without a name query');
   assert.ok(!scan.some(x=>x.method==='GET'&&x.query===renamed));assert.equal(scan.find(x=>x.method==='POST').body.baseRevision,1);
   const actual=await page.evaluate(async id=>{
    const get=async rev=>(await (await fetch('/api/library/'+id+'?revision='+rev)).json());
    return {old:await get(1),latest:await get(2)};
   },fixtures[0].id);
   assert.equal(actual.old.release.hash,oldRelease.hash);
   assert.equal(actual.old.release.package.definition.name,fixtures[0].name);
   assert.equal(actual.latest.chip.title,renamed);assert.equal(actual.latest.release.package.definition.name,renamed);
   assert.equal(actual.latest.release.package.definition.stableId,fixtures[0].stable);
   const total=await page.evaluate(async q=>{let n=0,offset=0;do{const data=await (await fetch('/api/library?q='+encodeURIComponent(q)+'&offset='+offset)).json();n+=data.items.length;offset=data.next;}while(offset!==null);return n;},query);
   assert.equal(total,31,'renaming must not create a 32nd cloud work');
  });
  await check('pagination remains reachable without horizontal overflow at 390px',async()=>{
   await page.setViewportSize({width:390,height:844});
   await page.locator('#cloud-search').fill(query);await click('search');await waitPage(1,30);
   assert.equal(await page.locator('[data-cloud="library-next"]').isVisible(),true);
   await click('library-next');await waitPage(2,1);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   assert.ok(await page.locator('#dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
   await page.screenshot({path:out+'/cloud-library-v3-mobile.png'});
   await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:out+'/cloud-library-v3.png'});
  });
  assert.deepEqual(errors,[]);
 }catch(e){errors.push(e.stack||String(e));console.error(e);process.exitCode=1;await page.screenshot({path:out+'/cloud-library-v3-failure.png'});}
 finally{fs.writeFileSync(out+'/cloud-library-v3-results.json',JSON.stringify({browser:await browser.version(),url:process.env.ONLINE_URL||'http://127.0.0.1:4174',fixtureCount:fixtures?.length||0,passed,errors},null,2));console.log(JSON.stringify({passed:passed.length,errors},null,2));await browser.close();}
})();
