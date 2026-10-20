import { authenticateBilling, readRecord, stripeRequest, syncCardSubscription, jsonResponse, unixISO } from '../_shared/card-trial.js';

export async function onRequestPost({ request, env }) {
  try {
    const account = await authenticateBilling(env, await request.json());
    if (!account) return jsonResponse({ error: 'no_verificado' }, 401);
    const paid = await readRecord(env, account.email);
    if (paid?.plan !== 'pro' || !paid.subscriptionId) return jsonResponse({ error: 'no_subscription' }, 409);
    const id = encodeURIComponent(paid.subscriptionId);
    let sub = await stripeRequest(env, 'subscriptions/' + id);
    const ended = ['canceled', 'incomplete_expired'].includes(sub.status);
    if (!ended && !sub.cancel_at_period_end) {
      sub = await stripeRequest(env, 'subscriptions/' + id, new URLSearchParams({ cancel_at_period_end: 'true' }));
    }
    if (!ended && !sub.cancel_at_period_end) throw new Error('cancellation_unconfirmed');
    if (paid.cardTrial) await syncCardSubscription(env, sub);
    else await env.PLANS_KV.put(account.email, JSON.stringify({
      ...paid, status: sub.status, cancelAtPeriodEnd: !!sub.cancel_at_period_end,
      currentPeriodEnd: unixISO(sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end) || paid.currentPeriodEnd,
      updatedAt: new Date().toISOString(),
    }));
    return jsonResponse({ ok: true, cancelAtPeriodEnd: !ended, ended });
  } catch {
    return jsonResponse({ error: 'cancellation_unconfirmed' }, 503);
  }
}
