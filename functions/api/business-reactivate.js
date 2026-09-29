// Reactiva una tarjeta Business ya existente que estaba despublicada,
// reutilizando el mismo id/URL (ver instrucción "reactivar la misma
// tarjeta reutiliza esa dirección") — el id se busca vía el índice
// 'bizowner:'+emailKey (estable, sin depender de ningún secreto). No
// modifica el contenido — para eso está business-publish.js. Exige plan
// de pago vigente: reactivar es una acción de publicación, igual que
// publicar por primera vez.
//
// `baseVersion` opcional: mismo mecanismo de business-publish.js/
// -unpublish.js (token opaco, no `updatedAt`) — evita reactivar a
// ciegas sobre un estado que ya cambió en el servidor.
import { authenticateOwner, jsonResponse, OWNER_INDEX_PREFIX } from '../_shared/business.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try { body = await request.json(); } catch (_) { return jsonResponse({ ok: false, error: 'payload_invalido' }, 400); }

  const auth = await authenticateOwner(env, body?.email, body?.token);
  if (!auth.ok) return jsonResponse({ ok: false, error: 'no_autorizado' }, 401);
  if (!auth.esPago) return jsonResponse({ ok: false, error: 'plan_no_habilitado' }, 402);

  const id = await env.BUSINESS_KV.get(OWNER_INDEX_PREFIX + auth.emailKey);
  if (!id) return jsonResponse({ ok: false, error: 'sin_tarjeta' }, 404);

  const raw = await env.BUSINESS_KV.get('biz:' + id);
  if (!raw) return jsonResponse({ ok: false, error: 'sin_tarjeta' }, 404);

  let record;
  try { record = JSON.parse(raw); } catch (_) { return jsonResponse({ ok: false, error: 'dato_corrupto' }, 500); }
  if (record.ownerEmailKey !== auth.emailKey) return jsonResponse({ ok: false, error: 'no_autorizado' }, 403);

  if (body.baseVersion && body.baseVersion !== record.version) {
    return jsonResponse({ ok: false, error: 'conflicto_de_version', id, published: record.published, updatedAt: record.updatedAt, version: record.version }, 409);
  }

  record.published = true;
  record.updatedAt = new Date().toISOString();
  record.version = crypto.randomUUID();
  await env.BUSINESS_KV.put('biz:' + id, JSON.stringify(record));

  const origin = new URL(request.url).origin;
  return jsonResponse({ ok: true, id, url: `${origin}/c/${id}`, published: true, updatedAt: record.updatedAt, version: record.version });
}
