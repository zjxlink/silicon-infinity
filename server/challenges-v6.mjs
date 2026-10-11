import B from '../game/testbench-v5.js';

// Authentication, origin checks and request limits are applied by the shared API.
export async function handleChallenges(request,ctx,h){
 const {db,user,url,parts,method,now}=ctx,{one,all,run,readBody,shape,text,hash,canon,id,json,fail,preflightProject,view,sources}=h;
 const access=c=>c&&(c.owner===user||c.visibility==='site'||one(db,"SELECT id FROM silicon_grants WHERE kind='challenge' AND resource=? AND user=?",c.id,user));
 const visible=async c=>!!(c&&await access(c));
 if(parts.length===1&&method==='GET'){
  const q=(url.searchParams.get('q')||'').slice(0,80),offset=Number(url.searchParams.get('offset')||0);if(!Number.isSafeInteger(offset)||offset<0||offset>10000)fail(400,'分页偏移无效');
  const rows=await all(db,"SELECT c.* FROM silicon_challenges c WHERE (c.owner=? OR c.visibility='site' OR EXISTS(SELECT 1 FROM silicon_grants g WHERE g.kind='challenge' AND g.resource=c.id AND g.user=?)) AND (c.title LIKE ? OR c.description LIKE ? OR c.tags LIKE ?) ORDER BY c.updated DESC,c.id LIMIT 30 OFFSET ?",user,user,'%'+q+'%','%'+q+'%','%'+q+'%',offset);
  return json({items:rows.map(c=>({...c,tags:JSON.parse(c.tags),source:JSON.parse(c.source),mine:c.owner===user})),next:rows.length===30?offset+30:null});
 }
 if(parts.length===1&&method==='POST'){
  const b=shape(await readBody(request),['requestId','stableId','package','tags','license','visibility','baseRevision','source'],['requestId','stableId','package'],'挑战发布'),requestId=text(b.requestId,100,'请求ID'),stable=text(b.stableId,80,'作品ID');
  if(!/^[A-Za-z_][A-Za-z0-9_.-]{0,79}$/.test(stable))fail(400,'作品ID只允许字母数字下划线点和横线');
  const requestHash=await hash(canon(b)),requestKey='challenge:'+await hash(canon([user,requestId])),prior=await one(db,'SELECT * FROM silicon_requests WHERE id=?',requestKey);if(prior){if(prior.owner!==user||prior.hash!==requestHash)fail(409,'同一请求ID不能发布不同内容');return json(JSON.parse(prior.response));}
  preflightProject(b.package?.workspace?.project);const pkg=await B.importPackage(b.package);view(pkg.workspace.view,pkg.workspace.project);sources(pkg.workspace.sources,pkg.workspace.project);
  const visibility=b.visibility??'private',license=b.license??'private';if(!['private','site'].includes(visibility)||!['private','MIT','CC0-1.0','CC-BY-4.0'].includes(license)||visibility==='site'&&license==='private')fail(400,'共享挑战需要选择许可');
  if(b.tags!==undefined&&(!Array.isArray(b.tags)||b.tags.length>6))fail(400,'最多6个标签');const tags=(b.tags||[]).map(t=>text(t,24,'标签'));if(new Set(tags).size!==tags.length)fail(400,'标签不能重复');
  if(b.baseRevision!==undefined&&(!Number.isSafeInteger(b.baseRevision)||b.baseRevision<1))fail(400,'基础修订无效');
  let source=null;if(b.source){shape(b.source,['id','revision','hash'],['id','revision','hash'],'来源');if(typeof b.source.id!=='string'||!Number.isSafeInteger(b.source.revision)||b.source.revision<1||typeof b.source.hash!=='string')fail(400,'来源无效');const from=await one(db,'SELECT * FROM silicon_challenges WHERE id=?',b.source.id);if(!await visible(from))fail(404,'没有这个可访问的来源');const r=await one(db,'SELECT hash FROM silicon_challenge_releases WHERE challenge=? AND revision=?',from.id,b.source.revision);if(!r||r.hash!==b.source.hash)fail(409,'来源版本指纹不一致');if(from.owner!==user&&from.license==='private'&&visibility==='site')fail(403,'此来源仅授权受邀使用，不能转为站内共享');source={...b.source};}
  const old=await one(db,'SELECT * FROM silicon_challenges WHERE owner=? AND stable=?',user,stable);if(old&&b.baseRevision!==old.latest||!old&&b.baseRevision!==undefined)fail(409,'发布修订已变化，请刷新再发布');
  if(old&&canon(JSON.parse(old.source))!==canon(source))fail(409,'同一作品的来源不能暗改，请另存作品');
  const challengeId=old?.id||id(),revision=(old?.latest||0)+1,releaseId=id(),packageHash=await hash(canon(pkg)),response={challengeId,revision,releaseId,packageHash};const sql=[];
  if(old)sql.push(db.prepare('UPDATE silicon_challenges SET title=?,description=?,tags=?,license=?,visibility=?,latest=?,updated=? WHERE id=? AND latest=?').bind(pkg.title,pkg.description,JSON.stringify(tags),license,visibility,revision,now,challengeId,old.latest));
  else sql.push(db.prepare('INSERT INTO silicon_challenges(id,owner,stable,title,description,tags,license,visibility,latest,source,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(challengeId,user,stable,pkg.title,pkg.description,JSON.stringify(tags),license,visibility,revision,JSON.stringify(source),now,now));
  sql.push(db.prepare('INSERT INTO silicon_challenge_releases(id,challenge,revision,hash,body,created) VALUES(?,?,?,?,?,?)').bind(releaseId,challengeId,revision,packageHash,JSON.stringify(pkg),now));
  sql.push(db.prepare('INSERT INTO silicon_requests(id,owner,hash,response,created) VALUES(?,?,?,?,?)').bind(requestKey,user,requestHash,JSON.stringify(response),now));
  try{await db.batch(sql);}catch{const retry=await one(db,'SELECT * FROM silicon_requests WHERE id=?',requestKey);if(retry?.hash===requestHash)return json(JSON.parse(retry.response));fail(409,'发布冲突，旧修订仍保留');}return json(response,201);
 }
 if(parts[1]&&parts.length===2&&method==='GET'){
  const item=await one(db,'SELECT * FROM silicon_challenges WHERE id=?',parts[1]);if(!await visible(item))fail(404,'没有这个可访问的挑战');const revision=Number(url.searchParams.get('revision')||item.latest);if(!Number.isSafeInteger(revision)||revision<1)fail(400,'修订号码无效');const release=await one(db,'SELECT * FROM silicon_challenge_releases WHERE challenge=? AND revision=?',item.id,revision);if(!release)fail(404,'修订不存在');return json({challenge:{...item,tags:JSON.parse(item.tags),source:JSON.parse(item.source),mine:item.owner===user},release:{id:release.id,revision:release.revision,hash:release.hash,package:JSON.parse(release.body)}});
 }
 fail(404,'挑战接口不存在');
}
