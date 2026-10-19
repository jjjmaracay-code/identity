import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost as checkPlanPost } from '../functions/api/check-plan.js';
import { onRequestPost as registerCompletePost } from '../functions/api/register-complete.js';
import { onRequestPost as claimTokenPost } from '../functions/api/claim-token.js';
import { devicesKey } from '../functions/_shared/devices.js';

class FakeKV {
  constructor() { this.store = new Map(); }
  async get(key) { return this.store.has(key) ? this.store.get(key) : null; }
  async put(key, value) { this.store.set(key, value); }
  async delete(key) { this.store.delete(key); }
}

function makeEnv({ enforced } = {}) {
  const env = { PLANS_KV: new FakeKV(), IP_HASH_SALT: 'test-salt' };
  if (enforced) env.DEVICE_LIMIT_ENFORCED = 'true';
  return env;
}

function uuid(n) {
  return `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
}

async function seedAccount(env, email, token, paid) {
  const emailKey = email.toLowerCase();
  await env.PLANS_KV.put('reg:' + emailKey, JSON.stringify({ registeredAt: new Date().toISOString(), token }));
  if (paid) await env.PLANS_KV.put(emailKey, JSON.stringify(paid));
}

function makeCheckPlanRequest(body) {
  return new Request('https://example.com/api/check-plan', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

async function entrar(env, email, token, deviceId) {
  const res = await checkPlanPost({ request: makeCheckPlanRequest({ email, token, deviceId }), env });
  return res.json();
}

// =================== Pro: hasta 3, el 4º recibe device_limit ===================

test('Pro con el interruptor encendido: 3 dispositivos entran, el 4º recibe device_limit', async () => {
  const env = makeEnv({ enforced: true });
  const email = 'pro-limite@example.com';
  const token = 'tok-pro';
  await seedAccount(env, email, token, { plan: 'pro', status: 'active', currentPeriodEnd: new Date(Date.now() + 10 * 86400000).toISOString() });

  for (let i = 1; i <= 3; i++) {
    const data = await entrar(env, email, token, uuid(i));
    assert.equal(data.ok, true, `dispositivo ${i} debería entrar`);
  }

  const data4 = await entrar(env, email, token, uuid(4));
  assert.equal(data4.ok, false);
  assert.equal(data4.code, 'device_limit');
  assert.equal(data4.devices.length, 3);
});

// =================== Lifetime: 1 dispositivo, el 2º recibe device_limit ===================

test('Lifetime con el interruptor encendido: 1 dispositivo entra, el 2º recibe device_limit', async () => {
  const env = makeEnv({ enforced: true });
  const email = 'lifetime-limite@example.com';
  const token = 'tok-life';
  await seedAccount(env, email, token, { plan: 'lifetime' });

  const data1 = await entrar(env, email, token, uuid(1));
  assert.equal(data1.ok, true);

  const data2 = await entrar(env, email, token, uuid(2));
  assert.equal(data2.ok, false);
  assert.equal(data2.code, 'device_limit');
  assert.equal(data2.devices.length, 1);
});

// =================== Prueba: sin límite nuevo ===================

test('Prueba (sin plan de pago): ningún límite nuevo, muchos dispositivos entran', async () => {
  const env = makeEnv({ enforced: true });
  const email = 'trial-sin-limite@example.com';
  const token = 'tok-trial';
  await seedAccount(env, email, token, null);

  for (let i = 1; i <= 5; i++) {
    const data = await entrar(env, email, token, uuid(i));
    assert.equal(data.ok, true, `dispositivo ${i} de prueba debería entrar sin límite`);
  }
});

// =================== Dispositivos previos a la activación ===================

test('dispositivos ya registrados antes de activar el límite se respetan aunque lo superen', async () => {
  const env = makeEnv({ enforced: false }); // primero, SIN el interruptor: se registran 2 en Lifetime (límite real es 1)
  const email = 'ya-tenia-dos@example.com';
  const token = 'tok-grandfather';
  await seedAccount(env, email, token, { plan: 'lifetime' });

  await entrar(env, email, token, uuid(1));
  await entrar(env, email, token, uuid(2));
  const lista = JSON.parse(await env.PLANS_KV.get(devicesKey(email.toLowerCase())));
  assert.equal(lista.length, 2, 'con el interruptor apagado, ambos se registraron sin límite');

  // Ahora se activa el interruptor -- los 2 dispositivos YA conocidos deben
  // seguir entrando con normalidad, aunque ya superen el límite de 1.
  env.DEVICE_LIMIT_ENFORCED = 'true';
  const data1 = await entrar(env, email, token, uuid(1));
  const data2 = await entrar(env, email, token, uuid(2));
  assert.equal(data1.ok, true, 'el primer dispositivo ya conocido debe seguir entrando');
  assert.equal(data2.ok, true, 'el segundo dispositivo ya conocido debe seguir entrando');

  // Pero un TERCER dispositivo, nuevo, ya SÍ debe recibir device_limit.
  const data3 = await entrar(env, email, token, uuid(3));
  assert.equal(data3.ok, false);
  assert.equal(data3.code, 'device_limit');
});

// =================== Interruptor apagado: nadie se bloquea ===================

test('con el interruptor apagado, nadie se bloquea aunque se supere el límite (y se registra "habria bloqueado")', async () => {
  const env = makeEnv({ enforced: false });
  const email = 'apagado@example.com';
  const token = 'tok-apagado';
  await seedAccount(env, email, token, { plan: 'lifetime' });

  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    const data1 = await entrar(env, email, token, uuid(1));
    const data2 = await entrar(env, email, token, uuid(2)); // 2º en Lifetime, límite 1 -- pero interruptor apagado
    assert.equal(data1.ok, true);
    assert.equal(data2.ok, true, 'con el interruptor apagado, el 2º dispositivo de Lifetime también debe entrar');
    assert.equal(data2.code, undefined, 'sin código de bloqueo cuando el interruptor está apagado');
    assert.ok(logs.some(l => l.includes('habria bloqueado') && l.includes('device_limit')), 'debe quedar constancia en el log de que se habría bloqueado');
  } finally {
    console.log = originalLog;
  }
});

test('con el interruptor apagado, un dispositivo revocado tampoco se bloquea', async () => {
  const env = makeEnv({ enforced: true });
  const email = 'revocado-apagado@example.com';
  const token = 'tok-revocado-apagado';
  await seedAccount(env, email, token, { plan: 'pro', status: 'active', currentPeriodEnd: new Date(Date.now() + 10 * 86400000).toISOString() });
  await entrar(env, email, token, uuid(1));

  const { markDeviceRevoked } = await import('../functions/_shared/devices.js');
  await markDeviceRevoked(env, email.toLowerCase(), uuid(1), 'otro');

  // Con el interruptor APAGADO, el dispositivo revocado debe entrar igual.
  env.DEVICE_LIMIT_ENFORCED = undefined;
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    const data = await entrar(env, email, token, uuid(1));
    assert.equal(data.ok, true);
    assert.equal(data.code, undefined);
    assert.ok(logs.some(l => l.includes('habria bloqueado') && l.includes('device_revoked')));
  } finally {
    console.log = originalLog;
  }
});

// =================== device_revoked con el interruptor encendido ===================

test('con el interruptor encendido, un dispositivo revocado recibe device_revoked', async () => {
  const env = makeEnv({ enforced: true });
  const email = 'revocado-encendido@example.com';
  const token = 'tok-revocado-encendido';
  await seedAccount(env, email, token, { plan: 'pro', status: 'active', currentPeriodEnd: new Date(Date.now() + 10 * 86400000).toISOString() });
  await entrar(env, email, token, uuid(1));

  const { markDeviceRevoked } = await import('../functions/_shared/devices.js');
  await markDeviceRevoked(env, email.toLowerCase(), uuid(1), 'otro');

  const data = await entrar(env, email, token, uuid(1));
  assert.equal(data.ok, false);
  assert.equal(data.code, 'device_revoked');
});

// =================== AGUJERO CORREGIDO: register-complete.js /
// claim-token.js también deben respetar el límite ===================
// Antes de este arreglo, "recuperar acceso" (register-complete.js) o la
// migración automática de token (claim-token.js) daban de alta un
// dispositivo NUEVO sin mirar nunca el límite -- ese dispositivo quedaba
// activo desde el primer momento y su check-plan ya lo veía como
// "conocido", nunca "nuevo", así que el límite no se aplicaba jamás por
// esa vía. La respuesta (token entregado) debe seguir siendo exitosa --
// solo NO debe quedar dado de alta como dispositivo activo.

async function seedVerifyCode(env, email, code) {
  await env.PLANS_KV.put('verify:' + email.toLowerCase(), JSON.stringify({ code, createdAt: Date.now() }));
}

function makeRegisterCompleteRequest(body, ip = '203.0.113.90') {
  return new Request('https://example.com/api/register-complete', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify(body),
  });
}

function makeClaimTokenRequest(body) {
  return new Request('https://example.com/api/claim-token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

test('Lifetime con 1 dispositivo activo: un 2º móvil entra por "recuperar acceso" (register-complete), recibe su token, y su check-plan ya devuelve device_limit', async () => {
  const env = makeEnv({ enforced: true });
  const email = 'agujero-lifetime-rc@example.com';
  const token = 'tok-agujero-life-rc';
  await seedAccount(env, email, token, { plan: 'lifetime' });
  await entrar(env, email, token, uuid(1)); // 1er dispositivo, activo

  const deviceNuevo = uuid(2);
  await seedVerifyCode(env, email, '111222');
  const res = await registerCompletePost({
    request: makeRegisterCompleteRequest({ email, code: '111222', deviceId: deviceNuevo }),
    env,
  });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.ok, true, 'la respuesta sigue siendo exitosa -- el token se entrega igual');
  assert.equal(typeof data.token, 'string');

  // La prueba real del agujero: el check-plan de ESE dispositivo nuevo
  // debe ver device_limit, no ok:true.
  const dataCheckPlan = await entrar(env, email, token, deviceNuevo);
  assert.equal(dataCheckPlan.ok, false);
  assert.equal(dataCheckPlan.code, 'device_limit', 'el dispositivo nuevo NUNCA debió quedar dado de alta como activo');
});

test('Lifetime con 1 dispositivo activo: un 2º móvil entra por claim-token, recibe su token, y su check-plan ya devuelve device_limit', async () => {
  const env = makeEnv({ enforced: true });
  const email = 'agujero-lifetime-ct@example.com';
  const emailKey = email.toLowerCase();
  const token = 'tok-agujero-life-ct';
  // claim-token exige reg SIN token todavía (migración) -- se simula una
  // cuenta antigua pre-token con un registeredAt conocido.
  const registeredAt = new Date(Date.now() - 100 * 86400000).toISOString();
  await env.PLANS_KV.put('reg:' + emailKey, JSON.stringify({ registeredAt }));
  await env.PLANS_KV.put(emailKey, JSON.stringify({ plan: 'lifetime' }));

  // El primer dispositivo ya está activo (dado de alta por otra vía, p.ej.
  // check-plan de un dispositivo que sí tenía token).
  await env.PLANS_KV.put(devicesKey(emailKey), JSON.stringify([
    { deviceId: uuid(1), tipo: 'otro', firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString(), status: 'active' },
  ]));

  const deviceNuevo = uuid(2);
  const res = await claimTokenPost({
    request: makeClaimTokenRequest({ email, registeredAt, deviceId: deviceNuevo }),
    env,
  });
  const data = await res.json();
  assert.equal(data.ok, true, 'la respuesta sigue siendo exitosa -- el token se entrega igual');
  assert.equal(typeof data.token, 'string');

  const dataCheckPlan = await entrar(env, email, data.token, deviceNuevo);
  assert.equal(dataCheckPlan.ok, false);
  assert.equal(dataCheckPlan.code, 'device_limit', 'el dispositivo nuevo NUNCA debió quedar dado de alta como activo');
});

test('Pro con 3 dispositivos activos: el 4º por "recuperar acceso" (register-complete) recibe token, pero su check-plan ya devuelve device_limit', async () => {
  const env = makeEnv({ enforced: true });
  const email = 'agujero-pro-rc@example.com';
  const token = 'tok-agujero-pro-rc';
  await seedAccount(env, email, token, { plan: 'pro', status: 'active', currentPeriodEnd: new Date(Date.now() + 10 * 86400000).toISOString() });
  await entrar(env, email, token, uuid(1));
  await entrar(env, email, token, uuid(2));
  await entrar(env, email, token, uuid(3));

  const deviceNuevo = uuid(4);
  await seedVerifyCode(env, email, '333444');
  const res = await registerCompletePost({
    request: makeRegisterCompleteRequest({ email, code: '333444', deviceId: deviceNuevo }, '203.0.113.91'),
    env,
  });
  const data = await res.json();
  assert.equal(data.ok, true);

  const dataCheckPlan = await entrar(env, email, token, deviceNuevo);
  assert.equal(dataCheckPlan.ok, false);
  assert.equal(dataCheckPlan.code, 'device_limit');
});

test('con el interruptor apagado, register-complete/claim-token siguen dando de alta sin límite (fase 3 sin cambios)', async () => {
  const env = makeEnv({ enforced: false });
  const email = 'apagado-rc@example.com';
  const token = 'tok-apagado-rc';
  await seedAccount(env, email, token, { plan: 'lifetime' });
  await entrar(env, email, token, uuid(1));

  const deviceNuevo = uuid(2);
  await seedVerifyCode(env, email, '555666');
  const res = await registerCompletePost({
    request: makeRegisterCompleteRequest({ email, code: '555666', deviceId: deviceNuevo }, '203.0.113.92'),
    env,
  });
  const data = await res.json();
  assert.equal(data.ok, true);

  // Con el interruptor apagado, el 2º dispositivo SÍ debe quedar activo
  // (igual que en la fase 3, sin límite).
  const dataCheckPlan = await entrar(env, email, token, deviceNuevo);
  assert.equal(dataCheckPlan.ok, true);
  assert.equal(dataCheckPlan.code, undefined);
});
