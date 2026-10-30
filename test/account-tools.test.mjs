import {test} from 'node:test';
import assert from 'node:assert/strict';
import {onRequestPost as proof} from '../functions/api/passkey-account.js';
import {onRequestPost as proxy} from '../functions/api/account-tools/[[path]].js';
import {devicesKey} from '../functions/_shared/devices.js';
const email='passkey-fixture@example.invalid',token='fictional-opaque-account-token-0123456789';
const deviceId='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
function fixture(){
 const records=new Map([['reg:'+email,JSON.stringify({token,registeredAt:new Date().toISOString()})],[email,JSON.stringify({plan:'lifetime'})]]);
 return {records,env:{DEVICE_LIMIT_ENFORCED:'true',PLANS_KV:{get:async key=>records.get(key)||null,put:()=>{throw Error('Read-only proof must not write');},delete:()=>{throw Error('Read-only proof must not delete');}}}};
}
const request=(body,origin='https://www.identifly.app')=>new Request(origin+'/api/passkey-account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
test('Account proof reuses the authoritative token and returns only opaque account/device metadata without writes',async()=>{
 const {env}=fixture();const res=await proof({request:request({email,token,deviceId}),env}),body=await res.json();
 assert.equal(res.status,200);assert.equal(res.headers.get('Cache-Control'),'no-store');assert.equal(body.ok,true);assert.match(body.subject,/^[a-f0-9]{64}$/);assert.match(body.epoch,/^[a-f0-9]{64}$/);assert.equal(body.deviceId,deviceId);
 assert.deepEqual(Object.keys(body).sort(),['deviceId','epoch','ok','subject']);assert.ok(!JSON.stringify(body).includes(email));assert.ok(!JSON.stringify(body).includes(token));
 for(const bad of [{token:'wrong'},{email:'other@example.invalid'},{deviceId:'invalid'}]){
  const r=await proof({request:request({email,token,deviceId,...bad}),env});assert.ok([400,401].includes(r.status));assert.equal((await r.json()).ok,false);
 }
});
test('Proof preserves blocked plans, revoked devices and existing device limits without registering a replacement',async()=>{
 const {env,records}=fixture();records.set(devicesKey(email),JSON.stringify([{deviceId,status:'active'}]));
 assert.equal((await proof({request:request({email,token,deviceId}),env})).status,200);
 assert.equal((await proof({request:request({email,token,deviceId:other}),env})).status,403);
 records.set(devicesKey(email),JSON.stringify([{deviceId,status:'revoked'}]));assert.equal((await proof({request:request({email,token,deviceId}),env})).status,403);
 records.set(email,JSON.stringify({plan:'pro',status:'canceled',currentPeriodEnd:new Date(0).toISOString()}));records.set('reg:'+email,JSON.stringify({token,registeredAt:'2020-01-01T00:00:00Z'}));assert.equal((await proof({request:request({email,token,deviceId}),env})).status,402);
});
test('Proxy is limited to fixed routes and same-site callers, with a bounded request and no upstream cookies',async()=>{
 const saved=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({ok:true}),{headers:{'Content-Type':'application/json','Set-Cookie':'upstream-secret=1','Cache-Control':'public'}});};
 try{
  const invoke=(path,body='{}',origin='https://www.identifly.app',header=origin)=>proxy({request:new Request(origin+'/api/account-tools/'+path,{method:'POST',headers:{Origin:header},body}),params:{path:path.split('/')}});
  const r=await invoke('passkeys/list');assert.equal(r.status,200);assert.equal(calls[0].url,'https://doctorqr-backend-production.up.railway.app/api/passkeys/identity/list');assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.headers.Origin,'https://www.identifly.app');assert.equal(r.headers.get('Cache-Control'),'no-store');assert.equal(r.headers.get('Set-Cookie'),null);
  assert.equal((await invoke('passkeys/identity/purge')).status,404);assert.equal((await invoke('https://other.invalid')).status,404);assert.equal((await invoke('passkeys/list','{}','https://other.invalid')).status,403);assert.equal((await invoke('passkeys/list','{}','https://www.identifly.app','https://other.invalid')).status,403);assert.equal((await invoke('passkeys/list','x'.repeat(50001))).status,413);assert.equal(calls.length,1);
  globalThis.fetch=async()=>{throw Error('fictional network failure');};const failed=await invoke('wallet/status');assert.equal(failed.status,503);assert.equal((await failed.json()).code,'service_unavailable');
 }finally{globalThis.fetch=saved;}
});
