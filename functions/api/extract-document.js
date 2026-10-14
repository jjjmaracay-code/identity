// Endpoint retirado -- el escaneo de documentos pasó a ser 100% local
// (pdf.js/mammoth.js/Tesseract.js + extractData() en index.html), sin
// enviar nada a ningún servidor. Responde 410 Gone sin leer ningún
// secreto (ya no usa GEMINI_API_KEY) ni tocar KV (ya no usa ocrlimit:) --
// mismo criterio de "endpoint mínimo, sin dependencias" que check-plan.js
// para sus propias respuestas tempranas. Se conserva el archivo (en vez
// de borrarlo) para que una build vieja en caché de un cliente que
// todavía llame a esta ruta reciba una respuesta clara y barata, no un
// 404 genérico de Cloudflare Pages.
function gone() {
  return new Response(JSON.stringify({ ok: false, error: 'removed', message: 'El escaneo de documentos ahora es 100% local, en tu dispositivo.' }), {
    status: 410, headers: { 'Content-Type': 'application/json' }
  });
}

export async function onRequestPost() {
  return gone();
}

export async function onRequestGet() {
  return gone();
}
