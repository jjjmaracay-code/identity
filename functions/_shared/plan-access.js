// Fuente única de verdad para "¿tiene esta cuenta acceso de pago vigente
// ahora mismo?". Antes de esta revisión, check-plan.js y
// functions/_shared/business.js calculaban esto cada uno por su cuenta,
// y ambos asumían PAID_PLANS.includes(plan) === acceso vigente — cierto
// para 'lifetime' (pago único, vitalicio de verdad) pero FALSO para
// 'pro' (suscripción mensual): stripe-webhook.js solo escuchaba
// checkout.session.completed, así que un Pro cancelado o impagado se
// quedaba con plan:'pro' en PLANS_KV para siempre, sin que nada
// reflejara la pérdida real del derecho de acceso. Ver stripe-webhook.js
// para el ciclo de vida completo que ahora alimenta currentPeriodEnd.
//
// Reglas de negocio (ver instrucción):
//   - 'lifetime' es vitalicio de verdad: nunca caduca, nunca se compara
//     con ninguna fecha.
//   - 'pro' es una suscripción: el acceso sigue vigente hasta el final
//     del periodo YA PAGADO (currentPeriodEnd), sin importar si el
//     propietario ya canceló la renovación (cancelAtPeriodEnd) — cancelar
//     la renovación futura no es lo mismo que terminar el periodo ya
//     pagado, y no debe retirar acceso antes de tiempo.
//   - Un registro 'pro' SIN currentPeriodEnd (creado por una versión
//     anterior de stripe-webhook.js, antes de que este archivo existiera)
//     se trata como vigente — no se penaliza retroactivamente a nadie que
//     ya pagara; el propio ciclo de Stripe (renovación o cancelación)
//     rellenará currentPeriodEnd la próxima vez que llegue un evento.
export const TRIAL_DAYS = 30;
export const PAID_PLANS = ['pro', 'lifetime'];

export function computePaidActive(paid) {
  if (!paid || !paid.plan) return false;
  if (paid.plan === 'lifetime') return true;
  if (paid.plan === 'pro') {
    if (!paid.currentPeriodEnd) return true; // legado, ver comentario de cabecera
    return Date.now() < new Date(paid.currentPeriodEnd).getTime();
  }
  return false;
}

// Devuelve null si el email no tiene registro (nunca se ha registrado en
// esta app) — igual que antes, eso es un "no existe", no un "free".
export async function getPlanStatus(env, emailKey) {
  const regRaw = await env.PLANS_KV.get('reg:' + emailKey);
  if (!regRaw) return null;

  let reg;
  try { reg = JSON.parse(regRaw); } catch (_) { return null; }

  const diasTranscurridos = Math.floor((Date.now() - new Date(reg.registeredAt).getTime()) / (1000 * 60 * 60 * 24));

  let paid = null;
  const paidRaw = await env.PLANS_KV.get(emailKey);
  if (paidRaw) {
    try { paid = JSON.parse(paidRaw); } catch (_) { paid = null; }
  }

  const plan = paid?.plan || 'free';
  const paidActive = computePaidActive(paid);
  const bloqueado = diasTranscurridos >= TRIAL_DAYS && !paidActive;

  return { reg, plan, paidActive, bloqueado, diasTranscurridos, paidRecord: paid, registeredAt: reg.registeredAt };
}
