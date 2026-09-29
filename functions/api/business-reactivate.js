// Reactiva una tarjeta Business ya existente que estaba despublicada,
// reutilizando el mismo id/URL (ver instrucción "reactivar la misma
// tarjeta reutiliza esa dirección"). No modifica el contenido — para eso
// está business-publish.js. Exige plan de pago vigente: reactivar es una
// acción de publicación, igual que publicar por primera vez.
import { authenticateOwner, jsonResponse } from '../_shared/business.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try { body = await request.json(); } catch (_) { return jsonResponse({ ok: false, error: 'payload_invalido' }, 400); }

  const auth = await authenticateOwner(env, body?.email, body?.token);
  if (!auth.ok) return jsonResponse({ ok: false, error: 'no_autorizado' }, 401);
  if (!auth.esPago) return jsonResponse({ ok: false, error: 'plan_no_habilitado' }, 402);

  const ownerKey = 'bizowner:' + auth.emailKey;
  const id = await env.BUSINESS_KV.get(ownerKey);
  if (!id) return jsonResponse({ ok: false, error: 'sin_tarjeta' }, 404);

  const raw = await env.BUSINESS_KV.get('biz:' + id);
  if (!raw) return jsonResponse({ ok: false, error: 'sin_tarjeta' }, 404);

  let record;
  try { record = JSON.parse(raw); } catch (_) { return jsonResponse({ ok: false, error: 'dato_corrupto' }, 500); }
  if (record.ownerEmailKey !== auth.emailKey) return jsonResponse({ ok: false, error: 'no_autorizado' }, 403);

  record.published = true;
  record.updatedAt = new Date().toISOString();
  await env.BUSINESS_KV.put('biz:' + id, JSON.stringify(record));

  const origin = new URL(request.url).origin;
  return jsonResponse({ ok: true, id, url: `${origin}/c/${id}`, published: true });
}
