import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../growth-share.js', import.meta.url), 'utf8');
const PUBLIC_URL = 'https://www.identifly.app/';
const ids = ['btn-recommend', 'growth-share-fallback', 'growth-share-url', 'growth-share-status', 'growth-copy-link', 'growth-share-close'];

function fixture(options = {}) {
  let activeElement;
  let privateAccesses = 0;
  const elements = Object.fromEntries(ids.map(id => [id, {
    id, hidden: id === 'growth-share-fallback', textContent: '', value: '', disabled: false,
    attributes: {}, listeners: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
    addEventListener(type, handler) { this.listeners[type] = handler; },
    focus() { activeElement = this; },
    select() { this.selected = true; },
    setSelectionRange(start, end) { this.selection = [start, end]; },
    async fire(type = 'click', event = {}) { return this.listeners[type]?.(event); }
  }]));
  const document = {
    readyState: options.readyState || 'complete',
    getElementById: id => elements[id],
    addEventListener(type, handler) { this[type] = handler; }
  };
  if (options.execCommand) document.execCommand = options.execCommand;
  const window = { t: options.t || (key => 'translated:' + key) };
  const navigator = options.navigator || {};
  const context = { window, document, navigator };
  const forbidden = () => { privateAccesses++; throw new Error('Private application access'); };
  for (const target of [context, window]) {
    for (const key of ['localStorage', 'sessionStorage', 'indexedDB', 'location', 'profileData', 'fetch']) {
      Object.defineProperty(target, key, { get: forbidden });
    }
  }
  vm.runInNewContext(source, context);
  return { elements, document, window, get activeElement() { return activeElement; }, get privateAccesses() { return privateAccesses; } };
}

test('native recommendation contains only translated public content and the canonical URL', async () => {
  let payload;
  const f = fixture({ navigator: { share: async data => { payload = data; } } });
  await f.elements['btn-recommend'].fire();
  assert.deepEqual(JSON.parse(JSON.stringify(payload)), {
    title: 'translated:growth.share_title', text: 'translated:growth.share_text', url: PUBLIC_URL
  });
  assert.equal(new URL(payload.url).search, '');
  assert.equal(new URL(payload.url).hash, '');
  assert.equal(f.elements['growth-share-fallback'].hidden, true);
  assert.equal(f.privateAccesses, 0);
});

test('the native menu opens synchronously in the click gesture and concurrent clicks are ignored', async () => {
  let finish;
  let calls = 0;
  const f = fixture({ navigator: { share() { calls++; return new Promise(resolve => { finish = resolve; }); } } });
  const pending = f.elements['btn-recommend'].fire();
  assert.equal(calls, 1);
  await f.elements['btn-recommend'].fire();
  assert.equal(calls, 1);
  finish();
  await pending;
});

test('AbortError is a normal cancellation: no fallback, copying or error message', async () => {
  let copyCalls = 0;
  const f = fixture({ navigator: {
    share: async () => { throw { name: 'AbortError' }; },
    clipboard: { writeText: async () => { copyCalls++; } }
  } });
  await f.elements['btn-recommend'].fire();
  assert.equal(f.elements['growth-share-fallback'].hidden, true);
  assert.equal(f.elements['growth-share-status'].textContent, '');
  assert.equal(copyCalls, 0);
  assert.equal(f.privateAccesses, 0);
});

test('missing native sharing offers explicit copying without writing the clipboard automatically', async () => {
  const copied = [];
  const f = fixture({ navigator: { clipboard: { writeText: async value => { copied.push(value); } } } });
  await f.elements['btn-recommend'].fire();
  assert.equal(f.elements['growth-share-fallback'].hidden, false);
  assert.deepEqual(copied, []);
  assert.equal(f.elements['growth-share-url'].value, PUBLIC_URL);
  assert.equal(f.elements['btn-recommend'].attributes['aria-expanded'], 'true');
  await f.elements['growth-copy-link'].fire();
  assert.deepEqual(copied, [PUBLIC_URL]);
  assert.equal(f.elements['growth-share-status'].textContent, 'translated:growth.link_copied');
  assert.equal(f.elements['growth-copy-link'].disabled, false);
  assert.equal(f.privateAccesses, 0);
});

test('native sharing failure offers copying and a following click can reopen the menu', async () => {
  let calls = 0;
  const f = fixture({ navigator: { share: async () => { calls++; if (calls === 1) throw new Error('NotAllowed'); } } });
  await f.elements['btn-recommend'].fire();
  assert.equal(f.elements['growth-share-fallback'].hidden, false);
  await f.elements['btn-recommend'].fire();
  assert.equal(calls, 2);
  assert.equal(f.elements['growth-share-fallback'].hidden, true);
});

for (const mode of ['absent', 'rejected']) {
  test(`${mode} clipboard leaves a selectable public URL with translated manual instructions`, async () => {
    const navigator = mode === 'rejected' ? { clipboard: { writeText: async () => { throw new Error('Denied'); } } } : {};
    const f = fixture({ navigator });
    await f.elements['btn-recommend'].fire();
    await f.elements['growth-copy-link'].fire();
    assert.equal(f.elements['growth-share-fallback'].hidden, false);
    assert.equal(f.activeElement.id, 'growth-share-url');
    assert.equal(f.elements['growth-share-url'].selected, true);
    assert.deepEqual(f.elements['growth-share-url'].selection, [0, PUBLIC_URL.length]);
    assert.equal(f.elements['growth-share-status'].textContent, 'translated:growth.copy_manually');
    assert.equal(f.elements['growth-share-status'].attributes['data-i18n'], 'growth.copy_manually');
    assert.equal(f.privateAccesses, 0);
  });
}

test('legacy copy works when supported, without reporting success on a false result', async () => {
  let supported = true;
  const f = fixture({ execCommand: command => { assert.equal(command, 'copy'); return supported; } });
  await f.elements['btn-recommend'].fire();
  await f.elements['growth-copy-link'].fire();
  assert.equal(f.elements['growth-share-status'].textContent, 'translated:growth.link_copied');
  supported = false;
  await f.elements['growth-copy-link'].fire();
  assert.equal(f.elements['growth-share-status'].textContent, 'translated:growth.copy_manually');
});

test('close and Escape hide the copy panel and restore focus to its trigger', async () => {
  const f = fixture();
  await f.elements['btn-recommend'].fire();
  await f.elements['growth-share-close'].fire();
  assert.equal(f.elements['growth-share-fallback'].hidden, true);
  assert.equal(f.activeElement.id, 'btn-recommend');
  await f.elements['btn-recommend'].fire();
  let prevented = false;
  await f.elements['growth-share-fallback'].fire('keydown', { key: 'Escape', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(f.elements['growth-share-fallback'].hidden, true);
  assert.equal(f.elements['btn-recommend'].attributes['aria-expanded'], 'false');
  assert.equal(f.activeElement.id, 'btn-recommend');
});

test('translation is resolved for each action, including changes of language after startup', async () => {
  let payload;
  let language = 'es';
  const f = fixture({ t: key => language + ':' + key, navigator: { share: async data => { payload = data; } } });
  language = 'ja';
  await f.elements['btn-recommend'].fire();
  assert.equal(payload.text, 'ja:growth.share_text');
  assert.equal(payload.title, 'ja:growth.share_title');
});

test('deferred loading binds once the document has been parsed', async () => {
  const f = fixture({ readyState: 'loading' });
  assert.equal(f.elements['btn-recommend'].listeners.click, undefined);
  f.document.DOMContentLoaded();
  await f.elements['btn-recommend'].fire();
  assert.equal(f.elements['growth-share-fallback'].hidden, false);
});
