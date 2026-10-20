// Test de integridad de i18n/*.json: falla si cualquier idioma no tiene
// EXACTAMENTE las mismas claves que es.json (fuente de verdad), o si en
// alguna clave los placeholders ({n}, {url}, {plataforma}...) de un
// idioma no coinciden con los de es.json para esa misma clave -- un
// placeholder que se pierda o se escriba distinto (p.ej. "{N}" en vez de
// "{n}") rompe en tiempo de ejecución el reemplazo que hace t()/window.t()
// sin que ningún otro mecanismo lo detecte.
//
// Ejecutar: node --test test/i18n.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const i18nDir = path.join(__dirname, '..', 'i18n');

// es.json es la fuente de verdad: todas las demás claves nacen ahí.
const SOURCE_LANG = 'es';
// Los otros 11 idiomas que deben tener exactamente las mismas claves.
const OTHER_LANGS = ['ca', 'eu', 'gl', 'en', 'fr', 'de', 'pt', 'hi', 'zh', 'ru', 'ja', 'ar'];

function loadLang(lang) {
  const raw = readFileSync(path.join(i18nDir, lang + '.json'), 'utf8');
  return JSON.parse(raw);
}

function placeholdersOf(value) {
  if (typeof value !== 'string') return new Set();
  const matches = value.match(/\{[a-zA-Z0-9_]+\}/g) || [];
  return new Set(matches);
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}

const source = loadLang(SOURCE_LANG);
const sourceKeys = Object.keys(source);

test('es.json es JSON válido y tiene claves', () => {
  assert.ok(sourceKeys.length > 0, 'es.json no debe estar vacío');
});

for (const lang of OTHER_LANGS) {
  test(`${lang}.json tiene exactamente las mismas claves que es.json`, () => {
    const dict = loadLang(lang);
    const dictKeys = Object.keys(dict);

    const missing = sourceKeys.filter((k) => !(k in dict));
    const extra = dictKeys.filter((k) => !(k in source));

    assert.deepStrictEqual(missing, [], `${lang}.json: faltan claves de es.json -> ${missing.join(', ')}`);
    assert.deepStrictEqual(extra, [], `${lang}.json: tiene claves que no existen en es.json -> ${extra.join(', ')}`);
  });

  test(`${lang}.json: los placeholders de cada clave coinciden con es.json`, () => {
    const dict = loadLang(lang);
    const mismatches = [];

    for (const key of sourceKeys) {
      const sourcePlaceholders = placeholdersOf(source[key]);
      if (sourcePlaceholders.size === 0) continue; // nada que comparar en esta clave
      const targetPlaceholders = placeholdersOf(dict[key]);
      if (!setsEqual(sourcePlaceholders, targetPlaceholders)) {
        mismatches.push(
          `${key}: es=[${[...sourcePlaceholders].join(',')}] ${lang}=[${[...targetPlaceholders].join(',')}]`
        );
      }
    }

    assert.deepStrictEqual(mismatches, [], `${lang}.json: placeholders no coinciden en:\n${mismatches.join('\n')}`);
  });
}
