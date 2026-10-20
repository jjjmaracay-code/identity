import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const html = read('demo.html');
const languages = ['es', 'ca', 'eu', 'gl', 'en', 'fr', 'de', 'pt', 'hi', 'zh', 'ru', 'ja', 'ar'];
const dictionaries = Object.fromEntries(languages.map(lang => [lang, JSON.parse(read('i18n/' + lang + '.json'))]));

// DOM mínimo construido a partir de las etiquetas reales de demo.html.
// Estas pruebas ejecutan los scripts reales en VM; no simulan un navegador.
function documentFromHTML() {
  const nodes = [...html.matchAll(/<([a-z][\w-]*)\b([^>]*?)>/gi)].map(([, tag, attrs]) => {
    const attributes = Object.fromEntries([...attrs.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(([, key, value]) => [key, value || '']));
    return {
      tag, attributes, textContent: '', value: '', hidden: 'hidden' in attributes,
      disabled: 'disabled' in attributes, listeners: {},
      hasAttribute(name) { return name in this.attributes; },
      getAttribute(name) { return this.attributes[name]; },
      setAttribute(name, value) { this.attributes[name] = value; },
      removeAttribute(name) { delete this.attributes[name]; },
      addEventListener(name, fn) { this.listeners[name] = fn; },
      async fire(name) { return this.listeners[name]?.(); }
    };
  });
  return {
    nodes,
    documentElement: nodes.find(node => node.tag === 'html'),
    getElementById: id => nodes.find(node => node.attributes.id === id),
    querySelectorAll: selector => nodes.filter(node => node.hasAttribute(selector.slice(1, -1)))
  };
}

async function fixture(options = {}) {
  const document = documentFromHTML();
  const fetches = [], qrCalls = [], downloads = [], revoked = [];
  const blobs = new Map();
  const stored = new Map(Object.entries(options.storage || {}));
  const storageReads = [], storageWrites = [];
  let privateAccesses = 0;
  const context = {
    document, Blob,
    navigator: { languages: [options.lang || 'es-ES'] },
    fetch: async url => {
      fetches.push(url);
      assert.match(url, /^\/i18n\/(es|ca|eu|gl|en|fr|de|pt|hi|zh|ru|ja|ar)\.json$/);
      const lang = url.slice(6, -5);
      if (options.failDictionary === lang) throw new Error('Offline dictionary');
      return { ok: true, json: async () => dictionaries[lang] };
    },
    URL: {
      createObjectURL(blob) { const url = 'blob:demo-' + blobs.size; blobs.set(url, blob); return url; },
      revokeObjectURL(url) { revoked.push(url); }
    }
  };
  context.window = context;
  for (const key of ['localStorage', 'sessionStorage', 'indexedDB', 'location', 'profileData', 'identity_access_token']) {
    if (key === 'localStorage' && options.normalPage) continue;
    Object.defineProperty(context, key, { get() { privateAccesses++; throw new Error('Private access: ' + key); } });
  }
  if (options.normalPage) {
    document.documentElement.removeAttribute('data-i18n-isolated');
    context.localStorage = {
      getItem(key) { storageReads.push(key); return stored.get(key) ?? null; },
      setItem(key, value) { storageWrites.push([key, value]); stored.set(key, value); }
    };
  }
  if (!options.missingQR) {
    context.QRCodeStyling = function (values) {
      qrCalls.push(values);
      this.append = node => { node.textContent = 'Rendered example QR'; };
    };
  }
  document.body = { appendChild() {} };
  document.createElement = tag => {
    assert.equal(tag, 'a');
    return { click() { downloads.push({ filename: this.download, blob: blobs.get(this.href), url: this.href }); }, remove() {} };
  };
  vm.createContext(context);
  vm.runInContext(read('i18n/loader.js'), context, { filename: 'i18n/loader.js' });
  if (!options.normalPage) {
    vm.runInContext(read('vcard.js'), context, { filename: 'vcard.js' });
    vm.runInContext(read('demo.js'), context, { filename: 'demo.js' });
  }
  await context.i18nReady;
  return { context, document, fetches, qrCalls, downloads, revoked, stored, storageReads, storageWrites, get privateAccesses() { return privateAccesses; } };
}

for (const lang of languages) {
  test(`demo ${lang}: QR y vCard ficticios sin leer el perfil, almacenamiento ni tokens`, async () => {
    const f = await fixture({ lang });
    assert.equal(f.privateAccesses, 0);
    assert.deepEqual(f.fetches, ['/i18n/' + lang + '.json']);
    assert.equal(f.context.currentLanguage, lang);
    assert.equal(f.document.documentElement.dir, lang === 'ar' ? 'rtl' : 'ltr');
    assert.equal(f.document.getElementById('demo-email').textContent, 'alex.demo@example.com');
    assert.equal(f.qrCalls.length, 1);
    const vcard = f.qrCalls[0].data;
    assert.match(vcard, /^BEGIN:VCARD\nVERSION:3\.0\n/);
    assert.ok(vcard.includes('FN:Alex Demo\n'));
    assert.ok(vcard.includes('TITLE:' + dictionaries[lang]['growth.demo_role'] + '\n'));
    assert.ok(vcard.includes('ORG:' + dictionaries[lang]['growth.demo_company'] + '\n'));
    assert.ok(vcard.includes('EMAIL:alex.demo@example.com\n'));
    assert.ok(vcard.endsWith('END:VCARD'));
    const button = f.document.getElementById('demo-download');
    assert.equal(button.disabled, false);
    await button.fire('click');
    assert.equal(f.downloads.length, 1);
    assert.equal(f.downloads[0].filename, 'identifly-demo.vcf');
    assert.equal(f.downloads[0].blob.type, 'text/vcard');
    assert.equal(await f.downloads[0].blob.text(), vcard);
    assert.deepEqual(f.revoked, [f.downloads[0].url]);
    assert.equal(f.privateAccesses, 0);
  });
}

test('el selector de la demo actualiza texto, QR y descarga sin persistir el idioma', async () => {
  const f = await fixture();
  const select = f.document.getElementById('demo-language');
  select.value = 'ja';
  await select.fire('change');
  assert.equal(select.disabled, false);
  assert.equal(f.context.currentLanguage, 'ja');
  assert.equal(f.document.documentElement.lang, 'ja');
  assert.equal(f.document.getElementById('demo-download').textContent, dictionaries.ja['growth.demo_download']);
  assert.equal(f.qrCalls.length, 2);
  await f.document.getElementById('demo-download').fire('click');
  assert.equal(await f.downloads[0].blob.text(), f.qrCalls[1].data);
  assert.deepEqual(f.fetches, ['/i18n/es.json', '/i18n/ja.json']);
  assert.equal(f.privateAccesses, 0);
});

test('si falla el diccionario detectado usa español sin consultar el perfil', async () => {
  const f = await fixture({ lang: 'ja-JP', failDictionary: 'ja' });
  assert.deepEqual(f.fetches, ['/i18n/ja.json', '/i18n/es.json']);
  assert.equal(f.context.currentLanguage, 'es');
  assert.ok(f.qrCalls[0].data.includes(dictionaries.es['growth.demo_role']));
  assert.equal(f.privateAccesses, 0);
});

test('si no carga QRCodeStyling se conserva la descarga de contacto ficticio y aparece el aviso', async () => {
  const f = await fixture({ missingQR: true });
  assert.equal(f.document.getElementById('demo-qr-error').hidden, false);
  await f.document.getElementById('demo-download').fire('click');
  assert.match(await f.downloads[0].blob.text(), /FN:Alex Demo/);
  assert.equal(f.privateAccesses, 0);
});

test('el loader normal conserva el idioma de la cuenta y la persistencia de preferencias', async () => {
  const registration = JSON.stringify({ language: 'fr', email: 'private@example.com' });
  const f = await fixture({ normalPage: true, lang: 'ca', storage: {
    identity_registration: registration, identity_language_pref: 'de'
  } });
  assert.equal(f.context.currentLanguage, 'fr');
  await f.context.setLanguage('en');
  assert.deepEqual(f.storageWrites, [['identity_language_pref', 'en']]);
  assert.equal(f.stored.get('identity_registration'), registration);
  assert.deepEqual(f.storageReads, ['identity_registration']);
});

test('sin registro el loader normal conserva la preferencia anterior al registro', async () => {
  const f = await fixture({ normalPage: true, lang: 'ca', storage: { identity_language_pref: 'pt' } });
  assert.equal(f.context.currentLanguage, 'pt');
  assert.deepEqual(f.storageReads, ['identity_registration', 'identity_language_pref']);
});

test('la demo HTML carga solo componentes públicos y sus accesos no transportan datos privados', () => {
  const document = documentFromHTML();
  assert.equal(document.documentElement.hasAttribute('data-i18n-isolated'), true);
  const scripts = document.nodes.filter(node => node.tag === 'script').map(node => node.attributes.src);
  assert.deepEqual(scripts, ['/i18n/loader.js', '/vcard.js', '/vendor/qr-code-styling/qr-code-styling.js', '/demo.js']);
  for (const node of document.nodes.filter(node => node.tag === 'a')) {
    assert.ok(['/', '/register.html'].includes(node.attributes.href));
  }
  assert.equal(document.nodes.some(node => node.tag === 'form'), false);
  const options = document.nodes.filter(node => node.tag === 'option').map(node => node.attributes.value);
  assert.deepEqual(new Set(options), new Set(languages));
});


test('árabe: cambiar a inglés restaura LTR, QR y descarga sin datos privados', async () => {
  const f = await fixture({ lang: 'ar-SA' });
  assert.equal(f.document.documentElement.dir, 'rtl');
  await f.context.setLanguage('en');
  assert.equal(f.document.documentElement.dir, 'ltr');
  assert.equal(f.context.currentLanguage, 'en');
  await f.context.setLanguage('ar');
  assert.equal(f.document.documentElement.dir, 'rtl');
  assert.equal(f.privateAccesses, 0);
});

test('árabe: el fallo del diccionario restaura dirección española', async () => {
  const f = await fixture({ lang: 'ar', failDictionary: 'ar' });
  assert.equal(f.context.currentLanguage, 'es');
  assert.equal(f.document.documentElement.dir, 'ltr');
});

test('árabe: la cuenta conserva su idioma en otro dispositivo y no reescribe el registro', async () => {
  const registration = JSON.stringify({ language: 'ar', email: 'private@example.com' });
  const f = await fixture({ normalPage: true, lang: 'en', storage: { identity_registration: registration } });
  assert.equal(f.document.documentElement.dir, 'rtl');
  assert.equal(f.stored.get('identity_registration'), registration);
  assert.deepEqual(f.storageWrites, []);
});
