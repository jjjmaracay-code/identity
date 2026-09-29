// Despublica la tarjeta Business del propietario autenticado. A propósito
// NO exige plan de pago vigente (a diferencia de business-publish.js /
// business-reactivate.js): el propietario debe poder retirar su tarjeta
// aunque ya no pague — ver instrucción "permite despublicar o eliminar
// aunque el propietario ya no pague". Conserva el registro y su id (no
// se borra), solo dejan de servirse desde functions/c/[id].js.
//
// El id se deriva (deriveBusinessId), no se busca en un índice — ver
// functions/_shared/business.js para el porqué.
import { authenticateOwner, deriveBusinessId, jsonResponse } from '../_shared/business.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try { body = await request.json(); } catch (_) { return jsonResponse({ ok: false, error: 'payload_invalido' }, 400); }

  const auth = await authenticateOwner(env, body?.email, body?.token);
  if (!auth.ok) return jsonResponse({ ok: false, error: 'no_autorizado' }, 401);

  let id;
  try { id = await deriveBusinessId(env, auth.emailKey); }
  catch (_) { return jsonResponse({ ok: false, error: 'configuracion_incompleta' }, 500); }

  const raw = await env.BUSINESS_KV.get('biz:' + id);
  if (!raw) return jsonResponse({ ok: false, error: 'sin_tarjeta' }, 404);

  let record;
  try { record = JSON.parse(raw); } catch (_) { return jsonResponse({ ok: false, error: 'dato_corrupto' }, 500); }
  if (record.ownerEmailKey !== auth.emailKey) return jsonResponse({ ok: false, error: 'no_autorizado' }, 403);

  record.published = false;
  record.updatedAt = new Date().toISOString();
  await env.BUSINESS_KV.put('biz:' + id, JSON.stringify(record));

  return jsonResponse({ ok: true, id, published: false });
}
