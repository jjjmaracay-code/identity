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

  let email, token;
  try {
    ({ email, token } = await request.json());
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

  const diasRestantes = Math.max(0, TRIAL_DAYS - status.diasTranscurridos);

  return new Response(JSON.stringify({
    ok: true, plan: status.plan, registeredAt: status.registeredAt,
    diasRestantes, bloqueado: status.bloqueado,
  }), {
    status: 200, headers: { 'Content-Type': 'application/json' }
  });
}

// Cualquier otro método también responde de forma genérica — no exponer
// nada distinto por usar GET u otro verbo.
export async function onRequestGet() {
  return genericReject();
}
