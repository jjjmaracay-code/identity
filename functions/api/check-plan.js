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
const TRIAL_DAYS = 30;
const PAID_PLANS = ['pro', 'lifetime'];

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

  // Token válido — a partir de aquí se calcula el estado del trial
  // enteramente con datos del servidor. Nunca se usa una fecha que venga
  // del cliente.
  const registeredAt = reg.registeredAt;
  const diasTranscurridos = Math.floor((Date.now() - new Date(registeredAt).getTime()) / (1000 * 60 * 60 * 24));
  const diasRestantes = Math.max(0, TRIAL_DAYS - diasTranscurridos);

  // El plan pagado vive en una clave sin prefijo (la escribe
  // stripe-webhook.js tras un pago confirmado). Si no hay registro ahí,
  // el usuario sigue en 'free' — una elección legítima que ya no lo
  // exime de la expiración del trial (ver goFree() en paywall.html).
  let plan = 'free';
  const paidRaw = await env.PLANS_KV.get(emailKey);
  if (paidRaw) {
    try {
      const paid = JSON.parse(paidRaw);
      if (paid?.plan) plan = paid.plan;
    } catch (_) {}
  }

  const bloqueado = diasTranscurridos >= TRIAL_DAYS && !PAID_PLANS.includes(plan);

  return new Response(JSON.stringify({ ok: true, plan, registeredAt, diasRestantes, bloqueado }), {
    status: 200, headers: { 'Content-Type': 'application/json' }
  });
}

// Cualquier otro método también responde de forma genérica — no exponer
// nada distinto por usar GET u otro verbo.
export async function onRequestGet() {
  return genericReject();
}
