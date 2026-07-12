function generateToken() {
  return crypto.randomUUID().replace(/-/g, '');
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { vcard, name } = await request.json();
    if (!vcard) {
      return new Response(JSON.stringify({ error: 'Falta vcard' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    const token = generateToken();
    await env.SHARE_KV.put('share:' + token, JSON.stringify({
      vcard,
      name: name || '',
      createdAt: new Date().toISOString(),
      used: false
    }), { expirationTtl: 60 * 60 * 24 * 30 }); // 30 días si nunca se usa

    return new Response(JSON.stringify({ token }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (!token) {
    return new Response(JSON.stringify({ error: 'Falta token' }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    });
  }

  const raw = await env.SHARE_KV.get('share:' + token);
  if (!raw) {
    return new Response(JSON.stringify({ valid: false, reason: 'not_found' }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  }

  const data = JSON.parse(raw);
  if (data.used) {
    return new Response(JSON.stringify({ valid: false, reason: 'already_used', name: data.name }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  }

  data.used = true;
  await env.SHARE_KV.put('share:' + token, JSON.stringify(data), { expirationTtl: 60 * 60 * 24 * 30 });

  return new Response(JSON.stringify({
    valid: true,
    vcard: data.vcard,
    name: data.name,
    createdAt: data.createdAt
  }), {
    status: 200, headers: { 'Content-Type': 'application/json' }
  });
}
