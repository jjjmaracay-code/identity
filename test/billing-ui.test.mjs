import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const html = read('paywall.html');
const languages = ['es','ca','eu','gl','en','fr','de','pt','hi','zh','ru','ja','ar'];
const drain = async () => { for (let n=0;n<30;n++) await Promise.resolve(); };
function nodesFromHTML() {
  const nodes=[...html.matchAll(/<([a-z][\w-]*)\b([^>]*?)>/gi)].map(([,tag,raw])=>{
    const attributes=Object.fromEntries([...raw.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(([,key,value])=>[key,value||'']));
    const classes=new Set((attributes.class||'').split(' '));
    return { tag,attributes,hidden:'hidden' in attributes,disabled:'disabled' in attributes,checked:false,value:'',textContent:'',listeners:{},
      hasAttribute(k){return k in attributes;},getAttribute(k){return attributes[k];},setAttribute(k,v){attributes[k]=v;},
      classList:{ add:k=>classes.add(k),remove:k=>classes.delete(k),contains:k=>classes.has(k) },
      addEventListener(k,fn){this.listeners[k]=fn;},async fire(k){await this.listeners[k]?.();await drain();} };
  });
  return {nodes,documentElement:nodes.find(n=>n.tag==='html'),body:{appendChild(){}},
    getElementById:id=>nodes.find(n=>n.attributes.id===id),querySelectorAll:selector=>nodes.filter(n=>n.hasAttribute(selector.slice(1,-1)))};
}
async function fixture(options={}) {
  const lang=options.lang||'es', dict=JSON.parse(read('i18n/'+lang+'.json')),document=nodesFromHTML();
  const values=new Map(Object.entries({identity_registration:JSON.stringify({email:'trial@example.com',language:lang,cardTrialRequired:true}),
    identity_access_token:'token-fixture',identity_data:JSON.stringify({name:'Álex Fixture',email:'alex@example.com'})}));
  const calls=[],alerts=[],downloads=[],blobs=new Map();let wiped=0;
  const status={ok:true,plan:'free',bloqueado:true,cardTrialRequired:true,trialEligible:true,hasSubscription:false,cancelAtPeriodEnd:false,...options.status};
  const context={document,Blob,URL,console,history:{replaceState(){}},navigator:{languages:[lang],onLine:true},
    location:{href:'https://www.identifly.app/paywall.html',replace(url){this.href=url;}},
    localStorage:{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)},
    alert:msg=>alerts.push(msg),confirm:()=>true,borrarTodoElAlmacenamiento:async()=>{wiped++;},
    fetch:async(url,init)=>{
      if(url.startsWith('/i18n/'))return {ok:true,json:async()=>dict};
      const body=JSON.parse(init.body); calls.push({url,body});
      let data,ok=true;
      if(url==='/api/check-plan')data={...status};
      else if(url==='/api/create-checkout')data={url:'https://checkout.stripe.com/c/pay/cs_test_fixture'};
      else if(url==='/api/cancel-subscription'){
        if(options.cancelFails){ok=false;data={error:'cancellation_unconfirmed'};}
        else {data={ok:true,cancelAtPeriodEnd:true};status.cancelAtPeriodEnd=true;}
      } else if(url==='/api/delete-account'){ok=false;data={error:'failure'};}
      else throw new Error('Unexpected request '+url);
      return {ok,json:async()=>data};
    }
  };
  // Interceptar solo los objetos blob de esta VM, sin modificar URL global.
  context.URL=class extends URL{static createObjectURL(blob){const url='blob:fixture-'+blobs.size;blobs.set(url,blob);return url;}static revokeObjectURL(){}};
  document.createElement=tag=>tag==='a'?{click(){downloads.push(blobs.get(this.href));},remove(){}}:{set innerHTML(s){this.textContent=s.replace(/<[^>]+>/g,'');}};
  context.window=context;vm.createContext(context);
  for(const script of ['i18n/loader.js','plan-cache.js','vcard.js','billing.js'])vm.runInContext(read(script),context,{filename:script});
  await context.i18nReady;await drain();
  return {context,document,calls,alerts,downloads,dict,values,get wiped(){return wiped;}};
}
for(const lang of languages)test(`pago ${lang}: muestra la prueba y exige ambas aceptaciones antes de ir a Stripe`,async()=>{
  const f=await fixture({lang}),$=id=>f.document.getElementById(id);
  assert.equal(f.document.documentElement.dir,lang==='ar'?'rtl':'ltr');
  assert.equal($('trial-offer').hidden,false);
  assert.equal($('btn-pro').textContent,f.dict['billing.start_trial']);
  await $('btn-pro').fire('click');
  assert.equal($('trial-consent-label').hidden,false);
  assert.equal($('btn-checkout').disabled,true);
  $('waiver-check').checked=true;await $('waiver-check').fire('change');
  assert.equal($('btn-checkout').disabled,true);
  await $('btn-checkout').fire('click');
  assert.equal(f.calls.filter(c=>c.url==='/api/create-checkout').length,0);
  $('trial-check').checked=true;await $('trial-check').fire('change');
  assert.equal($('btn-checkout').disabled,false);
  await $('btn-checkout').fire('click');
  const sent=f.calls.find(c=>c.url==='/api/create-checkout').body;
  assert.equal(sent.token,'token-fixture');assert.equal(sent.email,'trial@example.com');
  assert.equal(sent.trialAccepted,true);assert.equal(sent.waiverAccepted,true);
  assert.match(f.context.location.href,/^https:\/\/checkout\.stripe\.com\//);
});
test('pago: Lifetime no promete prueba gratuita ni exige el consentimiento de suscripción',async()=>{
 const f=await fixture(),$=id=>f.document.getElementById(id);
 await $('btn-lifetime').fire('click');
 assert.equal($('trial-consent-label').hidden,true);
 $('waiver-check').checked=true;await $('waiver-check').fire('change');
 await $('btn-checkout').fire('click');
 assert.equal(f.calls.at(-1).body.trialAccepted,false);assert.equal(f.calls.at(-1).body.plan,'lifetime');
});
test('pago: una prueba ya usada no se anuncia como gratis',async()=>{
 const f=await fixture({status:{trialEligible:false}});
 assert.equal(f.document.getElementById('trial-offer').hidden,true);
 assert.equal(f.document.getElementById('btn-pro').textContent,f.dict['index.plans.pro_button']);
});
test('pago: cancelar solo confirma éxito cuando el servidor lo confirma',async()=>{
 const failed=await fixture({status:{hasSubscription:true,plan:'pro',bloqueado:false},cancelFails:true});
 await failed.document.getElementById('btn-cancel-subscription').fire('click');
 assert.equal(failed.alerts.at(-1),failed.dict['billing.cancel_error']);
 assert.equal(failed.document.getElementById('btn-cancel-subscription').hidden,false);
 const success=await fixture({status:{hasSubscription:true,plan:'pro',bloqueado:false}});
 await success.document.getElementById('btn-cancel-subscription').fire('click');
 assert.equal(success.document.getElementById('btn-cancel-subscription').hidden,true);
 assert.equal(success.document.getElementById('billing-status').textContent,success.dict['billing.cancelled']);
});
test('pago: exportar usa identity_data y un fallo de baja conserva todos los datos locales',async()=>{
 const f=await fixture();
 await f.document.getElementById('btn-export-vcard-paywall').fire('click');
 assert.match(await f.downloads[0].text(),/FN:Álex Fixture/);
 await f.document.getElementById('btn-delete-account-paywall').fire('click');
 assert.equal(f.wiped,0);assert.ok(f.values.get('identity_data'));
 assert.equal(f.alerts.at(-1),f.dict['index.delete_confirm.server_error_toast']);
});
