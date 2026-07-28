// Comparación en tiempo constante (mismo patrón que check-plan.js /
// stripe-webhook.js) — evita que una diferencia de tiempo de respuesta
// filtre por cuántos caracteres iniciales coincide un código adivinado.
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
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
    return new Response(JSON.stringify({ ok: true, token, plan }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}
