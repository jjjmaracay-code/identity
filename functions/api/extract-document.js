// Extrae datos de contacto de un documento (imagen o PDF, incluido PDF
// multi-página) usando la API de Gemini (Google AI Studio). El archivo
// llega en base64 desde el cliente y se reenvía tal cual a Gemini —
// Gemini hace su propio OCR nativo y procesa PDFs de varias páginas de
// forma nativa, así que aquí no se usa Tesseract.js ni pdf.js (esos solo
// se usan en el fallback local del cliente, ver index.html).
//
// LA CLAVE DE API VIVE ÚNICAMENTE EN LA VARIABLE DE ENTORNO
// `GEMINI_API_KEY` DE CLOUDFLARE PAGES (Settings > Environment
// variables) — igual que las credenciales de PLANS_KV/Stripe. Nunca
// debe copiarse a este repo ni a index.html ni a ningún archivo servido
// al navegador.

// Configurable por env.GEMINI_MODEL si Google renombra/retira este
// modelo — evita depender de un redeploy de código para ese cambio.
const GEMINI_MODEL_DEFAULT = 'gemini-2.5-flash';
const DAILY_LIMIT = 20; // extracciones por cuenta/IP al día — protege la cuota gratuita compartida

// La API de Gemini limita los datos enviados como inlineData (base64
// embebido en el JSON, que es lo que hacemos aquí) a 20MB por request —
// por encima de eso Google exige usar su File API aparte. Dejamos margen
// para el resto del payload (prompt + schema), no solo para el archivo.
const MAX_BASE64_CHARS = 19 * 1024 * 1024;

const MIME_ALLOWED = ['image/jpeg', 'image/png', 'application/pdf'];

// Reintentos solo para fallos transitorios (5xx del lado de Gemini, o la
// petición ni siquiera llegó — red/timeout). Un 4xx (payload rechazado,
// cuota/crédito agotado) es un rechazo real: reintentarlo no cambia el
// resultado y solo quema más cuota compartida.
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 500;

const FIELD_KEYS = [
  'nombre', 'cargo', 'telefono', 'telefono_fijo', 'movil',
  'email_principal', 'email_secundario', 'email_trabajo',
  'empresa', 'ciudad', 'linkedin', 'github', 'web',
  'twitter', 'instagram', 'youtube', 'tiktok'
];

const PROMPT = `Eres un extractor de datos de contacto. Analiza el documento adjunto (foto, tarjeta de presentación, credencial, currículum o PDF — puede tener varias páginas, revísalas todas) y extrae los datos de contacto que encuentres, SOLO si aparecen de forma clara en el documento — nunca inventes ni completes datos que no estén.

Campos a buscar (usa exactamente estas claves en el JSON):
- nombre: nombre completo de la persona.
- cargo: cargo o profesión.
- telefono: teléfono principal si el documento no distingue tipos.
- telefono_fijo: teléfono fijo, SOLO si el documento lo distingue explícitamente de uno móvil (ej. "Tel:", "Oficina:").
- movil: teléfono móvil/celular, SOLO si el documento lo distingue explícitamente (ej. "Móvil:", "Cel:").
- email_principal, email_secundario, email_trabajo: hasta 3 emails distintos si aparecen varios; el más prominente va en email_principal.
- empresa: empresa u organización.
- ciudad: ciudad.
- linkedin: URL completa del perfil de LinkedIn.
- github: URL completa del usuario de GitHub.
- web: sitio web personal o de la empresa.
- twitter: usuario de Twitter/X (con @).
- instagram: URL del perfil de Instagram.
- youtube: URL del canal de YouTube.
- tiktok: URL del usuario de TikTok.

Para cada campo detectado, asigna confidence según cuánta certeza real tienes:
- "high": el dato es perfectamente legible, sin ambigüedad de lectura ni de a qué campo pertenece.
- "medium": razonablemente seguro pero con alguna duda (mala resolución, fuente decorativa, o tuviste que inferir a qué campo corresponde).
- "low": es una suposición o inferencia, no una lectura directa del documento.

Omite del JSON cualquier campo que no aparezca en el documento. No dupliques el mismo teléfono en "telefono" y en "telefono_fijo"/"movil" a la vez — usa "telefono" solo cuando el documento NO distingue el tipo.`;

function jsonRes(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' }
  });
}

// Mismo patrón de comparación en tiempo constante que check-plan.js.
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Identificador para el límite diario: cuenta verificada (email+token,
// igual que check-plan.js) si el usuario está registrado, o IP si no —
// index.html permite usar el extractor sin registro ("continuar sin
// cuenta"), así que no se puede exigir cuenta aquí.
async function resolveRateKey(env, request, email, token) {
  if (email && token && typeof token === 'string') {
    const emailKey = String(email).toLowerCase();
    const regRaw = await env.PLANS_KV.get('reg:' + emailKey);
    if (regRaw) {
      try {
        const reg = JSON.parse(regRaw);
        if (reg.token && timingSafeEqual(reg.token, token)) return 'acct:' + emailKey;
      } catch (_) { /* dato corrupto — cae a IP */ }
    }
  }
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  return 'ip:' + ip;
}

async function checkAndBumpRateLimit(env, rateKey) {
  const kvKey = 'ocrlimit:' + rateKey;
  const raw = await env.PLANS_KV.get(kvKey);
  let entry = null;
  try { entry = raw ? JSON.parse(raw) : null; } catch (_) {}

  const now = Date.now();
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + 24 * 3600 * 1000 };
  }
  if (entry.count >= DAILY_LIMIT) return false;

  entry.count += 1;
  // expirationTtl con margen sobre las 24h: limpia la clave sola sin
  // necesitar un cron de limpieza, sin arriesgarse a expirar antes de
  // que resetAt cumpla su ciclo.
  await env.PLANS_KV.put(kvKey, JSON.stringify(entry), { expirationTtl: 90000 });
  return true;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Llama a Gemini reintentando solo fallos transitorios: 5xx (error del
// lado de Google) o la petición no llegó (red/timeout — fetch lanza
// excepción). Un 4xx se devuelve tal cual en el primer intento, sin
// reintentar — no es un fallo pasajero, es un rechazo (payload inválido,
// cuota/crédito agotado, etc.) que insistir no arregla.
async function callGeminiWithRetry(geminiUrl, requestBody) {
  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let res;
    try {
      res = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody
      });
    } catch (err) {
      lastError = { type: 'network', err };
      if (attempt < MAX_RETRIES) { await sleep(RETRY_BASE_DELAY_MS * Math.pow(2, attempt)); continue; }
      return { ok: false, transient: true };
    }

    if (res.ok) return { ok: true, res };

    if (res.status >= 500 && attempt < MAX_RETRIES) {
      lastError = { type: 'http5xx', status: res.status };
      await sleep(RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
      continue;
    }

    // 4xx, o 5xx tras agotar reintentos: se devuelve tal cual.
    return { ok: false, res, transient: res.status >= 500 };
  }

  return { ok: false, transient: true, lastError };
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.GEMINI_API_KEY) {
    return jsonRes({ ok: false, error: 'server_misconfigured' }, 500);
  }

  let body;
  try { body = await request.json(); } catch (_) {
    return jsonRes({ ok: false, error: 'bad_request' }, 400);
  }

  const { mimeType, dataBase64, email, token } = body || {};
  if (!mimeType || !MIME_ALLOWED.includes(mimeType) || !dataBase64 || typeof dataBase64 !== 'string') {
    return jsonRes({ ok: false, error: 'bad_request' }, 400);
  }
  if (dataBase64.length > MAX_BASE64_CHARS) {
    return jsonRes({ ok: false, error: 'file_too_large' }, 400);
  }

  const rateKey = await resolveRateKey(env, request, email, token);
  const allowed = await checkAndBumpRateLimit(env, rateKey);
  if (!allowed) {
    return jsonRes({ ok: false, error: 'rate_limited' }, 429);
  }

  const schema = {
    type: 'OBJECT',
    properties: Object.fromEntries(FIELD_KEYS.map(key => [key, {
      type: 'OBJECT',
      properties: {
        value: { type: 'STRING' },
        confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] }
      },
      required: ['value', 'confidence']
    }]))
  };

  const model = env.GEMINI_MODEL || GEMINI_MODEL_DEFAULT;
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

  const requestBody = JSON.stringify({
    contents: [{
      parts: [
        { text: PROMPT },
        { inlineData: { mimeType, data: dataBase64 } }
      ]
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: schema
    }
  });

  const attempt = await callGeminiWithRetry(geminiUrl, requestBody);

  if (!attempt.ok) {
    if (!attempt.res) {
      return jsonRes({ ok: false, error: 'gemini_unreachable' }, 502);
    }
    console.error('Gemini error body:', await attempt.res.text());
    return jsonRes({ ok: false, error: 'gemini_error', status: attempt.res.status }, 502);
  }

  const geminiRes = attempt.res;

  let geminiData;
  try { geminiData = await geminiRes.json(); } catch (_) {
    return jsonRes({ ok: false, error: 'gemini_bad_response' }, 502);
  }

  const textOut = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!textOut) {
    return jsonRes({ ok: false, error: 'gemini_empty_response' }, 502);
  }

  let extracted;
  try { extracted = JSON.parse(textOut); } catch (_) {
    return jsonRes({ ok: false, error: 'gemini_invalid_json' }, 502);
  }

  // Nunca se confía ciegamente en la salida de un tercero: se filtra a
  // solo las claves conocidas, con la forma exacta {value, confidence}
  // que espera renderImportResults() en index.html.
  const clean = {};
  for (const key of FIELD_KEYS) {
    const item = extracted?.[key];
    if (item && typeof item.value === 'string' && item.value.trim() &&
        ['high', 'medium', 'low'].includes(item.confidence)) {
      clean[key] = { value: item.value.trim(), confidence: item.confidence };
    }
  }

  return jsonRes({ ok: true, extracted: clean });
}

export async function onRequestGet() {
  return jsonRes({ ok: false, error: 'method_not_allowed' }, 405);
}
