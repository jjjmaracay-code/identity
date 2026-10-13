import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/send-email.js';

class FakeKV {
  constructor() { this.store = new Map(); }
  async get(key) { return this.store.has(key) ? this.store.get(key) : null; }
  async put(key, value) { this.store.set(key, value); }
  async delete(key) { this.store.delete(key); }
}

function makeEnv() {
  return { PLANS_KV: new FakeKV(), IP_HASH_SALT: 'test-salt-only-for-tests', RESEND_API_KEY: 'test-key' };
}

function makeRequest(body, ip = '203.0.113.20') {
  return new Request('https://example.com/api/send-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify(body),
  });
}

let originalFetch;
before(() => { originalFetch = globalThis.fetch; });
after(() => { globalThis.fetch = originalFetch; });

test('un dominio desechable se rechaza sin intentar enviar (mismo error genérico que un fallo de envío)', async () => {
  const env = makeEnv();
  let fetchCalled = false;
  globalThis.fetch = async () => { fetchCalled = true; return new Response(JSON.stringify({ id: 'x' }), { status: 200 }); };

  const res = await onRequestPost({
    request: makeRequest({ template: 'verification', to_email: 'alguien@mailinator.com', to_name: 'Test' }),
    env,
  });
  const data = await res.json();

  assert.equal(res.status, 500);
  assert.equal(data.error, 'No se pudo enviar el código, inténtalo más tarde');
  assert.equal(fetchCalled, false);
});

test('un email normal sigue funcionando', async () => {
  const env = makeEnv();
  globalThis.fetch = async () => new Response(JSON.stringify({ id: 'resend-test-id' }), { status: 200 });

  const res = await onRequestPost({
    request: makeRequest({ template: 'verification', to_email: 'persona@gmail.com', to_name: 'Persona' }),
    env,
  });
  const data = await res.json();

  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  const stored = await env.PLANS_KV.get('verify:persona@gmail.com');
  assert.ok(stored);
});

test('el límite de IP en send-email salta tras 8 envíos desde la misma IP', async () => {
  const env = makeEnv();
  globalThis.fetch = async () => new Response(JSON.stringify({ id: 'resend-test-id' }), { status: 200 });
  const ip = '198.51.100.99';

  for (let i = 0; i < 8; i++) {
    const res = await onRequestPost({
      request: makeRequest({ template: 'verification', to_email: `ip-test-${i}@gmail.com`, to_name: 'Test' }, ip),
      env,
    });
    assert.equal(res.status, 200, `envío ${i} no debería estar limitado todavía`);
  }

  const res9 = await onRequestPost({
    request: makeRequest({ template: 'verification', to_email: 'ip-test-9@gmail.com', to_name: 'Test' }, ip),
    env,
  });
  const data9 = await res9.json();
  assert.equal(res9.status, 429);
  assert.equal(data9.error, 'rate_limited');
});
