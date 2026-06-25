export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const { email, name } = await request.json();

    if (!email) {
      return new Response(JSON.stringify({ error: 'Falta email' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    await env.PLANS_KV.put(
      'reg:' + email.toLowerCase(),
      JSON.stringify({ name: name || '', registeredAt: new Date().toISOString() })
    );

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}
