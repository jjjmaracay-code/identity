import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import vm from 'node:vm';

const read = promisify(readFile);
const root = new URL('../', import.meta.url);
const source = path => readFileSync(new URL(path, root), 'utf8');

test('el generador QR real admite el contacto ficticio en los doce idiomas', async () => {
  function element() {
    return {
      children: [], attributes: {}, style: {},
      setAttribute(name, value) { this.attributes[name] = value; },
      setAttributeNS(ns, name, value) { this.attributes[name] = value; },
      appendChild(node) { this.children.push(node); },
      hasChildNodes() { return this.children.length > 0; },
      get lastChild() { return this.children.at(-1); },
      removeChild(node) { this.children.splice(this.children.indexOf(node), 1); }
    };
  }
  const context = {
    document: { createElementNS: element },
    navigator: { userAgent: 'Node automated QR test' }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source('vendor/qr-code-styling/qr-code-styling.js'), context);
  vm.runInContext(source('vcard.js'), context);
  for (const lang of ['es', 'ca', 'eu', 'gl', 'en', 'fr', 'de', 'pt', 'hi', 'zh', 'ru', 'ja', 'ar']) {
    const dict = JSON.parse(source('i18n/' + lang + '.json'));
    const text = context.buildVCardFromProfile({
      name: 'Alex Demo', job: dict['growth.demo_role'], company: dict['growth.demo_company'], email: 'alex.demo@example.com'
    });
    const target = element();
    let qr;
    try {
      qr = new context.QRCodeStyling({ type: 'svg', data: text, width: 220, height: 220, margin: 20, qrOptions: { errorCorrectionLevel: 'M' } });
      qr.append(target);
      await qr._svgDrawingPromise;
    } catch (error) {
      throw new Error('QR ' + lang + ': ' + error.message, { cause: error });
    }
    assert.ok(qr._qr.getModuleCount() >= 21, lang);
    assert.equal(target.children.length, 1, lang);
    const countNodes = node => 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
    assert.ok(countNodes(target) > 100, lang);
    assert.equal(qr._options.data, text, lang);
  }
});

test('HTTP local: el precache completo carga y sirve la demo y sus recursos cuando se corta la red', async () => {
  const server = createServer(async (req, res) => {
    try {
      let path = new URL(req.url, 'http://localhost').pathname;
      if (path === '/') path = '/index.html';
      else if (!path.split('/').at(-1).includes('.')) path += '.html';
      const data = await read(new URL('.' + path, root));
      res.writeHead(200, { 'Content-Type': path.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = 'http://127.0.0.1:' + server.address().port;
    const listeners = {}, entries = new Map();
    const key = value => new URL(typeof value === 'string' ? value : value.url, origin).href;
    const cache = { async put(request, response) { entries.set(key(request), response.clone()); } };
    let offline = false;
    let fetched = 0;
    const context = {
      self: { location: { origin }, addEventListener(name, fn) { listeners[name] = fn; }, skipWaiting() {} },
      URL, Response, setTimeout, clearTimeout,
      Request: class extends Request {
        constructor(input, init) {
          super(input instanceof Request ? input : new URL(typeof input === 'string' ? input : input.url, origin), init);
        }
      },
      caches: {
        async open(name) { assert.equal(name, 'identity-v60'); return cache; },
        async match(request, options = {}) {
          const url = key(request);
          for (const [stored, response] of entries) {
            if (stored === url || (options.ignoreSearch && stored.split('?')[0] === url.split('?')[0])) return response.clone();
          }
        }
      },
      fetch: async (request, init) => {
        if (offline) throw new Error('Red desconectada');
        fetched++;
        return fetch(request, init);
      }
    };
    vm.createContext(context);
    vm.runInContext(source('sw.js'), context);
    let installing;
    listeners.install({ waitUntil(promise) { installing = promise; } });
    await installing;
    assert.ok(fetched > 30);
    const fetchedBeforeOffline = fetched;
    offline = true;
    async function cached(path, mode = 'cors') {
      let response;
      listeners.fetch({
        request: { url: origin + path, method: 'GET', mode },
        respondWith(value) { response = value; }, waitUntil() {}
      });
      assert.ok(response, path);
      const result = await response;
      assert.equal(result.status, 200, path);
      return result.text();
    }
    const html = await cached('/demo.html', 'navigate');
    assert.match(html, /data-i18n-isolated/);
    assert.match(html, /id="demo-email" dir="ltr"/);
    assert.equal(html, source('demo.html'));
    for (const path of ['/demo.js', '/public-card.css', '/growth.css', '/growth-share.js', '/vcard.js', '/vendor/qr-code-styling/qr-code-styling.js', '/i18n/loader.js']) {
      assert.equal(await cached(path), source(path.slice(1)), path);
    }
    for (const lang of ['es', 'ca', 'eu', 'gl', 'en', 'fr', 'de', 'pt', 'hi', 'zh', 'ru', 'ja', 'ar']) {
      assert.equal(await cached('/i18n/' + lang + '.json'), source('i18n/' + lang + '.json'));
    }
    assert.equal(fetched, fetchedBeforeOffline);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
