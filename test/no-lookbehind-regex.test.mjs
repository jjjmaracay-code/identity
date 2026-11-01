// Falla si vuelve a aparecer un lookbehind ((?<= o (?<!) en el código de
// cliente (lo que se sirve al navegador). Safari no lo soporta hasta la
// versión 16.4 -- en un motor que no lo soporta, el SyntaxError ocurre al
// COMPILAR el <script> entero, antes de ejecutar ninguna línea, así que
// ningún try/catch en tiempo de ejecución puede protegerlo (causa real de
// la pantalla en blanco en un iPhone 7 Plus con iOS 15.8.2, ver commit).
// No revisa comentarios con intención (ver LOOKBEHIND_PATTERN más abajo):
// solo el patrón "(?<=" o "(?<!" literal, que nunca debería aparecer de
// todos modos ni siquiera en un comentario del código de cliente.
//
// Ejecutar: node --test test/no-lookbehind-regex.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const LOOKBEHIND_PATTERN = /\(\?<[=!]/;

// Páginas y scripts que se sirven al navegador. functions/ (Cloudflare
// Pages Functions, servidor) y test/ (no se sirven nunca) quedan fuera a
// propósito -- ahí sí puede ejecutarse Node/V8, que soporta lookbehind.
const PAGINAS_CLIENTE = [
  'index.html', 'register.html', 'recovery.html', 'share.html',
  'install.html', 'paywall.html', 'demo.html', 'privacy.html', 'diag.html',
];

function listarJsRecursivo(dir) {
  let archivos = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = path.join(dir, nombre);
    const info = statSync(ruta);
    if (info.isDirectory()) {
      archivos = archivos.concat(listarJsRecursivo(ruta));
    } else if (nombre.endsWith('.js')) {
      archivos.push(ruta);
    }
  }
  return archivos;
}

function archivosClienteExistentes() {
  const archivos = [];
  for (const pagina of PAGINAS_CLIENTE) {
    const ruta = path.join(root, pagina);
    try {
      statSync(ruta);
      archivos.push(ruta);
    } catch {
      // Página opcional que no existe en este momento del repo: se ignora.
    }
  }
  // Todos los .js servidos directamente al cliente desde la raíz (igual
  // que los que aparecen sueltos en sw.js/CACHE_URLS), más i18n/loader.js
  // y todo vendor/ (librerías de terceros autohospedadas).
  archivos.push(...listarJsRecursivo(root).filter((ruta) => {
    const rel = path.relative(root, ruta).replace(/\\/g, '/');
    if (rel.startsWith('functions/') || rel.startsWith('test/') || rel.startsWith('scripts/')) return false;
    return !rel.includes('/'); // solo .js sueltos en la raíz
  }));
  archivos.push(path.join(root, 'i18n', 'loader.js'));
  archivos.push(...listarJsRecursivo(path.join(root, 'vendor')));
  return archivos;
}

test('ningún archivo de cliente contiene un lookbehind de expresión regular', () => {
  const archivos = archivosClienteExistentes();
  assert.ok(archivos.length > 10, 'la lista de archivos de cliente a revisar parece demasiado corta: ' + archivos.length);

  const encontrados = [];
  for (const ruta of archivos) {
    const contenido = readFileSync(ruta, 'utf8');
    const lineas = contenido.split('\n');
    lineas.forEach((linea, i) => {
      if (LOOKBEHIND_PATTERN.test(linea)) {
        encontrados.push(path.relative(root, ruta).replace(/\\/g, '/') + ':' + (i + 1) + ' -> ' + linea.trim());
      }
    });
  }

  assert.deepStrictEqual(
    encontrados,
    [],
    'Se encontró un lookbehind ((?<= o (?<!) en código de cliente -- Safari no lo soporta hasta la 16.4 y rompe TODO el <script> al compilar:\n' + encontrados.join('\n')
  );
});
