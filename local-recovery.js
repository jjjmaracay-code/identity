(function(){'use strict';
const DB='identifly-recovery-v1',STORE='account',TTL=7*86400000,LIMIT=3,CAP=128*1024;
let queue=Promise.resolve(),lastBoundary=0;
const A=()=>window.AccountTools,B=()=>window.IdentityAccountBridge;
const pack=profile=>Object.fromEntries(Object.entries(profile||{}).filter(([key])=>key!=='media'));
const same=(a,b)=>JSON.stringify(pack(a))===JSON.stringify(pack(b));
function open(){return new Promise((resolve,reject)=>{
 let settled=false;const r=indexedDB.open(DB,1),timer=setTimeout(()=>{settled=true;reject(Error('idb_timeout'));},5000);
 r.onupgradeneeded=()=>r.result.createObjectStore(STORE);r.onerror=()=>{clearTimeout(timer);if(!settled){settled=true;reject(r.error);}};r.onsuccess=()=>{clearTimeout(timer);if(settled){r.result.close();return;}settled=true;r.result.onversionchange=()=>r.result.close();resolve(r.result);};
});}
async function transaction(mode,fn){const db=await open();try{return await new Promise((resolve,reject)=>{
 const tx=db.transaction(STORE,mode),store=tx.objectStore(STORE);let result;
 fn(store,value=>{result=value;});tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('aborted'));
 });}finally{db.close();}}
function get(id){return transaction('readonly',(store,done)=>{const r=store.get(id);r.onsuccess=()=>done(r.result);});}
async function put(id,value,stamp){return transaction('readwrite',(store,done)=>{
 if(stamp!==B().stamp())throw Error('account_changed');store.clear();store.put(value,id);done(true);
});}
const recent=entries=>(entries||[]).filter(x=>x.at>Date.now()-TTL&&x.at<=Date.now()).slice(0,LIMIT);
async function record(oldProfile,newProfile){
 if(!B()?.unlocked()||!oldProfile||!Object.keys(pack(oldProfile)).length||same(oldProfile,newProfile))return;
 const initial=B().stamp(),owner=await A().digest(initial),now=Date.now();
 queue=queue.catch(()=>{}).then(async()=>{
  if(initial!==B().stamp())return;
  const saved=await get(owner)||{key:await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']),entries:[]};
  saved.entries=recent(saved.entries);
  // Debounced autosaves in one edit session keep its first recoverable state.
  if(saved.entries[0]?.at>=lastBoundary&&now-saved.entries[0].at<30000)return;
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(owner)},saved.key,new TextEncoder().encode(JSON.stringify(pack(oldProfile))));
  saved.entries.unshift({at:now,iv:A().b64(iv),data:A().b64(data)});saved.entries=saved.entries.slice(0,LIMIT);
  while(saved.entries.length&&JSON.stringify(saved.entries).length>CAP)saved.entries.pop();
  await put(owner,saved,initial);
 });return queue;
}
async function prune(){
 if(!A()||!B())return;const initial=B().stamp(),owner=await A().digest(initial);
 await transaction('readwrite',(store,done)=>{
  if(initial!==B().stamp()){done(false);return;}
  const cursor=store.openCursor();cursor.onsuccess=()=>{const c=cursor.result;if(!c){done(true);return;}
   if(c.key!==owner)c.delete();else{const value=c.value;value.entries=recent(value.entries);if(value.entries.length)c.update(value);else c.delete();}c.continue();};
 });
}
async function restore(){
 const a=A(),b=B(),status=document.getElementById('identity-account-status');if(!a||!b?.unlocked())return;
 if(window.FormEditLock?.isLocked('identity')){a.message(status,'unlock');return;}
 const initial=b.stamp(),source=localStorage.getItem('identity_data'),owner=await a.digest(initial);await queue.catch(()=>{});const saved=await get(owner),entries=recent(saved?.entries);
 if(!entries.length){a.message(status,'empty');return;}
 if(!await a.prompt('restoreConfirm'))return;
 if(initial!==b.stamp()||!b.unlocked()||window.FormEditLock?.isLocked('identity'))throw Object.assign(Error('changed'),{code:'context_changed'});
 const copy=JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:a.bytes(entries[0].iv),additionalData:new TextEncoder().encode(owner)},saved.key,a.bytes(entries[0].data))));
 if(initial!==b.stamp()||source!==localStorage.getItem('identity_data'))throw Object.assign(Error('changed'),{code:'context_changed'});
 // Restore only the profile, never registration, access tokens, password, TOTP or plan.
 const current=b.profile(),next={...copy,media:current.media};
 await b.restore(next,source);saved.entries=entries.slice(1);await put(owner,saved,initial);a.message(status,'restored');window.FormEditLock?.lockAll();
}
window.IdentityLocalRecovery={record,restore,boundary:()=>{lastBoundary=Date.now();}};
document.addEventListener('DOMContentLoaded',()=>{queue=queue.then(prune).catch(()=>{});setInterval(()=>{if(!document.hidden)queue=queue.then(prune).catch(()=>{});},3600000);const button=document.getElementById('identity-undo');if(button)button.onclick=()=>A().run(button,document.getElementById('identity-account-status'),restore);});
})();
