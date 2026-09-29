// Despublica la tarjeta Business del propietario autenticado. A propósito
// NO exige plan de pago vigente (a diferencia de business-publish.js /
// business-reactivate.js): el propietario debe poder retirar su tarjeta
// aunque ya no pague — ver instrucción "permite despublicar o eliminar
// aunque el propietario ya no pague". Conserva el registro y su id (no
// se borra), solo dejan de servirse desde functions/c/[id].js.
//
// El id se busca vía el índice 'bizowner:'+emailKey (estable, sin
// depender de ningún secreto — ver functions/_shared/business.js).
//
// `baseVersion` opcional (mismo mecanismo que business-publish.js, ver
// ese archivo para el porqué de usar un token opaco y no `updatedAt`):
// si el cliente lo manda y no coincide con el `version` actual del
// registro, se rechaza con 409 en vez de aplicar a ciegas una acción
// basada en un estado que ya no es el vigente (por ejemplo, una
// despublicación en vuelo que llegase después de que el propietario ya
// hubiera vuelto a publicar cambios desde otra pestaña).
import { authenticateOwner, jsonResponse, OWNER_INDEX_PREFIX } from '../_shared/business.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try { body = await request.json(); } catch (_) { return jsonResponse({ ok: false, error: 'payload_invalido' }, 400); }

  const auth = await authenticateOwner(env, body?.email, body?.token);
  if (!auth.ok) return jsonResponse({ ok: false, error: 'no_autorizado' }, 401);

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

  record.published = false;
  record.updatedAt = new Date().toISOString();
  record.version = crypto.randomUUID();
  await env.BUSINESS_KV.put('biz:' + id, JSON.stringify(record));

  return jsonResponse({ ok: true, id, published: false, updatedAt: record.updatedAt, version: record.version });
}
