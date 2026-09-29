// Reactiva una tarjeta Business ya existente que estaba despublicada,
// reutilizando el mismo id/URL (ver instrucción "reactivar la misma
// tarjeta reutiliza esa dirección"). No modifica el contenido — para eso
// está business-publish.js. Exige plan de pago vigente: reactivar es una
// acción de publicación, igual que publicar por primera vez.
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
  if (!auth.esPago) return jsonResponse({ ok: false, error: 'plan_no_habilitado' }, 402);

  const origin = new URL(request.url).origin;
  const doId = env.BUSINESS_DO.idFromName(auth.emailKey);
  const stub = env.BUSINESS_DO.get(doId);
  const doRes = await stub.fetch('https://business-do/reactivate', {
    method: 'POST',
    body: JSON.stringify({ baseVersion: body.baseVersion, origin }),
  });
  const doData = await doRes.json();
  return jsonResponse(doData, doRes.status);
}
