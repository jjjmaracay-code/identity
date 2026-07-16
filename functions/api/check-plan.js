// Endpoint retirado: respondía el plan por email sin autenticación (enumeración).
// Se mantiene como 404 explícito para no servir el fallback 200 de la SPA.
export function onRequest() {
  return new Response(JSON.stringify({ error: 'Not Found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' }
  });
}
