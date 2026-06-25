export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const email = url.searchParams.get('email');

  if (!email) {
    return new Response(JSON.stringify({ error: 'Falta email' }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    });
  }

  const data = await env.PLANS_KV.get('reg:' + email.toLowerCase());
  return new Response(JSON.stringify({ registered: !!data }), {
    status: 200, headers: { 'Content-Type': 'application/json' }
  });
}
