// ============================================================
//  IDENTIFLY — Contraseña de acceso: hash único compartido
// ============================================================
// Usado por register.html, recovery.html e index.html -- antes cada uno
// escribía identity_pin por su cuenta (register.html y recovery.html en
// texto plano, confiando en que index.html lo migrara a hash en el
// primer acceso correcto; index.html generaba su propio hash con una
// sal fija reutilizada entre contraseñas distintas). Se unifica aquí
// para que NINGÚN sitio vuelva a escribir texto plano y para que cada
// contraseña nueva tenga su propia sal (nunca se reutiliza la de la
// contraseña anterior).
//
// Formato guardado en identity_pin: JSON {v:2, salt, hash} (sal propia,
// embebida). Compatibilidad con formatos previos, detectados y
// migrados a v2 en el primer verifyPassword() correcto:
//   v1  {v:1, hash}   -- hash con sal en la clave aparte identity_pin_salt
//        (formato usado por index.html antes de este archivo)
//   v0  texto plano   -- escrito directamente por register.html/
//        recovery.html antes de este archivo
const PIN_KEY = 'identity_pin';
const PIN_SALT_KEY_LEGACY_V1 = 'identity_pin_salt';
const PBKDF2_ITERATIONS = 100000;

function _b64(bytes) { return btoa(String.fromCharCode(...bytes)); }
function _unb64(b64) { return Uint8Array.from(atob(b64), c => c.charCodeAt(0)); }

async function _deriveHashBits(pwd, salt) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(pwd), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey, 256
  );
  return _b64(new Uint8Array(bits));
}

function timingSafeEqualStr(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Hashea con una sal NUEVA cada vez -- nunca reutiliza ninguna sal
// anterior, ni la de identity_pin_salt (formato v1 heredado).
async function hashPassword(pwd) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await _deriveHashBits(pwd, salt);
  return JSON.stringify({ v: 2, salt: _b64(salt), hash });
}

// Borra TODAS las claves relacionadas con la contraseña anterior --
// identity_pin, la sal v1 heredada (por si quedaba de una migración
// vieja) y los contadores de intentos/bloqueo, que pertenecen a esa
// contraseña y no deben sobrevivir a un cambio real de contraseña.
function clearPasswordKeys() {
  localStorage.removeItem(PIN_KEY);
  localStorage.removeItem(PIN_SALT_KEY_LEGACY_V1);
  localStorage.removeItem('identity_attempts');
  localStorage.removeItem('identity_block_until');
}

// Punto único de guardado de una contraseña nueva: borra cualquier
// rastro de la anterior y guarda el hash con sal nueva. Lo usan
// register.html (alta), recovery.html (recuperación) e index.html
// (creación inicial o migración de un formato antiguo).
async function savePassword(pwd) {
  clearPasswordKeys();
  const hashed = await hashPassword(pwd);
  localStorage.setItem(PIN_KEY, hashed);
  return hashed;
}

// Devuelve { valid, needsMigration }. needsMigration=true si storedValue
// no está en el formato v2 actual (v1 con sal aparte, o texto plano) --
// quien llama debe entonces guardar savePassword(inputPin) para migrar.
async function verifyPassword(inputPwd, storedValue) {
  try {
    const obj = JSON.parse(storedValue);
    if (obj.v === 2 && obj.hash && obj.salt) {
      const candidate = await _deriveHashBits(inputPwd, _unb64(obj.salt));
      return { valid: timingSafeEqualStr(candidate, obj.hash), needsMigration: false };
    }
    if (obj.v === 1 && obj.hash) {
      // Formato heredado de index.html: sal en identity_pin_salt aparte.
      // Si esa clave ya no existe (p.ej. se borró a mano) no se puede
      // verificar contra este formato -- se trata como inválido en vez
      // de asumir nada.
      const saltB64 = localStorage.getItem(PIN_SALT_KEY_LEGACY_V1);
      if (!saltB64) return { valid: false, needsMigration: false };
      const candidate = await _deriveHashBits(inputPwd, _unb64(saltB64));
      return { valid: timingSafeEqualStr(candidate, obj.hash), needsMigration: true };
    }
  } catch (e) {
    // No es JSON válido => texto plano heredado de register.html/recovery.html
  }
  return { valid: inputPwd === storedValue, needsMigration: true };
}
