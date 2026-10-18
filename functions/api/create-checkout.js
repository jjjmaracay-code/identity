export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    const { plan, email, waiverAccepted } = body;

    if (!plan || !email) {
      return new Response(JSON.stringify({ error: 'Faltan plan o email' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    // Prueba, en el servidor, de que se aceptó la renuncia al derecho de
    // desistimiento de 14 días (Art. 103.m LGDCU) ANTES de crear la
    // sesión de pago -- la casilla del cliente (paywall.html) ya lo exige
    // para habilitar el botón, pero eso por sí solo es trivialmente
    // saltable (consola del navegador, petición manual); esta
    // comprobación es la que de verdad importa. true estricto, no solo
    // "truthy", para que un valor inesperado del body nunca cuele.
    if (waiverAccepted !== true) {
      return new Response(JSON.stringify({ error: 'waiver_not_accepted' }), {
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
    // Métodos de pago explícitos: solo tarjeta (Apple Pay / Google Pay
    // siguen funcionando dentro de 'card', vía el wallet del navegador).
    // Así se evita que Klarna, Bancontact, MB WAY, EPS, Amazon Pay o Link
    // aparezcan en el checkout, sin depender de lo que esté marcado en el
    // panel de Stripe.
    params.append('payment_method_types[0]', 'card');
    // client_reference_id y metadata[account_email]: a diferencia de
    // customer_email (que Stripe Checkout precarga en el campo de email
    // pero deja EDITABLE por quien paga), ninguno de estos dos campos se
    // muestra ni se puede tocar en la página de pago -- son la fuente de
    // verdad que stripe-webhook.js usa para decidir a qué cuenta
    // pertenece el plan (ver ese archivo).
    params.append('client_reference_id', email);
    params.append('success_url', `${origin}/paywall.html?session_id={CHECKOUT_SESSION_ID}&plan=${plan}`);
    params.append('cancel_url', `${origin}/paywall.html`);
    params.append('metadata[plan]', plan);
    params.append('metadata[email]', email);
    params.append('metadata[account_email]', email);
    // Prueba del lado del servidor de que se aceptó la renuncia al
    // desistimiento, con fecha -- queda en la propia sesión de Stripe
    // (consultable después si hiciera falta), no solo en el hecho de que
    // la petición no fue rechazada.
    params.append('metadata[waiver_accepted]', 'true');
    params.append('metadata[waiver_accepted_at]', new Date().toISOString());
    // Solo relevante para 'pro' (mode:'subscription'): esta metadata se
    // copia al objeto Subscription que Stripe crea, así que
    // stripe-webhook.js puede resolver a qué cuenta pertenece cuando
    // lleguen customer.subscription.updated/deleted más adelante (esos
    // eventos no incluyen la sesión de checkout original, solo la propia
    // suscripción). 'lifetime' es mode:'payment' y nunca crea una
    // suscripción, así que este parámetro no tiene efecto en ese caso.
    if (mode === 'subscription') {
      params.append('subscription_data[metadata][email]', email);
    }

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
