import {createHash} from 'node:crypto';
const SOURCE='news-newscentral-json-all';
const FEED='https://newscentral.site/feed/en.json';
const REPO='Mmundo74/stock-catalyst-discovery';
const ISSUE=2;
const BASELINE='2026-11-11T18:58:32.933Z';
const sha=x=>createHash('sha256').update(x).digest('hex');
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
const at=()=>new Date().toISOString();
function absoluteUrl(value){
 if(typeof value!=='string')throw Error('INVALID_URL');
 const u=new URL(value);
 if(u.protocol!=='https:'||u.username||u.password)throw Error('INVALID_URL');
 return u.href;
}
function stamp(value){
 if(typeof value!=='string'||!value.trim()||!Number.isFinite(Date.parse(value)))throw Error('INVALID_TIMESTAMP');
 return Date.parse(value);
}
export function parseFeed(raw){
 let doc;try{doc=typeof raw==='string'?JSON.parse(raw):raw}catch{throw Error('INVALID_FEED_JSON')}
 if(!doc||!Array.isArray(doc.items)||!/^https:\/\/jsonfeed.org\/version\/1\./.test(doc.version||'')||doc.feed_url!==FEED||doc.items.length>200)throw Error('INVALID_JSON_FEED');
 const entries=[],occurrences=new Set();
 for(const [i,item] of doc.items.entries()){
  if(!item||typeof item.id!=='string'||!item.id||typeof item.title!=='string'||!item.title.trim())throw Error('INVALID_ITEM_'+i);
  const url=absoluteUrl(item.url);
  const published=stamp(item.date_published);
  const updated=item.date_modified?stamp(item.date_modified):null;
  if(!url.startsWith('https://newscentral.site/'))throw Error('UNTRUSTED_SOURCE_ITEM_HOST');
  const fingerprint=sha(JSON.stringify(stable(item)));
  const occurrence=item.id+'|'+fingerprint;
  if(occurrences.has(occurrence))continue;
  occurrences.add(occurrence);
  entries.push({id:item.id,title:item.title,url,published_original:item.date_published,updated_original:item.date_modified||null,
   published,updated,fingerprint,publisher:'News Central Site'});
 }
 return {source_id:SOURCE,items:entries,provider_occurrences:doc.items.length,unique_occurrences:occurrences.size,
  coverage:'VERIFIED_PARTIAL',gap:'Rolling latest-N feed, missing history/pagination unknown'};
}
export function stateFromIssue(body){
 if(typeof body!=='string')throw Error('ISSUE_BODY_MISSING');
 const match=body.match(/<!-- NEWS_STATE_V1\n([\s\S]*?)\nEND_NEWS_STATE_V1 -->/);
 if(!match)throw Error('ISSUE_STATE_MISSING');
 let state;try{state=JSON.parse(match[1])}catch{throw Error('ISSUE_STATE_INVALID_JSON')}
 if(state.schema_version!==1||state.source_id!==SOURCE||state.baseline_utc!==BASELINE||
  !state.versions||Array.isArray(state.versions)||typeof state.versions!=='object')throw Error('ISSUE_STATE_INVALID');
 return state;
}
export function withState(body,state){
 const before=stateFromIssue(body);
 if(before.source_id!==state.source_id)throw Error('SOURCE_CHANGED');
 return body.replace(/<!-- NEWS_STATE_V1\n[\s\S]*?\nEND_NEWS_STATE_V1 -->/,
   '<!-- NEWS_STATE_V1\n'+JSON.stringify(state)+'\nEND_NEWS_STATE_V1 -->');
}
export function plan(parsed,state,now=Date.now()){
 const selected=[],versions={...state.versions};
 const baseline=stamp(state.baseline_utc);
 for(const item of parsed.items){
  if(item.published>now+3600000||(item.updated!=null&&item.updated>now+3600000))throw Error('FUTURE_SOURCE_TIMESTAMP');
  if(item.published<baseline&&(item.updated===null||item.updated<baseline))continue;
  if(versions[item.id]===item.fingerprint)continue;
  selected.push(item);
  versions[item.id]=item.fingerprint;
 }
 if(Object.keys(versions).length>600){
  const recent=new Set(parsed.items.map(x=>x.id));
  const keep=Object.entries(versions).filter(([key])=>recent.has(key));
  for(const entry of Object.entries(versions).reverse())if(keep.length<400&&!recent.has(entry[0]))keep.push(entry);
  return {selected,versions:Object.fromEntries(keep),source_count:parsed.provider_occurrences};
 }
 return {selected,versions,source_count:parsed.provider_occurrences};
}
export function pack(items,maxBytes=3350,maxMessages=8){
 const notices=[];let lines=[],bytes=0;
 for(const item of items){
  const line=item.title+'\n'+item.url+'\nPublished: '+item.published_original+
   (item.updated_original?'\nUpdated: '+item.updated_original:'')+'\nSource: News Central Site\n';
  const size=Buffer.byteLength(line+'\n');
  if(size>maxBytes)throw Error('SINGLE_ITEM_TOO_LARGE');
  if(lines.length&&bytes+size>maxBytes){notices.push(lines.join('\n'));lines=[];bytes=0;}
  lines.push(line);bytes+=size;
 }
 if(lines.length)notices.push(lines.join('\n'));
 if(notices.length>maxMessages)throw Error('NOTIFICATION_CAP_EXCEEDED');
 return notices;
}
async function getJSON(url,opts={}){
 const res=await fetch(url,{...opts,signal:AbortSignal.timeout(15000)});
 if(!res.ok)throw Error('HTTP_'+res.status+'_FROM_'+new URL(url).hostname);
 return res.json();
}
async function github(path,method='GET',body){
 const token=process.env.GITHUB_TOKEN;
 if(!token)throw Error('GITHUB_TOKEN_MISSING');
 return getJSON('https://api.github.com/repos/'+REPO+path,{method,headers:{
  Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',
  ...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
}
async function source(){
 const res=await fetch(FEED,{headers:{Accept:'application/feed+json, application/json'},redirect:'error',signal:AbortSignal.timeout(15000)});
 if(res.status===429)throw Error('SOURCE_RATE_LIMITED_HTTP_429');
 if(res.status!==200||!/(application\/json|application\/feed\+json)/i.test(res.headers.get('content-type')||''))throw Error('SOURCE_HTTP_OR_CONTENT_TYPE_'+res.status);
 const arr=new Uint8Array(await res.arrayBuffer());
 if(arr.length===0||arr.length>1000000)throw Error('SOURCE_BYTES_OUT_OF_RANGE');
 const raw=new TextDecoder('utf-8',{fatal:true}).decode(arr);
 const parsed=parseFeed(raw);
 return {...parsed,raw_sha256:sha(raw),raw_bytes:arr.length};
}
async function publish(topic,msg,count){
 if(!/^[a-zA-Z0-9_-]{24,96}$/.test(topic||''))throw Error('INVALID_NTFY_TOPIC');
 const payload={topic,title:'Stock News Discovery: '+count+' new source item(s)',message:msg,
  priority:2,tags:['newspaper'],click:'https://github.com/'+REPO+'/issues/'+ISSUE};
 const res=await fetch('https://ntfy.sh/',{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});
 if(!res.ok)throw Error('NTFY_DELIVERY_HTTP_'+res.status);
 const receipt=await res.json();
 if(!receipt?.id)throw Error('NTFY_ACK_MISSING');
 // The anonymous ntfy cache may take time to surface a newly published receipt.
 // Never commit the source-version checkpoint on a mere HTTP 200 acknowledgement.
 let verified=false;
 for(let attempt=0;attempt<6&&!verified;attempt++){
  await new Promise(resolve=>setTimeout(resolve,1000+attempt*500));
  const poll=await fetch('https://ntfy.sh/'+topic+'/json?poll=1&since=all',{
   headers:{'cache-control':'no-cache'},signal:AbortSignal.timeout(12000)});
  if(!poll.ok)continue;
  const body=await poll.text();
  for(const line of body.trim().split('\n')){
   try{if(JSON.parse(line).id===receipt.id){verified=true;break;}}catch{}
  }
 }
 if(!verified)throw Error('NTFY_READBACK_MISMATCH');
 return receipt.id;
}
export async function run({dryRun=false}={}){
 const started=at();
 const issue=await github('/issues/'+ISSUE);
 const state=stateFromIssue(issue.body);
 const received=await source();
 const choice=plan(received,state);
 const notices=pack(choice.selected);
 if(dryRun){return {mode:'DRY_RUN',status:'VERIFIED_PARTIAL',source_id:SOURCE,source_items:received.provider_occurrences,
  new_items:choice.selected.length,notices:notices.length,raw_response_sha256:received.raw_sha256,issue_number:ISSUE,checkpoint_advanced:false,gap:received.gap};}
 if(!process.env.NEWS_NTFY_TOPIC)throw Error('PUSH_TOPIC_NOT_CONFIGURED');
 let delivered=[];
 for(const notice of notices){delivered.push(await publish(process.env.NEWS_NTFY_TOPIC,notice,choice.selected.length));}
 const next={...state,versions:choice.versions,last_checked_at_utc:started,
  last_status:'VERIFIED_PARTIAL',last_delivery_at_utc:delivered.length?at():state.last_delivery_at_utc,
  delivered_batches:(state.delivered_batches||0)+delivered.length};
 const body=withState(issue.body,next);
 await github('/issues/'+ISSUE,'PATCH',{body});
 const readback=await github('/issues/'+ISSUE);
 const verified=stateFromIssue(readback.body);
 for(const item of choice.selected){if(verified.versions[item.id]!==item.fingerprint)throw Error('STATE_READBACK_MISMATCH');}
 return {mode:'HOSTED',status:'VERIFIED_PARTIAL',source_id:SOURCE,source_items:received.provider_occurrences,
  new_items:choice.selected.length,ntfy_confirmed:delivered.length,ids:delivered,
  checkpoint_advanced:delivered.length>0,readback_verified:true,gap:received.gap};
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 const dry=process.argv.includes('--dry-run');
 run({dryRun:dry}).then(x=>{console.log(JSON.stringify(x));}).catch(e=>{
  console.error(JSON.stringify({status:'FAILED',code:String(e.message||e).slice(0,160),checkpoint_advanced:false}));process.exitCode=1;
 });
}
