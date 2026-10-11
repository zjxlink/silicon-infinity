(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./testbench-v5.js'):root.LabTestbench);if(typeof module==='object'&&module.exports)module.exports=api;else root.TimelineV7=api;})(globalThis,function(B){'use strict';
 const copy=x=>JSON.parse(JSON.stringify(x));
 function indexOf(s,lane,index){if(!['events','checks','invariants'].includes(lane)||!Number.isInteger(index)||index<0||index>=s[lane].length)throw Error('时间线项目已变化，请重新选择。');return s[lane][index];}
 function uid(s,base='timeline'){const ids=new Set([...s.checks,...s.invariants].map(x=>x.id));let i=1;while(ids.has(base+'_'+i))i++;return base+'_'+i;}
 function transact(raw,fn){const s=B.validate(raw);fn(s);return B.validate(s);}
 function put(raw,lane,value,index=null){return transact(raw,s=>{if(!['events','checks','invariants'].includes(lane))throw Error('不支持的轨道。');const v=copy(value);if(index===null){if(lane!=='events'&&!v.id)v.id=uid(s);s[lane].push(v);}else{indexOf(s,lane,index);s[lane][index]=v;}});}
 function remove(raw,lane,index){return transact(raw,s=>{indexOf(s,lane,index);s[lane].splice(index,1);});}
 function move(raw,lane,index,at){return transact(raw,s=>{const item=indexOf(s,lane,index);if(typeof at!=='string'||!/^(0|[1-9][0-9]*)$/.test(at))throw Error('时刻必须是非负整数微秒。');if(lane==='invariants'){const shift=BigInt(at)-BigInt(item.from);item.from=at;item.until=String(BigInt(item.until)+shift);}else item.at=at;});}
 function duplicate(raw,lane,index){return transact(raw,s=>{const item=copy(indexOf(s,lane,index));if(lane!=='events')item.id=uid(s,'copy');s[lane].push(item);});}
 function metadata(raw,{duration,seed}){return transact(raw,s=>{s.duration=duration;s.seed=seed;});}
 function hold(raw,{label,target,from,until,every,op='eq',value,min,max}){return transact(raw,s=>{for(const t of[from,until,every])if(typeof t!=='string'||!/^(0|[1-9][0-9]*)$/.test(t))throw Error('保持目标需要整数微秒。');const start=BigInt(from),end=BigInt(until),step=BigInt(every);if(step<=0n||start>end||end>BigInt(s.duration))throw Error('保持目标的区间或采样间隔无效。');const count=(end-start)/step+1n;if(count>2048n||s.checks.length+Number(count)>2048)throw Error('保持采样超过2048次预算。');for(let t=start;t<=end;t+=step){const c={id:uid(s,'hold'),label,at:String(t),kind:'port',target,op};if(op==='eq')c.value=copy(value);else if(op==='range'){c.min=min;c.max=max;}s.checks.push(c);}});}
 function rows(raw){const s=B.validate(raw),result=[];for(const lane of['events','checks','invariants'])s[lane].forEach((item,index)=>result.push({lane,index,key:lane+':'+index,at:item.at??item.from,until:item.until??null,target:item.target??item.targets.join(', '),label:item.label||item.kind,item:copy(item)}));result.sort((a,b)=>Number(BigInt(a.at)-BigInt(b.at))||a.key.localeCompare(b.key));return result;}
 function formatValue(x){if(x===undefined)return'';return typeof x==='object'?JSON.stringify(x):String(x);}
 return{validate:B.validate,put,remove,move,duplicate,metadata,hold,rows,formatValue};
});
