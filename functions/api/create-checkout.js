import { authenticateBilling, readRecord, accountId, stripeRequest, jsonResponse } from '../_shared/card-trial.js';
import { computePaidActive } from '../_shared/plan-access.js';

export async function onRequestPost({ request, env }) {
  let checkoutEmail;
  try {
    const body = await request.json();
    const account = await authenticateBilling(env, body);
    if (!account) return jsonResponse({ error: 'no_verificado' }, 401);
    const { email, reg } = account;
    checkoutEmail = email;
    const { plan, waiverAccepted } = body;
    if (waiverAccepted !== true) return jsonResponse({ error: 'waiver_not_accepted' }, 400);
    const price = plan === 'pro' ? env.STRIPE_PRICE_PRO : plan === 'lifetime' ? env.STRIPE_PRICE_LIFETIME : null;
    if (!price) return jsonResponse({ error: 'invalid_plan' }, 400);
    const paid = await readRecord(env, email);
    if (computePaidActive(paid)) return jsonResponse({ error: 'plan_already_active' }, 409);
    if (paid?.subscriptionId) {
      const oldSub = await stripeRequest(env, 'subscriptions/' + encodeURIComponent(paid.subscriptionId));
      if (!['canceled', 'incomplete_expired'].includes(oldSub.status)) return jsonResponse({ error: 'plan_already_active' }, 409);
      await env.PLANS_KV.put(email, JSON.stringify({ ...paid, status: oldSub.status }));
    }
    const trial = plan === 'pro' && reg.cardTrialRequired === true && !reg.cardTrialUsed && !paid;
    if (!trial && body.trialAccepted === true) return jsonResponse({ error: 'trial_unavailable' }, 409);
    if (trial && body.trialAccepted !== true) return jsonResponse({ error: 'trial_not_accepted' }, 400);

    let pending = await readRecord(env, 'checkout:' + email);
    let previous = paid?.sessionId || '';
    if (pending?.sessionId) {
      const old = await stripeRequest(env, 'checkout/sessions/' + encodeURIComponent(pending.sessionId));
      if (old.status === 'complete') return jsonResponse({ error: 'activation_pending' }, 409);
      if (old.status === 'open' && pending.plan === plan) return jsonResponse({ url: old.url });
      if (old.status === 'open') {
        await stripeRequest(env, 'checkout/sessions/' + encodeURIComponent(old.id) + '/expire', new URLSearchParams());
      } else if (old.status !== 'expired') throw new Error('stripe_unavailable');
      previous = old.id;
      pending = null;
    }
    if (pending && pending.plan !== plan) return jsonResponse({ error: 'activation_pending' }, 409);
    if (pending && Date.now() - pending.createdAt > 23 * 3600 * 1000) {
      return jsonResponse({ error: 'activation_pending' }, 409);
    }
    const origin = new URL(request.url).origin;
    const identity = await accountId(reg.token);
    const attempt = pending?.attempt || await accountId(identity + ':' + origin + ':' + previous);
    const params = new URLSearchParams({
      mode: plan === 'pro' ? 'subscription' : 'payment',
      integration_identifier: 'identifly-fase6-kqzwrpma',
      'line_items[0][price]': price, 'line_items[0][quantity]': '1',
      customer_email: email, 'allowed_payment_method_types[0]': 'card', client_reference_id: email,
      success_url: `${origin}/paywall.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/paywall.html`,
      'metadata[plan]': plan, 'metadata[email]': email, 'metadata[account_email]': email,
      'metadata[account_id]': identity, 'metadata[waiver_accepted]': 'true',
    });
    if (plan === 'pro') {
      params.set('subscription_data[metadata][email]', email);
      params.set('subscription_data[metadata][account_id]', identity);
    }
    if (trial) {
      params.set('payment_method_collection', 'always');
      params.set('subscription_data[trial_period_days]', '30');
      params.set('subscription_data[trial_settings][end_behavior][missing_payment_method]', 'cancel');
      params.set('subscription_data[metadata][card_trial]', 'true');
      params.set('metadata[card_trial]', 'true');
      params.set('metadata[trial_accepted]', 'true');
    }
    await env.PLANS_KV.put('checkout:' + email, JSON.stringify({
      attempt, createdAt: pending?.createdAt || Date.now(), plan, params: params.toString(),
    }));
    const session = await stripeRequest(env, 'checkout/sessions', params, 'identifly-' + attempt);
    if (!session.id || !session.url) throw new Error('stripe_unavailable');
    await env.PLANS_KV.put('checkout:' + email, JSON.stringify({
      attempt, createdAt: pending?.createdAt || Date.now(), plan, sessionId: session.id,
    }));
    return jsonResponse({ url: session.url });
  } catch (error) {
    if (checkoutEmail && [400, 401, 403, 404].includes(error.status) && error.code !== 'idempotency_error') {
      const pending = await readRecord(env, 'checkout:' + checkoutEmail);
      if (pending && !pending.sessionId) await env.PLANS_KV.delete('checkout:' + checkoutEmail);
    }
    return jsonResponse({ error: 'payment_unavailable' }, 503);
  }
}
