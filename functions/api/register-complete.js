export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const { email, name } = await request.json();

    if (!email) {
      return new Response(JSON.stringify({ error: 'Falta email' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    const emailKey = email.toLowerCase();
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
