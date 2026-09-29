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
// COORDINACIÓN: la comprobación de versión y la escritura del registro
// se delegan ENTERAS a BusinessCardDO (env.BUSINESS_DO, un Durable
// Object por propietario — ver workers/business-do/src/
// business-card-do.js). Esta función solo autentica, valida el payload y
// reenvía; no toca KV directamente para el contenido de la tarjeta ni
// implementa ningún patrón de lectura/relectura/borrado propio — esa
// lógica vive una sola vez, dentro del Durable Object, donde la
// plataforma garantiza que como mucho una operación de este propietario
// se ejecuta a la vez.
import { authenticateOwner, validateBusinessPayload, jsonResponse } from '../_shared/business.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try { body = await request.json(); } catch (_) { return jsonResponse({ ok: false, error: 'payload_invalido' }, 400); }

  const { email, token } = body || {};
  const auth = await authenticateOwner(env, email, token);
  if (!auth.ok) return jsonResponse({ ok: false, error: 'no_autorizado' }, 401);
  if (!auth.esPago) return jsonResponse({ ok: false, error: 'plan_no_habilitado' }, 402);

  const validated = validateBusinessPayload(body);
  if (!validated.ok) return jsonResponse({ ok: false, error: validated.error }, 400);

  const origin = new URL(request.url).origin;
  const doId = env.BUSINESS_DO.idFromName(auth.emailKey);
  const stub = env.BUSINESS_DO.get(doId);
  const doRes = await stub.fetch('https://business-do/publish', {
    method: 'POST',
    body: JSON.stringify({ emailKey: auth.emailKey, data: validated.data, baseVersion: body.baseVersion, origin }),
  });
  const doData = await doRes.json();
  return jsonResponse(doData, doRes.status);
}

export async function onRequestGet() {
  return jsonResponse({ ok: false, error: 'metodo_no_permitido' }, 405);
}
