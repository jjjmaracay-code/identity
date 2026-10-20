import { authenticateBilling, stripeRequest, syncCardSubscription, jsonResponse } from '../_shared/card-trial.js';
import { computePaidActive } from '../_shared/plan-access.js';
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('session_id');

  if (!sessionId || !/^cs_[a-zA-Z0-9_]+$/.test(sessionId)) {
    return new Response(JSON.stringify({ error: 'Falta session_id' }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    });
  }

  const stripeRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
    headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`, 'Stripe-Version': '2026-09-30.endive' }
  });

  const session = await stripeRes.json();

  if (!stripeRes.ok || session.payment_status !== 'paid') {
    return new Response(JSON.stringify({ paid: false }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({ paid: true, plan: session.metadata?.plan }), {
    status: 200, headers: { 'Content-Type': 'application/json' }
  });
}


export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const account = await authenticateBilling(env, body);
    if (!account) return jsonResponse({ error: 'no_verificado' }, 401);
    if (typeof body.sessionId !== 'string' || !/^cs_[a-zA-Z0-9_]+$/.test(body.sessionId)) return jsonResponse({ error: 'invalid_session' }, 400);
    const session = await stripeRequest(env, 'checkout/sessions/' + body.sessionId);
    if ((session.metadata?.account_email || session.client_reference_id)?.toLowerCase() !== account.email) {
      return jsonResponse({ error: 'no_verificado' }, 401);
    }
    if (session.status !== 'complete') return jsonResponse({ active: false });
    if (session.subscription && session.metadata?.account_id) {
      const sub = await stripeRequest(env, 'subscriptions/' + encodeURIComponent(session.subscription));
      const paid = await syncCardSubscription(env, sub, { sessionId: session.id });
      return jsonResponse({ active: computePaidActive(paid), trial: paid?.status === 'trialing' });
    }
    return jsonResponse({ active: session.payment_status === 'paid' });
  } catch { return jsonResponse({ error: 'payment_unavailable' }, 503); }
}
