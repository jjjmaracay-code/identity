import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { onRequestPost, onRequestGet } from '../functions/api/share-qr.js';
import { SHARE_LIMITS } from '../functions/_shared/share-security.js';

const email = 'owner@example.com', token = 'private-test-account-token';
const vcard = 'BEGIN:VCARD\nVERSION:3.0\nFN:José 宇\nEMAIL:contact@example.net\nEND:VCARD';

function fixture(plan = 'free') {
  const registrations = new Map([
    ['reg:' + email, JSON.stringify({ token, registeredAt: '2026-10-01T00:00:00Z' })],
    [email, JSON.stringify({ plan })],
  ]);
  const values = new Map(), writes = [], reads = [];
  const env = {
    PLANS_KV: { async get(key) { reads.push(key); return registrations.get(key) ?? null; } },
    SHARE_KV: {
      async get(key) { return values.get(key) ?? null; },
      async put(key, value, options) { writes.push({ key, value, options }); values.set(key, value); },
    },
  };
  const body = { email, token, vcard, name: 'José 宇' };
  function request(payload = body, extraHeaders = {}) {
    return new Request('https://example.com/api/share-qr', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...extraHeaders }, body: JSON.stringify(payload),
    });
  }
  return { env, values, writes, reads, body, request, create: (payload, headers) => onRequestPost({ env, request: request(payload, headers) }) };
}

for (const credentials of [{ email: undefined, token: undefined }, { token: '' }, { token: 'wrong-token' },
  { email: 'unknown@example.com' }, { email: [] }, { token: {} }]) {
  test('crear sin credenciales válidas no escribe nada: ' + JSON.stringify(credentials), async () => {
    const f = fixture();
    const response = await f.create({ ...f.body, ...credentials });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, 'no_autorizado');
    assert.equal(f.writes.length, 0);
  });
}

for (const plan of ['free', 'pro', 'lifetime']) {
  test(`una cuenta ${plan} crea un enlace; el destinatario lo abre sin registrarse`, async () => {
    const f = fixture(plan);
    const response = await f.create({ ...f.body, email: email.toUpperCase() });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const result = await response.json();
    assert.match(result.token, /^[a-f0-9]{32}$/);
    const shareWrites = f.writes.filter(w => w.key.startsWith('share:'));
    assert.equal(shareWrites.length, 1);
    assert.equal(shareWrites[0].options.expirationTtl, 30 * 86400);
    assert.deepEqual(Object.keys(JSON.parse(shareWrites[0].value)).sort(), ['createdAt', 'name', 'used', 'vcard']);
    assert.equal(shareWrites[0].value.includes(token), false);
    assert.equal(shareWrites[0].value.includes(email), false);
    // Sin PLANS_KV ni credenciales: el GET público y sus enlaces antiguos
    // conservan exactamente el contrato anterior.
    const open = () => onRequestGet({ env: { SHARE_KV: f.env.SHARE_KV }, request: new Request('https://example.com/api/share-qr?token=' + result.token) });
    assert.equal((await (await open()).json()).vcard, vcard);
    assert.equal((await (await open()).json()).reason, 'already_used');
  });
}

test('un enlace anterior a la corrección sigue abriendo sin credenciales', async () => {
  const f = fixture();
  f.values.set('share:old-link', JSON.stringify({ used: false, vcard, name: 'Anterior', createdAt: '2026-10-01' }));
  const response = await onRequestGet({ env: { SHARE_KV: f.env.SHARE_KV }, request: new Request('https://example.com/api/share-qr?token=old-link') });
  assert.equal((await response.json()).vcard, vcard);
});

for (const payload of [null, [], { vcard: {} }, { name: [] }, { vcard: 'esto no es una tarjeta' },
  { vcard: 'BEGIN:VCARD\nFN:Bad\0\nEND:VCARD' }]) {
  test('contenido inválido no llega al almacenamiento: ' + JSON.stringify(payload), async () => {
    const f = fixture();
    const response = await f.create(payload === null || Array.isArray(payload) ? payload : { ...f.body, ...payload });
    assert.equal(response.status, 400);
    assert.equal(f.writes.length, 0);
  });
}

test('el tamaño de la tarjeta se limita por bytes, también con caracteres multibyte', async () => {
  const f = fixture();
  const response = await f.create({ ...f.body, vcard: 'BEGIN:VCARD\nFN:' + '宇'.repeat(23000) + '\nEND:VCARD' });
  assert.equal(response.status, 413);
  assert.equal(f.writes.length, 0);
});

test('el nombre excesivo se rechaza; una vCard CRLF válida se conserva', async () => {
  const f = fixture();
  assert.equal((await f.create({ ...f.body, name: 'x'.repeat(257) })).status, 413);
  assert.equal(f.writes.length, 0);
  const card = vcard.replaceAll('\n', '\r\n');
  const response = await f.create({ ...f.body, vcard: card });
  const result = await response.json();
  assert.equal(JSON.parse(f.values.get('share:' + result.token)).vcard, card);
});

for (const declaredLength of [undefined, '1', String(SHARE_LIMITS.requestBytes + 1)]) {
  test('el cuerpo excesivo se rechaza sin confiar en Content-Length=' + declaredLength, async () => {
    const f = fixture();
    const headers = { 'Content-Type': 'application/json' };
    if (declaredLength !== undefined) headers['Content-Length'] = declaredLength;
    const request = new Request('https://example.com/api/share-qr', {
      method: 'POST', headers, body: ' '.repeat(SHARE_LIMITS.requestBytes + 1),
    });
    const response = await onRequestPost({ env: f.env, request });
    assert.equal(response.status, 413);
    assert.equal(f.reads.length, 0);
    assert.equal(f.writes.length, 0);
  });
}

test('la lectura por streaming se detiene al superar el límite', async () => {
  const f = fixture();
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(65537)); },
    cancel() { cancelled = true; },
  });
  const request = new Request('https://example.com/api/share-qr', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: stream, duplex: 'half',
  });
  assert.equal((await onRequestPost({ env: f.env, request })).status, 413);
  assert.equal(cancelled, true);
  assert.equal(f.writes.length, 0);
});

test('JSON mal formado, origen ajeno y tipo incorrecto se rechazan sin escrituras', async () => {
  const f = fixture();
  const malformed = new Request('https://example.com/api/share-qr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal((await onRequestPost({ env: f.env, request: malformed })).status, 400);
  assert.equal((await f.create(f.body, { Origin: 'https://other.example' })).status, 403);
  assert.equal((await f.create(f.body, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await f.create(f.body, { Origin: 'https://example.com' })).status, 200);
});

test('la cuota corta rechaza el siguiente enlace y permite volver al vencer la ventana', async () => {
  const f = fixture(), realNow = Date.now;
  let now = 1800000000000;
  Date.now = () => now;
  try {
    for (let i = 0; i < 30; i++) { assert.equal((await f.create()).status, 200); now += 1100; }
    const response = await f.create();
    assert.equal(response.status, 429);
    assert.ok(Number(response.headers.get('Retry-After')) > 0);
    assert.equal(f.writes.filter(w => w.key.startsWith('share:')).length, 30);
    now += 600000;
    assert.equal((await f.create()).status, 200);
  } finally { Date.now = realNow; }
});

test('la cuota diaria sigue limitando aunque se renueve la ventana corta', async () => {
  const f = fixture(), realNow = Date.now;
  let now = 1800000000000;
  Date.now = () => now;
  try {
    for (let i = 0; i < 200; i++) { assert.equal((await f.create()).status, 200); now += 40000; }
    const response = await f.create();
    assert.equal(response.status, 429);
    assert.ok(Number(response.headers.get('Retry-After')) > 600);
    assert.equal(f.writes.filter(w => w.key.startsWith('share:')).length, 200);
    now += 86400000;
    assert.equal((await f.create()).status, 200);
  } finally { Date.now = realNow; }
});

test('una reserva solapada en el mismo isolate se rechaza sin escribir otro contacto', async () => {
  const f = fixture();
  let release, started;
  const held = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { started = resolve; });
  const get = f.env.SHARE_KV.get;
  f.env.SHARE_KV.get = async key => { started(); await held; return get(key); };
  const first = f.create();
  await entered;
  let second;
  try { second = await f.create(); } finally { release(); }
  assert.equal(second.status, 429);
  assert.equal((await first).status, 200);
  assert.equal(f.writes.filter(w => w.key.startsWith('share:')).length, 1);
});

for (const quotaFailure of [new Error('private backend details'), new Error('KV PUT failed: 429 Too Many Requests')]) {
  test('si falla la reserva de cuota no se crea el contacto: ' + quotaFailure.message, async () => {
    const f = fixture();
    f.env.SHARE_KV.put = async () => { throw quotaFailure; };
    const response = await f.create();
    assert.equal(response.status, quotaFailure.message.includes('429') ? 429 : 503);
    assert.equal((await response.text()).includes('private'), false);
    assert.equal(f.values.size, 0);
  });
}

test('una caída de autenticación no crea enlaces ni expone detalles internos', async () => {
  const f = fixture();
  f.env.PLANS_KV.get = async () => { throw new Error(token); };
  const response = await f.create();
  assert.equal(response.status, 503);
  assert.equal((await response.text()).includes(token), false);
  assert.equal(f.writes.length, 0);
});

test('la aplicación envía la cuenta verificada y abre el enlace devuelto', async () => {
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const source = index.match(/async function generateShareLink\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(source);
  const calls = [];
  let accountToken = token;
  const context = {
    _reg: { email }, profileData: { email: 'contact@example.net', name: 'José' },
    localStorage: { getItem(key) { assert.equal(key, 'identity_access_token'); return accountToken; } },
    buildVCard: () => vcard, window: { location: { origin: 'https://example.com' } },
    fetch: async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return Response.json({ token: 'public-link-token' }); },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  assert.equal(await context.generateShareLink(), 'https://example.com/share.html?token=public-link-token');
  assert.equal(calls[0].body.email, email);
  assert.equal(calls[0].body.token, token);
  assert.equal(calls[0].body.vcard, vcard);
  accountToken = null;
  await assert.rejects(context.generateShareLink());
  assert.equal(calls.length, 1, 'sin credencial no debe enviar una petición anónima');
  accountToken = token;
  context.fetch = async () => Response.json({ token: 'untrusted-error-token' }, { status: 503 });
  await assert.rejects(context.generateShareLink());
});
