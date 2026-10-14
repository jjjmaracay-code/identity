import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BusinessCardDO } from '../functions/_do-companion/business-card-do.js';

// Simula this.state.storage (get/put/deleteAll) -- lo mínimo que usa
// BusinessCardDO, no el SDK real de Durable Objects.
class FakeStorage {
  constructor() { this.map = new Map(); }
  async get(key) { return this.map.has(key) ? this.map.get(key) : undefined; }
  async put(key, value) { this.map.set(key, value); }
  async deleteAll() { this.map.clear(); }
}

// blockConcurrencyWhile real solo serializa frente a OTRAS peticiones a
// la misma instancia -- en un test secuencial de una sola instancia basta
// con ejecutar el callback directamente.
class FakeState {
  constructor() { this.storage = new FakeStorage(); }
  async blockConcurrencyWhile(fn) { return fn(); }
}

class FakeBusinessKV {
  constructor() { this.map = new Map(); }
  async get(key) { return this.map.has(key) ? this.map.get(key) : null; }
  async put(key, value) { this.map.set(key, value); }
  async delete(key) { this.map.delete(key); }
}

function makeDO() {
  const state = new FakeState();
  const env = { BUSINESS_KV: new FakeBusinessKV() };
  return { state, env, instance: new BusinessCardDO(state, env) };
}

async function readJson(res) { return res.json(); }

test('publicar y luego borrar: elimina el índice bizid y vacía el storage', async () => {
  const { state, env, instance } = makeDO();

  const publishRes = await instance.publish({
    emailKey: 'negocio@example.com',
    data: { name: 'Mi Negocio' },
    origin: 'https://example.com',
  });
  const publishData = await readJson(publishRes);
  assert.equal(publishData.ok, true);
  const id = publishData.id;

  assert.equal(await env.BUSINESS_KV.get('bizid:' + id), 'negocio@example.com');
  assert.ok(await state.storage.get('record'));

  const deleteRes = await instance.delete();
  const deleteData = await readJson(deleteRes);
  assert.equal(deleteData.ok, true);

  assert.equal(await env.BUSINESS_KV.get('bizid:' + id), null, 'el índice público debió borrarse');
  assert.equal(await state.storage.get('record'), undefined, 'el contenido de la tarjeta debió borrarse');
});

test('borrar sin haber publicado nunca es un no-op idempotente', async () => {
  const { env, instance } = makeDO();

  const res = await instance.delete();
  const data = await readJson(res);

  assert.equal(data.ok, true);
  assert.equal(env.BUSINESS_KV.map.size, 0, 'no debió escribir ni borrar nada en BUSINESS_KV');
});

test('borrar dos veces seguidas sigue respondiendo ok (idempotente)', async () => {
  const { instance } = makeDO();

  await instance.publish({ emailKey: 'doble@example.com', data: { name: 'X' }, origin: 'https://example.com' });

  const primero = await readJson(await instance.delete());
  const segundo = await readJson(await instance.delete());

  assert.equal(primero.ok, true);
  assert.equal(segundo.ok, true);
});

test('la ruta /delete del fetch() del DO llama a instance.delete()', async () => {
  const { state, env, instance } = makeDO();
  await instance.publish({ emailKey: 'ruta@example.com', data: { name: 'Y' }, origin: 'https://example.com' });

  const res = await instance.fetch(new Request('https://business-do/delete', { method: 'POST', body: '{}' }));
  const data = await readJson(res);

  assert.equal(data.ok, true);
  assert.equal(await state.storage.get('record'), undefined);
});
