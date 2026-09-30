// Ciclo de vida real de las suscripciones de Stripe.
//
// ANTES: solo se escuchaba checkout.session.completed. Un plan 'pro'
// (suscripción mensual) se guardaba una vez y se quedaba en PLANS_KV para
// siempre, incluso si el usuario cancelaba o el cobro de renovación
// fallaba — no había ningún evento que reflejara la pérdida real del
// acceso. Esto rompía silenciosamente el requisito de IDENTIFLY BUSINESS
// de "bloquear publicaciones/actualizaciones al vencer el acceso", pero
// el problema es del PLAN en sí, no solo de Business: check-plan.js (todo
// el resto de la app) tenía el mismo punto ciego.
//
// AHORA: se añaden customer.subscription.updated y
// customer.subscription.deleted. En vez de fiarse del `status` de Stripe
// (que cambia de forma distinta según cómo se cancele), se guarda
// `currentPeriodEnd` -- el final del periodo YA PAGADO -- y
// computePaidActive() en functions/_shared/plan-access.js decide el
// acceso comparándolo con la fecha actual. Esto es justo lo que separa
// "cancelar la renovación" (cancel_at_period_end:true, el acceso sigue
// vivo hasta currentPeriodEnd) de "terminar el periodo pagado" (Stripe
// emite subscription.deleted cuando currentPeriodEnd ya pasó y no hubo
// renovación) sin tener que interpretar cada variante de `status` a mano.
//
// 'lifetime' es pago único (mode:'payment' en create-checkout.js): nunca
// genera un objeto Subscription en Stripe, así que estos dos eventos
// nunca lo tocan -- sigue siendo vitalicio de verdad (ver
// computePaidActive).
//
// Correlación email -> suscripción: create-checkout.js ahora pasa
// subscription_data[metadata][email] al crear la sesión de checkout en
// modo 'subscription', así que el objeto Subscription que Stripe crea
// lleva esa metadata consigo en todos sus eventos futuros. Una
// suscripción creada ANTES de este cambio no tendrá esa metadata: sus
// eventos de actualización/cancelación se descartan sin poder
// correlacionarse (limitación documentada, ver INFORME de entrega —
// no hay suscripciones Pro reales todavía, así que no hay ninguna cuenta
// afectada por esta transición).
//
// Eventos repetidos o fuera de orden: cada evento de Stripe trae
// `created` (epoch en segundos). Se guarda `lastEventCreated` en el
// registro y se descarta cualquier evento con `created` menor o igual al
// ya aplicado -- un reintento de Stripe (mismo evento) o una entrega
// fuera de orden nunca puede pisar un estado más nuevo con uno más viejo.
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
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

// Solo lectura -- nunca modifica la suscripción real en Stripe. Se usa
// para conocer current_period_end/status en el momento del primer pago,
// porque el evento checkout.session.completed no los trae.
async function fetchSubscription(env, subscriptionId) {
  const res = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  if (!res.ok) return null;
  return res.json();
}

function isoFromUnix(sec) {
  return typeof sec === 'number' ? new Date(sec * 1000).toISOString() : null;
}

// Cuentas de Stripe más recientes ya no devuelven current_period_end en
// el propio objeto Subscription -- lo mueven a cada SubscriptionItem
// (sub.items.data[N].current_period_end). Confirmado en modo prueba: un
// registro real (ver INFORME de entrega) llegó con status:'active' (la
// llamada a Stripe SÍ tuvo éxito) pero current_period_end:null en el
// nivel superior, porque este código solo miraba ahí. Se intenta primero
// el campo superior (cuentas/API antiguas) y se cae al de items si no
// está, sin romper ninguno de los dos casos.
function currentPeriodEndUnix(sub) {
  if (typeof sub?.current_period_end === 'number') return sub.current_period_end;
  const item = sub?.items?.data?.[0];
  if (typeof item?.current_period_end === 'number') return item.current_period_end;
  return null;
}

// true si YA hay un estado más nuevo (o igual) guardado que el evento
// actual -- en ese caso el evento actual se descarta sin escribir nada.
function esEventoObsoleto(existing, eventCreated) {
  return !!(existing && typeof existing.lastEventCreated === 'number' && eventCreated <= existing.lastEventCreated);
}

async function leerRegistroPago(env, emailKey) {
  const raw = await env.PLANS_KV.get(emailKey);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const signature = request.headers.get('stripe-signature');
  const rawBody = await request.text();

  if (!signature) return new Response('No signature', { status: 400 });

  const isValid = await verifyStripeSignature(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  if (!isValid) return new Response('Invalid signature', { status: 400 });

  let event;
  try { event = JSON.parse(rawBody); } catch (_) { return new Response('Invalid payload', { status: 400 }); }
  const eventCreated = typeof event.created === 'number' ? event.created : Math.floor(Date.now() / 1000);

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_email || session.metadata?.email;
    const plan = session.metadata?.plan;

    if (email && plan) {
      const emailKey = email.toLowerCase();
      const existing = await leerRegistroPago(env, emailKey);
      if (!esEventoObsoleto(existing, eventCreated)) {
        const nowIso = new Date().toISOString();

        if (plan === 'lifetime') {
          await env.PLANS_KV.put(emailKey, JSON.stringify({
            plan: 'lifetime', sessionId: session.id, date: existing?.date || nowIso,
            updatedAt: nowIso, lastEventCreated: eventCreated,
          }));
        } else if (plan === 'pro' && session.subscription) {
          const sub = await fetchSubscription(env, session.subscription);
          await env.PLANS_KV.put(emailKey, JSON.stringify({
            plan: 'pro', sessionId: session.id, date: existing?.date || nowIso,
            subscriptionId: session.subscription,
            status: sub?.status || 'active',
            currentPeriodEnd: sub ? isoFromUnix(currentPeriodEndUnix(sub)) : null,
            cancelAtPeriodEnd: !!sub?.cancel_at_period_end,
            updatedAt: nowIso, lastEventCreated: eventCreated,
          }));
        } else {
          // Plan reconocido pero sin datos suficientes (p.ej. 'pro' sin
          // session.subscription, que no debería pasar) -- se guarda igual
          // el plan sin período, como hacía el código anterior, en vez de
          // perder el pago silenciosamente.
          await env.PLANS_KV.put(emailKey, JSON.stringify({
            plan, sessionId: session.id, date: existing?.date || nowIso,
            updatedAt: nowIso, lastEventCreated: eventCreated,
          }));
        }
      }
    }
  } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    const email = sub.metadata?.email;
    if (email) {
      const emailKey = email.toLowerCase();
      const existing = await leerRegistroPago(env, emailKey);
      // Nunca se toca un registro 'lifetime' desde un evento de
      // suscripción -- no debería ocurrir (lifetime no crea
      // suscripciones), pero es una comprobación barata que evita
      // cualquier cruce accidental de datos.
      if (existing?.plan === 'lifetime') {
        // no-op
      } else if (!esEventoObsoleto(existing, eventCreated)) {
        await env.PLANS_KV.put(emailKey, JSON.stringify({
          plan: 'pro',
          sessionId: existing?.sessionId,
          date: existing?.date || new Date().toISOString(),
          subscriptionId: sub.id,
          status: sub.status,
          currentPeriodEnd: isoFromUnix(currentPeriodEndUnix(sub)),
          cancelAtPeriodEnd: !!sub.cancel_at_period_end,
          updatedAt: new Date().toISOString(),
          lastEventCreated: eventCreated,
        }));
      }
    }
    // Sin email en la metadata: suscripción creada antes de que
    // create-checkout.js empezara a fijar subscription_data.metadata.email
    // -- no se puede correlacionar con ninguna cuenta. Se descarta sin
    // error (Stripe no debe reintentar esto indefinidamente).
  }

  return new Response('OK', { status: 200 });
}
