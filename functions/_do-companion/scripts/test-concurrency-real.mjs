// Verificación REAL (no un mock de Node) de que BusinessCardDO serializa
// de verdad las publicaciones concurrentes del mismo propietario, contra
// el runtime local auténtico de Cloudflare (workerd), no contra una
// reimplementación en memoria.
//
// ESTE SCRIPT NO SE HA EJECUTADO TODAVÍA. El entorno de desarrollo
// automatizado que preparó este código bloquea toda conexión de red
// saliente desde los comandos de shell, incluso a 127.0.0.1 (se intentó
// una vez, con una denegación explícita del permiso; no se ha vuelto a
// intentar). El binding del Durable Object SÍ se verificó como realmente
// conectado más de una vez (`wrangler pages dev` reportó
// "env.BUSINESS_DO ... Durable Object local [connected]"), pero disparar
// las peticiones HTTP concurrentes en sí requiere una máquina con acceso
// de red normal — no está marcado como superado, solo preparado.
//
// PASOS EXACTOS (PowerShell, tres ventanas). Todas las rutas son
// relativas a la raíz del repo (C:\Users\N6506\Desktop\IA\IDENTIFLY).
//
// Ventana 1 — arranca el Worker que aloja el Durable Object:
//   cd functions/_do-companion
//   npx wrangler@4.143.0 dev --port 8793
//   (deja esta ventana abierta; no hace falta ver nada especial aquí)
//
// Ventana 2 — arranca el proyecto Pages enlazado a ese Durable Object:
//   npx wrangler@4.143.0 pages dev . --port 8794 `
//     --kv PLANS_KV --kv SHARE_KV --kv BUSINESS_KV `
//     --do BUSINESS_DO=BusinessCardDO@identifly-business-do `
//     --compatibility-date=2024-01-01
//   Debe aparecer la línea:
//     env.BUSINESS_DO (BusinessCardDO, defined in identifly-business-do)   Durable Object   local [connected]
//   Si dice [not connected], la Ventana 1 no está corriendo o el nombre
//   "identifly-business-do" no coincide con el `name` de
//   functions/_do-companion/wrangler.toml -- no continúes hasta ver [connected].
//
// Ventana 3 — siembra una cuenta de prueba en el MISMO KV local que ve
// la Ventana 2 (comando verificado: escribe y relee correctamente contra
// la persistencia local por defecto de wrangler) y lanza la prueba:
//   cd C:\Users\N6506\Desktop\IA\IDENTIFLY
//   @'
//   name = "identifly-pages-local-seed"
//   compatibility_date = "2024-01-01"
//   [[kv_namespaces]]
//   binding = "PLANS_KV"
//   id = "PLANS_KV"
//   '@ | Set-Content -Encoding utf8 __tmp-seed.toml
//
//   npx wrangler@4.143.0 kv key put --config __tmp-seed.toml --binding PLANS_KV --local `
//     "reg:concurrencia@example.com" '{"registeredAt":"2024-01-01T00:00:00.000Z","token":"testtoken123"}'
//   npx wrangler@4.143.0 kv key put --config __tmp-seed.toml --binding PLANS_KV --local `
//     "concurrencia@example.com" '{"plan":"lifetime"}'
//
//   node functions/_do-companion/scripts/test-concurrency-real.mjs `
//     http://127.0.0.1:8794 concurrencia@example.com testtoken123
//
//   # Limpieza al terminar (no dejar datos de prueba ni el toml temporal):
//   npx wrangler@4.143.0 kv key delete --config __tmp-seed.toml --binding PLANS_KV --local "reg:concurrencia@example.com"
//   npx wrangler@4.143.0 kv key delete --config __tmp-seed.toml --binding PLANS_KV --local "concurrencia@example.com"
//   Remove-Item __tmp-seed.toml
//
// RESULTADO ESPERADO: el script imprime "Respuesta A" y "Respuesta B" con
// el MISMO `id` en ambas, y termina con
//   "OK: ambas peticiones concurrentes coinciden en el mismo id".
// Si alguna vez imprimiera dos ids distintos, sería una regresión real
// del Durable Object (no debería ocurrir dado su modelo de ejecución de
// una sola instancia a la vez) y habría que investigarlo antes de
// considerar esto cerrado.

const [, , baseUrlArg, emailArg, tokenArg] = process.argv;
if (!baseUrlArg || !emailArg || !tokenArg) {
  console.error('Uso: node test-concurrency-real.mjs <baseUrl> <email> <token>');
  console.error('Ver los comentarios de cabecera de este archivo para preparar las Terminales 1 y 2 primero.');
  process.exit(1);
}

const payload = {
  email: emailArg, token: tokenArg,
  modality: 'company', primaryAction: 'contact', phone: '+34600000000',
};

async function publicarUnaVez(etiqueta) {
  const res = await fetch(`${baseUrlArg}/api/business-publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, displayName: `Empresa (${etiqueta})`, tagline: etiqueta }),
  });
  const data = await res.json().catch(() => ({}));
  return { etiqueta, status: res.status, data };
}

(async () => {
  console.log('Disparando DOS publicaciones "primera vez" verdaderamente concurrentes (Promise.all, peticiones HTTP reales)...');
  const [a, b] = await Promise.all([publicarUnaVez('A'), publicarUnaVez('B')]);
  console.log('Respuesta A:', a.status, a.data);
  console.log('Respuesta B:', b.status, b.data);

  const idsDevueltos = new Set([a.data.id, b.data.id].filter(Boolean));
  console.log('\n--- RESULTADO ---');
  console.log('ids distintos devueltos:', idsDevueltos.size, [...idsDevueltos]);
  if (idsDevueltos.size === 1) {
    console.log('OK: ambas peticiones concurrentes coinciden en el mismo id -- BusinessCardDO serializó correctamente la primera publicación.');
  } else {
    console.log('FALLO: se devolvieron ids distintos -- revisar el binding del Durable Object (¿"[connected]" en la Terminal 2?).');
    process.exitCode = 1;
  }

  // Limpieza opcional: despublica para dejar el entorno de prueba como estaba.
  await fetch(`${baseUrlArg}/api/business-unpublish`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: emailArg, token: tokenArg }),
  }).catch(() => {});
})();
