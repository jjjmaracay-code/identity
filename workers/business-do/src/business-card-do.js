// Worker COMPAÑERO del proyecto Pages de IDENTIFLY — aloja el único
// Durable Object de Business: un coordinador por propietario
// (BusinessCardDO). Los Durable Objects de un proyecto Cloudflare Pages
// deben vivir en un Worker aparte, enlazado desde Pages mediante un
// binding entre scripts (ver wrangler.toml de este worker y el INFORME
// de entrega para los pasos de configuración de Preview/Producción).
//
// QUÉ PROTEGE REALMENTE LA PLATAFORMA (y qué no):
// Dentro de una MISMA instancia de Durable Object, las operaciones sobre
// this.state.storage están protegidas por las "input gates" de
// Cloudflare: mientras una petición tiene una operación de storage en
// vuelo, no se entrega una segunda petición a esa misma instancia. Eso
// basta para que dos llamadas a this.state.storage.get/put sobre la
// MISMA clave nunca se intercalen entre sí.
//
// Esa protección automática es específica de this.state.storage. NO se
// extiende a otras llamadas asíncronas dentro del mismo método -- en
// particular, escribir en env.BUSINESS_KV es una subpetición a un
// servicio externo (KV), no una operación de this.state.storage, así
// que un `await` sobre ella SÍ podría dejar pasar otra petición a esta
// instancia mientras está en curso. Por eso el bloque que lee el
// registro, decide el id/versión, escribe el registro Y escribe el
// índice público se envuelve entero en
// `this.state.blockConcurrencyWhile(...)`: es la API que Cloudflare
// documenta exactamente para esto -- impide que se entregue CUALQUIER
// otro evento a esta instancia mientras el callback está en curso,
// cubriendo también las llamadas que no son de storage. El alcance es
// deliberadamente estrecho (solo esta operación, nunca el constructor ni
// el camino de solo lectura /get) y solo envuelve una escritura a
// nuestro propio KV -- una llamada rápida y acotada, no una operación
// externa de duración impredecible -- para no bloquear la instancia de
// forma indiscriminada.
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

  // Reescribe el índice público id->propietario si no coincide con lo
  // esperado. Se llama SIEMPRE que hay un registro (en publish/
  // unpublish/reactivate/get), no solo la primera vez -- ver el punto 2
  // del informe: si la escritura del registro tuviera éxito pero esta
  // escritura en KV fallara (o si nunca se hubiera hecho, en un registro
  // creado por una versión anterior de este código), cualquier operación
  // posterior del propietario la repara sola, sin exigirle que vuelva a
  // publicar expresamente. Es idempotente: reescribir el mismo valor no
  // tiene coste funcional.
  //
  // LÍMITE DOCUMENTADO, no algo que este código pueda evitar: Cloudflare
  // KV es "eventually consistent" a nivel global -- una escritura puede
  // tardar hasta 60 segundos en propagarse a todas las ubicaciones de
  // borde. Justo después de crear una tarjeta (o de reparar su índice),
  // una visita a /c/{id} servida desde una ubicación de borde distinta a
  // la que procesó la escritura podría no ver el índice todavía y
  // mostrar "no disponible" durante ese margen. No es un fallo del
  // código: es una propiedad del propio servicio KV, inherente a
  // cualquier uso de KV como índice de lectura pública.
  async _repararIndice(record) {
    const actual = await this.env.BUSINESS_KV.get(PUBLIC_ID_INDEX_PREFIX + record.id);
    if (actual !== record.ownerEmailKey) {
      await this.env.BUSINESS_KV.put(PUBLIC_ID_INDEX_PREFIX + record.id, record.ownerEmailKey);
    }
  }

  // body: { emailKey, data (payload ya validado y saneado por
  // validateBusinessPayload en business-publish.js), baseVersion,
  // origin }.
  async publish(body) {
    return this.state.blockConcurrencyWhile(async () => {
      if (await this._dentroDeCooldownSinBloqueo()) {
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
      // Escritura de contenido: si esta llamada falla, el registro
      // anterior en el almacenamiento del Durable Object queda
      // exactamente como estaba (this.state.storage.put de una clave es
      // un reemplazo atómico de esa clave, nunca una escritura parcial).
      await this.state.storage.put('record', record);

      // Índice público -- SIEMPRE se (re)escribe, no solo la primera vez
      // (ver _repararIndice): si esta escritura concreta fallara aquí, el
      // registro ya quedó guardado con el MISMO id de siempre; un
      // reintento de publicar, o simplemente abrir el editor después
      // (que llama a /get), repara el índice sin perder el id ni crear
      // una tarjeta nueva.
      await this._repararIndice(record);

      return json({ ok: true, id, url: `${body.origin}/c/${id}`, publishedAt: record.publishedAt, updatedAt: record.updatedAt, version: record.version });
    });
  }

  // Variante sin blockConcurrencyWhile propio: se llama SOLO desde dentro
  // de publish(), que ya está envuelto en uno -- evitar anidar otro
  // blockConcurrencyWhile dentro del mismo callback.
  async _dentroDeCooldownSinBloqueo() {
    const last = await this.state.storage.get('lastPublishAt');
    const now = Date.now();
    if (typeof last === 'number' && now - last < 4000) return true;
    await this.state.storage.put('lastPublishAt', now);
    return false;
  }

  async unpublish(body) {
    return this.state.blockConcurrencyWhile(async () => {
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
    });
  }

  async reactivate(body) {
    return this.state.blockConcurrencyWhile(async () => {
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
      // Repara el índice también aquí, por si el propietario reactiva un
      // registro cuyo índice hubiera quedado sin escribir en su día.
      await this._repararIndice(existing);
      return json({ ok: true, id: existing.id, url: `${body.origin}/c/${existing.id}`, published: true, updatedAt: existing.updatedAt, version: existing.version });
    });
  }

  // Solo lectura: no necesita blockConcurrencyWhile (no decide nada a
  // partir de un estado que pudiera cambiar a medio camino), pero sí
  // repara el índice público si estuviera desincronizado -- así basta con
  // que el propietario abra su editor (que llama aquí) para sanar un
  // fallo parcial anterior, sin que tenga que volver a publicar.
  async get() {
    const existing = await this._record();
    if (!existing) return json({ ok: true, exists: false });
    await this._repararIndice(existing);
    return json({ ok: true, exists: true, record: existing });
  }
}

// Un Worker desplegable necesita un export default con fetch() aunque
// nunca se le llame directamente (todo el tráfico real llega al Durable
// Object a través del binding desde el proyecto Pages, nunca por una URL
// pública de este worker -- ver INFORME de entrega, punto 3). Se deja
// como no-op explícito, sin lógica de negocio duplicada aquí.
export default {
  async fetch() {
    return new Response('BusinessCardDO worker — no se sirve tráfico directo aquí.', { status: 404 });
  },
};
