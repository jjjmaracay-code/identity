// Comparación en tiempo constante (mismo patrón que check-plan.js /
// stripe-webhook.js) — evita que una diferencia de tiempo de respuesta
// filtre por cuántos caracteres iniciales coincide un código adivinado.
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Máximo de intentos fallidos contra un mismo código antes de invalidarlo.
// Un código correcto presentado dentro de los primeros 4 fallos sigue
// valiendo con normalidad -- solo el quinto fallo invalida el código ya
// mismo, sin esperar a que caduque por TTL (ver más abajo).
const MAX_FAILED_ATTEMPTS = 5;

// Hash de la IP (nunca se guarda en claro) -- mismo patrón de WebCrypto que
// ya usa stripe-webhook.js para HMAC, aquí con SHA-256 simple + un salt de
// servidor (env.IP_HASH_SALT, secreto de Cloudflare) para que el hash no se
// pueda revertir ni correlacionar con otros usos de la misma IP fuera de
// esta app.
async function hashIp(ip, salt) {
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const { email, name, code } = await request.json();

    if (!email) {
      return new Response(JSON.stringify({ error: 'Falta email' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }
    if (!code || typeof code !== 'string') {
      return new Response(JSON.stringify({ error: 'codigo_invalido_o_caducado' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    const emailKey = email.toLowerCase();

    // Rate limiting por IP — este endpoint no tenía ninguno; sin él, un
    // script puede probar el código de 6 cifras contra muchos emails
    // distintos desde la misma IP. El contador de intentos fallidos de
    // abajo ya acota el ataque contra UN email; este límite acota el
    // volumen agregado contra MUCHOS emails desde una misma IP. Umbral más
    // alto que el de send-email.js porque el cliente reintenta esta llamada
    // hasta 3 veces por fallo de red (ver comentario más abajo) y una IP
    // puede ser compartida: 15 llamadas/10min y 60/día dejan tranquilas
    // varias personas registrándose a la vez desde la misma IP, y acotan a
    // un script a brutoforzar como máximo ~3 emails completos (5 intentos
    // cada uno) por ventana de 10 minutos.
    const now = Math.floor(Date.now() / 1000);
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const ipHash = await hashIp(ip, env.IP_HASH_SALT);
    const rlIpKey = 'ratelimit:ip:register-complete:' + ipHash;
    const SHORT_WINDOW_IP = 600, SHORT_LIMIT_IP = 15;
    const LONG_WINDOW_IP = 86400, LONG_LIMIT_IP = 60;

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

    // Verificación real del código de un solo uso que send-email.js genera
    // en el servidor y guarda en 'verify:'+email con 10 minutos de vida.
    // Antes de esto, cualquiera podía llamar a este endpoint solo con un
    // email — sin código, sin verificación de ningún tipo — y recibir de
    // vuelta el token real de esa cuenta si ya existía.
    const verifyRaw = await env.PLANS_KV.get('verify:' + emailKey);
    let verifyOk = false;
    if (verifyRaw) {
      try {
        const verifyData = JSON.parse(verifyRaw);
        verifyOk = !!verifyData?.code && timingSafeEqual(String(verifyData.code), String(code));
        if (!verifyOk) {
          // Fallo: cuenta el intento. Se guarda con `expiration` (timestamp
          // absoluto anclado al createdAt original), nunca con
          // `expirationTtl` relativo -- si se renovara la ventana completa
          // en cada fallo, el código nunca caducaría mientras alguien
          // siguiera intentando.
          const attempts = (verifyData.attempts || 0) + 1;
          const expiration = Number.isFinite(verifyData.createdAt)
            ? Math.floor(verifyData.createdAt / 1000) + 600
            : null;
          // Invalidar directamente (sin intentar un `put` que KV va a
          // rechazar) cuando: se agotaron los intentos, falta createdAt
          // (no hay expiration que calcular), o al código le quedan menos
          // de 60s de vida -- KV exige que `expiration` sea un timestamp
          // al menos 60s en el futuro; un put con menos que eso falla
          // siempre.
          const debeInvalidarse =
            attempts >= MAX_FAILED_ATTEMPTS ||
            expiration === null ||
            expiration - now < 60;
          try {
            if (debeInvalidarse) {
              await env.PLANS_KV.delete('verify:' + emailKey);
            } else {
              await env.PLANS_KV.put(
                'verify:' + emailKey,
                JSON.stringify({ ...verifyData, attempts }),
                { expiration }
              );
            }
          } catch (_) {
            // El put o el delete fallaron (p.ej. corte transitorio de KV)
            // -- no se reintenta ni se deja el código en un estado
            // ambiguo: verifyOk ya es false, así que la respuesta de abajo
            // ya trata el código como invalidado con el error genérico.
          }
        }
      } catch (_) { /* dato corrupto — tratar como no verificado */ }
    }
    if (!verifyOk) {
      return new Response(JSON.stringify({ error: 'codigo_invalido_o_caducado' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    const existingRaw = await env.PLANS_KV.get('reg:' + emailKey);
    const existing = existingRaw ? JSON.parse(existingRaw) : null;

    // El cliente reintenta esta llamada hasta 3 veces si falla la red —
    // si ya existe un registro para este email se conservan registeredAt
    // y token originales sin pisarlos, o cada reintento alargaría el
    // trial y regeneraría un token distinto al que el cliente ya pueda
    // tener guardado.
    const registeredAt = existing?.registeredAt || new Date().toISOString();
    const token = existing?.token || crypto.randomUUID();

    await env.PLANS_KV.put(
      'reg:' + emailKey,
      JSON.stringify({ name: name || existing?.name || '', registeredAt, token })
    );

    // Herencia de plan por email: IDENTIFLY es local-first (el perfil
    // vive solo en el dispositivo), pero el plan de pago sí es
    // server-mode por diseño y vive en la clave SIN prefijo `emailKey`
    // (la escribe stripe-webhook.js, o se asigna a mano — ver
    // check-plan.js, que lee de ahí exactamente igual). Si este email
    // ya pagó, se lo devolvemos al cliente para que lo aplique de
    // inmediato al perfil recién creado, sea el primer dispositivo o
    // uno nuevo. Es una lectura pura — no se escribe ni se toca esa
    // entrada en ningún momento, así que no hay duplicado ni
    // sobreescritura posible.
    const PAID_PLANS = ['pro', 'lifetime'];
    let plan = null;
    try {
      const paidRaw = await env.PLANS_KV.get(emailKey);
      if (paidRaw) {
        const paid = JSON.parse(paidRaw);
        if (paid?.plan && PAID_PLANS.includes(paid.plan)) plan = paid.plan;
      }
    } catch (_) { /* dato de plan corrupto — mejor no aplicar nada que romper el registro */ }

    // El token se devuelve para que el cliente lo guarde en su propio
    // localStorage — es lo que permite después a check-plan.js verificar
    // el plan de este email sin exponerlo a nadie más (ver check-plan.js).
    return new Response(JSON.stringify({ ok: true, token, plan, registeredAt }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}
