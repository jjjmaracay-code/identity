'use strict';
// Real local login/recovery UI with fictional accounts and delayed API replies.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),origin='https://session.test',password='Fictional!234';
const salt=Buffer.alloc(16,7),stored=JSON.stringify({v:2,salt:salt.toString('base64'),hash:crypto.pbkdf2Sync(password,salt,100000,32,'sha256').toString('base64')});
const registration={name:'Alice Fixture',email:'alice@example.invalid',verified:true,language:'es',timestamp:new Date().toISOString()};
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg'};
(async()=>{let browser;try{
 browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 async function fixture({pending=false,holdPlan=false,planReply={ok:true,plan:'lifetime',bloqueado:false}}={}){
  const c=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce',serviceWorkers:'block'});c.setDefaultTimeout(10000);
  let release;const held=new Promise(resolve=>{release=resolve;}),requests=[],errors=[];
  await c.exposeFunction('__sessionQAError',message=>errors.push(message));
  await c.addInitScript(()=>{if(window!==window.top)return;window.addEventListener('error',e=>window.__sessionQAError(e.message));window.addEventListener('unhandledrejection',e=>window.__sessionQAError(String(e.reason?.message||e.reason)));});
  await c.addInitScript(({origin,registration,stored,pending,holdPlan})=>{
   if(location.origin!==origin||localStorage.getItem('seeded'))return;localStorage.setItem('seeded','1');
   const values={identity_consent:'true',identity_tour_done:'1',identity_pin:stored,identity_registration:JSON.stringify(registration),identity_plan:'lifetime',identity_data:JSON.stringify({name:registration.name,email:registration.email,job:'Original role',toggles:{job:true,email:true}})};
   if(pending){values.identity_kv_sync_pending='true';values.identity_pending_verify_code='123456';}
   if(holdPlan)values.identity_access_token='confirmed-fictional-token';
   for(const[k,v]of Object.entries(values))localStorage.setItem(k,v);
  },{origin,registration,stored,pending,holdPlan});
  await c.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url());if(u.origin!==origin)return route.abort();if(u.pathname==='/sw.js')return route.abort();
   if(u.pathname.startsWith('/api/')){
    requests.push({path:u.pathname,body:req.postData()||''});
    if(u.pathname==='/api/claim-token'||u.pathname==='/api/register-complete'){
     await held;return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,token:'confirmed-fictional-token',cardTrialRequired:pending})});
    }
    if(u.pathname==='/api/check-plan'){if(holdPlan)await held;return route.fulfill({contentType:'application/json',body:JSON.stringify(planReply)});}
    return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,plan:'lifetime',bloqueado:false,apple:false,google:false})});
   }
   const file=path.resolve(root,'.'+(u.pathname==='/'?'/index.html':u.pathname));if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:'Missing fixture asset'});
   return route.fulfill({contentType:mime[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});
  });
  const p=await c.newPage();await p.goto(origin+'/index.html');await p.waitForFunction(()=>!!window.IdentityAccountBridge&&!document.getElementById('boot-gate'));
  return{c,p,release,requests,errors};
 }
 async function login(p){await p.locator('#pin-dots-display').fill(password);await p.locator('#pin-enter-btn').click();await p.waitForFunction(()=>document.getElementById('screen-main').classList.contains('visible'));}
 for(const pending of [false,true]){
  const x=await fixture({pending});x.release();await x.p.waitForFunction(()=>localStorage.getItem('identity_access_token')==='confirmed-fictional-token');await login(x.p);
  assert.equal(await x.p.evaluate(()=>IdentityAccountBridge.unlocked()),true,'A server-confirmed token on the same page must enable optional access and recovery');
  assert.equal(x.requests.filter(r=>r.path==='/api/check-plan').length,1,'The confirmed token still passes through the normal plan check');
  if(pending){assert.equal(x.requests.filter(r=>r.path==='/api/claim-token').length,0,'A confirmed pending registration does not request a competing token');assert.equal(await x.p.evaluate(()=>localStorage.getItem('identity_kv_sync_pending')),null);}
  await x.p.evaluate(()=>openEdit());await x.p.locator('#form-edit-tab-identity').click();await x.p.locator('.fel-dialog[open] .fel-enable').click();
  await x.p.locator('#identity-account-tools summary').click();await x.p.locator('#passkey-enable').click();await x.p.locator('#account-tools-confirm-input').waitFor();await x.p.locator('#account-tools-dialog button[type="button"]').click();
  await x.p.locator('#f-job').fill('Edited role');await x.p.evaluate(()=>saveProfile());await x.p.waitForTimeout(300);
  await x.p.locator('#identity-undo').click();await x.p.locator('#account-tools-confirm').click();
  await x.p.waitForFunction(()=>IdentityAccountBridge.profile().job==='Original role');assert.equal(await x.p.evaluate(()=>FormEditLock.isLocked('identity')),true);
  const other=await x.c.newPage();await other.goto(origin+'/index.html');await other.evaluate(()=>localStorage.setItem('identity_access_token','changed-in-another-tab'));
  assert.equal(await x.p.evaluate(()=>IdentityAccountBridge.unlocked()),false,'A different tab cannot silently replace the authenticated owner context');
  await x.p.locator('#form-edit-tab-identity').click();await x.p.locator('.fel-dialog[open] .fel-enable').click();const count=x.requests.length;
  await x.p.locator('#passkey-enable').click();assert.equal(await x.p.locator('#account-tools-dialog').count(),0);assert.equal(x.requests.length,count,'The stale tab cannot enroll for the changed account');
  assert.deepEqual(x.errors,[]);await x.c.close();
 }
 console.log('PASS: delayed token claim and pending-registration confirmation allow login and encrypted Undo without a reload; another tab cannot rebind that session.');
 for(const pending of [false,true]){
  const x=await fixture({pending}),other=await x.c.newPage();await other.goto(origin+'/index.html');
  await other.evaluate(()=>{localStorage.setItem('identity_registration',JSON.stringify({name:'Other Fixture',email:'other@example.invalid',timestamp:'2026-01-01T00:00:00Z'}));localStorage.setItem('identity_access_token','other-fictional-token');});
  x.release();await x.p.waitForTimeout(250);
  assert.equal(await x.p.evaluate(()=>localStorage.getItem('identity_access_token')),'other-fictional-token','A late server response cannot overwrite the other account token');
  assert.equal(await x.p.evaluate(()=>JSON.parse(localStorage.getItem('identity_registration')).email),'other@example.invalid');
  assert.equal(await x.p.evaluate(()=>IdentityAccountBridge.unlocked()),false);assert.deepEqual(x.errors,[]);await x.c.close();
 }
 console.log('PASS: delayed claim/registration replies cannot alter a different account selected in another tab.');
 for(const planReply of [{ok:false,code:'device_revoked'},{ok:true,plan:'pro',bloqueado:true}]){
  const x=await fixture({holdPlan:true,planReply}),other=await x.c.newPage();await other.goto(origin+'/index.html');
  await other.evaluate(()=>{localStorage.setItem('identity_registration',JSON.stringify({name:'Other Fixture',email:'other@example.invalid',timestamp:'2026-01-01T00:00:00Z'}));localStorage.setItem('identity_access_token','other-fictional-token');localStorage.setItem('identity_data',JSON.stringify({name:'Other Fixture',job:'Other role'}));});
  const delivered=x.p.waitForResponse(r=>new URL(r.url()).pathname==='/api/check-plan');x.release();await(await delivered).finished();await x.p.waitForTimeout(100);
  assert.equal(new URL(x.p.url()).pathname,'/index.html','A stale plan verdict cannot redirect the old tab');
  assert.equal(await x.p.evaluate(()=>localStorage.getItem('identity_access_token')),'other-fictional-token');
  assert.equal(await x.p.evaluate(()=>JSON.parse(localStorage.getItem('identity_data')).job),'Other role','A stale revocation cannot wipe the new account');
  assert.equal(await x.p.evaluate(()=>localStorage.getItem('identity_plan_verified')),null,'A stale plan verdict cannot be cached for another account');
  assert.deepEqual(x.errors,[]);await x.c.close();
 }
 console.log('PASS: stale device revocation or blocked-plan replies neither wipe, redirect nor cache a verdict for another account.');
}finally{await browser?.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
