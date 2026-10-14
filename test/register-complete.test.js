import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/register-complete.js';
import { hashTrialFingerprint, trialFingerprintKey } from '../functions/_shared/trial-fingerprint.js';
import { getPlanStatus, TRIAL_DAYS } from '../functions/_shared/plan-access.js';

// Simula la validación real de Cloudflare KV: `expiration` (timestamp
// absoluto) debe ser un número finito al menos 60 segundos en el futuro,
// o el `put` falla -- igual que en producción. Sin esto, los tests no
// detectarían un `put` con una expiration inválida (NaN o demasiado
// cercana) que en KV real lanzaría un error.
class FakeKV {
  constructor() { this.store = new Map(); }
  async get(key) { return this.store.has(key) ? this.store.get(key) : null; }
  async put(key, value, opts) {
    if (opts && 'expiration' in opts) {
      const nowSec = Math.floor(Date.now() / 1000);
      if (!Number.isFinite(opts.expiration) || opts.expiration - nowSec < 60) {
        throw new Error('Invalid expiration: must be a number at least 60 seconds in the future');
      }
    }
    this.store.set(key, value);
  }
  async delete(key) { this.store.delete(key); }
}

function makeEnv() {
  return { PLANS_KV: new FakeKV(), IP_HASH_SALT: 'test-salt-only-for-tests' };
}

function makeRequest(body, ip = '203.0.113.10') {
  return new Request('https://example.com/api/register-complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify(body),
  });
}

async function seedVerifyCode(env, email, code) {
  await env.PLANS_KV.put('verify:' + email, JSON.stringify({ code, createdAt: Date.now() }));
}

// Permite fijar cuántos segundos han pasado ya desde que se generó el
// código, para probar el borde de los 60s de vida restante sin esperar
// de verdad ni manipular Date.now() globalmente.
async function seedVerifyCodeConAntiguedad(env, email, code, segundosTranscurridos) {
  const createdAt = Date.now() - segundosTranscurridos * 1000;
  await env.PLANS_KV.put('verify:' + email, JSON.stringify({ code, createdAt }));
}

async function seedVerifyCodeSinCreatedAt(env, email, code) {
  await env.PLANS_KV.put('verify:' + email, JSON.stringify({ code }));
}

test('5 intentos fallidos invalidan el código (ni siquiera el correcto funciona después)', async () => {
  const env = makeEnv();
  const email = 'fallos@example.com';
  await seedVerifyCode(env, email, '123456');

  for (let i = 0; i < 5; i++) {
    const res = await onRequestPost({ request: makeRequest({ email, code: '000000' }), env });
    const data = await res.json();
    assert.equal(res.status, 400);
    assert.equal(data.error, 'codigo_invalido_o_caducado');
  }

  // El 5º fallo ya debió invalidar el código -- el código ORIGINAL correcto
  // tampoco debe funcionar ahora.
  const resFinal = await onRequestPost({ request: makeRequest({ email, code: '123456' }), env });
  const dataFinal = await resFinal.json();
  assert.equal(resFinal.status, 400);
  assert.equal(dataFinal.error, 'codigo_invalido_o_caducado');
  assert.equal(await env.PLANS_KV.get('verify:' + email), null);
});

test('un código correcto tras 4 fallos sigue valiendo', async () => {
  const env = makeEnv();
  const email = 'cuatro-fallos@example.com';
  await seedVerifyCode(env, email, '654321');

  for (let i = 0; i < 4; i++) {
    const res = await onRequestPost({ request: makeRequest({ email, code: '000000' }), env });
    assert.equal(res.status, 400);
  }

  const resOk = await onRequestPost({ request: makeRequest({ email, code: '654321' }), env });
  const dataOk = await resOk.json();
  assert.equal(resOk.status, 200);
  assert.equal(dataOk.ok, true);
  assert.equal(typeof dataOk.token, 'string');
});

test('el límite de IP en register-complete salta tras 15 llamadas desde la misma IP', async () => {
  const env = makeEnv();
  const ip = '198.51.100.7';

  for (let i = 0; i < 15; i++) {
    const email = `ip-test-${i}@example.com`;
    await seedVerifyCode(env, email, '111111');
    const res = await onRequestPost({ request: makeRequest({ email, code: '111111' }, ip), env });
    assert.equal(res.status, 200, `llamada ${i} no debería estar limitada todavía`);
  }

  const email16 = 'ip-test-16@example.com';
  await seedVerifyCode(env, email16, '111111');
  const res16 = await onRequestPost({ request: makeRequest({ email: email16, code: '111111' }, ip), env });
  const data16 = await res16.json();
  assert.equal(res16.status, 429);
  assert.equal(data16.error, 'rate_limited');
});

test('un email normal sigue funcionando sin fricción', async () => {
  const env = makeEnv();
  const email = 'normal@example.com';
  await seedVerifyCode(env, email, '999999');

  const res = await onRequestPost({ request: makeRequest({ email, code: '999999' }, '192.0.2.50'), env });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.registeredAt !== undefined, true);
});

test('fallo con el código a 30s de caducar → se borra en vez de intentar actualizarlo', async () => {
  const env = makeEnv();
  const email = 'casi-caducado@example.com';
  // Creado hace 570s de los 600s de vida -- solo quedan 30s, por debajo
  // del mínimo de 60s que exige expiration en KV real.
  await seedVerifyCodeConAntiguedad(env, email, '222222', 570);

  const res = await onRequestPost({ request: makeRequest({ email, code: '000000' }, '192.0.2.60'), env });
  const data = await res.json();

  assert.equal(res.status, 400);
  assert.equal(data.error, 'codigo_invalido_o_caducado');
  // Si el código se hubiera actualizado (en vez de borrado), el FakeKV
  // habría lanzado por expiration < 60s y la excepción se habría tragado
  // dejando el registro ANTIGUO intacto -- este assert distingue ambos
  // casos: solo pasa si de verdad se llamó a delete.
  assert.equal(await env.PLANS_KV.get('verify:' + email), null);
});

test('fallo sin createdAt → se borra en vez de intentar actualizarlo', async () => {
  const env = makeEnv();
  const email = 'sin-createdat@example.com';
  await seedVerifyCodeSinCreatedAt(env, email, '333333');

  const res = await onRequestPost({ request: makeRequest({ email, code: '000000' }, '192.0.2.61'), env });
  const data = await res.json();

  assert.equal(res.status, 400);
  assert.equal(data.error, 'codigo_invalido_o_caducado');
  assert.equal(await env.PLANS_KV.get('verify:' + email), null);
});

test('el contador sube correctamente cuando la expiration es válida', async () => {
  const env = makeEnv();
  const email = 'contador-ok@example.com';
  await seedVerifyCode(env, email, '444444'); // recién creado, 600s de margen

  const res = await onRequestPost({ request: makeRequest({ email, code: '000000' }, '192.0.2.62'), env });
  const data = await res.json();
  assert.equal(res.status, 400);
  assert.equal(data.error, 'codigo_invalido_o_caducado');

  // No se borró -- se actualizó con attempts:1, mismo código original.
  const stored = JSON.parse(await env.PLANS_KV.get('verify:' + email));
  assert.equal(stored.attempts, 1);
  assert.equal(stored.code, '444444');

  // Y el código correcto todavía funciona después de ese fallo contado.
  const resOk = await onRequestPost({ request: makeRequest({ email, code: '444444' }, '192.0.2.62'), env });
  const dataOk = await resOk.json();
  assert.equal(resOk.status, 200);
  assert.equal(dataOk.ok, true);
});

// Huella anti-reabuso del trial (ver functions/_shared/trial-fingerprint.js
// y delete-account.js): comprueba que el SERVIDOR -- no solo lo que
// register.html muestra -- deniega el trial a una cuenta que ya lo usó
// antes y borró su cuenta. getPlanStatus() es la misma función que usa
// check-plan.js en producción; probarla aquí directamente confirma que
// el bloqueo es real incluso si el cliente manipulara su propia fecha
// local.
test('huella de trial existente -> el registro no concede trial (el SERVIDOR lo deniega, no solo el cliente)', async () => {
  const env = makeEnv();
  const email = 'ya-uso-trial@example.com';
  const emailKey = email.toLowerCase();

  // Simula que delete-account.js ya dejó esta huella en un borrado previo.
  const trialHash = await hashTrialFingerprint(email, env.IP_HASH_SALT);
  await env.PLANS_KV.put(trialFingerprintKey(trialHash), '1', { expirationTtl: 60 * 24 * 3600 });

  await seedVerifyCode(env, email, '777777');
  const res = await onRequestPost({ request: makeRequest({ email, code: '777777' }, '192.0.2.70'), env });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.trialUsed, true, 'la respuesta debe avisar al cliente de que no hay trial');

  // El registeredAt guardado debe ser una fecha ya muy pasada (época
  // Unix), no "ahora mismo".
  const reg = JSON.parse(await env.PLANS_KV.get('reg:' + emailKey));
  assert.equal(reg.registeredAt, new Date(0).toISOString());

  // La prueba real: getPlanStatus() (la misma función de
  // functions/_shared/plan-access.js que usa check-plan.js) debe
  // devolver bloqueado:true DESDE YA, sin que el cliente haya tocado
  // nada -- esto es lo que de verdad impide el acceso, no el aviso al
  // cliente.
  const status = await getPlanStatus(env, emailKey);
  assert.equal(status.paidActive, false);
  assert.ok(status.diasTranscurridos >= TRIAL_DAYS, `diasTranscurridos (${status.diasTranscurridos}) debería ser >= TRIAL_DAYS (${TRIAL_DAYS})`);
  assert.equal(status.bloqueado, true, 'el servidor debe bloquear el acceso de inmediato, no conceder 30 días nuevos');
});

test('email que nunca usó el trial -> registro normal, trial completo de verdad', async () => {
  const env = makeEnv();
  const email = 'primera-vez@example.com';
  const emailKey = email.toLowerCase();
  // Sin huella trial_used para este email -- caso normal.

  await seedVerifyCode(env, email, '888888');
  const res = await onRequestPost({ request: makeRequest({ email, code: '888888' }, '192.0.2.71'), env });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.trialUsed, false);

  const reg = JSON.parse(await env.PLANS_KV.get('reg:' + emailKey));
  assert.notEqual(reg.registeredAt, new Date(0).toISOString());

  const status = await getPlanStatus(env, emailKey);
  assert.equal(status.diasTranscurridos, 0);
  assert.equal(status.bloqueado, false, 'una cuenta recién registrada sin huella debe tener su trial completo');
});
