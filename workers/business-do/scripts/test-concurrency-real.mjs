// Verificación REAL (no un mock de Node) de que BusinessCardDO serializa
// de verdad las publicaciones concurrentes del mismo propietario, contra
// el runtime local auténtico de Cloudflare (workerd), no contra una
// reimplementación en memoria.
//
// ESTE SCRIPT NO SE HA PODIDO EJECUTAR DESDE EL ENTORNO DE DESARROLLO
// AUTOMATIZADO QUE PREPARÓ ESTE CÓDIGO: ese entorno bloquea las
// conexiones de red salientes (incluso a 127.0.0.1) desde los comandos
// de shell, así que ni `curl` ni `fetch()` han podido dispararse desde
// ahí. El binding del Durable Object SÍ se verificó como realmente
// conectado (`wrangler pages dev` reportó
// "env.BUSINESS_DO ... Durable Object local [connected]"), pero las
// peticiones concurrentes en sí las debe ejecutar quien tenga acceso de
// red normal en su máquina -- ver los pasos de abajo.
//
// CÓMO EJECUTARLO:
//   Terminal 1 (arranca el Worker que aloja el Durable Object):
//     cd workers/business-do
//     npx wrangler dev --port 8793
//
//   Terminal 2 (arranca el proyecto Pages enlazado a ese Durable Object):
//     cd ../..   (raíz del repo)
//     npx wrangler pages dev . --port 8794 \
//       --kv PLANS_KV --kv SHARE_KV --kv BUSINESS_KV \
//       --do BUSINESS_DO=BusinessCardDO@identifly-business-do \
//       --compatibility-date=2024-01-01
//   Confirma en la salida de la Terminal 2 que aparece
//   "env.BUSINESS_DO ... Durable Object local [connected]" antes de continuar.
//
//   Terminal 3 (este script, con datos ficticios -- necesita una cuenta
//   registrada localmente en PLANS_KV; el más simple es usar
//   register-complete.js/claim-token.js contra la Terminal 2, o insertar
//   el registro directamente con `wrangler kv key put` apuntando al
//   namespace local de PLANS_KV que reporte la Terminal 2):
//     node scripts/test-concurrency-real.mjs http://127.0.0.1:8794 tu-email-de-prueba@example.com TU_TOKEN

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
