import { stripeRequest, syncCardSubscription, readRecord, accountId } from '../_shared/card-trial.js';
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
  if (!Number.isFinite(age) || Math.abs(age) > 300) return false;

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
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Stripe-Version': '2026-09-30.endive' },
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

const CHECKOUT_EVENTS = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded']);

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

  // Los eventos de la prueba con tarjeta se reconcilian leyendo el estado
  // actual de Stripe, también si dos cambios comparten el mismo segundo.
  const object = event.data?.object;
  if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
    // Resolver desde la factura a la suscripción, no desde su email de facturación.
    const subscription = object?.parent?.subscription_details?.subscription || object?.subscription;
    const id = typeof subscription === 'string' ? subscription : subscription?.id;
    if (!id) return new Response('OK');
    try {
      const sub = await stripeRequest(env, 'subscriptions/' + encodeURIComponent(id));
      if (sub.metadata?.account_id) await syncCardSubscription(env, sub, { eventCreated, eventId: event.id });
      else if (sub.metadata?.email) {
        const email = sub.metadata.email.toLowerCase(), existing = await leerRegistroPago(env, email);
        if (existing?.plan === 'pro' && existing.subscriptionId === sub.id) {
          await env.PLANS_KV.put(email, JSON.stringify({ ...existing,
            status: sub.status, currentPeriodEnd: isoFromUnix(currentPeriodEndUnix(sub)),
            cancelAtPeriodEnd: !!sub.cancel_at_period_end, updatedAt: new Date().toISOString(),
            lastEventCreated: Math.max(existing.lastEventCreated || 0, eventCreated),
          }));
        }
      }
      return new Response('OK');
    } catch { return new Response('Retry invoice sync', { status: 503 }); }
  }
  if (event.type === 'checkout.session.async_payment_failed') return new Response('OK');
  const isCardEvent = !!object?.metadata?.account_id &&
    (object.object === 'subscription' || event.type.startsWith('customer.subscription.') || object.metadata.card_trial === 'true');
  if (isCardEvent && (CHECKOUT_EVENTS.has(event.type) ||
      ['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted',
        'customer.subscription.paused', 'customer.subscription.resumed'].includes(event.type))) {
    try {
      if (CHECKOUT_EVENTS.has(event.type) &&
          (object.status !== 'complete' || !['paid', 'no_payment_required'].includes(object.payment_status))) {
        return new Response('Incomplete Checkout', { status: 400 });
      }
      const id = CHECKOUT_EVENTS.has(event.type) ? object.subscription : object.id;
      if (typeof id !== 'string') return new Response('Missing subscription', { status: 400 });
      const sub = await stripeRequest(env, 'subscriptions/' + encodeURIComponent(id));
      await syncCardSubscription(env, sub, {
        sessionId: CHECKOUT_EVENTS.has(event.type) ? object.id : undefined,
        eventCreated, eventId: event.id,
      });
      return new Response('OK', { status: 200 });
    } catch { return new Response('Retry subscription sync', { status: 503 }); }
  }

  if (CHECKOUT_EVENTS.has(event.type)) {
    const session = event.data.object;
    // metadata.account_email y client_reference_id los fija
    // create-checkout.js y NUNCA son visibles ni editables en la página
    // de pago de Stripe -- a diferencia de customer_email/
    // customer_details.email, que Stripe Checkout precarga pero deja
    // que quien paga edite libremente antes de confirmar. El plan se
    // asigna SIEMPRE según el email del registro (uno de estos dos
    // campos de confianza) cuando están presentes; solo se cae al
    // comportamiento antiguo (customer_email/metadata.email) en una
    // sesión creada ANTES de este cambio, que no los tiene.
    const email = session.metadata?.account_email || session.client_reference_id
      || session.customer_email || session.metadata?.email;
    const plan = session.metadata?.plan;

    if (email && plan) {
      const emailKey = email.toLowerCase();
      const existing = await leerRegistroPago(env, emailKey);
      if (session.metadata?.account_id) {
        const reg = await readRecord(env, 'reg:' + emailKey);
        if (!reg?.token || session.metadata.account_id !== await accountId(reg.token)) return new Response('OK');
        if (session.payment_status !== 'paid') return new Response('Incomplete payment', { status: 400 });
      }
      if (!esEventoObsoleto(existing, eventCreated)) {
        const nowIso = new Date().toISOString();

        if (existing?.plan === 'lifetime' && plan !== 'lifetime') return new Response('OK');
        if (plan === 'lifetime') {
          await env.PLANS_KV.put(emailKey, JSON.stringify({
            plan: 'lifetime', sessionId: session.id, date: existing?.date || nowIso,
            updatedAt: nowIso, lastEventCreated: eventCreated,
          }));
        } else if (plan === 'pro' && session.subscription) {
          const sub = await fetchSubscription(env, session.subscription);
          if (!sub && session.metadata?.account_id) return new Response('Retry subscription sync', { status: 503 });
          if (session.metadata?.account_id) {
            await syncCardSubscription(env, sub, { sessionId: session.id, eventCreated, eventId: event.id });
            return new Response('OK');
          }
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
      // Un evento con forma de cancelación/borrado (el propio tipo
      // 'customer.subscription.deleted', o un 'updated' cuyo status ya es
      // 'canceled') que llega sin registro existente no debe CREAR uno
      // nuevo desde cero -- caso real: delete-account.js ya borró
      // {emailKey} por petición del usuario (RGPD art. 17), y Stripe
      // todavía entrega el evento de cancelación de la suscripción que se
      // canceló como parte de ese mismo borrado (o llega tarde/reintentado
      // después). Sin esta comprobación, este webhook resucitaría un
      // registro de pago para una cuenta que el usuario pidió eliminar
      // por completo. Si en el futuro el mismo email vuelve a pagar,
      // checkout.session.completed (la rama de arriba) lo crea de la
      // forma normal -- este criterio solo evita crear un registro a
      // partir de un evento que, por sí mismo, no aporta nada que
      // "actualizar" si no había nada que actualizar.
      const esEventoDeCancelacion = event.type === 'customer.subscription.deleted' || sub.status === 'canceled';
      // Nunca se toca un registro 'lifetime' desde un evento de
      // suscripción -- no debería ocurrir (lifetime no crea
      // suscripciones), pero es una comprobación barata que evita
      // cualquier cruce accidental de datos.
      if (existing?.plan === 'lifetime') {
        // no-op
      } else if (!existing && esEventoDeCancelacion) {
        // no-op -- ver comentario de arriba
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
