import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost as transferPost } from '../functions/api/transfer-device.js';
import { onRequestPost as checkPlanPost } from '../functions/api/check-plan.js';

class FakeKV {
  constructor() { this.store = new Map(); }
  async get(key) { return this.store.has(key) ? this.store.get(key) : null; }
  async put(key, value, opts) {
    if (opts && 'expiration' in opts) {
      const nowSec = Math.floor(Date.now() / 1000);
      if (!Number.isFinite(opts.expiration) || opts.expiration - nowSec < 60) {
        throw new Error('Invalid expiration');
      }
    }
    this.store.set(key, value);
  }
  async delete(key) { this.store.delete(key); }
}

function makeEnv() {
  return { PLANS_KV: new FakeKV(), IP_HASH_SALT: 'test-salt', DEVICE_LIMIT_ENFORCED: 'true', RESEND_API_KEY: 'test-key' };
}

const DEVICE_VIEJO = '11111111-0000-4000-8000-000000000000';
const DEVICE_NUEVO = '22222222-0000-4000-8000-000000000000';

async function seedAccount(env, email, token, paid) {
  const emailKey = email.toLowerCase();
  await env.PLANS_KV.put('reg:' + emailKey, JSON.stringify({ registeredAt: new Date().toISOString(), token }));
  if (paid) await env.PLANS_KV.put(emailKey, JSON.stringify(paid));
}

async function registrarDispositivoViejo(env, email, token) {
  const req = new Request('https://example.com/api/check-plan', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, token, deviceId: DEVICE_VIEJO }),
  });
  await checkPlanPost({ request: req, env });
}

async function seedVerifyCode(env, email, code) {
  await env.PLANS_KV.put('verify:' + email.toLowerCase(), JSON.stringify({ code, createdAt: Date.now() }));
}

function makeTransferRequest(body, ip = '203.0.113.50') {
  return new Request('https://example.com/api/transfer-device', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify(body),
  });
}

async function checkPlanDevice(env, email, token, deviceId) {
  const req = new Request('https://example.com/api/check-plan', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, token, deviceId }),
  });
  const res = await checkPlanPost({ request: req, env });
  return res.json();
}

let originalFetch;
before(() => { originalFetch = globalThis.fetch; });
after(() => { globalThis.fetch = originalFetch; });

test('sin código, no transfiere', async () => {
  const env = makeEnv();
  const email = 'sin-codigo@example.com';
  const token = 'tok-1';
  await seedAccount(env, email, token, { plan: 'pro', status: 'active', currentPeriodEnd: new Date(Date.now() + 10 * 86400000).toISOString() });
  await registrarDispositivoViejo(env, email, token);

  const res = await transferPost({
    request: makeTransferRequest({ email, token, deviceIdViejo: DEVICE_VIEJO, deviceIdNuevo: DEVICE_NUEVO, motivo: 'otro' }),
    env,
  });
  assert.equal(res.status, 400);

  // El dispositivo viejo sigue activo con normalidad.
  const data = await checkPlanDevice(env, email, token, DEVICE_VIEJO);
  assert.equal(data.ok, true);
});

test('código incorrecto, no transfiere', async () => {
  const env = makeEnv();
  const email = 'codigo-malo@example.com';
  const token = 'tok-2';
  await seedAccount(env, email, token, { plan: 'pro', status: 'active', currentPeriodEnd: new Date(Date.now() + 10 * 86400000).toISOString() });
  await registrarDispositivoViejo(env, email, token);
  await seedVerifyCode(env, email, '123456');

  const res = await transferPost({
    request: makeTransferRequest({ email, token, deviceIdViejo: DEVICE_VIEJO, deviceIdNuevo: DEVICE_NUEVO, motivo: 'otro', code: '000000' }),
    env,
  });
  const data = await res.json();
  assert.equal(res.status, 400);
  assert.equal(data.error, 'codigo_invalido_o_caducado');

  const viejo = await checkPlanDevice(env, email, token, DEVICE_VIEJO);
  assert.equal(viejo.ok, true, 'el dispositivo viejo sigue activo');
});

test('con código correcto: el viejo queda revocado y el nuevo entra', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ id: 'email-1' }), { status: 200 });
  const env = makeEnv();
  const email = 'transfer-ok@example.com';
  const token = 'tok-3';
  await seedAccount(env, email, token, { plan: 'pro', status: 'active', currentPeriodEnd: new Date(Date.now() + 10 * 86400000).toISOString() });
  await registrarDispositivoViejo(env, email, token);
  await seedVerifyCode(env, email, '654321');

  const res = await transferPost({
    request: makeTransferRequest({ email, token, deviceIdViejo: DEVICE_VIEJO, deviceIdNuevo: DEVICE_NUEVO, motivo: 'robo', code: '654321', lang: 'en' }),
    env,
  });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.ok, true);

  // El dispositivo viejo, en su siguiente check-plan, debe recibir
  // device_revoked -- nunca ok:true.
  const viejo = await checkPlanDevice(env, email, token, DEVICE_VIEJO);
  assert.equal(viejo.ok, false);
  assert.equal(viejo.code, 'device_revoked');

  // El dispositivo nuevo ya está activo con normalidad.
  const nuevo = await checkPlanDevice(env, email, token, DEVICE_NUEVO);
  assert.equal(nuevo.ok, true);
  assert.equal(nuevo.code, undefined);
});

test('Lifetime: segunda transferencia antes de 24h se rechaza', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ id: 'email-2' }), { status: 200 });
  const env = makeEnv();
  const email = 'lifetime-cooldown@example.com';
  const token = 'tok-4';
  await seedAccount(env, email, token, { plan: 'lifetime' });
  await registrarDispositivoViejo(env, email, token);
  await seedVerifyCode(env, email, '111111');

  const DEVICE_3 = '33333333-0000-4000-8000-000000000000';
  const res1 = await transferPost({
    request: makeTransferRequest({ email, token, deviceIdViejo: DEVICE_VIEJO, deviceIdNuevo: DEVICE_NUEVO, motivo: 'perdida', code: '111111' }),
    env,
  });
  assert.equal(res1.status, 200);

  // Intenta transferir OTRA VEZ de inmediato (DEVICE_NUEVO -> DEVICE_3).
  await seedVerifyCode(env, email, '222222');
  const res2 = await transferPost({
    request: makeTransferRequest({ email, token, deviceIdViejo: DEVICE_NUEVO, deviceIdNuevo: DEVICE_3, motivo: 'otro', code: '222222' }),
    env,
  });
  const data2 = await res2.json();
  assert.equal(res2.status, 403);
  assert.equal(data2.error, 'cooldown_activo');
  assert.ok(data2.puedeDesde, 'debe indicar la hora en la que podrá volver a transferir');
});

test('con el interruptor apagado, transfer-device.js no hace nada', async () => {
  const env = makeEnv();
  env.DEVICE_LIMIT_ENFORCED = undefined;
  const email = 'apagado-transfer@example.com';
  const token = 'tok-5';
  await seedAccount(env, email, token, { plan: 'pro', status: 'active', currentPeriodEnd: new Date(Date.now() + 10 * 86400000).toISOString() });
  await seedVerifyCode(env, email, '999999');

  const res = await transferPost({
    request: makeTransferRequest({ email, token, deviceIdViejo: DEVICE_VIEJO, deviceIdNuevo: DEVICE_NUEVO, motivo: 'otro', code: '999999' }),
    env,
  });
  assert.equal(res.status, 403);
});
