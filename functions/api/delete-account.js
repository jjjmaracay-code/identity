import { closePendingCheckout } from '../_shared/card-trial.js';
// Borrado de cuenta (RGPD art. 17) — borra todo lo que el servidor guarda
// de este email en PLANS_KV. Ver INFORME Fase 0b para el inventario
// completo de claves y para las piezas que quedan FUERA de este endpoint
// (contenido de tarjeta Business en Durable Object storage, e índice
// bizid: en BUSINESS_KV, que hoy no tienen ningún camino de borrado — ver
// ese informe antes de considerar "Eliminar todos mis datos" completo
// para quien haya usado Business).
//
// CONTRATO DE RESPUESTA (revisado tras auditoría): la versión anterior
// respondía {ok:true} para CUALQUIER token inválido -- máxima protección
// contra enumeración, pero también indistinguible de un borrado real
// para cualquiera que probara tokens al azar. Ahora:
//   - Token válido -> se borra todo, se escribe la marca de abajo, {ok:true}.
//   - Token inválido PERO existe una marca `deleted:` para ese email+token
//     exactos -> {ok:true} (reintento idempotente de un borrado que ya
//     ocurrió -- el cliente puede reintentar con el mismo token sin red
//     tras un timeout y ver la misma respuesta de éxito).
//   - Token inválido y sin marca -> 401 {error:'no_verificado'} (ya no se
//     disfraza de éxito).
// La marca es `deleted:` + SHA-256(emailKey + ':' + token), TTL 7 días, sin
// el email en claro en la clave. No lleva salt (a diferencia del hash de
// IP de Fase 0): el token ya es un UUID de alta entropía que solo conoce
// quien lo tenía guardado -- un salt añadiría cero resistencia real aquí.
import { hashTrialFingerprint, trialFingerprintKey, TRIAL_FINGERPRINT_TTL_SECONDS } from '../_shared/trial-fingerprint.js';

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function ok() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' }
  });
}

function noVerificado() {
  return new Response(JSON.stringify({ error: 'no_verificado' }), {
    status: 401, headers: { 'Content-Type': 'application/json' }
  });
}

// Único caso que SÍ es un error "algo falló de verdad": la cancelación en
// Stripe no se pudo confirmar y por tanto no se borró nada -- decir
// "ok:true" aquí sería mentirle al usuario sobre si su suscripción sigue
// cobrándose.
const GENERIC_DELETE_FAILURE_MSG = 'No se pudo completar la solicitud, inténtalo más tarde';
function genericFailure() {
  return new Response(JSON.stringify({ error: GENERIC_DELETE_FAILURE_MSG }), {
    status: 500, headers: { 'Content-Type': 'application/json' }
  });
}

// Hash de la IP (nunca se guarda en claro) -- mismo patrón que Fase 0
// (register-complete.js / send-email.js), con el mismo secreto
// env.IP_HASH_SALT.
async function hashIp(ip, salt) {
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Marca de "esta cuenta ya se borró con este token exacto" -- sin salt,
// ver nota de cabecera.
async function hashDeletedMarker(emailKey, token) {
  const data = new TextEncoder().encode(`${emailKey}:${token}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Estados de Stripe que significan "no hay nada que cancelar" -- la
// suscripción ya terminó por sí misma, o nunca llegó a cuajar. Un 404 al
// consultarla ('not_found', ver más abajo) cuenta igual: Stripe ya no
// tiene esa suscripción (resource_missing), así que tampoco hay nada que
// cancelar -- no es un fallo de la consulta, es la respuesta.
const ESTADOS_SIN_NADA_QUE_CANCELAR = new Set(['canceled', 'incomplete_expired', 'not_found']);

// Solo lectura contra Stripe -- consulta el estado REAL y actual de la
// suscripción, en vez de fiarse del `status` que tengamos cacheado en
// PLANS_KV (que puede estar desactualizado: ver INFORME, punto 2). null
// si no se pudo determinar de verdad (cualquier error que NO sea "esta
// suscripción ya no existe") -- eso bloquea el borrado; nunca se asume
// que "no se pudo comprobar" equivale a "no hay nada que cancelar".
async function fetchStripeSubscriptionStatus(env, subscriptionId) {
  try {
    const res = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Stripe-Version': '2026-09-30.endive' },
    });
    if (res.status === 404) return 'not_found';
    if (!res.ok) return null;
    const sub = await res.json();
    return typeof sub?.status === 'string' ? sub.status : null;
  } catch (_) {
    return null;
  }
}

// Cancelación inmediata (no "al final del periodo"). true solo si Stripe
// confirma -- cualquier fallo de red o respuesta de error cuenta como
// fallo, nunca se asume éxito.
async function cancelStripeSubscription(env, subscriptionId) {
  try {
    const res = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Stripe-Version': '2026-09-30.endive' },
    });
    return res.ok;
  } catch (_) {
    return false;
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    let email, token;
    try {
      ({ email, token } = await request.json());
    } catch (_) {
      return noVerificado();
    }
    if (!email || !token || typeof token !== 'string') return noVerificado();

    const emailKey = email.toLowerCase();

    // Rate limiting por IP, mismo patrón que Fase 0 -- umbral
    // deliberadamente bajo porque es una operación destructiva y el uso
    // legítimo de este endpoint es, como mucho, un puñado de veces por
    // cuenta en toda su vida: 5 llamadas/10min y 20/día por IP.
    const now = Math.floor(Date.now() / 1000);
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const ipHash = await hashIp(ip, env.IP_HASH_SALT);
    const rlIpKey = 'ratelimit:ip:delete-account:' + ipHash;
    const SHORT_WINDOW_IP = 600, SHORT_LIMIT_IP = 5;
    const LONG_WINDOW_IP = 86400, LONG_LIMIT_IP = 20;

    const rlIpRaw = await env.PLANS_KV.get(rlIpKey);
    const rlIp = rlIpRaw ? JSON.parse(rlIpRaw) : { count: 0, windowStart: now, dayCount: 0, dayStart: now };

    if (now - rlIp.windowStart >= SHORT_WINDOW_IP) { rlIp.count = 0; rlIp.windowStart = now; }
    if (now - rlIp.dayStart >= LONG_WINDOW_IP) { rlIp.dayCount = 0; rlIp.dayStart = now; }

    if (rlIp.count >= SHORT_LIMIT_IP || rlIp.dayCount >= LONG_LIMIT_IP) {
      return new Response(JSON.stringify({ error: 'rate_limited', retryAfter: SHORT_WINDOW_IP }), {
        status: 429, headers: { 'Content-Type': 'application/json' }
      });
    }

    rlIp.count++; rlIp.dayCount++;
    await env.PLANS_KV.put(rlIpKey, JSON.stringify(rlIp), { expirationTtl: LONG_WINDOW_IP });

    // Validación del token -- mismo patrón timing-safe que check-plan.js.
    const regRaw = await env.PLANS_KV.get('reg:' + emailKey);
    let tokenValido = false;
    if (regRaw) {
      try {
        const reg = JSON.parse(regRaw);
        tokenValido = !!reg.token && timingSafeEqual(reg.token, token);
      } catch (_) { tokenValido = false; }
    }

    if (!tokenValido) {
      // ¿Ya se borró esta cuenta con este mismo token exacto? -- la marca
      // se escribe en el borrado real, más abajo. Si existe, es un
      // reintento idempotente del cliente; si no, es un token
      // genuinamente inválido.
      const marcaHash = await hashDeletedMarker(emailKey, token);
      const marcaRaw = await env.PLANS_KV.get('deleted:' + marcaHash);
      return marcaRaw ? ok() : noVerificado();
    }

    // Token válido, cuenta real. Se consulta el estado REAL en Stripe
    // (nunca el `status` cacheado en PLANS_KV, que puede estar
    // desactualizado) y se cancela cualquier suscripción que no esté YA
    // terminada (active, trialing, past_due, unpaid, incomplete...): el
    // criterio es "no está en ESTADOS_SIN_NADA_QUE_CANCELAR", no una
    // lista cerrada de estados "activos" como hacía la versión anterior
    // (computePaidActive solo cubre el caso de "acceso vigente", no
    // "hay algo que cancelar en Stripe"). Si no se puede ni recuperar ni
    // cancelar, no se borra nada. 'lifetime' es pago único: nunca tiene
    // subscriptionId, nada que cancelar.
    let paid = null;
    try {
      const paidRaw = await env.PLANS_KV.get(emailKey);
      if (paidRaw) paid = JSON.parse(paidRaw);
    } catch (_) { paid = null; }

    try { await closePendingCheckout(env, emailKey); } catch { return genericFailure(); }

    if (paid?.plan === 'pro' && paid?.subscriptionId) {
      const estadoActual = await fetchStripeSubscriptionStatus(env, paid.subscriptionId);
      if (estadoActual === null) return genericFailure();
      if (!ESTADOS_SIN_NADA_QUE_CANCELAR.has(estadoActual)) {
        const cancelado = await cancelStripeSubscription(env, paid.subscriptionId);
        if (!cancelado) return genericFailure();
      }
    }

    // Delete the optional passkeys/downloads for this exact account token.
    // A failed remote deletion must not be reported as a complete account deletion.
    try {
      const tools=await fetch('https://doctorqr-backend-production.up.railway.app/api/passkeys/identity/purge', {
        method:'POST',redirect:'manual',signal:AbortSignal.timeout(8000),
        headers:{'Content-Type':'application/json','Origin':'https://www.identifly.app'},
        body:JSON.stringify({email:emailKey,token})
      });
      if(!tools.ok||(await tools.json()).success!==true)return genericFailure();
    }catch(_){return genericFailure();}

    // Borrado de los datos de Business (Fase 0c): contenido de la
    // tarjeta (Durable Object storage) + el índice público bizid: en
    // BUSINESS_KV -- ver business-card-do.js:/delete. Se llama siempre,
    // aunque esta cuenta nunca haya publicado nada (es un no-op barato e
    // idempotente en ese caso). Si falla (incluida la propia llamada al
    // binding de servicio), no se borra nada más -- mismo criterio que
    // la cancelación de Stripe de arriba.
    const doId = env.BUSINESS_DO.idFromName(emailKey);
    const stub = env.BUSINESS_DO.get(doId);
    let businessBorrado = false;
    try {
      const doRes = await stub.fetch('https://business-do/delete', { method: 'POST', body: '{}' });
      businessBorrado = doRes.ok;
    } catch (_) {
      businessBorrado = false;
    }
    if (!businessBorrado) return genericFailure();

    // Borrar todas las claves de KV de este email (ver INFORME Fase 0b
    // para el inventario completo y lo que queda fuera de aquí) y dejar
    // la marca de borrado para que un reintento posterior con el mismo
    // token responda igual que este borrado real. Los datos de
    // facturación de Stripe NO se tocan -- obligación legal de
    // conservación, viven en Stripe, no en nuestro KV.
    //
    // trial_used: huella anti-reabuso del periodo de prueba (ver
    // functions/_shared/trial-fingerprint.js) -- sin ella, borrar la
    // cuenta y volver a registrarse con el mismo email reiniciaría el
    // trial indefinidamente. Es irreversible (SHA-256), no es el email
    // en claro, y vive 24 meses.
    const marcaHash = await hashDeletedMarker(emailKey, token);
    const trialHash = await hashTrialFingerprint(email, env.IP_HASH_SALT);
    await Promise.all([
      env.PLANS_KV.delete('reg:' + emailKey),
      env.PLANS_KV.delete(emailKey),
      env.PLANS_KV.delete('verify:' + emailKey),
      env.PLANS_KV.delete('checkout:' + emailKey),
      env.PLANS_KV.delete('ratelimit:' + emailKey),
      env.PLANS_KV.delete('ocrlimit:acct:' + emailKey),
      // Lista de dispositivos (fase 3 del lote de licencias, ver
      // functions/_shared/devices.js) -- mismo criterio que el resto de
      // este borrado: dato ligado a la cuenta, se va con ella.
      env.PLANS_KV.delete('devices:' + emailKey),
      env.PLANS_KV.put('deleted:' + marcaHash, '1', { expirationTtl: 7 * 24 * 3600 }),
      env.PLANS_KV.put(trialFingerprintKey(trialHash), '1', { expirationTtl: TRIAL_FINGERPRINT_TTL_SECONDS }),
    ]);

    return ok();
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function onRequestGet() {
  return noVerificado();
}
