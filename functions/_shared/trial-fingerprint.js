// Huella anti-reabuso del periodo de prueba (RGPD: dato minimizado desde
// el origen -- nunca se guarda el email en claro, solo un hash
// irreversible). La escribe delete-account.js al borrar una cuenta; la
// comprueba register-complete.js al completar un registro nuevo -- si
// existe, esa cuenta se crea SIN periodo de prueba (ver trialUsed en la
// respuesta de register-complete.js y cómo lo usa register.html).
//
// Normalización del email ANTES de hashear, para que variantes del mismo
// buzón no esquiven la huella:
//   - minúsculas
//   - sin la etiqueta "+algo" de la parte local (RFC 5233, cualquier
//     proveedor que la soporte, no solo Gmail)
//   - en gmail.com/googlemail.com, sin puntos en la parte local (Gmail
//     los ignora al enrutar correo: "j.perez@gmail.com" y
//     "jperez@gmail.com" son el mismo buzón)
export function normalizeEmailForFingerprint(email) {
  const lower = String(email || '').trim().toLowerCase();
  const atIdx = lower.lastIndexOf('@');
  if (atIdx === -1) return lower;
  let local = lower.slice(0, atIdx);
  const domain = lower.slice(atIdx + 1);
  const plusIdx = local.indexOf('+');
  if (plusIdx !== -1) local = local.slice(0, plusIdx);
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.replace(/\./g, '');
  }
  return local + '@' + domain;
}

// Mismo patrón SHA-256(salt + ':' + valor) que hashIp() en
// delete-account.js/register-complete.js -- irreversible, y el salt de
// servidor (env.IP_HASH_SALT, el mismo secreto ya existente, no uno
// nuevo) impide correlacionar esta huella con usos de ese email fuera
// de IDENTIFLY.
export async function hashTrialFingerprint(email, salt) {
  const normalized = normalizeEmailForFingerprint(email);
  const data = new TextEncoder().encode(`${salt}:${normalized}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function trialFingerprintKey(hash) {
  return 'trial_used:' + hash;
}

// 24 meses, expresados como 24 × 30 días -- mismo criterio simple de
// "mes = 30 días" que ya usa el resto del backend para TTLs en días
// (p.ej. share-qr.js: 60*60*24*30 para "30 días").
export const TRIAL_FINGERPRINT_TTL_SECONDS = 24 * 30 * 24 * 3600;
