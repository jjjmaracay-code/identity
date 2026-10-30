'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const backend=path.resolve(process.env.BACKEND_REPO||path.join(__dirname,'../../doctorqr-backend'));
const {createFixture}=require(backend+'/tests/account-tools-fixture.cjs');
const root=path.resolve(__dirname,'..'),origin='https://www.identifly.app',password='Fictional!234';
const salt=Buffer.alloc(16,7),stored=JSON.stringify({v:2,salt:salt.toString('base64'),hash:crypto.pbkdf2Sync(password,salt,100000,32,'sha256').toString('base64')});
(async()=>{const f=await createFixture();let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
 async function create({factor=false,prf=true}={}){
  const c=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,reducedMotion:'reduce',serviceWorkers:'block'});c.setDefaultTimeout(12000);const errors=[],writes=[];
  const identity=f.identities[0];
  await c.addInitScript(({origin,identity,stored,factor})=>{
   if(location.origin!==origin||localStorage.getItem('qa-seeded'))return;localStorage.setItem('qa-seeded','1');
   const reg={name:'Identity Alice',email:identity.email,verified:true,language:'es',timestamp:new Date().toISOString()};
   const values={identity_consent:'true',identity_tour_done:'1',identity_pin:stored,identity_registration:JSON.stringify(reg),identity_access_token:identity.token,identity_device_id:identity.deviceId,identity_plan:'lifetime',identity_data:JSON.stringify({name:reg.name,email:reg.email,job:'Original role',toggles:{job:true,email:true}})};
   if(factor){values.identity_2fa_config=JSON.stringify({totp:true});values.identity_totp_secret='JBSWY3DPEHPK3PXP';}
   for(const [k,v]of Object.entries(values))localStorage.setItem(k,v);
  },{origin,identity,stored,factor});
  await c.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url());if(u.origin!==origin)return route.abort();
   if(u.pathname.startsWith('/api/account-tools/passkeys/')){
    const target=f.base+'/api/passkeys/identity/'+u.pathname.split('/api/account-tools/passkeys/')[1];writes.push({url:target,body:req.postData()});
    const response=await c.request.post(target,{headers:{Origin:origin,'Content-Type':'application/json'},data:req.postData()});return route.fulfill({response});
   }
   if(u.pathname.startsWith('/api/account-tools/wallet/'))return route.fulfill({contentType:'application/json',body:JSON.stringify({apple:false,google:false})});
   if(u.pathname.startsWith('/api/'))return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,plan:'lifetime',bloqueado:false})});
   if(u.pathname==='/sw.js')return route.abort();
   const file=path.resolve(root,'.'+(u.pathname==='/'?'/index.html':u.pathname));if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:'Missing fictional asset'});
   return route.fulfill({contentType:({'.html':'text/html','.js':'application/javascript','.json':'application/json','.css':'text/css','.png':'image/png','.jpg':'image/jpeg'})[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});
  });
  await c.exposeFunction('__accountToolsRootError',message=>errors.push(message));await c.addInitScript(()=>{if(window!==window.top)return;window.addEventListener('error',e=>window.__accountToolsRootError(e.message));window.addEventListener('unhandledrejection',e=>window.__accountToolsRootError(String(e.reason?.message||e.reason)));});
  const p=await c.newPage();await p.goto(origin+'/index.html');await p.waitForFunction(()=>!!window.IdentityAccountBridge&&!document.getElementById('boot-gate'));
  const cdp=await c.newCDPSession(p);await cdp.send('WebAuthn.enable');await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true,hasPrf:prf}});
  await p.locator('#pin-dots-display').fill(password);await p.locator('#pin-enter-btn').click();
  if(factor){await p.locator('#screen-2fa-verify.open').waitFor();const code=await p.evaluate(()=>getTOTPInstance(currentTOTPSecret).generate());await p.locator('#verify-totp-input').fill(code);await p.locator('#btn-verify-totp').click();}
  await p.waitForFunction(()=>IdentityAccountBridge.unlocked());await p.evaluate(()=>openEdit());
  await p.locator('#form-edit-tab-identity').click();await p.locator('.fel-dialog[open] .fel-enable').click();
  await p.locator('#identity-account-tools summary').click();return{c,p,cdp,errors,writes};
 }
 const x=await create();
 await x.p.locator('#passkey-enable').click();await x.p.locator('#account-tools-confirm-input').fill(password);await x.p.locator('#account-tools-confirm').click();
 await x.p.waitForFunction(()=>!!localStorage.getItem('identity_passkey_grant'),{},{timeout:20000});
 const grant=await x.p.evaluate(()=>JSON.parse(localStorage.getItem('identity_passkey_grant')));assert.ok(grant.data&&grant.iv&&grant.salt);assert.ok(!JSON.stringify(grant).includes(password));
 assert.ok(x.writes.every(r=>!r.body.includes(password)),'Password never goes to the optional backend');
 assert.ok(x.writes.every(r=>!r.body.includes('results')),'PRF output never goes to server');
 // An actual edit captures its earlier value without requiring an extra save action.
 await x.p.locator('#f-job').fill('New role');await x.p.evaluate(()=>saveProfile());await x.p.waitForTimeout(300);
 await x.p.locator('#identity-undo').click();await x.p.locator('#account-tools-confirm').click();await x.p.waitForFunction(()=>IdentityAccountBridge.profile().job==='Original role');
 assert.equal(await x.p.evaluate(()=>localStorage.getItem('identity_pin')),stored);assert.equal(await x.p.evaluate(()=>FormEditLock.isLocked('identity')),true);
 await x.p.evaluate(()=>document.getElementById('screen-edit').classList.remove('open'));await x.p.locator('#btn-lock').click();assert.equal(await x.p.locator('#passkey-login').evaluate(e=>getComputedStyle(e).getPropertyValue('--tools-accent').trim()),'#aaff00');assert.ok((await x.p.locator('#passkey-login').boundingBox()).height>=48);await x.p.locator('#passkey-login').click();
 await x.p.waitForFunction(()=>IdentityAccountBridge.unlocked(),{},{timeout:20000});assert.equal(await x.p.evaluate(()=>IdentityAccountBridge.profile().email),'identity-alice@example.invalid');
 await x.p.waitForFunction(()=>{const e=document.getElementById('screen-main'),n=document.getElementById('card-name').getBoundingClientRect();return getComputedStyle(e).opacity==='1'&&n.top>=0&&n.bottom<=innerHeight;});assert.deepEqual(x.errors,[]);await x.p.evaluate(()=>openEdit());assert.equal(await x.p.locator('#identity-account-status').evaluate(e=>getComputedStyle(e).color),'rgb(238, 247, 255)');await x.p.locator('#identity-account-tools').screenshot({path:'/tmp/identifly-account-tools-mobile.png'});await x.c.close();
 console.log('PASS: actual Identifly UI enrolls a PRF-capable credential, keeps password/PRF local, restores profile data, relocks editing and unlocks with verified passkey.');
 await f.reset();const y=await create({factor:true});await y.p.locator('#passkey-enable').click();await y.p.locator('#account-tools-confirm-input').fill(password);await y.p.locator('#account-tools-confirm').click();
 await y.p.locator('#account-tools-confirm-input').waitFor();const code=await y.p.evaluate(()=>getTOTPInstance(currentTOTPSecret).generate());await y.p.locator('#account-tools-confirm-input').fill(code);await y.p.locator('#account-tools-confirm').click();await y.p.waitForFunction(()=>!!localStorage.getItem('identity_passkey_grant'),{},{timeout:20000});
 await y.p.evaluate(()=>document.getElementById('screen-edit').classList.remove('open'));await y.p.locator('#btn-lock').click();await y.p.locator('#passkey-login').click();await y.p.locator('#screen-2fa-verify.open').waitFor();assert.equal(await y.p.evaluate(()=>IdentityAccountBridge.unlocked()),false,'Passkey must not bypass an enabled local authenticator');
 const second=await y.p.evaluate(()=>getTOTPInstance(currentTOTPSecret).generate());await y.p.locator('#verify-totp-input').fill(second);await y.p.locator('#btn-verify-totp').click();await y.p.waitForFunction(()=>IdentityAccountBridge.unlocked());assert.deepEqual(y.errors,[]);await y.c.close();
 console.log('PASS: encrypted local authenticator remains mandatory after passkey unlock.');
 await f.reset();const z=await create({prf:false});await z.p.locator('#passkey-enable').click();await z.p.locator('#account-tools-confirm-input').fill(password);await z.p.locator('#account-tools-confirm').click();await z.p.waitForFunction(()=>document.getElementById('identity-account-status').textContent.includes('no permite'));
 assert.equal(await z.p.evaluate(()=>localStorage.getItem('identity_passkey_grant')),null);assert.equal((await f.db.query("SELECT * FROM app_passkeys WHERE app='identity'")).rows.length,0);assert.equal(await z.p.evaluate(()=>IdentityAccountBridge.unlocked()),true);assert.deepEqual(z.errors,[]);await z.c.close();
 console.log('PASS: unsupported secure-key wrapping leaves original password access intact and creates no server credential.');
}finally{await browser?.close();await f.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
