export async function onRequestPost(context) {
  const { request, env } = context;

  const signature = request.headers.get('stripe-signature');
  const rawBody = await request.text();

  if (!signature) return new Response('No signature', { status: 400 });

  const isValid = await verifyStripeSignature(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  if (!isValid) return new Response('Invalid signature', { status: 400 });

  const event = JSON.parse(rawBody);

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_email || session.metadata?.email;
    const plan = session.metadata?.plan;

    if (email && plan) {
      await env.PLANS_KV.put(email.toLowerCase(), JSON.stringify({
        plan, sessionId: session.id, date: new Date().toISOString()
      }));
    }
  }

  return new Response('OK', { status: 200 });
}

async function verifyStripeSignature(payload, signatureHeader, secret) {
  const parts = signatureHeader.split(',').reduce((acc, part) => {
    const [key, value] = part.split('=');
    acc[key] = value;
    return acc;
  }, {});

  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  const age = Date.now() / 1000 - parseInt(timestamp, 10);
  if (age > 300) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
  const expectedSignature = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  return timingSafeEqual(expectedSignature, signature);
}

// crypto.subtle no expone timingSafeEqual en el runtime de Cloudflare Workers —
// comparación en tiempo constante manual (longitud igual + XOR acumulado byte a byte)
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
