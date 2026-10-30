(function(){'use strict';
const GRANT='identity_passkey_grant';
document.addEventListener('DOMContentLoaded',()=>{
 const A=window.AccountTools,B=window.IdentityAccountBridge;if(!A||!B)return;
 const status=document.getElementById('identity-account-status'),enable=document.getElementById('passkey-enable'),remove=document.getElementById('passkey-remove'),login=document.getElementById('passkey-login');
 let working=false;
 const ensure=s=>{if(s!==B.stamp())throw Object.assign(Error('account_changed'),{code:'context_changed'});};
 const account=()=>{const r=A.read('identity_registration');return{email:r?.email,token:localStorage.getItem('identity_access_token'),deviceId:getOrCreateDeviceId()};};
 const owner=()=>A.digest(B.stamp());
 async function grant(){const g=A.read(GRANT);return g?.owner===await owner()&&g.id&&g.data&&g.salt?g:null;}
 function publicCredential(c){return{...c,clientExtensionResults:{}};}
 async function prf(c,options,salt){
  const result=c.clientExtensionResults?.prf;
  if(result?.results?.first)return new Uint8Array(result.results.first);
  if(result?.enabled!==true)throw Object.assign(Error('prf_required'),{code:'unsupported'});
  options.allowCredentials=[{id:c.id,transports:c.response.transports||['internal','hybrid']}];
  options.extensions={prf:{eval:{first:A.bytes(salt)}}};
  const assertion=await SimpleWebAuthnBrowser.startAuthentication({optionsJSON:options});
  const raw=assertion.clientExtensionResults?.prf?.results?.first;
  if(!raw)throw Object.assign(Error('prf_required'),{code:'unsupported'});
  return{raw:new Uint8Array(raw),assertion};
 }
 async function refresh(){
  const g=await grant();login.hidden=!g||!A.supported();remove.hidden=!g;enable.hidden=!!g||!A.supported();
 }
 enable.onclick=()=>A.run(enable,status,async()=>{
  if(working||!B.unlocked())return;working=true;let rawKey,registered;
  const initial=B.stamp();
  try{
   const password=await A.prompt('password','password');ensure(initial);if(password===null)return;
   rawKey=await B.enrollmentKey(password);ensure(initial);if(!rawKey)throw Error('password_required');
   const stale=await A.request('identity','list',account());ensure(initial);
   for(const key of stale.keys||[]){await A.request('identity','remove',{...account(),credential_id:key.id});ensure(initial);}
   const salt=A.b64(crypto.getRandomValues(new Uint8Array(32))),start=await A.request('identity','register/options',account());ensure(initial);
   start.options.extensions={prf:{eval:{first:A.bytes(salt)}}};
   const credential=await SimpleWebAuthnBrowser.startRegistration({optionsJSON:start.options});ensure(initial);
   if(credential.clientExtensionResults?.prf?.enabled!==true&&!credential.clientExtensionResults?.prf?.results?.first)throw Object.assign(Error('prf_required'),{code:'unsupported'});
   const result=await A.request('identity','register/verify',{...account(),challenge_id:start.challenge_id,credential:publicCredential(credential)});ensure(initial);registered=result.credential_id;
   let raw=credential.clientExtensionResults?.prf?.results?.first;
   if(!raw){
    const auth=await A.request('identity','login/options',account());ensure(initial);
    const proof=await prf(credential,auth.options,salt);raw=proof.raw;
    await A.request('identity','login/verify',{...account(),challenge_id:auth.challenge_id,credential:publicCredential(proof.assertion)});ensure(initial);
   }
   const key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt']),iv=crypto.getRandomValues(new Uint8Array(12));
   const bound=await owner();ensure(initial);
   const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(bound)},key,rawKey);ensure(initial);
   localStorage.setItem(GRANT,JSON.stringify({v:1,owner:bound,id:registered,salt,iv:A.b64(iv),data:A.b64(encrypted)}));registered=null;
   await refresh();A.message(status,'enabled');
  }finally{
   rawKey?.fill(0);if(registered&&initial===B.stamp())await A.request('identity','remove',{...account(),credential_id:registered}).catch(()=>{});
   working=false;
  }
 });
 login.onclick=()=>A.run(login,document.getElementById('passkey-login-status'),async()=>{
  if(working||B.unlocked()||Date.now()<Number(localStorage.getItem('identity_block_until')||0))return;
  const initial=B.stamp();working=true;let rawKey;
  try{
   const g=await grant();if(!g)throw Error('grant_missing');ensure(initial);
   const start=await A.request('identity','login/options',account());ensure(initial);
   start.options.allowCredentials=start.options.allowCredentials.filter(c=>c.id===g.id);
   if(!start.options.allowCredentials.length)throw Error('credential_missing');
   start.options.extensions={prf:{eval:{first:A.bytes(g.salt)}}};
   const credential=await SimpleWebAuthnBrowser.startAuthentication({optionsJSON:start.options});ensure(initial);
   const raw=credential.clientExtensionResults?.prf?.results?.first;if(!raw)throw Object.assign(Error('prf_required'),{code:'unsupported'});
   const result=await A.request('identity','login/verify',{...account(),challenge_id:start.challenge_id,credential:publicCredential(credential)});ensure(initial);
   if(!result.success||result.credential_id!==g.id||result.deviceId!==account().deviceId)throw Error('wrong_credential');
   const key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['decrypt']);
   rawKey=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:A.bytes(g.iv),additionalData:new TextEncoder().encode(g.owner)},key,A.bytes(g.data)));ensure(initial);
   await B.unlock(rawKey);ensure(initial);
  }finally{rawKey?.fill(0);working=false;}
 });
 remove.onclick=()=>A.run(remove,status,async()=>{
  if(!B.unlocked())return;const initial=B.stamp();if(!await A.prompt('remove'))return;ensure(initial);
  const g=await grant();if(g)await A.request('identity','remove',{...account(),credential_id:g.id});ensure(initial);localStorage.removeItem(GRANT);await refresh();status.textContent='';
 });
 window.addEventListener('storage',()=>refresh().catch(()=>{}));
 window.addEventListener('identity:account-token-confirmed',()=>refresh().catch(()=>{}));refresh().catch(()=>{});
});
})();
