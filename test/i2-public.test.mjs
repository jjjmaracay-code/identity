import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { onRequestGet as businessGet } from '../functions/c/[id].js';
import { onRequestGet as shareGet, onRequestPost as sharePost } from '../functions/api/share-qr.js';
import { THEME_TOKENS } from '../functions/_shared/business.js';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const shareHTML = read('share.html');
const signature = html => html.match(/<a\b[^>]*data-i18n="growth\.create_yours"[^>]*>/)?.[0];

function assertPublicSignature(html) {
  const link = signature(html);
  assert.ok(link, 'Falta el enlace de firma');
  assert.match(link, /href="\/register\.html"/);
  assert.match(link, /rel="noreferrer"/);
  assert.match(link, /referrerpolicy="no-referrer"/);
  assert.doesNotMatch(link, /\?|#|token=|email=/);
}

function businessContext(theme, options = {}) {
  const id = 'a'.repeat(32);
  const owner = 'owner-private@example.com';
  const record = {
    id, published: options.published !== false, displayName: 'Alex <Demo>',
    tagline: 'Ejemplo', modality: 'professional', email: 'public@example.com',
    web: 'https://example.com', social: {}, design: { theme }
  };
  const values = new Map([
    ['bizid:' + id, owner],
    ['reg:' + owner, JSON.stringify({ registeredAt: '2020-01-01T00:00:00Z', token: 'owner-private-token' })],
    [owner, JSON.stringify(options.expired ? { plan: 'pro', currentPeriodEnd: '2020-02-01T00:00:00Z' } : { plan: 'lifetime' })]
  ]);
  const kv = { async get(key) { return values.get(key) || null; }, async put() { throw new Error('Unexpected KV write'); } };
  return { params: { id }, env: {
    BUSINESS_KV: kv, PLANS_KV: kv,
    BUSINESS_DO: {
      idFromName(name) { assert.equal(name, owner); return id; },
      get() { return { async fetch() { return Response.json({ ok: true, exists: true, record }); } }; }
    }
  } };
}

for (const theme of ['dark', 'light']) {
  test(`la firma Business conserva el tema ${theme}, la vCard y el acceso sin credenciales privadas`, async () => {
    const response = await businessGet(businessContext(theme));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const html = await response.text();
    assertPublicSignature(html);
    assert.ok(html.includes('body{background:' + THEME_TOKENS[theme].bg));
    assert.ok(html.includes('color:' + THEME_TOKENS[theme].text));
    assert.ok(html.includes('Alex &lt;Demo&gt;'));
    assert.match(html, /src="\/i18n\/loader\.js"/);
    const vcard = Buffer.from(html.match(/data-vcard="([^"]+)"/)[1], 'base64').toString('utf8');
    assert.match(vcard, /FN:Alex <Demo>/);
    assert.match(vcard, /EMAIL:public@example\.com/);
    assert.doesNotMatch(html, /owner-private@example\.com|owner-private-token/);
  });
}

for (const options of [{ published: false }, { expired: true }]) {
  test(`una tarjeta retirada o caducada sigue sin exponerse (${JSON.stringify(options)})`, async () => {
    const response = await businessGet(businessContext('dark', options));
    assert.equal(response.status, 404);
    assert.doesNotMatch(await response.text(), /Alex|public@example|data-vcard/);
  });
}

test('la firma de share.html queda fuera de la tarjeta dinámica y no arrastra el token al registro', () => {
  assertPublicSignature(shareHTML);
  assert.ok(shareHTML.indexOf('id="card"') < shareHTML.indexOf('<footer'));
  assert.match(shareHTML, /href="\/public-card\.css"/);
});

test('el enlace de un solo uso se consume una vez y conserva la vCard original', async () => {
  const values = new Map();
  const env = { PLANS_KV: { async get(key) {
    return key === 'reg:creator@example.com' ? JSON.stringify({ token: 'creator-token' }) : null;
  } }, SHARE_KV: {
    async get(key) { return values.get(key) || null; },
    async put(key, value) { values.set(key, value); }
  } };
  const vcard = 'BEGIN:VCARD\nVERSION:3.0\nFN:Ejemplo\nEMAIL:demo@example.com\nEND:VCARD';
  const created = await sharePost({ env, request: new Request('https://example.com/api/share-qr', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'creator@example.com', token: 'creator-token', name: 'Ejemplo', vcard })
  }) });
  assert.equal(created.status, 200);
  const { token } = await created.json();
  const open = () => shareGet({ env, request: new Request('https://example.com/api/share-qr?token=' + token) });
  const first = await (await open()).json();
  assert.equal(first.valid, true);
  assert.equal(first.vcard, vcard);
  const second = await (await open()).json();
  assert.equal(second.valid, false);
  assert.equal(second.reason, 'already_used');
  assert.equal(second.vcard, undefined);
});

test('los botones de demo y recomendación están conectados a sus módulos en las páginas reales', () => {
  const index = read('index.html'), register = read('register.html');
  assert.match(index, /src="\/growth-share\.js" defer/);
  assert.match(index, /href="\/growth\.css"/);
  assert.match(register, /href="\/growth\.css"/);
  assert.equal([...index.matchAll(/href="\/demo\.html"/g)].length, 2);
  assert.match(register, /href="\/demo\.html"/);
  for (const id of ['btn-recommend', 'growth-share-fallback', 'growth-share-url', 'growth-share-status', 'growth-copy-link', 'growth-share-close']) {
    assert.equal([...index.matchAll(new RegExp('id="' + id + '"', 'g'))].length, 1, id);
  }
  assert.match(index, /id="growth-share-fallback" hidden/);
  assert.match(index, /id="growth-share-url"[^>]*readonly/);
});

test('el Service Worker incluye todos los recursos I2 y sigue excluyendo API y tarjetas Business', () => {
  const listeners = {};
  const context = { self: { location: { origin: 'https://example.com' }, addEventListener(name, fn) { listeners[name] = fn; } }, URL };
  vm.runInNewContext(read('sw.js') + '\nself.testURLs = CACHE_URLS; self.testVersion = APP_VERSION;', context);
  assert.equal(context.self.testVersion, '48');
  for (const url of ['/demo', '/demo.js', '/public-card.css', '/growth.css', '/growth-share.js', '/vcard.js', '/vendor/qr-code-styling/qr-code-styling.js', '/i18n/loader.js']) {
    assert.ok(context.self.testURLs.includes(url), url);
  }
  for (const lang of ['es', 'ca', 'eu', 'gl', 'en', 'fr', 'de', 'pt', 'hi', 'zh', 'ru', 'ja', 'ar']) {
    assert.ok(context.self.testURLs.includes('/i18n/' + lang + '.json'));
  }
  for (const pathname of ['/api/share-qr?token=private', '/c/abc']) {
    let intercepted = false;
    listeners.fetch({ request: { url: 'https://example.com' + pathname, method: 'GET' }, respondWith() { intercepted = true; } });
    assert.equal(intercepted, false);
  }
});
