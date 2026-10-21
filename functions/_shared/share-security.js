// Protección de la CREACIÓN de enlaces. La recepción pública no requiere cuenta.
// Reutiliza los bindings existentes; no modifica planes, dispositivos ni Business.
import { timingSafeEqual } from './business.js';

export const SHARE_LIMITS = Object.freeze({
  requestBytes: 128 * 1024,
  vcardBytes: 64 * 1024,
  nameCharacters: 256,
  windowSeconds: 600,
  windowCount: 30,
  daySeconds: 86400,
  dayCount: 200,
});

export class ShareRequestError extends Error {
  constructor(status, code, retryAfter) {
    super(code);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export function shareResponse(data, status = 200, retryAfter) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (retryAfter) headers['Retry-After'] = String(retryAfter);
  return new Response(JSON.stringify(data), { status, headers });
}

export async function readShareBody(request) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) throw new ShareRequestError(403, 'origen_no_permitido');
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new ShareRequestError(415, 'contenido_no_admitido');
  }
  const declaredLength = request.headers.get('Content-Length');
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > SHARE_LIMITS.requestBytes)) {
    throw new ShareRequestError(413, 'contenido_demasiado_grande');
  }

  // No basta Content-Length: puede faltar o mentir. Se cuentan bytes durante
  // la lectura, antes de decodificar y antes de JSON.parse.
  const reader = request.body?.getReader();
  if (!reader) throw new ShareRequestError(400, 'payload_invalido');
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > SHARE_LIMITS.requestBytes) {
        reader.cancel().catch(() => {});
        throw new ShareRequestError(413, 'contenido_demasiado_grande');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch (_) {
    throw new ShareRequestError(400, 'payload_invalido');
  }
}

export async function authenticateShareCreator(env, body) {
  const { email, token } = body;
  if (typeof email !== 'string' || !email || email.length > 254 ||
      typeof token !== 'string' || !token || token.length > 512) {
    throw new ShareRequestError(401, 'no_autorizado');
  }
  const emailKey = email.trim().toLowerCase();
  const raw = await env.PLANS_KV.get('reg:' + emailKey);
  let registration;
  try { registration = JSON.parse(raw); } catch (_) { /* rechazo genérico */ }
  if (!registration || !timingSafeEqual(registration.token, token)) throw new ShareRequestError(401, 'no_autorizado');
  // Todos los planes registrados conservan compartir. Nunca se confía en
  // un plan enviado por el cliente ni se introduce un nuevo requisito de pago.
  return emailKey;
}

export function validateShareContact(body) {
  const { vcard, name = '' } = body;
  if (typeof vcard !== 'string' || typeof name !== 'string') throw new ShareRequestError(400, 'contacto_invalido');
  if (new TextEncoder().encode(vcard).byteLength > SHARE_LIMITS.vcardBytes || name.length > SHARE_LIMITS.nameCharacters) {
    throw new ShareRequestError(413, 'contenido_demasiado_grande');
  }
  if (!/^BEGIN:VCARD\r?\n/.test(vcard) || !/\r?\nEND:VCARD\s*$/.test(vcard) || vcard.includes('\0')) {
    throw new ShareRequestError(400, 'contacto_invalido');
  }
  return { vcard, name };
}

// KV no ofrece transacciones globales: estas cuotas son una defensa de
// frecuencia, NO una garantía contable exacta entre centros de datos.
// Se rechaza al fallar la reserva. No se permite escribir el contacto si
// no se pudo guardar la cuota. Para cuotas globales estrictas se requiere
// un coordinador transaccional (DO), no más lecturas/reintentos en KV.
const activeReservations = new WeakMap();

export async function reserveShareQuota(kv, emailKey) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(emailKey));
  const accountHash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  const key = 'ratelimit:share:' + accountHash;
  let active = activeReservations.get(kv);
  if (!active) { active = new Set(); activeReservations.set(kv, active); }
  // Evita reservas simultáneas de una misma cuenta dentro de un isolate,
  // sin crear una cola de peticiones ilimitada ni conservar tokens en memoria.
  if (active.has(key)) throw new ShareRequestError(429, 'rate_limited', 1);
  active.add(key);
  try {
    const now = Math.floor(Date.now() / 1000);
    const raw = await kv.get(key);
    const quota = raw ? JSON.parse(raw) : { count: 0, windowStart: now, dayCount: 0, dayStart: now };
    if (!quota || ![quota.count, quota.windowStart, quota.dayCount, quota.dayStart].every(Number.isSafeInteger) ||
        quota.count < 0 || quota.dayCount < 0 || quota.windowStart > now || quota.dayStart > now) {
      throw new Error('Invalid share quota');
    }
    if (now - quota.windowStart >= SHARE_LIMITS.windowSeconds) { quota.count = 0; quota.windowStart = now; }
    if (now - quota.dayStart >= SHARE_LIMITS.daySeconds) { quota.dayCount = 0; quota.dayStart = now; }
    const waits = [];
    if (quota.count >= SHARE_LIMITS.windowCount) waits.push(quota.windowStart + SHARE_LIMITS.windowSeconds - now);
    if (quota.dayCount >= SHARE_LIMITS.dayCount) waits.push(quota.dayStart + SHARE_LIMITS.daySeconds - now);
    if (waits.length) throw new ShareRequestError(429, 'rate_limited', Math.max(1, ...waits));
    quota.count++;
    quota.dayCount++;
    await kv.put(key, JSON.stringify(quota), { expirationTtl: SHARE_LIMITS.daySeconds + SHARE_LIMITS.windowSeconds });
  } catch (error) {
    if (error instanceof ShareRequestError) throw error;
    // KV también puede rechazar escrituras muy próximas sobre la misma clave.
    if (/\b429\b/.test(String(error?.message))) throw new ShareRequestError(429, 'rate_limited', 1);
    throw error;
  } finally {
    active.delete(key);
  }
}
