// Despublica la tarjeta Business del propietario autenticado. A propósito
// NO exige plan de pago vigente (a diferencia de business-publish.js /
// business-reactivate.js): el propietario debe poder retirar su tarjeta
// aunque ya no pague — ver instrucción "permite despublicar o eliminar
// aunque el propietario ya no pague". Conserva el registro y su id (no
// se borra), solo dejan de servirse desde functions/c/[id].js.
//
// La comprobación de `baseVersion` y la escritura ocurren dentro de
// BusinessCardDO (env.BUSINESS_DO) como una sola operación coordinada —
// ver business-publish.js y workers/business-do/src/business-card-do.js.
import { authenticateOwner, jsonResponse } from '../_shared/business.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try { body = await request.json(); } catch (_) { return jsonResponse({ ok: false, error: 'payload_invalido' }, 400); }

  const auth = await authenticateOwner(env, body?.email, body?.token);
  if (!auth.ok) return jsonResponse({ ok: false, error: 'no_autorizado' }, 401);

  const doId = env.BUSINESS_DO.idFromName(auth.emailKey);
  const stub = env.BUSINESS_DO.get(doId);
  const doRes = await stub.fetch('https://business-do/unpublish', {
    method: 'POST',
    body: JSON.stringify({ baseVersion: body.baseVersion }),
  });
  const doData = await doRes.json();
  return jsonResponse(doData, doRes.status);
}
