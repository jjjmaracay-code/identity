export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    const { plan, email } = body;

    if (!plan || !email) {
      return new Response(JSON.stringify({ error: 'Faltan plan o email' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    const priceId = plan === 'pro' ? env.STRIPE_PRICE_PRO
                  : plan === 'lifetime' ? env.STRIPE_PRICE_LIFETIME
                  : null;

    if (!priceId) {
      return new Response(JSON.stringify({ error: 'Plan no válido' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    const mode = plan === 'pro' ? 'subscription' : 'payment';
    const origin = new URL(request.url).origin;

    const params = new URLSearchParams();
    params.append('mode', mode);
    params.append('line_items[0][price]', priceId);
    params.append('line_items[0][quantity]', '1');
    params.append('customer_email', email);
    params.append('success_url', `${origin}/paywall.html?session_id={CHECKOUT_SESSION_ID}&plan=${plan}`);
    params.append('cancel_url', `${origin}/paywall.html`);
    params.append('metadata[plan]', plan);
    params.append('metadata[email]', email);

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    const session = await stripeRes.json();

    if (!stripeRes.ok) {
      return new Response(JSON.stringify({ error: session.error?.message || 'Error de Stripe' }), {
        status: 500, headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}
