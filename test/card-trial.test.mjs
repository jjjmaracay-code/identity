import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { onRequestPost as register } from '../functions/api/register-complete.js';
import { onRequestPost as checkout } from '../functions/api/create-checkout.js';
import { onRequestPost as webhook } from '../functions/api/stripe-webhook.js';
import { onRequestPost as checkSession } from '../functions/api/check-session.js';
import { onRequestPost as checkPlan } from '../functions/api/check-plan.js';
import { onRequestPost as cancel } from '../functions/api/cancel-subscription.js';
import { onRequestPost as remove } from '../functions/api/delete-account.js';
import { accountId, readRecord } from '../functions/_shared/card-trial.js';
import { getPlanStatus, computePaidActive } from '../functions/_shared/plan-access.js';
import { hashTrialFingerprint, trialFingerprintKey } from '../functions/_shared/trial-fingerprint.js';
import { recordDeviceSeen } from '../functions/_shared/devices.js';

class KV {
  store = new Map();
  async get(key) { return this.store.get(key) ?? null; }
  async put(key, value) { this.store.set(key, value); }
  async delete(key) { this.store.delete(key); }
}
const email = 'trial@example.com';
const request = body => new Request('https://www.identifly.app/api/test', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.6' }, body: JSON.stringify(body),
});
async function call(handler, env, body) {
  const res = await handler({ request: request(body), env });
  return { status: res.status, data: await res.json() };
}
async function fixture(flag = 'true') {
  const env = {
    IDENTIFLY_CHECKOUT_ENABLED: 'true', PLANS_KV: new KV(), IP_HASH_SALT: 'test-only', STRIPE_CARD_TRIAL_ENABLED: flag,
    STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_PRICE_PRO: 'price_fixture_pro',
    STRIPE_PRICE_LIFETIME: 'price_fixture_lifetime', STRIPE_WEBHOOK_SECRET: 'whsec_fixture',
    BUSINESS_DO: { idFromName: x => x, get: () => ({ fetch: async () => new Response('{}') }) },
  };
  await env.PLANS_KV.put('verify:' + email, JSON.stringify({ code: '123456', createdAt: Date.now() }));
  const result = await call(register, env, { email, code: '123456' });
  assert.equal(result.status, 200);
  return { env, cred: { email, token: result.data.token }, result };
}
async function stripeFixture(t, cred) {
  const now = Math.floor(Date.now() / 1000), calls = [];
  const state = {
    calls, fail: false,
    session: { id: 'cs_test_fixture', url: 'https://checkout.stripe.com/c/pay/cs_test_fixture', status: 'open',
      payment_status: 'unpaid', subscription: 'sub_fixture', metadata: { account_email: email, card_trial: 'true', account_id: await accountId(cred.token) } },
    sub: { id: 'sub_fixture', customer: 'cus_fixture', status: 'trialing', trial_start: now - 5,
      trial_end: now + 30 * 86400, current_period_end: now + 30 * 86400, cancel_at_period_end: false,
      metadata: { email, card_trial: 'true', account_id: await accountId(cred.token) } },
  };
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    if(url==='https://doctorqr-backend-production.up.railway.app/api/passkeys/identity/purge')return Response.json({success:true});
    assert.ok(url.startsWith('https://api.stripe.com/v1/'));
    const method = options.method || 'GET', params = new URLSearchParams(options.body);
    calls.push({ url, method, params, headers: options.headers });
    if (state.fail) return new Response('{}', { status: 503 });
    let value;
    if (url.endsWith('/expire')) { state.session.status = 'expired'; value = state.session; }
    else if (url.includes('/checkout/sessions')) value = state.session;
    else if (url.includes('/subscriptions/')) {
      if (method === 'POST') state.sub.cancel_at_period_end = params.get('cancel_at_period_end') === 'true';
      if (method === 'DELETE') state.sub.status = 'canceled';
      value = state.sub;
    } else throw new Error('Unexpected Stripe request: ' + method + ' ' + url);
    return Response.json(value);
  });
  return state;
}
async function deliver(env, type, object, timestamp = Math.floor(Date.now() / 1000)) {
  const body = JSON.stringify({ id: 'evt_fixture', type, created: timestamp, data: { object } });
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(timestamp + '.' + body)));
  const signature = [...bytes].map(x => x.toString(16).padStart(2, '0')).join('');
  return webhook({ env, request: new Request('https://www.identifly.app/api/stripe-webhook', {
    method: 'POST', headers: { 'stripe-signature': `t=${timestamp},v1=${signature}` }, body,
  }) });
}
const consent = { plan: 'pro', waiverAccepted: true, trialAccepted: true };

test('F6: apagado por defecto; conserva los registros anteriores al encenderlo', async () => {
  const { env, result } = await fixture('false');
  env.STRIPE_CARD_TRIAL_ENABLED = 'true';
  const again = await call(register, env, { email, code: '123456' });
  assert.equal(again.data.cardTrialRequired, false);
  assert.equal(again.data.token, result.data.token);
  assert.equal((await getPlanStatus(env, email)).bloqueado, false);
  const fresh = await fixture('false');
  assert.equal(fresh.result.data.cardTrialRequired, false);
  assert.equal((await getPlanStatus(fresh.env, email)).bloqueado, false);
});

test('F6: registro nuevo exige tarjeta y el Checkout incluye 30 días y consentimiento', async t => {
  const { env, cred } = await fixture();
  assert.equal((await getPlanStatus(env, email)).bloqueado, true);
  const stripe = await stripeFixture(t, cred);
  const result = await call(checkout, env, { ...cred, ...consent });
  assert.equal(result.status, 200);
  assert.match(result.data.url, /^https:\/\/checkout.stripe.com\//);
  const posted = stripe.calls.find(c => c.method === 'POST');
  assert.equal(posted.params.get('subscription_data[trial_period_days]'), '30');
  assert.equal(posted.params.get('payment_method_collection'), 'always');
  assert.equal(posted.params.get('allowed_payment_method_types[0]'), 'card');
  assert.equal(posted.params.get('subscription_data[trial_settings][end_behavior][missing_payment_method]'), 'cancel');
  assert.equal(posted.params.get('metadata[trial_accepted]'), 'true');
  assert.equal(posted.params.get('client_reference_id'), email);
  assert.ok(posted.headers['Idempotency-Key']);
  assert.equal(posted.headers['Stripe-Version'], '2026-09-30.endive');
  await call(checkout, env, { ...cred, ...consent });
  assert.equal(stripe.calls.filter(c => c.url.endsWith('/checkout/sessions') && c.method === 'POST').length, 1);
});

test('F6: no crea Checkout sin titular o sin ambas aceptaciones estrictas', async t => {
  const { env, cred } = await fixture();
  const stripe = await stripeFixture(t, cred);
  for (const body of [{ ...cred, ...consent, token: 'wrong' }, { ...cred, ...consent, email: 'other@example.com' },
    { ...cred, ...consent, waiverAccepted: 'true' }, { ...cred, ...consent, trialAccepted: false }]) {
    assert.ok((await call(checkout, env, body)).status >= 400);
  }
  assert.equal(stripe.calls.length, 0);
});

test('F6: Lifetime y cuentas anteriores no reciben una prueba con tarjeta', async t => {
  const { env, cred } = await fixture('false');
  const stripe = await stripeFixture(t, cred);
  const result = await call(checkout, env, { ...cred, plan: 'lifetime', waiverAccepted: true });
  assert.equal(result.status, 200);
  assert.equal(stripe.calls[0].params.get('mode'), 'payment');
  assert.equal(stripe.calls[0].params.has('subscription_data[trial_period_days]'), false);
});

test('F6: no_payment_required activa la prueba con fechas reales; no limita dispositivos durante ella', async t => {
  const { env, cred } = await fixture();
  const stripe = await stripeFixture(t, cred);
  stripe.session.status = 'complete'; stripe.session.payment_status = 'no_payment_required';
  const result = await call(checkSession, env, { ...cred, sessionId: stripe.session.id });
  assert.deepEqual(result.data, { active: true, trial: true });
  const plan = await getPlanStatus(env, email);
  assert.equal(plan.trialActive, true); assert.equal(plan.bloqueado, false);
  assert.equal(plan.trialEligible, false);
  assert.equal(plan.trialEndsAt, new Date(stripe.sub.trial_end * 1000).toISOString());
  env.DEVICE_LIMIT_ENFORCED = 'true';
  for (let i = 1; i <= 3; i++) await recordDeviceSeen(env, email, `00000000-0000-4000-8000-00000000000${i}`, 'test');
  const checked = await call(checkPlan, env, { ...cred, deviceId: '00000000-0000-4000-8000-000000000004' });
  assert.equal(checked.data.ok, true); assert.equal(checked.data.trialActive, true);
});

test('F6: no activa una sesión ajena ni una sesión abierta', async t => {
  const { env, cred } = await fixture();
  const stripe = await stripeFixture(t, cred);
  assert.equal((await call(checkSession, env, { ...cred, sessionId: stripe.session.id })).data.active, false);
  stripe.session.status = 'complete'; stripe.session.metadata.account_email = 'other@example.com';
  assert.equal((await call(checkSession, env, { ...cred, sessionId: stripe.session.id })).status, 401);
  assert.equal(await env.PLANS_KV.get(email), null);
});

test('F6: cancelar renovación mantiene la prueba; al vencer se bloquea sin volver al trial antiguo', async t => {
  const { env, cred } = await fixture();
  const stripe = await stripeFixture(t, cred);
  assert.equal((await deliver(env, 'customer.subscription.created', stripe.sub)).status, 200);
  assert.equal((await call(cancel, env, cred)).data.ok, true);
  assert.equal(stripe.sub.cancel_at_period_end, true);
  assert.equal((await getPlanStatus(env, email)).bloqueado, false);
  stripe.sub.trial_start -= 31 * 86400; stripe.sub.trial_end = Math.floor(Date.now() / 1000) - 1;
  stripe.sub.status = 'canceled';
  await deliver(env, 'customer.subscription.updated', stripe.sub);
  assert.equal((await getPlanStatus(env, email)).bloqueado, true);
  assert.equal((await call(checkout, env, { ...cred, ...consent })).data.error, 'trial_unavailable');
});

test('F6: no confirma cancelación ni concede acceso si Stripe falla', async t => {
  const { env, cred } = await fixture();
  const stripe = await stripeFixture(t, cred);
  stripe.fail = true;
  assert.equal((await deliver(env, 'customer.subscription.created', stripe.sub)).status, 503);
  assert.equal(await env.PLANS_KV.get(email), null);
  await env.PLANS_KV.put(email, JSON.stringify({ plan: 'pro', subscriptionId: 'sub_fixture', cardTrial: true }));
  assert.equal((await call(cancel, env, cred)).status, 503);
});

test('F6: renovación pagada y cancelación inmediata con eventos en el mismo segundo', async t => {
  const { env, cred } = await fixture();
  const stripe = await stripeFixture(t, cred);
  const now = Math.floor(Date.now() / 1000);
  await deliver(env, 'customer.subscription.created', stripe.sub, now);
  stripe.sub.status = 'active';
  await deliver(env, 'customer.subscription.updated', stripe.sub, now);
  assert.equal((await getPlanStatus(env, email)).paidActive, true);
  stripe.sub.status = 'canceled';
  await deliver(env, 'customer.subscription.deleted', stripe.sub, now);
  assert.equal((await getPlanStatus(env, email)).bloqueado, true);
});

test('F6: un webhook tardío no recrea la cuenta ni se vincula a un token nuevo', async t => {
  const { env, cred } = await fixture();
  const stripe = await stripeFixture(t, cred);
  await env.PLANS_KV.delete('reg:' + email);
  await deliver(env, 'customer.subscription.created', stripe.sub);
  assert.equal(await env.PLANS_KV.get(email), null);
  await env.PLANS_KV.put('reg:' + email, JSON.stringify({ token: 'new-token', registeredAt: new Date().toISOString() }));
  await deliver(env, 'customer.subscription.updated', stripe.sub);
  assert.equal(await env.PLANS_KV.get(email), null);
});

test('F6: reintentar registro y apagar el interruptor no reinician una prueba usada', async t => {
  const { env, cred } = await fixture();
  const stripe = await stripeFixture(t, cred);
  await deliver(env, 'customer.subscription.created', stripe.sub);
  env.STRIPE_CARD_TRIAL_ENABLED = 'false';
  await call(register, env, { email, code: '123456' });
  const reg = await readRecord(env, 'reg:' + email);
  assert.equal(reg.cardTrialUsed, true); assert.equal(reg.cardTrialRequired, true);
  assert.equal(reg.token, cred.token);
});

test('F6: una huella de borrado impide otra prueba y evita anunciar 0 € cuando habría cobro', async t => {
  const { env, cred } = await fixture();
  await env.PLANS_KV.delete('reg:' + email);
  const hash = await hashTrialFingerprint(email, env.IP_HASH_SALT);
  await env.PLANS_KV.put(trialFingerprintKey(hash), '1');
  const registered = await call(register, env, { email, code: '123456' });
  const stripe = await stripeFixture(t, cred);
  assert.equal((await getPlanStatus(env, email)).trialEligible, false);
  const result = await call(checkout, env, { ...consent, email, token: registered.data.token });
  assert.equal(result.data.error, 'trial_unavailable');
  assert.equal(stripe.calls.length, 0);
});

test('F6: el borrado expira Checkout antes de eliminar la cuenta; un fallo conserva los datos', async t => {
  const { env, cred } = await fixture();
  const stripe = await stripeFixture(t, cred);
  await call(checkout, env, { ...cred, ...consent });
  stripe.fail = true;
  assert.equal((await call(remove, env, cred)).status, 500);
  assert.ok(await env.PLANS_KV.get('reg:' + email));
  stripe.fail = false;
  assert.equal((await call(remove, env, cred)).data.ok, true);
  assert.ok(stripe.calls.some(c => c.url.endsWith('/expire')));
  assert.equal(await env.PLANS_KV.get('checkout:' + email), null);
  assert.equal(await env.PLANS_KV.get('reg:' + email), null);
});

test('F6: webhook con timestamp futuro no es válido', async () => {
  const { env } = await fixture();
  const res = await deliver(env, 'customer.subscription.updated', {}, Math.floor(Date.now() / 1000) + 601);
  assert.equal(res.status, 400);
});

test('F6: trialing sin fechas no da acceso, Lifetime y Pro antiguos conservan su comportamiento', () => {
  assert.equal(computePaidActive({ plan: 'pro', status: 'trialing' }), false);
  assert.equal(computePaidActive({ plan: 'lifetime' }), true);
  assert.equal(computePaidActive({ plan: 'pro' }), true);
  assert.equal(computePaidActive({ plan: 'pro', cardTrial: true, status: 'paused' }), false);
  assert.equal(computePaidActive({ plan: 'pro', cardTrial: true, status: 'active' }), false);
});

test('F6: la gracia offline no prolonga la prueba y Business no pierde su fecha al guardar caché', () => {
  const store = new Map(), context = { Date, Number, JSON, Object };
  context.window = context;
  context.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  vm.createContext(context);
  vm.runInContext(readFileSync(new URL('../plan-cache.js', import.meta.url), 'utf8'), context);
  context.identityPlanCache.write({ ok: true, plan: 'pro', bloqueado: false, cardTrialRequired: true,
    trialActive: true, trialEndsAt: new Date(Date.now() - 1).toISOString() });
  assert.equal(context.identityPlanCache.read(14 * 86400000).bloqueado, true);
  context.identityPlanCache.write({ ok: true, plan: 'pro', bloqueado: false, trialActive: true,
    trialEndsAt: new Date(Date.now() + 86400000).toISOString() });
  assert.equal(context.identityPlanCache.read(14 * 86400000).bloqueado, false);
  assert.equal(JSON.parse(store.get('identity_registration')).cardTrialRequired, true);

});


test('F6: tras cancelar y terminar, permite contratar Pro sin otra prueba ni reutilizar el Checkout antiguo', async t => {
  const { env, cred } = await fixture();
  const stripe = await stripeFixture(t, cred);
  await call(checkout, env, { ...cred, ...consent });
  const firstKey = stripe.calls[0].headers['Idempotency-Key'];
  stripe.session.status = 'complete'; stripe.session.payment_status = 'no_payment_required';
  await call(checkSession, env, { ...cred, sessionId: stripe.session.id });
  assert.equal(await env.PLANS_KV.get('checkout:' + email), null);
  stripe.sub.status = 'canceled';
  await deliver(env, 'customer.subscription.deleted', stripe.sub);
  stripe.session = { ...stripe.session, id: 'cs_test_second', url: 'https://checkout.stripe.com/c/pay/cs_test_second', status: 'open' };
  const next = await call(checkout, env, { ...cred, plan: 'pro', waiverAccepted: true });
  assert.equal(next.status, 200);
  const posted = stripe.calls.filter(c => c.url.endsWith('/checkout/sessions') && c.method === 'POST').at(-1);
  assert.notEqual(posted.headers['Idempotency-Key'], firstKey);
  assert.equal(posted.params.has('subscription_data[trial_period_days]'), false);
  stripe.sub = { ...stripe.sub, id: 'sub_second', status: 'active', trial_start: null, trial_end: null };
  delete stripe.sub.metadata.card_trial;
  stripe.session = { ...stripe.session, status: 'complete', payment_status: 'paid', subscription: 'sub_second' };
  delete stripe.session.metadata.card_trial;
  await call(checkSession, env, { ...cred, sessionId: stripe.session.id });
  assert.equal((await getPlanStatus(env, email)).paidActive, true);
});

test('F6: una creación con respuesta perdida se recupera con la misma clave al borrar y expira antes de la baja', async t => {
  const { env, cred } = await fixture();
  const stripe = await stripeFixture(t, cred); stripe.fail = true;
  assert.equal((await call(checkout, env, { ...cred, ...consent })).status, 503);
  const firstKey = stripe.calls[0].headers['Idempotency-Key'];
  stripe.fail = false;
  assert.equal((await call(remove, env, cred)).data.ok, true);
  assert.equal(stripe.calls[1].headers['Idempotency-Key'], firstKey);
  assert.equal(stripe.session.status, 'expired');
});

for (const type of ['invoice.paid', 'invoice.payment_failed']) test(`F6: ${type} resuelve la suscripción y actualiza el acceso con su estado real`, async t => {
  const { env, cred } = await fixture(); const stripe = await stripeFixture(t, cred);
  stripe.sub.status = type === 'invoice.paid' ? 'active' : 'past_due';
  await deliver(env, type, { parent: { subscription_details: { subscription: 'sub_fixture' } }, customer_email: 'not-owner@example.com' });
  assert.equal((await getPlanStatus(env, email)).paidActive, type === 'invoice.paid');
  assert.equal(await env.PLANS_KV.get('not-owner@example.com'), null);
});

test('F6: el evento de pago asíncrono activa solo una sesión confirmada', async t => {
  const { env, cred } = await fixture(); const stripe = await stripeFixture(t, cred);
  assert.equal((await deliver(env, 'checkout.session.async_payment_succeeded', stripe.session)).status, 400);
  assert.equal(await env.PLANS_KV.get(email), null);
  stripe.session.status = 'complete'; stripe.session.payment_status = 'paid';
  assert.equal((await deliver(env, 'checkout.session.async_payment_succeeded', stripe.session)).status, 200);
  assert.equal((await getPlanStatus(env, email)).paidActive, true);
});
