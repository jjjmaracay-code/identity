import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('account-wallet.js (integración antigua de Wallet) no existe', () => {
  assert.equal(existsSync(new URL('../account-wallet.js', import.meta.url)), false);
});

test('index.html no referencia account-wallet.js ni su panel', () => {
  const index = read('index.html');
  assert.doesNotMatch(index, /account-wallet\.js/);
  assert.doesNotMatch(index, /account-wallet-tools/);
});

test('sw.js no precachea account-wallet.js', () => {
  const sw = read('sw.js');
  const cacheUrls = sw.match(/const CACHE_URLS = \[([\s\S]*?)\];/);
  assert.ok(cacheUrls, 'no se encontró CACHE_URLS en sw.js');
  assert.doesNotMatch(cacheUrls[1], /account-wallet\.js/, 'account-wallet.js sigue en CACHE_URLS');
});

test('la allowlist del proxy de account-tools ya no tiene rutas wallet/*, y sigue teniendo las de passkeys', () => {
  const proxy = read('functions/api/account-tools/[[path]].js');
  const match = proxy.match(/const allowed=new Set\(\[([^\]]*)\]\)/);
  assert.ok(match, 'no se encontró la allowlist en el proxy');
  const allowed = match[1].split(',').map(s => s.trim().replace(/^'|'$/g, ''));

  for (const ruta of ['wallet/status', 'wallet/apple', 'wallet/google']) {
    assert.ok(!allowed.includes(ruta), ruta + ' debería haberse retirado de la allowlist');
  }
  for (const ruta of ['passkeys/list', 'passkeys/register/options', 'passkeys/register/verify', 'passkeys/login/options', 'passkeys/login/verify', 'passkeys/remove']) {
    assert.ok(allowed.includes(ruta), ruta + ' debería seguir en la allowlist');
  }
});
