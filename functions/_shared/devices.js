// Registro de dispositivos por cuenta (fases 3-5 del lote de licencias).
//
// Fase 3: SOLO REGISTRA, nunca bloquea -- recordDeviceSeen() nunca lanza
// y nunca cambia la respuesta del endpoint que la llama.
//
// Fases 4-5: límite de dispositivos activos por plan y revocación por
// transferencia. TODO el bloqueo real depende de DEVICE_LIMIT_ENFORCED
// (ver isDeviceLimitEnforced() en check-plan.js/transfer-device.js) -- las
// funciones de ESTE archivo son puro cálculo/almacenamiento, no deciden
// por sí mismas si bloquear; eso lo decide el endpoint que las usa,
// mirando siempre el interruptor primero.
//
// Dato mínimo guardado por dispositivo: un UUID v4 que el propio
// dispositivo elige (ver device-id.js), un "tipo" genérico deducido del
// User-Agent (nunca el User-Agent completo) y fechas. Nunca se guarda IP
// ni el User-Agent real.

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidDeviceId(id) {
  return typeof id === 'string' && UUID_V4_RE.test(id);
}

// Categoría genérica, no el User-Agent real. El orden importa: iPad se
// comprueba antes que Android/Mobile porque Safari en iPadOS reciente
// puede anunciarse como escritorio -- aun así, el resto de combinaciones
// (Android con o sin "Mobile") son la señal estándar para distinguir
// teléfono de tablet en ese sistema.
export function deviceTypeFromUserAgent(ua) {
  const s = String(ua || '');
  if (/iPad/i.test(s)) return 'tablet';
  if (/iPhone/i.test(s)) return 'iphone';
  if (/Android/i.test(s)) return /Mobile/i.test(s) ? 'android' : 'tablet';
  return 'otro';
}

const DEVICES_KEY_PREFIX = 'devices:';
const MAX_DEVICES = 20;
const REWRITE_THRESHOLD_MS = 24 * 3600 * 1000;
const DEVICE_LIMIT_ACTIVATED_AT_KEY = 'device_limit_activated_at';
const TRANSFER_KEY_PREFIX = 'transfer:';
const LIFETIME_TRANSFER_COOLDOWN_MS = 24 * 3600 * 1000;

// Dispositivos activos permitidos por plan (regla 2) -- un plan sin
// entrada aquí (prueba/free) no tiene límite nuevo.
export const PLAN_DEVICE_LIMITS = { pro: 3, lifetime: 1 };

// Interruptor único para TODO el bloqueo de las fases 4-5 (regla 1). Si
// no vale exactamente 'true' (comparación estricta de string -- así
// llegará la variable de entorno en Cloudflare Pages), el servidor NUNCA
// bloquea a nadie por límite de dispositivos ni por revocación.
export function isDeviceLimitEnforced(env) {
  return env.DEVICE_LIMIT_ENFORCED === 'true';
}

export function devicesKey(emailKey) {
  return DEVICES_KEY_PREFIX + emailKey;
}

export function transferKey(emailKey) {
  return TRANSFER_KEY_PREFIX + emailKey;
}

export function isDeviceActive(d) {
  return !!d && d.status !== 'revoked';
}

export async function getDevicesList(env, emailKey) {
  try {
    const raw = await env.PLANS_KV.get(devicesKey(emailKey));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

export function findDevice(lista, deviceId) {
  return lista.find(d => d && d.deviceId === deviceId) || null;
}

export function countActiveDevices(lista) {
  return lista.filter(isDeviceActive).length;
}

// Fecha global (no por cuenta) de activación del interruptor -- se fija
// UNA sola vez, la primera vez que un endpoint con DEVICE_LIMIT_ENFORCED
// realmente en 'true' la consulta. No decide nada por sí misma hoy (un
// dispositivo ya conocido nunca se bloquea por el límite, sin importar
// cuándo se vio por primera vez -- ver check-plan.js); se guarda para que
// quede constancia auditable de cuándo empezó a aplicarse la regla 2,
// como pide la regla 3.
export async function getOrSetDeviceLimitActivatedAt(env) {
  try {
    const raw = await env.PLANS_KV.get(DEVICE_LIMIT_ACTIVATED_AT_KEY);
    if (raw) return raw;
    const nowIso = new Date().toISOString();
    await env.PLANS_KV.put(DEVICE_LIMIT_ACTIVATED_AT_KEY, nowIso);
    return nowIso;
  } catch (_) {
    return null;
  }
}

async function writeDevicesList(env, emailKey, lista) {
  await env.PLANS_KV.put(devicesKey(emailKey), JSON.stringify(lista));
}

function evictOldestIfOverCap(lista) {
  if (lista.length > MAX_DEVICES) {
    let oldestIdx = 0;
    for (let i = 1; i < lista.length; i++) {
      if (new Date(lista[i].lastSeen).getTime() < new Date(lista[oldestIdx].lastSeen).getTime()) oldestIdx = i;
    }
    lista.splice(oldestIdx, 1);
  }
}

// Registra que `deviceId` acaba de usar la cuenta `emailKey`. Escrituras
// mínimas a propósito: si el dispositivo ya estaba visto hace menos de
// 24h, no se escribe nada en KV. Nunca lanza -- un fallo aquí (KV caído,
// dato corrupto, deviceId inválido) nunca debe afectar a la respuesta del
// endpoint que llama a esto.
//
// NO decide ningún límite -- eso lo hace check-plan.js ANTES de llamar
// aquí (mirando countActiveDevices()/PLAN_DEVICE_LIMITS con el
// interruptor). Esta función asume que ya se decidió que este
// dispositivo puede registrarse/seguir activo.
// ¿Daría de alta este deviceId un dispositivo NUEVO por encima del límite
// de su plan? Usan esto register-complete.js y claim-token.js ANTES de
// llamar a recordDeviceSeen() -- sin esto, "recuperar acceso" o la
// migración de token podían dar de alta un dispositivo nuevo sin mirar
// nunca el límite (a diferencia de check-plan.js, que sí lo mira),
// anulando el límite por completo con el interruptor encendido: ese
// dispositivo nuevo quedaba activo desde el primer momento y su próximo
// check-plan ya lo encontraba "conocido", nunca "nuevo".
// Un dispositivo YA conocido (activo o revocado) nunca cuenta como
// "nuevo" aquí -- el límite solo afecta a altas genuinamente nuevas.
export async function isNewDeviceOverLimit(env, emailKey, deviceId, plan) {
  if (!isValidDeviceId(deviceId)) return false;
  const limite = PLAN_DEVICE_LIMITS[plan];
  if (!limite) return false;
  const lista = await getDevicesList(env, emailKey);
  if (findDevice(lista, deviceId)) return false;
  return countActiveDevices(lista) >= limite;
}

export async function recordDeviceSeen(env, emailKey, deviceId, userAgent) {
  if (!isValidDeviceId(deviceId)) return;
  try {
    const lista = await getDevicesList(env, emailKey);
    const nowIso = new Date().toISOString();
    const idx = lista.findIndex(d => d && d.deviceId === deviceId);

    if (idx === -1) {
      lista.push({ deviceId, tipo: deviceTypeFromUserAgent(userAgent), firstSeen: nowIso, lastSeen: nowIso, status: 'active' });
    } else {
      const visto = lista[idx];
      const antiguedad = Date.now() - new Date(visto.lastSeen).getTime();
      if (Number.isFinite(antiguedad) && antiguedad < REWRITE_THRESHOLD_MS) {
        return; // visto hace menos de 24h -- nada que escribir
      }
      visto.lastSeen = nowIso;
    }

    evictOldestIfOverCap(lista);
    await writeDevicesList(env, emailKey, lista);
  } catch (_) {
    // Nunca debe afectar a la respuesta principal -- ver cabecera.
  }
}

// Fuerza el alta/reactivación de un dispositivo SIN pasar por el umbral
// de 24h ni por ningún límite -- solo lo usa transfer-device.js, justo
// tras confirmar una transferencia real, para que el dispositivo nuevo
// quede operativo de inmediato.
export async function forceActivateDevice(env, emailKey, deviceId, userAgent) {
  if (!isValidDeviceId(deviceId)) return;
  const lista = await getDevicesList(env, emailKey);
  const nowIso = new Date().toISOString();
  const idx = lista.findIndex(d => d && d.deviceId === deviceId);
  if (idx === -1) {
    lista.push({ deviceId, tipo: deviceTypeFromUserAgent(userAgent), firstSeen: nowIso, lastSeen: nowIso, status: 'active' });
  } else {
    lista[idx].lastSeen = nowIso;
    lista[idx].status = 'active';
    delete lista[idx].revokedAt;
    delete lista[idx].revokedReason;
  }
  evictOldestIfOverCap(lista);
  await writeDevicesList(env, emailKey, lista);
}

// Marca un dispositivo como revocado (transferencia real, regla 6) -- no
// lo borra de la lista (se conserva el historial: tipo, cuándo se vio por
// última vez, cuándo y por qué se revocó). El PROPIO dispositivo revocado
// se entera y se borra a sí mismo en su siguiente check-plan (regla 7),
// nunca el servidor lo borra por él.
export async function markDeviceRevoked(env, emailKey, deviceId, motivo) {
  const lista = await getDevicesList(env, emailKey);
  const idx = lista.findIndex(d => d && d.deviceId === deviceId);
  if (idx === -1) return false;
  lista[idx].status = 'revoked';
  lista[idx].revokedAt = new Date().toISOString();
  lista[idx].revokedReason = motivo;
  await writeDevicesList(env, emailKey, lista);
  return true;
}

// Cooldown entre transferencias (regla 6, solo relevante para Lifetime:
// 24h mínimas). Devuelve null si ya se puede transferir, o la fecha ISO
// en la que se podrá si todavía no.
export async function getTransferCooldownUntil(env, emailKey) {
  try {
    const raw = await env.PLANS_KV.get(transferKey(emailKey));
    if (!raw) return null;
    const { lastTransferAt } = JSON.parse(raw);
    if (!lastTransferAt) return null;
    const puedeDesde = new Date(lastTransferAt).getTime() + LIFETIME_TRANSFER_COOLDOWN_MS;
    if (Date.now() < puedeDesde) return new Date(puedeDesde).toISOString();
    return null;
  } catch (_) {
    return null;
  }
}

export async function setLastTransferAt(env, emailKey) {
  await env.PLANS_KV.put(transferKey(emailKey), JSON.stringify({ lastTransferAt: new Date().toISOString() }));
}
