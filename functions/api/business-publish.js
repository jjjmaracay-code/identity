// Publica o actualiza la tarjeta IDENTIFLY BUSINESS del propietario
// autenticado. Una única tarjeta Business por cuenta (ver instrucción:
// "para esta primera versión, utiliza una tarjeta Business por cuenta").
//
// Requiere SIEMPRE, verificado en servidor:
//   1. Identidad válida (email + token, mismo mecanismo que check-plan.js).
//   2. Plan de pago vigente (pro/lifetime, sin bloqueo de trial) — igual
//      que el resto de la app, nunca se confía en un plan enviado por el
//      cliente.
// La propiedad se resuelve por email autenticado, nunca por un id que
// envíe el cliente: así una cuenta no puede publicar ni pisar la tarjeta
// de otra.
import {
  authenticateOwner, validateBusinessPayload, jsonResponse, generateBusinessId,
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
  // de entrega), solo evita que un doble toque/reintento inmediato cree
  // dos tarjetas distintas en la primera publicación.
  const rateKey = 'bizrate:' + auth.emailKey;
  if (await env.BUSINESS_KV.get(rateKey)) {
    return jsonResponse({ ok: false, error: 'demasiadas_solicitudes' }, 429);
  }
  await env.BUSINESS_KV.put(rateKey, '1', { expirationTtl: 4 });

  const validated = validateBusinessPayload(body);
  if (!validated.ok) return jsonResponse({ ok: false, error: validated.error }, 400);

  const ownerKey = 'bizowner:' + auth.emailKey;
  const existingId = await env.BUSINESS_KV.get(ownerKey);
  let existingRecord = null;
  if (existingId) {
    const raw = await env.BUSINESS_KV.get('biz:' + existingId);
    if (raw) { try { existingRecord = JSON.parse(raw); } catch (_) {} }
  }

  const id = existingId || generateBusinessId();
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

  // Si falla la escritura del registro, no se toca el índice de
  // propietario — evita dejar bizowner apuntando a un id sin datos
  // (estado parcial). Al escribir primero el registro y solo después el
  // índice, un fallo entre medias deja como mucho un registro huérfano
  // (nunca uno roto referenciado desde el índice).
  await env.BUSINESS_KV.put('biz:' + id, JSON.stringify(record));
  if (!existingId) await env.BUSINESS_KV.put(ownerKey, id);

  const origin = new URL(request.url).origin;
  return jsonResponse({ ok: true, id, url: `${origin}/c/${id}`, publishedAt: record.publishedAt, updatedAt: record.updatedAt });
}

export async function onRequestGet() {
  return jsonResponse({ ok: false, error: 'metodo_no_permitido' }, 405);
}
