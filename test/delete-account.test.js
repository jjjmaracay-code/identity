import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/delete-account.js';

class FakeKV {
  constructor() { this.store = new Map(); }
  async get(key) { return this.store.has(key) ? this.store.get(key) : null; }
  async put(key, value) { this.store.set(key, value); }
  async delete(key) { this.store.delete(key); }
}

// Fake binding de servicio hacia BusinessCardDO -- por defecto responde
// ok a /delete (como si la cuenta nunca hubiera publicado nada, el caso
// más común en estos tests). `fetchCalls` acumula cada llamada para que
// los tests puedan comprobar que se llamó, y con qué método/ruta.
function makeFakeBusinessDO({ falla = false } = {}) {
  const fetchCalls = [];
  return {
    fetchCalls,
    idFromName(name) { return name; },
    get(id) {
      return {
        async fetch(url, opts) {
          fetchCalls.push({ url, method: opts?.method });
          return falla ? new Response('{}', { status: 500 }) : new Response(JSON.stringify({ ok: true }), { status: 200 });
        },
      };
    },
  };
}

function makeEnv({ businessDoFalla = false } = {}) {
  return {
    PLANS_KV: new FakeKV(),
    IP_HASH_SALT: 'test-salt-only-for-tests',
    STRIPE_SECRET_KEY: 'sk_test_xxx',
    BUSINESS_DO: makeFakeBusinessDO({ falla: businessDoFalla }),
  };
}

function makeRequest(body, ip = '203.0.113.30') {
  return new Request('https://example.com/api/delete-account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify(body),
  });
}

async function seedAccount(env, email, token, paid) {
  await env.PLANS_KV.put('reg:' + email, JSON.stringify({ name: 'Test', registeredAt: new Date().toISOString(), token }));
  if (paid) await env.PLANS_KV.put(email, JSON.stringify(paid));
  // Rastros adicionales que delete-account.js también debe limpiar.
  await env.PLANS_KV.put('ratelimit:' + email, JSON.stringify({ count: 1, windowStart: 0, dayCount: 1, dayStart: 0 }));
  await env.PLANS_KV.put('ocrlimit:acct:' + email, JSON.stringify({ count: 1, resetAt: Date.now() + 1000 }));
}

async function existeAlgunRastro(env, email) {
  const claves = ['reg:' + email, email, 'ratelimit:' + email, 'ocrlimit:acct:' + email];
  for (const k of claves) {
    if (await env.PLANS_KV.get(k) !== null) return true;
  }
  return false;
}

// Simula el GET de estado + el DELETE de cancelación de Stripe en una
// sola función, para no repetir el branching en cada test.
function stripeStub({ estado, getFalla = false, deleteFalla = false } = {}) {
  return async (url, opts) => {
    if (opts?.method === 'DELETE') {
      return deleteFalla ? new Response('{}', { status: 400 }) : new Response('{}', { status: 200 });
    }
    // GET de estado
    if (getFalla) return new Response('{}', { status: 500 });
    return new Response(JSON.stringify({ status: estado }), { status: 200 });
  };
}

let originalFetch;
before(() => { originalFetch = globalThis.fetch; });
after(() => { globalThis.fetch = originalFetch; });

test('token inválido, sin marca de borrado previo -> 401 no_verificado, nada borrado', async () => {
  const env = makeEnv();
  const email = 'invalido@example.com';
  await seedAccount(env, email, 'token-real');
  let fetchCalled = false;
  globalThis.fetch = async () => { fetchCalled = true; return new Response('{}', { status: 200 }); };

  const res = await onRequestPost({ request: makeRequest({ email, token: 'token-FALSO' }), env });
  const data = await res.json();

  assert.equal(res.status, 401);
  assert.equal(data.error, 'no_verificado');
  assert.equal(fetchCalled, false);
  assert.equal(await existeAlgunRastro(env, email), true, 'no debió borrarse nada con un token incorrecto');
});

test('con suscripción Pro activa (status active), se consulta y cancela en Stripe, luego se borra todo', async () => {
  const env = makeEnv();
  const email = 'pro-activo@example.com';
  await seedAccount(env, email, 'token-real', { plan: 'pro', subscriptionId: 'sub_123', status: 'active' });

  const llamadas = [];
  globalThis.fetch = async (url, opts) => {
    llamadas.push({ url, method: opts?.method || 'GET' });
    return stripeStub({ estado: 'active' })(url, opts);
  };

  const res = await onRequestPost({ request: makeRequest({ email, token: 'token-real' }), env });
  const data = await res.json();

  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.equal(llamadas.length, 2, 'debió consultar el estado y luego cancelar');
  assert.equal(llamadas[0].method, 'GET');
  assert.equal(llamadas[1].method, 'DELETE');
  assert.equal(llamadas[0].url, 'https://api.stripe.com/v1/subscriptions/sub_123');
  assert.equal(await existeAlgunRastro(env, email), false, 'debió borrarse todo tras cancelar');
});

test('suscripción past_due también se cancela', async () => {
  const env = makeEnv();
  const email = 'pro-pastdue@example.com';
  await seedAccount(env, email, 'token-real', { plan: 'pro', subscriptionId: 'sub_pd', status: 'past_due' });

  let cancelLlamado = false;
  globalThis.fetch = async (url, opts) => {
    if (opts?.method === 'DELETE') { cancelLlamado = true; return new Response('{}', { status: 200 }); }
    return new Response(JSON.stringify({ status: 'past_due' }), { status: 200 });
  };

  const res = await onRequestPost({ request: makeRequest({ email, token: 'token-real' }), env });
  const data = await res.json();

  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.equal(cancelLlamado, true, 'past_due no es "canceled" -- debió intentarse cancelar');
  assert.equal(await existeAlgunRastro(env, email), false);
});

test('si no se puede recuperar el estado en Stripe, no se borra nada', async () => {
  const env = makeEnv();
  const email = 'pro-get-falla@example.com';
  await seedAccount(env, email, 'token-real', { plan: 'pro', subscriptionId: 'sub_err', status: 'active' });

  globalThis.fetch = stripeStub({ getFalla: true });

  const res = await onRequestPost({ request: makeRequest({ email, token: 'token-real' }), env });
  const data = await res.json();

  assert.equal(res.status, 500);
  assert.equal(data.error, 'No se pudo completar la solicitud, inténtalo más tarde');
  assert.equal(await existeAlgunRastro(env, email), true);
});

test('si la cancelación en Stripe falla, no se borra nada', async () => {
  const env = makeEnv();
  const email = 'pro-fallo-stripe@example.com';
  await seedAccount(env, email, 'token-real', { plan: 'pro', subscriptionId: 'sub_456', status: 'active' });

  globalThis.fetch = stripeStub({ estado: 'active', deleteFalla: true });

  const res = await onRequestPost({ request: makeRequest({ email, token: 'token-real' }), env });
  const data = await res.json();

  assert.equal(res.status, 500);
  assert.equal(data.error, 'No se pudo completar la solicitud, inténtalo más tarde');
  assert.equal(await existeAlgunRastro(env, email), true, 'no debió borrarse nada si Stripe falló');
});

test('suscripción ya cancelada en Stripe: no reintenta el DELETE, borra igual', async () => {
  const env = makeEnv();
  const email = 'pro-ya-cancelada@example.com';
  await seedAccount(env, email, 'token-real', { plan: 'pro', subscriptionId: 'sub_ya', status: 'active' });

  let deleteLlamado = false;
  globalThis.fetch = async (url, opts) => {
    if (opts?.method === 'DELETE') { deleteLlamado = true; return new Response('{}', { status: 200 }); }
    return new Response(JSON.stringify({ status: 'canceled' }), { status: 200 });
  };

  const res = await onRequestPost({ request: makeRequest({ email, token: 'token-real' }), env });
  const data = await res.json();

  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.equal(deleteLlamado, false, 'ya estaba cancelada -- no debió llamar a DELETE');
  assert.equal(await existeAlgunRastro(env, email), false);
});

test('incomplete_expired cuenta como terminada: no intenta cancelar, se borra igual', async () => {
  const env = makeEnv();
  const email = 'pro-incomplete-expired@example.com';
  await seedAccount(env, email, 'token-real', { plan: 'pro', subscriptionId: 'sub_ie', status: 'incomplete' });

  let deleteLlamado = false;
  globalThis.fetch = async (url, opts) => {
    if (opts?.method === 'DELETE') { deleteLlamado = true; return new Response('{}', { status: 200 }); }
    return new Response(JSON.stringify({ status: 'incomplete_expired' }), { status: 200 });
  };

  const res = await onRequestPost({ request: makeRequest({ email, token: 'token-real' }), env });
  const data = await res.json();

  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.equal(deleteLlamado, false, 'incomplete_expired ya está terminada -- no debió llamar a DELETE');
  assert.equal(await existeAlgunRastro(env, email), false);
});

test('404 de Stripe (resource_missing): nada que cancelar, se borra igual', async () => {
  const env = makeEnv();
  const email = 'pro-sub-inexistente@example.com';
  await seedAccount(env, email, 'token-real', { plan: 'pro', subscriptionId: 'sub_no_existe', status: 'active' });

  let deleteLlamado = false;
  globalThis.fetch = async (url, opts) => {
    if (opts?.method === 'DELETE') { deleteLlamado = true; return new Response('{}', { status: 200 }); }
    return new Response(JSON.stringify({ error: { code: 'resource_missing' } }), { status: 404 });
  };

  const res = await onRequestPost({ request: makeRequest({ email, token: 'token-real' }), env });
  const data = await res.json();

  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.equal(deleteLlamado, false, 'un 404 significa que ya no hay nada que cancelar');
  assert.equal(await existeAlgunRastro(env, email), false);
});

test('un error de Stripe que NO es 404 sigue bloqueando el borrado', async () => {
  const env = makeEnv();
  const email = 'pro-error-500@example.com';
  await seedAccount(env, email, 'token-real', { plan: 'pro', subscriptionId: 'sub_500', status: 'active' });

  globalThis.fetch = async () => new Response('{}', { status: 500 });

  const res = await onRequestPost({ request: makeRequest({ email, token: 'token-real' }), env });
  const data = await res.json();

  assert.equal(res.status, 500);
  assert.equal(data.error, 'No se pudo completar la solicitud, inténtalo más tarde');
  assert.equal(await existeAlgunRastro(env, email), true);
});

test('sin suscripción activa (free, sin plan de pago) se borra todo sin llamar a Stripe', async () => {
  const env = makeEnv();
  const email = 'free@example.com';
  await seedAccount(env, email, 'token-real'); // sin paid record

  let fetchCalled = false;
  globalThis.fetch = async () => { fetchCalled = true; return new Response('{}', { status: 200 }); };

  const res = await onRequestPost({ request: makeRequest({ email, token: 'token-real' }), env });
  const data = await res.json();

  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.equal(fetchCalled, false, 'no hay nada que cancelar, no debió llamar a Stripe');
  assert.equal(await existeAlgunRastro(env, email), false, 'debió borrarse todo');
});

// Fase 3 del lote de licencias (identificador de dispositivo, ver
// functions/_shared/devices.js) -- devices:{emailKey} es un dato más
// ligado a la cuenta, igual que reg:/ratelimit:/ocrlimit:acct: (ver
// seedAccount/existeAlgunRastro arriba): se va con el resto al borrar.
test('delete-account borra también devices:{emailKey}', async () => {
  const env = makeEnv();
  const email = 'con-dispositivos@example.com';
  await seedAccount(env, email, 'token-real');
  await env.PLANS_KV.put('devices:' + email, JSON.stringify([
    { deviceId: '11111111-1111-4111-8111-111111111111', tipo: 'iphone', firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString() },
  ]));

  globalThis.fetch = async () => new Response('{}', { status: 200 });

  const res = await onRequestPost({ request: makeRequest({ email, token: 'token-real' }), env });
  const data = await res.json();

  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.equal(await env.PLANS_KV.get('devices:' + email), null, 'devices: debió borrarse junto al resto de la cuenta');
});

test('lifetime: no hay nada que cancelar, se borra igual sin llamar a Stripe', async () => {
  const env = makeEnv();
  const email = 'lifetime@example.com';
  await seedAccount(env, email, 'token-real', { plan: 'lifetime', date: new Date().toISOString() });

  let fetchCalled = false;
  globalThis.fetch = async () => { fetchCalled = true; return new Response('{}', { status: 200 }); };

  const res = await onRequestPost({ request: makeRequest({ email, token: 'token-real' }), env });
  const data = await res.json();

  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.equal(fetchCalled, false);
  assert.equal(await existeAlgunRastro(env, email), false);
});

test('reintento con el mismo token tras un borrado real -> ok (idempotente vía marca)', async () => {
  const env = makeEnv();
  const email = 'idempotente@example.com';
  await seedAccount(env, email, 'token-real');
  globalThis.fetch = async () => new Response('{}', { status: 200 });

  const res1 = await onRequestPost({ request: makeRequest({ email, token: 'token-real' }), env });
  const data1 = await res1.json();
  assert.equal(res1.status, 200);
  assert.equal(data1.ok, true);
  assert.equal(await existeAlgunRastro(env, email), false);

  // Segunda llamada: ya no hay reg: contra el que validar el token, pero
  // la marca de borrado (hash del mismo email+token) hace que responda
  // exactamente igual.
  const res2 = await onRequestPost({ request: makeRequest({ email, token: 'token-real' }), env });
  const data2 = await res2.json();
  assert.equal(res2.status, 200);
  assert.deepEqual(data2, data1);
});

test('tras un borrado real, un token DISTINTO para el mismo email no cuela (no_verificado)', async () => {
  const env = makeEnv();
  const email = 'idempotente-token-distinto@example.com';
  await seedAccount(env, email, 'token-real');
  globalThis.fetch = async () => new Response('{}', { status: 200 });

  const res1 = await onRequestPost({ request: makeRequest({ email, token: 'token-real' }), env });
  assert.equal((await res1.json()).ok, true);

  // Mismo email, pero un token que nunca fue el real -- la marca se
  // calculó con el token real, no con cualquier token para ese email.
  const res2 = await onRequestPost({ request: makeRequest({ email, token: 'token-inventado' }), env });
  const data2 = await res2.json();
  assert.equal(res2.status, 401);
  assert.equal(data2.error, 'no_verificado');
});

// =================== Fase 0c: borrado de datos de Business ===================

test('se llama siempre a BUSINESS_DO /delete, incluso sin plan de pago', async () => {
  const env = makeEnv();
  const email = 'free-con-business@example.com';
  await seedAccount(env, email, 'token-real');
  globalThis.fetch = async () => new Response('{}', { status: 200 });

  const res = await onRequestPost({ request: makeRequest({ email, token: 'token-real' }), env });
  const data = await res.json();

  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.equal(env.BUSINESS_DO.fetchCalls.length, 1);
  assert.equal(env.BUSINESS_DO.fetchCalls[0].method, 'POST');
  assert.equal(env.BUSINESS_DO.fetchCalls[0].url, 'https://business-do/delete');
});

test('si BUSINESS_DO /delete falla, no se borra nada (ni KV ni la marca)', async () => {
  const env = makeEnv({ businessDoFalla: true });
  const email = 'business-do-falla@example.com';
  await seedAccount(env, email, 'token-real');
  globalThis.fetch = async () => new Response('{}', { status: 200 });

  const res = await onRequestPost({ request: makeRequest({ email, token: 'token-real' }), env });
  const data = await res.json();

  assert.equal(res.status, 500);
  assert.equal(data.error, 'No se pudo completar la solicitud, inténtalo más tarde');
  assert.equal(await existeAlgunRastro(env, email), true, 'no debió borrarse nada si el borrado de Business falló');
});
