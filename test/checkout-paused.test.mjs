import {test} from 'node:test';
import assert from 'node:assert/strict';
import {onRequestPost} from '../functions/api/create-checkout.js';
import {checkoutEnabled} from '../functions/_shared/checkout-policy.js';
test('cierre por defecto: sin cuerpo, KV ni Stripe; rechaza incluso planes y sesiones anteriores',async t=>{
 t.mock.method(globalThis,'fetch',()=>{throw new Error('No debe consultar Stripe');});
 for(const flag of [undefined,'false','TRUE',' true ',true,'1','']) {
  assert.equal(checkoutEnabled({IDENTIFLY_CHECKOUT_ENABLED:flag}),false);
  let reads=0;const env={IDENTIFLY_CHECKOUT_ENABLED:flag,get PLANS_KV(){reads++;throw new Error('No debe leer KV');}};
  const request={json(){throw new Error('No debe leer cuerpo');}};
  const res=await onRequestPost({env,request});assert.equal(res.status,503);
  assert.equal(res.headers.get('Cache-Control'),'no-store');assert.deepEqual(await res.json(),{error:'checkout_paused'});assert.equal(reads,0);
 }
});
test('reapertura explícita mantiene autenticación; el cliente no puede activar el interruptor',async()=>{
 assert.equal(checkoutEnabled({IDENTIFLY_CHECKOUT_ENABLED:'true'}),true);
 const res=await onRequestPost({env:{IDENTIFLY_CHECKOUT_ENABLED:'true'},request:{json:async()=>({})}});
 assert.equal(res.status,401);assert.equal((await res.json()).error,'no_verificado');
 const blocked=await onRequestPost({env:{},request:{json:async()=>({IDENTIFLY_CHECKOUT_ENABLED:'true'})}});
 assert.equal(blocked.status,503);
});
