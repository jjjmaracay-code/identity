import { checkoutEnabled } from '../_shared/checkout-policy.js';
// Verifica el plan/estado del trial de un usuario. Requiere el token
// opaco emitido en el registro (register-complete.js), o reclamado vía
// claim-token.js para cuentas registradas antes de que ese mecanismo
// existiera — nunca se puede consultar el plan de un email ajeno sin ese
// token. Toda respuesta de fallo usa el MISMO formato y status (200,
// {ok:false}), sea cual sea el motivo (email no existe, token
// incorrecto, token no asignado todavía) — así este endpoint no se puede
// usar para averiguar si un email está registrado. Es precisamente la
// vulnerabilidad de enumeración que tenía la versión anterior de este
// archivo (que por eso se había retirado dejándolo en 404 fijo).
//
// El cálculo de "¿sigue vigente el acceso de pago?" vive en
// functions/_shared/plan-access.js (getPlanStatus/computePaidActive) —
// antes vivía aquí duplicado, y asumía que cualquier plan 'pro' seguía
// vigente para siempre porque stripe-webhook.js no escuchaba la
// cancelación/impago de la suscripción. Ver ese archivo compartido y
// stripe-webhook.js para el detalle del ciclo de vida real.
import { TRIAL_DAYS, getPlanStatus } from '../_shared/plan-access.js';
import {
  recordDeviceSeen, isValidDeviceId, getDevicesList, findDevice, isDeviceActive,
  countActiveDevices, PLAN_DEVICE_LIMITS, getAccountDeviceLimit, isDeviceLimitEnforced, getOrSetDeviceLimitActivatedAt,
} from '../_shared/devices.js';

function genericReject() {
  return new Response(JSON.stringify({ ok: false }), {
    status: 200, headers: { 'Content-Type': 'application/json' }
  });
}

// Comparación en tiempo constante (mismo patrón que stripe-webhook.js) —
// evita que una diferencia de tiempo de respuesta filtre por cuántos
// caracteres iniciales coincide un token adivinado.
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let email, token, deviceId;
  try {
    ({ email, token, deviceId } = await request.json());
  } catch (_) {
    return genericReject();
  }
  if (!email || !token || typeof token !== 'string') return genericReject();

  const emailKey = email.toLowerCase();
  const regRaw = await env.PLANS_KV.get('reg:' + emailKey);
  if (!regRaw) return genericReject();

  let reg;
  try { reg = JSON.parse(regRaw); } catch (_) { return genericReject(); }
  if (!reg.token || !timingSafeEqual(reg.token, token)) return genericReject();

  // Token válido — a partir de aquí se calcula el estado del trial/plan
  // enteramente con datos del servidor (getPlanStatus vuelve a leer
  // PLANS_KV, es una segunda lectura barata que evita duplicar aquí su
  // lógica). Nunca se usa una fecha que venga del cliente.
  const status = await getPlanStatus(env, emailKey);
  if (!status) return genericReject(); // no debería pasar (ya comprobamos reg arriba), blindaje

  const diasRestantes = status.trialActive
    ? Math.max(0, Math.ceil((Date.parse(status.trialEndsAt) - Date.now()) / 86400000))
    : Math.max(0, TRIAL_DAYS - status.diasTranscurridos);
  const ua = request.headers.get('User-Agent');
  const deviceLimit = status.trialActive ? null : await getAccountDeviceLimit(emailKey, status.plan);
  const accountOverride = deviceLimit && deviceLimit !== PLAN_DEVICE_LIMITS[status.plan] ? { deviceLimit } : {};
  const respuestaNormal = () => new Response(JSON.stringify({
    ...accountOverride,
    checkoutEnabled: checkoutEnabled(env),
    ok: true, plan: status.plan, registeredAt: status.registeredAt,
    diasRestantes, bloqueado: status.bloqueado, cardTrialRequired: status.cardTrialRequired,
    trialEligible: status.trialEligible, trialActive: status.trialActive, trialEndsAt: status.trialEndsAt,
    cancelAtPeriodEnd: status.cancelAtPeriodEnd, hasSubscription: status.hasSubscription,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  // Sin deviceId (o inválido): nada que registrar ni que limitar -- se
  // comporta exactamente igual que antes de la fase 3.
  if (!isValidDeviceId(deviceId)) return respuestaNormal();

  const enforced = isDeviceLimitEnforced(env);
  const lista = await getDevicesList(env, emailKey);
  const existente = findDevice(lista, deviceId);

  if (existente) {
    if (!isDeviceActive(existente)) {
      // Dispositivo revocado por una transferencia real (ver
      // transfer-device.js). SOLO con el interruptor encendido se avisa
      // al cliente para que se borre él mismo (regla 7); apagado, se
      // trata como si no estuviera revocado -- regla 1, ningún bloqueo
      // nuevo sin el interruptor.
      if (enforced) {
        console.log('[device-limit] bloqueo real: device_revoked', JSON.stringify({ emailKey, deviceId }));
        return new Response(JSON.stringify({ ok: false, code: 'device_revoked' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      console.log('[device-limit] habria bloqueado (device_revoked), interruptor apagado', JSON.stringify({ emailKey, deviceId }));
      await recordDeviceSeen(env, emailKey, deviceId, ua);
      return respuestaNormal();
    }
    // Dispositivo activo ya conocido -- nunca lo afecta el límite, se vea
    // o no superado (regla 3): solo se refresca su lastSeen.
    await recordDeviceSeen(env, emailKey, deviceId, ua);
    return respuestaNormal();
  }

  // Dispositivo NUEVO (no está todavía en la lista) -- aquí sí se mira el
  // límite por plan (regla 2). Prueba/free: sin entrada en
  // PLAN_DEVICE_LIMITS, sin límite nuevo.
  const limite = deviceLimit;
  if (limite && countActiveDevices(lista) >= limite) {
    if (enforced) {
      await getOrSetDeviceLimitActivatedAt(env);
      console.log('[device-limit] bloqueo real: device_limit', JSON.stringify({ emailKey, plan: status.plan, activos: countActiveDevices(lista), limite }));
      return new Response(JSON.stringify({
        ok: false, code: 'device_limit', plan: status.plan, ...accountOverride,
        devices: lista.filter(isDeviceActive).map(d => ({ deviceId: d.deviceId, tipo: d.tipo, lastSeen: d.lastSeen })),
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    console.log('[device-limit] habria bloqueado (device_limit), interruptor apagado', JSON.stringify({ emailKey, plan: status.plan, activos: countActiveDevices(lista), limite }));
  }

  await recordDeviceSeen(env, emailKey, deviceId, ua);
  return respuestaNormal();
}

// Cualquier otro método también responde de forma genérica — no exponer
// nada distinto por usar GET u otro verbo.
export async function onRequestGet() {
  return genericReject();
}
