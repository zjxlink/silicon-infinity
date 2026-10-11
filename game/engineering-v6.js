(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.EngineeringV6=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const C=()=>typeof module==='object'&&module.exports?require('./circuit.js'):globalThis.CircuitLab;
const ID=/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/,NODE=/^(?:boundary:)?[A-Za-z_][A-Za-z0-9_.-]{0,95}$/,WIRE=/^[A-Za-z_][A-Za-z0-9_.-]{0,95}$/;
const dangerous=new Set(['__proto__','constructor','prototype']);
function check(ok,message){if(!ok)throw Error('工程视图：'+message);}
function object(v){return v&&typeof v==='object'&&!Array.isArray(v);}
function shape(v,keys,label){check(object(v)&&Object.keys(v).sort().join('|')===keys.slice().sort().join('|'),label+'字段不匹配');}
function label(v){return typeof v==='string'&&v.trim().length>0&&v.length<=48&&!/[\u0000-\u001f\u007f]/.test(v);}
function copy(v){return C().parseJSON(JSON.stringify(v));}
function defaults(){return{version:1,pages:[{id:'main',name:'主画布'}],assignments:{},wireLabels:{},bundles:[],activePage:'main'};}
function definition(p,n){return p.definitions.find(d=>d.stableId===n.definition.stableId&&d.revision===n.definition.revision&&d.contentHash===n.definition.contentHash);}
function nodes(p){return [...['inputs','outputs','inouts'].flatMap(k=>(p.circuit[k]||[]).map(n=>({id:'boundary:'+n.id,label:n.name,modelId:'boundary',ports:[n]}))),...p.circuit.instances.map(n=>{const d=definition(p,n);return{id:n.id,label:n.label||d?.name||n.id,modelId:d?.model.id||'composite',ports:d?.ports||[],definition:d};})];}
function nodeKey(e){return e.kind==='boundary'?'boundary:'+e.port:e.instance;}
function port(p,e){const n=nodes(p).find(n=>n.id===nodeKey(e));return n?.ports.find(x=>x.id===e.port);}
function pair(w){return[nodeKey(w.from),nodeKey(w.to)].sort().join('|');}
function validate(raw,p,{references=true}={}){
 const e=copy(raw);shape(e,['version','pages','assignments','wireLabels','bundles','activePage'],'根');check(e.version===1,'不支持的版本');
 check(Array.isArray(e.pages)&&e.pages.length>=1&&e.pages.length<=32,'页面数量需为1—32');const pages=new Set();for(const page of e.pages){shape(page,['id','name'],'页面');check(ID.test(page.id)&&!dangerous.has(page.id)&&!pages.has(page.id),'页面ID重复或无效');check(label(page.name),'页面名称需为1—48字');pages.add(page.id);}check(pages.has('main'),'必须保留main主画布');check(pages.has(e.activePage),'当前页面不存在');
 const ns=new Set(nodes(p).map(n=>n.id)),ws=new Map(p.circuit.wires.map(w=>[w.id,w]));
 check(object(e.assignments)&&Object.keys(e.assignments).length<=2000,'页面分组数量超限');for(const[id,page]of Object.entries(e.assignments))check(NODE.test(id)&&!dangerous.has(id)&&pages.has(page)&&(!references||ns.has(id)),'分组元件或页面不存在：'+id);
 check(object(e.wireLabels)&&Object.keys(e.wireLabels).length<=4000,'导线标签数量超限');for(const[id,name]of Object.entries(e.wireLabels))check(WIRE.test(id)&&!dangerous.has(id)&&label(name)&&(!references||ws.has(id)),'导线标签无效或导线不存在：'+id);
 check(Array.isArray(e.bundles)&&e.bundles.length<=128,'总线束数量超限');const ids=new Set(),used=new Set();for(const b of e.bundles){shape(b,['id','name','wireIds','collapsed'],'总线束');check(ID.test(b.id)&&!dangerous.has(b.id)&&!ids.has(b.id),'总线束ID重复或无效');ids.add(b.id);check(label(b.name)&&typeof b.collapsed==='boolean','总线束名称或折叠状态无效');check(Array.isArray(b.wireIds)&&b.wireIds.length>=2&&b.wireIds.length<=64,'每束需要2—64条导线');let peers=null;for(const id of b.wireIds){check(WIRE.test(id)&&!dangerous.has(id)&&!used.has(id),'导线重复加入总线束');used.add(id);const w=ws.get(id);if(!w){check(!references,'总线束导线不存在：'+id);continue;}check(port(p,w.from)?.kind==='digital'&&port(p,w.to)?.kind==='digital','总线束只支持数字导线');const current=pair(w);if(peers===null)peers=current;check(current===peers,'一束导线必须连接同一对元件');}}
 return e;
}
function normalize(raw,p){if(raw===undefined)return defaults();const e=validate(raw,p,{references:false}),ns=new Set(nodes(p).map(n=>n.id)),ws=new Set(p.circuit.wires.map(w=>w.id));e.assignments=Object.fromEntries(Object.entries(e.assignments).filter(([id])=>ns.has(id)));e.wireLabels=Object.fromEntries(Object.entries(e.wireLabels).filter(([id])=>ws.has(id)));e.bundles=e.bundles.map(b=>({...b,wireIds:b.wireIds.filter(id=>ws.has(id))})).filter(b=>b.wireIds.length>=2);return validate(e,p);}
const pageFor=(e,id)=>e.assignments[id]||'main';
function visibility(p,raw,page){const e=normalize(raw,p);page=page||e.activePage;check(e.pages.some(p=>p.id===page),'页面不存在');const ids=new Set(nodes(p).filter(n=>pageFor(e,n.id)===page).map(n=>n.id)),internal=[],crossings=[];for(const w of p.circuit.wires){const a=ids.has(nodeKey(w.from)),b=ids.has(nodeKey(w.to));if(a&&b)internal.push(w.id);else if(a||b){const local=a?w.from:w.to,remote=a?w.to:w.from;crossings.push({wireId:w.id,local:copy(local),remote:copy(remote),remotePage:pageFor(e,nodeKey(remote)),label:e.wireLabels[w.id]||w.id});}}return{page,nodeIds:[...ids],wireIds:internal,crossings};}
function hierarchy(p){const out=[],defs=new Map(p.definitions.map(d=>[d.stableId+'@'+d.revision,d]));for(const n of nodes(p).filter(n=>n.modelId==='boundary'))out.push({...n,path:n.id,parent:'',depth:0});function walk(c,path,depth){check(depth<=16,'层级超过16');for(const n of c.instances){const d=defs.get(n.definition.stableId+'@'+n.definition.revision),full=path?path+'/'+n.id:n.id;out.push({id:n.id,path:full,parent:path,depth,label:n.label||d?.name||n.id,modelId:d?.model.id||'composite',ports:d?.ports||[],composite:d?.model.kind==='composite'});if(d?.model.kind==='composite')walk(d.model.circuit,full,depth+1);}}walk(p.circuit,'',0);return out;}
function search(p,query=''){const q=query.trim().toLowerCase();return hierarchy(p).filter(n=>[n.path,n.label,n.modelId,...n.ports.flatMap(p=>[p.id,p.name])].join(' ').toLowerCase().includes(q)).slice(0,200);}
async function connect(p,from,to,id){check(WIRE.test(id)&&!dangerous.has(id),'导线ID无效');check(port(p,from)&&port(p,to),'请选择两个现有端点');const next=copy(p);C().addWire(next,id,from,to);return C().importProject(next);}
function observe(runtime,p,path){const n=hierarchy(p).find(n=>n.path===path);check(n,'观察元件不存在');return{path,label:n.label,modelId:n.modelId,time:String(runtime.time),ports:n.ports.map(port=>{try{return{...port,value:runtime.getPort(path.startsWith('boundary:')?C().boundary(path.slice(9)):C().ep(path,port.id))};}catch{return{...port,value:null};}})};}
return{VERSION:1,defaults,validate,normalize,nodes,nodeKey,port,pageFor,visibility,hierarchy,search,connect,observe};
});
