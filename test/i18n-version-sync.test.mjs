import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const sw = read('sw.js');
const loader = read('i18n/loader.js');

// Mismo patrón que DICT_VERSION en i2-demo.test.mjs: se leen los valores
// reales de los archivos en vez de hardcodearlos.
const DICT_VERSION = loader.match(/DICT_VERSION = '(\d+)'/)[1];

// Archivos de diccionario reales en i18n/ (todo .json salvo los que no
// son diccionarios de idioma, como rtl.css, que ni siquiera es .json).
const realDictFiles = readdirSync(new URL('../i18n/', import.meta.url))
  .filter(name => name.endsWith('.json'));

// Entradas /i18n/<lang>.json?v=<n> tal como aparecen hoy en CACHE_URLS.
const cacheDictEntries = [...sw.matchAll(/'\/i18n\/([\w-]+\.json)\?v=(\d+)'/g)]
  .map(([, file, version]) => ({ file, version }));

test('todas las entradas /i18n/*.json de CACHE_URLS llevan el mismo ?v= y coincide con DICT_VERSION de i18n/loader.js', () => {
  assert.ok(cacheDictEntries.length > 0, 'no se encontró ninguna entrada /i18n/*.json?v= en sw.js');
  for (const { file, version } of cacheDictEntries) {
    assert.equal(version, DICT_VERSION, file);
  }
});

test('cada archivo real de i18n/*.json aparece en CACHE_URLS, y ninguno sobra', () => {
  const cacheFiles = cacheDictEntries.map(({ file }) => file).sort();
  assert.deepEqual(cacheFiles, [...realDictFiles].sort());
});
