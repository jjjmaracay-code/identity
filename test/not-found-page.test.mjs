import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const html = read('404.html');

const SUPPORTED_LANGS = ['es', 'ca', 'eu', 'gl', 'en', 'fr', 'de', 'pt', 'hi', 'zh', 'ru', 'ja', 'ar'];

test('404.html existe y tiene noindex', () => {
  assert.ok(html.length > 0);
  assert.match(html, /<meta name="robots" content="noindex">/);
});

test('404.html enlaza a / (el botón de volver a IDENTIFLY)', () => {
  assert.match(html, /<a class="btn" id="nf-btn" href="\/">/);
});

test('ningún recurso cargado en 404.html es externo', () => {
  // Todo href/src debe ser una ruta propia (empieza por "/"), nunca un
  // dominio externo -- ni siquiera uno ya permitido por la CSP, para que
  // esta página no dependa de ninguna petición de red más allá de sí
  // misma y sus propios estáticos.
  const refs = [...html.matchAll(/\b(?:href|src)="([^"]+)"/g)].map(m => m[1]);
  assert.ok(refs.length > 0, 'no se encontró ningún href/src que comprobar');
  for (const ref of refs) {
    assert.ok(ref.startsWith('/'), 'referencia no propia: ' + ref);
  }
  // Tampoco un <script src="...">: el único script es el inline de abajo.
  assert.doesNotMatch(html, /<script\s+src=/);
});

test('ningún lookbehind de expresión regular ((?<= o (?<!) en 404.html', () => {
  assert.doesNotMatch(html, /\(\?<[=!]/);
});

test('el diccionario inline de 404.html cubre los 13 idiomas con las 3 frases, eligiendo idioma igual que la app', () => {
  const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(scriptMatch, 'no se encontró el <script> inline');
  const scriptSrc = scriptMatch[1];

  for (const lang of SUPPORTED_LANGS) {
    const elements = {
      'nf-title': { textContent: '' },
      'nf-text': { textContent: '' },
      'nf-btn': { textContent: '' },
    };
    const documentElement = { lang: '', dir: '' };
    const context = {
      document: {
        documentElement,
        getElementById: id => elements[id],
      },
      localStorage: {
        getItem: key => (key === 'identity_language_pref' ? lang : null),
      },
      navigator: { language: 'xx-XX' },
    };
    vm.createContext(context);
    vm.runInContext(scriptSrc, context);

    assert.equal(documentElement.lang, lang, lang);
    assert.equal(documentElement.dir, lang === 'ar' ? 'rtl' : 'ltr', lang);
    assert.ok(elements['nf-title'].textContent.length > 0, lang + ': falta título');
    assert.ok(elements['nf-text'].textContent.length > 0, lang + ': falta frase');
    assert.ok(elements['nf-btn'].textContent.length > 0, lang + ': falta botón');
  }
});

test('sin idioma guardado ni coincidencia de navegador, usa español (fallback)', () => {
  const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);
  const scriptSrc = scriptMatch[1];
  const elements = {
    'nf-title': { textContent: '' },
    'nf-text': { textContent: '' },
    'nf-btn': { textContent: '' },
  };
  const documentElement = { lang: '', dir: '' };
  const context = {
    document: { documentElement, getElementById: id => elements[id] },
    localStorage: { getItem: () => { throw new Error('localStorage bloqueado'); } },
    navigator: { language: 'xx-XX' },
  };
  vm.createContext(context);
  vm.runInContext(scriptSrc, context);
  assert.equal(documentElement.lang, 'es');
});
