// Publica o actualiza la tarjeta IDENTIFLY BUSINESS del propietario
// autenticado. Una única tarjeta Business por cuenta (ver instrucción:
// "para esta primera versión, utiliza una tarjeta Business por cuenta").
//
// Requiere SIEMPRE, verificado en servidor:
//   1. Identidad válida (email + token, mismo mecanismo que check-plan.js).
//   2. Plan de pago vigente ahora mismo (pro con periodo pagado vigente,
//      o lifetime), calculado en functions/_shared/plan-access.js — nunca
//      se confía en un plan enviado por el cliente.
// La propiedad se resuelve por email autenticado, nunca por un id que
// envíe el cliente: así una cuenta no puede publicar ni pisar la tarjeta
// de otra.
//
// El id de la tarjeta es DETERMINISTA (deriveBusinessId, ver
// functions/_shared/business.js) en vez de aleatorio: dos publicaciones
// "primera vez" concurrentes de la misma cuenta calculan siempre el
// mismo id y escriben el mismo registro KV — nunca pueden crear dos
// tarjetas ni dejar una huérfana. Esto sustituye al índice 'bizowner:'
// que usaba la versión anterior (ver deriveBusinessId para el porqué).
import {
  authenticateOwner, validateBusinessPayload, jsonResponse, deriveBusinessId,
} from '../_shared/business.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try { body = await request.json(); } catch (_) { return jsonResponse({ ok: false, error: 'payload_invalido' }, 400); }

  const { email, token } = body || {};
  const auth = await authenticateOwner(env, email, token);
  if (!auth.ok) return jsonResponse({ ok: false, error: 'no_autorizado' }, 401);
  if (!auth.esPago) return jsonResponse({ ok: false, error: 'plan_no_habilitado' }, 402);

  // Guarda mínimo entre publicaciones de la MISMA cuenta — no es un
  // limitador de tráfico general (este proyecto no tiene Durable Objects
  // ni reglas de rate limiting a nivel de borde configuradas; ver INFORME
  // de entrega). Con el id determinista ya NO hace falta para evitar
  // duplicados (eso lo garantiza deriveBusinessId): se conserva solo
  // como freno anti-abuso ante pulsaciones repetidas.
  const rateKey = 'bizrate:' + auth.emailKey;
  if (await env.BUSINESS_KV.get(rateKey)) {
    return jsonResponse({ ok: false, error: 'demasiadas_solicitudes' }, 429);
  }
  await env.BUSINESS_KV.put(rateKey, '1', { expirationTtl: 4 });

  const validated = validateBusinessPayload(body);
  if (!validated.ok) return jsonResponse({ ok: false, error: validated.error }, 400);

  let id;
  try { id = await deriveBusinessId(env, auth.emailKey); }
  catch (_) { return jsonResponse({ ok: false, error: 'configuracion_incompleta' }, 500); }

  const existingRaw = await env.BUSINESS_KV.get('biz:' + id);
  let existingRecord = null;
  if (existingRaw) { try { existingRecord = JSON.parse(existingRaw); } catch (_) {} }

  const nowIso = new Date().toISOString();
  const record = {
    ...validated.data,
    id,
    ownerEmailKey: auth.emailKey,
    published: true,
    createdAt: existingRecord?.createdAt || nowIso,
    publishedAt: existingRecord?.publishedAt || nowIso,
    updatedAt: nowIso,
  };

  // Única escritura de la operación: si falla (red, cuota, lo que sea),
  // la promesa rechaza, Pages Functions responde con un error y el
  // registro anterior en 'biz:'+id queda exactamente como estaba — KV no
  // hace escrituras parciales de un mismo valor. No hay un segundo paso
  // (como el índice 'bizowner:' de antes) que pudiera quedar
  // desincronizado si este `put` falla.
  await env.BUSINESS_KV.put('biz:' + id, JSON.stringify(record));

  const origin = new URL(request.url).origin;
  return jsonResponse({ ok: true, id, url: `${origin}/c/${id}`, publishedAt: record.publishedAt, updatedAt: record.updatedAt });
}

export async function onRequestGet() {
  return jsonResponse({ ok: false, error: 'metodo_no_permitido' }, 405);
}
