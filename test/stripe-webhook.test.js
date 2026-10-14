import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/stripe-webhook.js';

class FakeKV {
  constructor() { this.store = new Map(); }
  async get(key) { return this.store.has(key) ? this.store.get(key) : null; }
  async put(key, value) { this.store.set(key, value); }
  async delete(key) { this.store.delete(key); }
}

function makeEnv() {
  return { PLANS_KV: new FakeKV(), STRIPE_WEBHOOK_SECRET: 'whsec_test_only', STRIPE_SECRET_KEY: 'sk_test_xxx' };
}

// Reproduce la firma que verifyStripeSignature (dentro de stripe-webhook.js)
// exige: HMAC-SHA256 de "{timestamp}.{payload}" con el secreto del webhook,
// en hex, dentro de la cabecera `t=...,v1=...`.
async function firmarPayload(payload, secret) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signedPayload = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
  const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `t=${timestamp},v1=${hex}`;
}

async function makeSignedRequest(env, event) {
  const payload = JSON.stringify(event);
  const signature = await firmarPayload(payload, env.STRIPE_WEBHOOK_SECRET);
  return new Request('https://example.com/api/stripe-webhook', {
    method: 'POST',
    headers: { 'stripe-signature': signature },
    body: payload,
  });
}

test('customer.subscription.deleted tras un borrado de cuenta no recrea el registro', async () => {
  const env = makeEnv();
  const email = 'borrado@example.com';
  const emailKey = email; // ya en minúsculas
  // Nada en PLANS_KV para este email -- simula que delete-account.js ya
  // borró la cuenta antes de que este evento llegara.
  assert.equal(await env.PLANS_KV.get(emailKey), null);

  const event = {
    type: 'customer.subscription.deleted',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: 'sub_borrado', status: 'canceled', cancel_at_period_end: false,
        metadata: { email },
      },
    },
  };

  const res = await onRequestPost({ request: await makeSignedRequest(env, event), env });
  assert.equal(res.status, 200);
  assert.equal(await env.PLANS_KV.get(emailKey), null, 'no debió recrear el registro de pago');
});

test('customer.subscription.updated con status canceled tras un borrado tampoco recrea el registro', async () => {
  const env = makeEnv();
  const email = 'borrado-updated@example.com';

  const event = {
    type: 'customer.subscription.updated',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: 'sub_borrado2', status: 'canceled', cancel_at_period_end: false,
        metadata: { email },
      },
    },
  };

  const res = await onRequestPost({ request: await makeSignedRequest(env, event), env });
  assert.equal(res.status, 200);
  assert.equal(await env.PLANS_KV.get(email), null, 'no debió recrear el registro de pago');
});

test('(sin regresión) un evento normal sin registro previo SÍ sigue creando el registro si no es de cancelación', async () => {
  const env = makeEnv();
  const email = 'cuenta-normal@example.com';

  const event = {
    type: 'customer.subscription.updated',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: 'sub_normal', status: 'active', cancel_at_period_end: false,
        metadata: { email },
      },
    },
  };

  const res = await onRequestPost({ request: await makeSignedRequest(env, event), env });
  assert.equal(res.status, 200);
  const stored = JSON.parse(await env.PLANS_KV.get(email));
  assert.equal(stored.plan, 'pro');
  assert.equal(stored.status, 'active');
});
