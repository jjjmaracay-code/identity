// Solo los registros nuevos creados con STRIPE_CARD_TRIAL_ENABLED=true
// necesitan tarjeta. Las cuentas anteriores conservan su acceso.
export const cardTrialEnabled = env => env.STRIPE_CARD_TRIAL_ENABLED === 'true';
export const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
export async function readRecord(env, key) {
  const raw = await env.PLANS_KV.get(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
export async function accountId(token) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
export async function authenticateBilling(env, body) {
  if (typeof body?.email !== 'string' || typeof body?.token !== 'string' || !body.token) return null;
  const email = body.email.trim().toLowerCase();
  const reg = await readRecord(env, 'reg:' + email);
  if (typeof reg?.token !== 'string' || reg.token.length !== body.token.length) return null;
  let diff = 0;
  for (let i = 0; i < body.token.length; i++) diff |= reg.token.charCodeAt(i) ^ body.token.charCodeAt(i);
  return diff ? null : { email, reg };
}
export async function stripeRequest(env, path, params, idempotencyKey) {
  const headers = { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Stripe-Version': '2026-09-30.endive' };
  if (params) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await fetch('https://api.stripe.com/v1/' + path, {
    method: params ? 'POST' : 'GET', headers, body: params?.toString(),
  });
  const data = await res.json();
  if (!res.ok) {
    const error = new Error('stripe_unavailable');
    error.status = res.status; error.code = data.error?.type;
    throw error;
  }
  return data;
}
export const unixISO = value => typeof value === 'number' && Number.isFinite(value)
  ? new Date(value * 1000).toISOString() : null;
export function subscriptionRecord(sub, existing = {}) {
  return {
    ...existing, plan: 'pro', cardTrial: true, subscriptionId: sub.id,
    customerId: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id,
    status: sub.status, trialStart: unixISO(sub.trial_start), trialEnd: unixISO(sub.trial_end),
    currentPeriodEnd: unixISO(sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end),
    cancelAtPeriodEnd: !!sub.cancel_at_period_end, updatedAt: new Date().toISOString(),
  };
}
// Las fechas vienen de Stripe. La huella del token impide asociar eventos
// tardíos de una cuenta borrada a otra registrada después con el mismo email.
export async function syncCardSubscription(env, sub, extra = {}) {
  const email = sub.metadata?.email?.trim().toLowerCase();
  if (!email || !sub.metadata?.account_id) return null;
  const reg = await readRecord(env, 'reg:' + email);
  if (!reg?.token || sub.metadata.account_id !== await accountId(reg.token)) return null;
  const existing = await readRecord(env, email);
  if (existing?.plan === 'lifetime') return existing;
  if (existing?.subscriptionId && existing.subscriptionId !== sub.id
      && !['canceled', 'incomplete_expired'].includes(existing.status)) return null;
  const record = subscriptionRecord(sub, existing || {});
  if (extra.sessionId) record.sessionId = extra.sessionId;
  record.date ||= new Date().toISOString();
  record.lastEventCreated = Math.max(existing?.lastEventCreated || 0, extra.eventCreated || 0);
  if (extra.eventId) record.lastEventId = extra.eventId;
  await env.PLANS_KV.put('reg:' + email, JSON.stringify({
    registeredAt: reg.registeredAt, token: reg.token,
    cardTrialRequired: !!reg.cardTrialRequired,
    cardTrialUsed: !!reg.cardTrialUsed || sub.metadata.card_trial === 'true',
  }));
  await env.PLANS_KV.put(email, JSON.stringify(record));
  if (extra.sessionId) {
    const pending = await readRecord(env, 'checkout:' + email);
    if (pending?.sessionId === extra.sessionId) await env.PLANS_KV.delete('checkout:' + email);
  }
  return record;
}
// Cerrar Checkout antes de borrar la cuenta, también si el webhook aún no
// ha guardado la suscripción. Cualquier fallo conserva los datos para reintentar.
export async function closePendingCheckout(env, email) {
  const pending = await readRecord(env, 'checkout:' + email);
  if (!pending) return;
  let session;
  if (!pending.sessionId) {
    if (!pending.params || Date.now() - pending.createdAt > 23 * 3600 * 1000) throw new Error('checkout_pending');
    session = await stripeRequest(env, 'checkout/sessions', new URLSearchParams(pending.params), 'identifly-' + pending.attempt);
    if (!session.id) throw new Error('checkout_pending');
    await env.PLANS_KV.put('checkout:' + email, JSON.stringify({ ...pending, sessionId: session.id }));
  } else session = await stripeRequest(env, 'checkout/sessions/' + encodeURIComponent(pending.sessionId));
  if (session.status === 'open') {
    await stripeRequest(env, 'checkout/sessions/' + encodeURIComponent(session.id) + '/expire', new URLSearchParams());
  } else if (session.status === 'complete' && session.subscription) {
    const id = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
    const sub = await stripeRequest(env, 'subscriptions/' + encodeURIComponent(id));
    if (['canceled', 'incomplete_expired'].includes(sub.status)) return;
    const res = await fetch('https://api.stripe.com/v1/subscriptions/' + encodeURIComponent(id), {
      method: 'DELETE', headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Stripe-Version': '2026-09-30.endive' },
    });
    if (!res.ok && res.status !== 404) throw new Error('stripe_unavailable');
  } else if (session.status !== 'expired' && session.status !== 'complete') {
    throw new Error('checkout_pending');
  }
}
