import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost as check } from '../functions/api/check-plan.js';
import { onRequestPost as recover } from '../functions/api/register-complete.js';
import { onRequestPost as claim } from '../functions/api/claim-token.js';
import { PLAN_DEVICE_LIMITS, deviceLimitForFingerprint, getAccountDeviceLimit, isNewDeviceOverLimit, devicesKey } from '../functions/_shared/devices.js';
const fingerprint='b5ba82f4c6a9336170511a96a963b0aef1c9b5986a54459f7a5a66fe6da9e270';
const email='authorized-fixture@example.invalid',token='local-fixture-token';
const uuid=i=>`${String(i).padStart(8,'0')}-0000-4000-8000-000000000000`;
class KV{store=new Map();async get(k){return this.store.get(k)||null;}async put(k,v){this.store.set(k,v);}async delete(k){this.store.delete(k);}}
async function envFor(plan='lifetime'){
 const env={PLANS_KV:new KV(),DEVICE_LIMIT_ENFORCED:'true'};
 await env.PLANS_KV.put('reg:'+email,JSON.stringify({token,registeredAt:new Date().toISOString()}));
 await env.PLANS_KV.put(email,JSON.stringify({plan,status:'active',currentPeriodEnd:new Date(Date.now()+86400000).toISOString()}));return env;
}
async function enter(env,id,extra={}){return(await check({env,request:new Request('https://fixture.invalid/api/check-plan',{method:'POST',body:JSON.stringify({email,token,deviceId:uuid(id),...extra})})})).json();}
// Match the configured fingerprint only for a fictional account. Real emails
// are not committed as test data. Other SHA-256 operations remain unmodified.
async function withAuthorizedFixture(run){
 const original=crypto.subtle.digest.bind(crypto.subtle);
 crypto.subtle.digest=async(algorithm,data)=>new TextDecoder().decode(data)===email?Uint8Array.from(fingerprint.match(/../g),b=>parseInt(b,16)).buffer:original(algorithm,data);
 try{await run();}finally{crypto.subtle.digest=original;}
}
test('Exactly one configured fingerprint gets five; ordinary plan rules and trials remain unchanged',async()=>{
 assert.deepEqual(PLAN_DEVICE_LIMITS,{pro:3,lifetime:1});
 for(const plan of ['pro','lifetime'])assert.equal(deviceLimitForFingerprint(fingerprint,plan),5);
 for(const plan of ['trial','free',undefined])assert.equal(deviceLimitForFingerprint(fingerprint,plan),null);
 assert.equal(await getAccountDeviceLimit('another@example.invalid','lifetime'),1);
 assert.equal(await getAccountDeviceLimit('another@example.invalid','pro'),3);
 assert.equal(deviceLimitForFingerprint(fingerprint.slice(0,-1)+'1','lifetime'),1);
});
for(const plan of ['pro','lifetime'])test('Authorized '+plan+' account keeps five devices active and a sixth new device is rejected',()=>withAuthorizedFixture(async()=>{
 const env=await envFor(plan);
 for(let i=1;i<=5;i++){const result=await enter(env,i);assert.equal(result.ok,true);assert.equal(result.deviceLimit,5);}
 const result=await enter(env,6);assert.equal(result.code,'device_limit');assert.equal(result.deviceLimit,5);assert.equal(result.devices.length,5);
 for(let i=1;i<=5;i++)assert.equal((await enter(env,i)).ok,true);
 const list=JSON.parse(await env.PLANS_KV.get(devicesKey(email)));assert.equal(list.filter(d=>d.status==='active').length,5);
}));
test('Recovery and token-claim share the effective limit helper; no route can preregister a sixth device',()=>withAuthorizedFixture(async()=>{
 const env=await envFor();for(let i=1;i<=5;i++)await enter(env,i);
 assert.equal(await isNewDeviceOverLimit(env,email,uuid(5),'lifetime'),false);
 assert.equal(await isNewDeviceOverLimit(env,email,uuid(6),'lifetime'),true);
}));
test('A guessed email, wrong token or client-supplied override cannot authorize an account',()=>withAuthorizedFixture(async()=>{
 const env=await envFor();assert.deepEqual(await enter(env,1,{token:'wrong',deviceLimit:99}),{ok:false});assert.equal(await env.PLANS_KV.get(devicesKey(email)),null);
 for(let i=1;i<=5;i++)await enter(env,i);assert.equal((await enter(env,6,{deviceLimit:99})).code,'device_limit');
}));
test('Exception does not reactivate revoked devices or change payment records',()=>withAuthorizedFixture(async()=>{
 const env=await envFor(),paid=await env.PLANS_KV.get(email);await enter(env,1);
 await env.PLANS_KV.put(devicesKey(email),JSON.stringify([{deviceId:uuid(1),status:'revoked'}]));
 assert.equal((await enter(env,1)).code,'device_revoked');assert.equal(await env.PLANS_KV.get(email),paid);
}));
test('Actual email recovery admits the fifth device and cannot preregister the sixth',()=>withAuthorizedFixture(async()=>{
 const env=await envFor();for(let i=1;i<=4;i++)await enter(env,i);
 for(const i of [5,6]){
  await env.PLANS_KV.put('verify:'+email,JSON.stringify({code:'123456',createdAt:Date.now()}));
  const response=await recover({env,request:new Request('https://fixture.invalid/api/register-complete',{method:'POST',headers:{'Content-Type':'application/json','CF-Connecting-IP':'203.0.113.90'},body:JSON.stringify({email,code:'123456',deviceId:uuid(i)})})});
  const result=await response.json();assert.equal(result.ok,true);assert.ok(result.token);
 }
 assert.equal(JSON.parse(await env.PLANS_KV.get(devicesKey(email))).filter(d=>d.status==='active').length,5);
 assert.equal((await enter(env,6)).code,'device_limit');
}));
test('Actual legacy token claim cannot preregister a sixth device',()=>withAuthorizedFixture(async()=>{
 const env=await envFor();for(let i=1;i<=5;i++)await enter(env,i);
 const registeredAt=new Date(Date.now()-100*86400000).toISOString();await env.PLANS_KV.put('reg:'+email,JSON.stringify({registeredAt}));
 const response=await claim({env,request:new Request('https://fixture.invalid/api/claim-token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,registeredAt,deviceId:uuid(6)})})});const result=await response.json();assert.equal(result.ok,true);
 assert.equal((await enter(env,6,{token:result.token})).code,'device_limit');assert.equal(JSON.parse(await env.PLANS_KV.get(devicesKey(email))).filter(d=>d.status==='active').length,5);
}));
