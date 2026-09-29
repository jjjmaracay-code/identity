// Devuelve al propietario autenticado el estado actual de SU tarjeta
// Business en el servidor: el registro completo (para poder recuperar la
// última versión publicada de forma explícita, ver instrucción) y el
// veredicto de plan/trial vigente (para que el editor pueda mostrar
// "Acceso de pago inactivo" sin otra llamada). No requiere plan de pago
// vigente: leer el propio estado siempre debe ser posible, incluso con el
// acceso caducado.
//
// La lectura se delega a BusinessCardDO (env.BUSINESS_DO) — el registro
// vive únicamente ahí, nunca duplicado en una clave KV aparte.
import { authenticateOwner, jsonResponse } from '../_shared/business.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try { body = await request.json(); } catch (_) { return jsonResponse({ ok: false, error: 'payload_invalido' }, 400); }

  const auth = await authenticateOwner(env, body?.email, body?.token);
  if (!auth.ok) return jsonResponse({ ok: false, error: 'no_autorizado' }, 401);

  const access = { plan: auth.plan, bloqueado: auth.bloqueado, esPago: auth.esPago };

  const origin = new URL(request.url).origin;
  const doId = env.BUSINESS_DO.idFromName(auth.emailKey);
  const stub = env.BUSINESS_DO.get(doId);
  const doRes = await stub.fetch('https://business-do/get');
  const doData = await doRes.json();

  if (!doData.ok) return jsonResponse({ ok: false, error: 'dato_corrupto' }, 500);
  if (!doData.exists) return jsonResponse({ ok: true, exists: false, access });

  const { ownerEmailKey, ...publicFields } = doData.record;
  return jsonResponse({ ok: true, exists: true, access, record: publicFields, url: `${origin}/c/${publicFields.id}` });
}
