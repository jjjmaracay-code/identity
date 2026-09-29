// Worker COMPAÑERO del proyecto Pages de IDENTIFLY — aloja el único
// Durable Object de Business: un coordinador por propietario
// (BusinessCardDO). Los Durable Objects de un proyecto Cloudflare Pages
// deben vivir en un Worker aparte, enlazado desde Pages mediante un
// binding entre scripts (ver wrangler.toml de este worker y el
// wrangler.toml preparado en la raíz del proyecto Pages, sección
// [[durable_objects.bindings]] con script_name). No se despliega en
// esta fase — ver INFORME de entrega para los pasos y qué falta
// verificar contra la documentación vigente de Cloudflare Pages antes
// de activarlo.
//
// GARANTÍA QUE RESUELVE (y que KV por sí solo no puede dar): Cloudflare
// ejecuta como mucho una invocación de fetch() de una MISMA instancia de
// Durable Object a la vez -- una segunda petición para el mismo
// propietario espera a que la primera termine (incluidos sus propios
// `await` internos) antes de empezar a ejecutarse. Esto convierte
// "leer, decidir, escribir" en una operación verdaderamente atómica sin
// necesidad de ningún patrón de lectura/relectura/borrado sobre KV.
import { generateBusinessId, PUBLIC_ID_INDEX_PREFIX } from '../../../functions/_shared/business.js';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

export class BusinessCardDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    let body = null;
    if (request.method === 'POST') {
      try { body = await request.json(); } catch (_) { return json({ ok: false, error: 'payload_invalido' }, 400); }
    }
    const { pathname } = new URL(request.url);
    switch (pathname) {
      case '/publish': return this.publish(body || {});
      case '/unpublish': return this.unpublish(body || {});
      case '/reactivate': return this.reactivate(body || {});
      case '/get': return this.get();
      default: return json({ ok: false, error: 'ruta_no_encontrada' }, 404);
    }
  }

  async _record() {
    return (await this.state.storage.get('record')) || null;
  }

  // Freno anti-abuso ante pulsaciones repetidas -- vive en el propio
  // almacenamiento del Durable Object (coordinado igual que el resto de
  // operaciones) en vez de una clave KV aparte, ver instrucción "todas
  // las mutaciones pasan por la misma coordinación".
  async _dentroDeCooldown() {
    const last = await this.state.storage.get('lastPublishAt');
    const now = Date.now();
    if (typeof last === 'number' && now - last < 4000) return true;
    await this.state.storage.put('lastPublishAt', now);
    return false;
  }

  // body: { emailKey, data (payload ya validado y saneado por
  // validateBusinessPayload en business-publish.js), baseVersion,
  // origin }. Este método entero se ejecuta como una sola operación
  // coordinada: leer el estado actual, decidir si hay conflicto de
  // versión, generar/reutilizar el id y escribir el registro nuevo,
  // todo sin que ninguna otra petición para este mismo propietario
  // pueda intercalarse en medio.
  async publish(body) {
    if (await this._dentroDeCooldown()) {
      return json({ ok: false, error: 'demasiadas_solicitudes' }, 429);
    }

    const existing = await this._record();
    if (existing && body.baseVersion && body.baseVersion !== existing.version) {
      return json({
        ok: false, error: 'conflicto_de_version',
        id: existing.id, published: existing.published, updatedAt: existing.updatedAt, version: existing.version,
      }, 409);
    }

    const nowIso = new Date().toISOString();
    const isFirstPublish = !existing;
    const id = existing?.id || generateBusinessId();
    const record = {
      ...body.data,
      id,
      ownerEmailKey: body.emailKey,
      published: true,
      createdAt: existing?.createdAt || nowIso,
      publishedAt: existing?.publishedAt || nowIso,
      updatedAt: nowIso,
      version: crypto.randomUUID(),
    };
    // Única escritura de contenido de esta operación: si falla, el
    // registro anterior en el almacenamiento del Durable Object queda
    // exactamente como estaba.
    await this.state.storage.put('record', record);

    // Índice público id->propietario: solo se escribe la primera vez
    // que este propietario genera un id (nunca cambia después) — no hay
    // ventana de carrera porque esta operación entera ya está
    // serializada por la plataforma.
    if (isFirstPublish) {
      await this.env.BUSINESS_KV.put(PUBLIC_ID_INDEX_PREFIX + id, body.emailKey);
    }

    return json({ ok: true, id, url: `${body.origin}/c/${id}`, publishedAt: record.publishedAt, updatedAt: record.updatedAt, version: record.version });
  }

  async unpublish(body) {
    const existing = await this._record();
    if (!existing) return json({ ok: false, error: 'sin_tarjeta' }, 404);
    if (body.baseVersion && body.baseVersion !== existing.version) {
      return json({
        ok: false, error: 'conflicto_de_version',
        id: existing.id, published: existing.published, updatedAt: existing.updatedAt, version: existing.version,
      }, 409);
    }
    existing.published = false;
    existing.updatedAt = new Date().toISOString();
    existing.version = crypto.randomUUID();
    await this.state.storage.put('record', existing);
    return json({ ok: true, id: existing.id, published: false, updatedAt: existing.updatedAt, version: existing.version });
  }

  async reactivate(body) {
    const existing = await this._record();
    if (!existing) return json({ ok: false, error: 'sin_tarjeta' }, 404);
    if (body.baseVersion && body.baseVersion !== existing.version) {
      return json({
        ok: false, error: 'conflicto_de_version',
        id: existing.id, published: existing.published, updatedAt: existing.updatedAt, version: existing.version,
      }, 409);
    }
    existing.published = true;
    existing.updatedAt = new Date().toISOString();
    existing.version = crypto.randomUUID();
    await this.state.storage.put('record', existing);
    return json({ ok: true, id: existing.id, url: `${body.origin}/c/${existing.id}`, published: true, updatedAt: existing.updatedAt, version: existing.version });
  }

  async get() {
    const existing = await this._record();
    if (!existing) return json({ ok: true, exists: false });
    return json({ ok: true, exists: true, record: existing });
  }
}

// Un Worker desplegable necesita un export default con fetch() aunque
// nunca se le llame directamente (todo el tráfico real llega al Durable
// Object a través del binding desde el proyecto Pages) -- se deja como
// no-op explícito, sin lógica de negocio duplicada aquí.
export default {
  async fetch() {
    return new Response('BusinessCardDO worker — no se sirve tráfico directo aquí.', { status: 404 });
  },
};
