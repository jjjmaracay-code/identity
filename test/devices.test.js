import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordDeviceSeen, isValidDeviceId, deviceTypeFromUserAgent, devicesKey } from '../functions/_shared/devices.js';
import { onRequestPost as checkPlanPost } from '../functions/api/check-plan.js';
import { onRequestPost as registerCompletePost } from '../functions/api/register-complete.js';

// Mismo patrón que el resto de test/*.test.js -- un contador de put()
// propio para poder comprobar "no escribió nada" sin inspeccionar el
// contenido, que es justo lo que pide la regla de escrituras mínimas.
class FakeKV {
  constructor() { this.store = new Map(); this.putCount = 0; }
  async get(key) { return this.store.has(key) ? this.store.get(key) : null; }
  async put(key, value) { this.putCount++; this.store.set(key, value); }
  async delete(key) { this.store.delete(key); }
}

function makeEnv() {
  return { PLANS_KV: new FakeKV(), IP_HASH_SALT: 'test-salt-only-for-tests' };
}

const UUID1 = '11111111-1111-4111-8111-111111111111';
const UUID2 = '22222222-2222-4222-8222-222222222222';

// =================== isValidDeviceId / deviceTypeFromUserAgent ===================

test('isValidDeviceId acepta un UUID v4 real y rechaza lo que no lo es', () => {
  assert.equal(isValidDeviceId(UUID1), true);
  assert.equal(isValidDeviceId('no-es-un-uuid'), false);
  assert.equal(isValidDeviceId(''), false);
  assert.equal(isValidDeviceId(undefined), false);
  assert.equal(isValidDeviceId(12345), false);
  // v1 (no v4): el dígito de versión (13º carácter hex) no es "4".
  assert.equal(isValidDeviceId('11111111-1111-1111-8111-111111111111'), false);
});

test('deviceTypeFromUserAgent devuelve solo categorías genéricas', () => {
  assert.equal(deviceTypeFromUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), 'iphone');
  assert.equal(deviceTypeFromUserAgent('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)'), 'tablet');
  assert.equal(deviceTypeFromUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile'), 'android');
  assert.equal(deviceTypeFromUserAgent('Mozilla/5.0 (Linux; Android 14; SM-X200)'), 'tablet');
  assert.equal(deviceTypeFromUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'otro');
  assert.equal(deviceTypeFromUserAgent(''), 'otro');
  assert.equal(deviceTypeFromUserAgent(undefined), 'otro');
});

// =================== recordDeviceSeen ===================

test('dispositivo nuevo se registra en devices:{emailKey}', async () => {
  const env = makeEnv();
  await recordDeviceSeen(env, 'nuevo@example.com', UUID1, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');
  const lista = JSON.parse(await env.PLANS_KV.get(devicesKey('nuevo@example.com')));
  assert.equal(lista.length, 1);
  assert.equal(lista[0].deviceId, UUID1);
  assert.equal(lista[0].tipo, 'iphone');
  assert.equal(lista[0].firstSeen, lista[0].lastSeen);
  // Nunca el user-agent completo ni ningún rastro de IP en lo guardado.
  assert.equal(JSON.stringify(lista).includes('Mozilla'), false);
});

test('el mismo dispositivo visto antes de 24h NO vuelve a escribir en KV', async () => {
  const env = makeEnv();
  await recordDeviceSeen(env, 'repetido@example.com', UUID1, 'ua');
  const putsTrasPrimeraVez = env.PLANS_KV.putCount;

  await recordDeviceSeen(env, 'repetido@example.com', UUID1, 'ua'); // mismo instante

  assert.equal(env.PLANS_KV.putCount, putsTrasPrimeraVez, 'no debió escribir de nuevo en KV');
});

test('pasadas 24h, el mismo dispositivo SÍ actualiza lastSeen', async () => {
  const env = makeEnv();
  await recordDeviceSeen(env, 'viejo@example.com', UUID1, 'ua');
  const key = devicesKey('viejo@example.com');

  // Simula el paso de 25h retrocediendo a mano el lastSeen ya guardado.
  const lista = JSON.parse(await env.PLANS_KV.get(key));
  const antiguo = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
  lista[0].lastSeen = antiguo;
  await env.PLANS_KV.put(key, JSON.stringify(lista));
  const putsAntes = env.PLANS_KV.putCount;

  await recordDeviceSeen(env, 'viejo@example.com', UUID1, 'ua');

  assert.equal(env.PLANS_KV.putCount, putsAntes + 1, 'pasadas 24h sí debe escribir');
  const listaFinal = JSON.parse(await env.PLANS_KV.get(key));
  assert.notEqual(listaFinal[0].lastSeen, antiguo);
  assert.equal(listaFinal.length, 1, 'sigue siendo el mismo dispositivo, no uno nuevo');
});

test('un deviceId inválido se ignora sin lanzar ni escribir nada', async () => {
  const env = makeEnv();
  await recordDeviceSeen(env, 'malo@example.com', 'no-es-un-uuid', 'ua');
  assert.equal(await env.PLANS_KV.get(devicesKey('malo@example.com')), null);
  assert.equal(env.PLANS_KV.putCount, 0);
});

test('un deviceId ausente (undefined) se ignora igual, sin lanzar', async () => {
  const env = makeEnv();
  await recordDeviceSeen(env, 'sin-id@example.com', undefined, 'ua');
  assert.equal(await env.PLANS_KV.get(devicesKey('sin-id@example.com')), null);
});

test('tope de 20 dispositivos por cuenta: se descarta SOLO el de lastSeen más antiguo', async () => {
  const env = makeEnv();
  const emailKey = 'muchos@example.com';
  const key = devicesKey(emailKey);
  const base = Date.now() - 100 * 24 * 3600 * 1000;
  const existentes = [];
  for (let i = 0; i < 20; i++) {
    existentes.push({
      deviceId: 'dispositivo-antiguo-' + i,
      tipo: 'otro',
      firstSeen: new Date(base + i * 1000).toISOString(),
      lastSeen: new Date(base + i * 1000).toISOString(),
    });
  }
  await env.PLANS_KV.put(key, JSON.stringify(existentes));
  const masAntiguoId = existentes[0].deviceId; // el de timestamp menor

  await recordDeviceSeen(env, emailKey, UUID2, 'ua');

  const listaFinal = JSON.parse(await env.PLANS_KV.get(key));
  assert.equal(listaFinal.length, 20, 'nunca debe superar el tope de 20');
  assert.ok(listaFinal.some(d => d.deviceId === UUID2), 'el dispositivo nuevo debe estar en la lista');
  assert.ok(!listaFinal.some(d => d.deviceId === masAntiguoId), 'el de lastSeen más antiguo debe haberse descartado');
});

// =================== check-plan.js (end-to-end con el registro de dispositivo) ===================

function makeCheckPlanRequest(body) {
  return new Request('https://example.com/api/check-plan', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

test('dos dispositivos distintos con la misma cuenta entran los dos, sin bloqueo', async () => {
  const env = makeEnv();
  const email = 'dos-dispositivos@example.com';
  const emailKey = email.toLowerCase();
  const token = 'tok-compartido';
  await env.PLANS_KV.put('reg:' + emailKey, JSON.stringify({ registeredAt: new Date().toISOString(), token }));

  for (const deviceId of [UUID1, UUID2]) {
    const res = await checkPlanPost({ request: makeCheckPlanRequest({ email, token, deviceId }), env });
    const data = await res.json();
    assert.equal(data.ok, true, `el dispositivo ${deviceId} debería entrar sin bloqueo (fase 3 solo registra)`);
  }

  const lista = JSON.parse(await env.PLANS_KV.get(devicesKey(emailKey)));
  assert.equal(lista.length, 2, 'ambos dispositivos deben quedar registrados');
});

test('check-plan funciona exactamente igual sin deviceId o con uno inválido', async () => {
  const env = makeEnv();
  const email = 'sin-device@example.com';
  const emailKey = email.toLowerCase();
  const token = 'tok-sin-device';
  await env.PLANS_KV.put('reg:' + emailKey, JSON.stringify({ registeredAt: new Date().toISOString(), token }));

  const casos = [
    { email, token }, // sin deviceId
    { email, token, deviceId: 'no-es-un-uuid' },
    { email, token, deviceId: 12345 },
  ];
  for (const body of casos) {
    const res = await checkPlanPost({ request: makeCheckPlanRequest(body), env });
    const data = await res.json();
    assert.equal(data.ok, true, 'ningún caso de deviceId ausente/inválido debe cambiar la respuesta');
  }

  // Ninguno de esos deviceId inválidos/ausentes debe haber creado nada.
  assert.equal(await env.PLANS_KV.get(devicesKey(emailKey)), null);
});

// =================== register-complete.js: herencia de plan vía computePaidActive ===================

async function seedVerifyCode(env, email, code) {
  await env.PLANS_KV.put('verify:' + email, JSON.stringify({ code, createdAt: Date.now() }));
}

function makeRegisterCompleteRequest(body, ip) {
  return new Request('https://example.com/api/register-complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify(body),
  });
}

test('register-complete NO hereda un plan pro ya cancelado', async () => {
  const env = makeEnv();
  const email = 'cancelado-f3@example.com';
  await env.PLANS_KV.put(email.toLowerCase(), JSON.stringify({
    plan: 'pro', status: 'canceled', currentPeriodEnd: new Date(Date.now() + 10 * 86400000).toISOString(),
  }));
  await seedVerifyCode(env, email, '111222');

  const res = await registerCompletePost({ request: makeRegisterCompleteRequest({ email, code: '111222' }, '203.0.113.201'), env });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.plan, null, 'un plan pro cancelado no debe heredarse, aunque currentPeriodEnd sea futuro');
});

test('register-complete NO hereda un plan pro con el periodo ya caducado', async () => {
  const env = makeEnv();
  const email = 'caducado-f3@example.com';
  await env.PLANS_KV.put(email.toLowerCase(), JSON.stringify({
    plan: 'pro', status: 'active', currentPeriodEnd: new Date(Date.now() - 86400000).toISOString(),
  }));
  await seedVerifyCode(env, email, '333444');

  const res = await registerCompletePost({ request: makeRegisterCompleteRequest({ email, code: '333444' }, '203.0.113.202'), env });
  const data = await res.json();
  assert.equal(data.plan, null);
});

test('register-complete SÍ hereda un plan pro activo de verdad', async () => {
  const env = makeEnv();
  const email = 'activo-f3@example.com';
  await env.PLANS_KV.put(email.toLowerCase(), JSON.stringify({
    plan: 'pro', status: 'active', currentPeriodEnd: new Date(Date.now() + 10 * 86400000).toISOString(),
  }));
  await seedVerifyCode(env, email, '555666');

  const res = await registerCompletePost({ request: makeRegisterCompleteRequest({ email, code: '555666' }, '203.0.113.203'), env });
  const data = await res.json();
  assert.equal(data.plan, 'pro');
});

test('register-complete SÍ hereda lifetime (nunca caduca, sin importar status)', async () => {
  const env = makeEnv();
  const email = 'lifetime-f3@example.com';
  await env.PLANS_KV.put(email.toLowerCase(), JSON.stringify({ plan: 'lifetime' }));
  await seedVerifyCode(env, email, '777888');

  const res = await registerCompletePost({ request: makeRegisterCompleteRequest({ email, code: '777888' }, '203.0.113.204'), env });
  const data = await res.json();
  assert.equal(data.plan, 'lifetime');
});

test('register-complete también registra el dispositivo que completa el registro', async () => {
  const env = makeEnv();
  const email = 'registro-con-device@example.com';
  await seedVerifyCode(env, email, '999000');

  const res = await registerCompletePost({
    request: makeRegisterCompleteRequest({ email, code: '999000', deviceId: UUID1 }, '203.0.113.205'),
    env,
  });
  const data = await res.json();
  assert.equal(data.ok, true);

  const lista = JSON.parse(await env.PLANS_KV.get(devicesKey(email.toLowerCase())));
  assert.equal(lista.length, 1);
  assert.equal(lista[0].deviceId, UUID1);
});
