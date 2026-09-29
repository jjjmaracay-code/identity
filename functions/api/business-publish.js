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
// LÍMITE REAL DE ESTA IMPLEMENTACIÓN (documentado, no oculto): Cloudflare
// KV no ofrece ninguna operación "escribe solo si no existe" ni
// transacciones — no hay forma de obtener una garantía de coordinación
// distribuida real con solo KV. Lo que sigue es la alternativa mínima
// posible sin contratar Durable Objects/D1: para la PRIMERA publicación
// de una cuenta se escribe primero el registro y LUEGO se intenta
// reclamar el índice 'bizowner:'+emailKey; inmediatamente después se
// vuelve a leer ese índice. Si otra petición concurrente lo reclamó
// entre medias, esta petición pierde la carrera, borra el registro que
// acababa de crear (nunca queda una tarjeta huérfana) y responde con el
// id/URL de la que ganó — el cliente nunca ve dos tarjetas ni un id
// inválido. Esto cierra el caso de dos peticiones simultáneas de verdad
// (probado con Promise.all, ver INFORME de entrega), pero sigue
// existiendo una ventana en teoría bajo un número arbitrario de
// peticiones concurrentes exactamente en el mismo instante: no se
// presenta como una garantía formal de exclusión mutua, solo como una
// reducción práctica y verificada del riesgo. Cerrarla del todo
// requeriría un Durable Object (una sola instancia con ejecución
// serializada por cuenta) — no incluido aquí por instrucción expresa de
// no contratar/configurar recursos de producción en esta fase.
//
// ACTUALIZACIONES (cuenta que ya tiene tarjeta): se exige que el cliente
// mande `baseVersion` con el `version` que conocía antes de editar. Si
// el registro ya cambió en el servidor desde entonces (por ejemplo, el
// propietario lo despublicó en otra pestaña mientras esta petición
// seguía en vuelo), se rechaza con 409 en vez de resucitar a ciegas una
// tarjeta que el usuario acaba de despublicar. `version` es un token
// opaco (crypto.randomUUID, regenerado en cada escritura) en vez de
// comparar por `updatedAt`: dos escrituras que caen en el mismo
// milisegundo de reloj (perfectamente real bajo reintentos rápidos o
// pruebas automatizadas) producirían el mismo `updatedAt` y el chequeo
// se saltaría en falso — `version` nunca colisiona por esta vía. Un
// cliente que no mande `baseVersion` (compatibilidad con llamadas
// antiguas, o la primerísima publicación) no se bloquea por esto — ver
// instrucción de compatibilidad sin reescrituras automáticas.
import {
  authenticateOwner, validateBusinessPayload, jsonResponse, generateBusinessId, OWNER_INDEX_PREFIX,
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
  // de entrega). Reduce la probabilidad de la carrera de "primera
  // publicación" descrita arriba, pero no es lo que la evita — eso lo
  // hace la reconciliación tras escribir.
  const rateKey = 'bizrate:' + auth.emailKey;
  if (await env.BUSINESS_KV.get(rateKey)) {
    return jsonResponse({ ok: false, error: 'demasiadas_solicitudes' }, 429);
  }
  await env.BUSINESS_KV.put(rateKey, '1', { expirationTtl: 4 });

  const validated = validateBusinessPayload(body);
  if (!validated.ok) return jsonResponse({ ok: false, error: validated.error }, 400);

  const ownerKey = OWNER_INDEX_PREFIX + auth.emailKey;
  const existingId = await env.BUSINESS_KV.get(ownerKey);
  const nowIso = new Date().toISOString();

  if (existingId) {
    // Camino normal: actualizar la tarjeta ya existente de esta cuenta.
    const existingRaw = await env.BUSINESS_KV.get('biz:' + existingId);
    let existingRecord = null;
    if (existingRaw) { try { existingRecord = JSON.parse(existingRaw); } catch (_) {} }

    if (existingRecord && body.baseVersion && body.baseVersion !== existingRecord.version) {
      return jsonResponse({
        ok: false, error: 'conflicto_de_version',
        id: existingId, published: existingRecord.published, updatedAt: existingRecord.updatedAt, version: existingRecord.version,
      }, 409);
    }

    const record = {
      ...validated.data,
      id: existingId,
      ownerEmailKey: auth.emailKey,
      published: true,
      createdAt: existingRecord?.createdAt || nowIso,
      publishedAt: existingRecord?.publishedAt || nowIso,
      updatedAt: nowIso,
      version: crypto.randomUUID(),
    };
    // Única escritura de la operación: si falla, el registro anterior
    // queda exactamente como estaba (KV no hace escrituras parciales de
    // un mismo valor) y no se toca el índice de propietario.
    await env.BUSINESS_KV.put('biz:' + existingId, JSON.stringify(record));

    const origin = new URL(request.url).origin;
    return jsonResponse({ ok: true, id: existingId, url: `${origin}/c/${existingId}`, publishedAt: record.publishedAt, updatedAt: record.updatedAt, version: record.version });
  }

  // Primera publicación de esta cuenta — ver el límite documentado arriba.
  const candidateId = generateBusinessId();
  const record = {
    ...validated.data,
    id: candidateId,
    ownerEmailKey: auth.emailKey,
    published: true,
    createdAt: nowIso,
    publishedAt: nowIso,
    updatedAt: nowIso,
    version: crypto.randomUUID(),
  };
  await env.BUSINESS_KV.put('biz:' + candidateId, JSON.stringify(record));
  await env.BUSINESS_KV.put(ownerKey, candidateId);

  // Reconciliación: relee el índice para detectar si otra petición
  // concurrente lo reclamó también. Si el índice ya no coincide con nuestro
  // propio id, perdimos la carrera frente a esa otra petición — se borra
  // el registro que acabamos de crear (nunca queda huérfano) y se
  // responde con los datos reales de la tarjeta ganadora, para que este
  // cliente nunca reciba un id que luego no pueda gestionar.
  const confirmedId = await env.BUSINESS_KV.get(ownerKey);
  let finalId = candidateId;
  let finalRecord = record;
  if (confirmedId && confirmedId !== candidateId) {
    await env.BUSINESS_KV.delete('biz:' + candidateId);
    finalId = confirmedId;
    const winnerRaw = await env.BUSINESS_KV.get('biz:' + confirmedId);
    if (winnerRaw) { try { finalRecord = JSON.parse(winnerRaw); } catch (_) {} }
  }

  const origin = new URL(request.url).origin;
  return jsonResponse({ ok: true, id: finalId, url: `${origin}/c/${finalId}`, publishedAt: finalRecord.publishedAt, updatedAt: finalRecord.updatedAt, version: finalRecord.version });
}

export async function onRequestGet() {
  return jsonResponse({ ok: false, error: 'metodo_no_permitido' }, 405);
}
