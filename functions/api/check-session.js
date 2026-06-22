export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('session_id');

  if (!sessionId) {
    return new Response(JSON.stringify({ error: 'Falta session_id' }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    });
  }

  const stripeRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
    headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` }
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
