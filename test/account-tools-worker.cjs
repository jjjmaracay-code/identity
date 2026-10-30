/* Native Workers regression: QA dependencies miniflare@4 and esbuild@0.25. Fictional accounts only. */
'use strict';
const {Miniflare}=require('miniflare'),esbuild=require('esbuild'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{let mf;const calls=[];let redirect=false;try{
 const script=esbuild.buildSync({stdin:{contents:`
 import {onRequestPost as proxy} from ${JSON.stringify(path.resolve(__dirname,'../functions/api/account-tools/[[path]].js'))};
 import {onRequestPost as remove} from ${JSON.stringify(path.resolve(__dirname,'../functions/api/delete-account.js'))};
 export default {async fetch(request){
  if(new URL(request.url).pathname==='/api/delete-account'){
   const records=new Map([['reg:worker-fixture@example.invalid',JSON.stringify({token:'fictional-worker-token-0123456789',registeredAt:new Date().toISOString()})],['worker-fixture@example.invalid',JSON.stringify({plan:'lifetime'})]]);
   const env={IP_HASH_SALT:'fictional-worker-salt',PLANS_KV:{get:async k=>records.get(k)||null,put:async(k,v)=>records.set(k,v),delete:async k=>records.delete(k)},BUSINESS_DO:{idFromName:k=>k,get:()=>({fetch:async()=>new Response(JSON.stringify({ok:true}))})}};
   const response=await remove({request,env});
   return new Response(JSON.stringify({result:await response.json(),retained:records.has('reg:worker-fixture@example.invalid')}),{status:response.status});
  }
  return proxy({request,params:{path:['passkeys','list']}});
 }};`,resolveDir:path.resolve(__dirname,'..')},bundle:true,format:'esm',platform:'browser',write:false}).outputFiles[0].text;
 mf=new Miniflare({modules:true,compatibilityDate:'2026-06-13',script,outboundService:async request=>{
  const u=new URL(request.url);calls.push({path:u.pathname,origin:u.origin});assert.equal(u.origin,'https://doctorqr-backend-production.up.railway.app');
  if(redirect)return new Response(null,{status:302,headers:{Location:'https://other.invalid'}});
  return u.pathname.endsWith('/purge')?new Response(JSON.stringify({success:true}),{headers:{'Content-Type':'application/json'}}):new Response(JSON.stringify({code:'passkey_account_unavailable'}),{status:401,headers:{'Content-Type':'application/json','Set-Cookie':'fixture=discard'}});
 }});
 const invoke=path=>mf.dispatchFetch('https://www.identifly.app/api/'+path,{method:'POST',headers:{Origin:'https://www.identifly.app','Content-Type':'application/json'},body:path==='delete-account'?JSON.stringify({email:'worker-fixture@example.invalid',token:'fictional-worker-token-0123456789'}):'{}'});
 let r=await invoke('account-tools/passkeys/list');assert.equal(r.status,401);assert.equal(r.headers.get('Set-Cookie'),null);assert.equal(calls[0].path,'/api/passkeys/identity/list');
 r=await invoke('delete-account');assert.equal(r.status,200);assert.deepEqual(await r.json(),{result:{ok:true},retained:false});assert.ok(calls.some(x=>x.path==='/api/passkeys/identity/purge'));
 redirect=true;const count=calls.length;r=await invoke('account-tools/passkeys/list');assert.equal(r.status,503);assert.equal(r.headers.get('Location'),null);assert.equal(calls.length,count+1,'Never follow an upstream redirect with account credentials');
 const deletionCount=calls.length;r=await invoke('delete-account');assert.equal(r.status,500);assert.equal((await r.json()).retained,true,'Unconfirmed remote removal must retain the account for retry');assert.equal(calls.length,deletionCount+1);assert.ok(calls.every(x=>x.origin==='https://doctorqr-backend-production.up.railway.app'));
 console.log('PASS: actual Workers runtime forwards optional verification, confirms account removal and refuses redirects without forwarding credentials or falsely confirming deletion.');
}finally{await mf?.dispose();}})().catch(e=>{console.error(e);process.exitCode=1;});
