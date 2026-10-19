// Registro de dispositivos por cuenta (fase 3 del lote de licencias) --
// SOLO REGISTRA, no bloquea nada todavía. Ningún endpoint que llame a
// recordDeviceSeen() cambia su respuesta por esto: si algo falla aquí
// dentro, se traga el error y la petición sigue exactamente igual que si
// esta función no existiera.
//
// Dato mínimo guardado por dispositivo: un UUID v4 que el propio
// dispositivo elige (ver device-id.js), un "tipo" genérico deducido del
// User-Agent (nunca el User-Agent completo) y dos fechas. Nunca se guarda
// IP ni el User-Agent real.

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

export function devicesKey(emailKey) {
  return DEVICES_KEY_PREFIX + emailKey;
}

// Registra que `deviceId` acaba de usar la cuenta `emailKey`. Escrituras
// mínimas a propósito (regla 5 del lote): si el dispositivo ya estaba
// visto hace menos de 24h, no se escribe nada en KV. Nunca lanza -- un
// fallo aquí (KV caído, dato corrupto, deviceId inválido) nunca debe
// afectar a la respuesta del endpoint que llama a esto.
export async function recordDeviceSeen(env, emailKey, deviceId, userAgent) {
  if (!isValidDeviceId(deviceId)) return;
  try {
    const key = devicesKey(emailKey);
    const raw = await env.PLANS_KV.get(key);
    let lista = [];
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) lista = parsed;
      } catch (_) { lista = []; }
    }

    const nowIso = new Date().toISOString();
    const idx = lista.findIndex(d => d && d.deviceId === deviceId);

    if (idx === -1) {
      lista.push({ deviceId, tipo: deviceTypeFromUserAgent(userAgent), firstSeen: nowIso, lastSeen: nowIso });
    } else {
      const visto = lista[idx];
      const antiguedad = Date.now() - new Date(visto.lastSeen).getTime();
      if (Number.isFinite(antiguedad) && antiguedad < REWRITE_THRESHOLD_MS) {
        return; // visto hace menos de 24h -- nada que escribir
      }
      visto.lastSeen = nowIso;
    }

    // Tope de 20 dispositivos por cuenta: al superarlo, se descarta SOLO
    // el de lastSeen más antiguo (no se recorta de golpe a 20).
    if (lista.length > MAX_DEVICES) {
      let oldestIdx = 0;
      for (let i = 1; i < lista.length; i++) {
        if (new Date(lista[i].lastSeen).getTime() < new Date(lista[oldestIdx].lastSeen).getTime()) oldestIdx = i;
      }
      lista.splice(oldestIdx, 1);
    }

    await env.PLANS_KV.put(key, JSON.stringify(lista));
  } catch (_) {
    // Nunca debe afectar a la respuesta principal -- ver cabecera.
  }
}
