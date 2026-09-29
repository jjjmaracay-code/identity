// Utilidades compartidas por los endpoints de IDENTIFLY BUSINESS
// (functions/api/business-*.js y functions/c/[id].js).
//
// Reutiliza el MISMO mecanismo de identidad que ya usa el resto de la app
// (email + token opaco emitido por register-complete.js/claim-token.js,
// verificado contra PLANS_KV 'reg:'+email — ver check-plan.js). No se
// inventa un sistema de autenticación nuevo para Business: es el mismo
// que ya protege el trial/plan del resto de IDENTIFLY.
//
// El veredicto de "¿tiene acceso de pago vigente ahora mismo?" vive en
// functions/_shared/plan-access.js — antes se recalculaba aquí de forma
// duplicada y desactualizada (ver ese archivo para el porqué: un plan
// 'pro' cancelado no perdía el acceso hasta esta revisión).
import { TRIAL_DAYS, PAID_PLANS, getPlanStatus } from './plan-access.js';
export { TRIAL_DAYS, PAID_PLANS };

export const MODALITIES = ['professional', 'freelance', 'company'];
export const SOCIAL_KEYS = ['instagram', 'facebook', 'linkedin', 'twitter', 'youtube', 'tiktok', 'whatsapp'];
export const PRIMARY_ACTIONS = ['contact', 'quote', 'booking', 'catalog'];

// =====================================================================
// TEMAS Y PRESENTACIÓN DEL LOGO — dos temas exclusivos y tres
// presentaciones de logo, sin personalización libre de color/tipografía
// (ver instrucción). Estos tokens y fórmulas los importa DIRECTAMENTE
// functions/c/[id].js (misma runtime de servidor — comparten código de
// verdad). El cliente (business.js) no puede importar módulos de
// functions/ al ser un <script> clásico de navegador, así que duplica
// estos mismos valores con un comentario cruzado a este archivo — igual
// patrón que ya usa LIMITS.
export const CARD_THEMES = ['dark', 'light'];
export const LOGO_PRESENTATIONS = ['direct', 'framed', 'integrated'];

// "Oscuro IDENTIFLY": fondo negro, texto claro, acento verde de la app
// con neón SUAVE reservado a títulos/controles (nunca en párrafos
// largos). "Claro": fondo blanco, texto negro, profundidad con sombras
// suaves en vez de neón (el verde de acento se oscurece para mantener
// contraste legible sobre blanco).
export const THEME_TOKENS = {
  dark: {
    bg: '#0a0a0a', text: '#e8e8e8', muted: 'rgba(255,255,255,0.45)',
    accent: '#AAFF00', accentGlow: '0 0 6px rgba(170,255,0,0.45)',
    surface: 'rgba(255,255,255,0.07)', surfaceBorder: 'rgba(255,255,255,0.14)',
    shadow: '0 6px 16px -6px rgba(0,0,0,0.55)', hairline: 'rgba(255,255,255,0.08)',
    accentSoftBg: 'rgba(170,255,0,0.05)', accentBorder: 'rgba(170,255,0,0.3)',
    mainActionBg: 'linear-gradient(180deg, rgba(170,255,0,0.16), rgba(8,8,8,0.5) 65%, rgba(0,0,0,0.55))',
    mainActionColor: '#AAFF00', mainActionBorder: '1px solid rgba(170,255,0,0.5)',
    mainActionShadow: 'inset 0 1px 0 rgba(170,255,0,0.5), 0 8px 20px -8px rgba(0,0,0,0.6)',
  },
  light: {
    bg: '#ffffff', text: '#1a1a1a', muted: 'rgba(0,0,0,0.5)',
    accent: '#2f6600', accentGlow: 'none',
    surface: '#f2f2f2', surfaceBorder: 'rgba(0,0,0,0.08)',
    shadow: '0 4px 14px -4px rgba(0,0,0,0.18)', hairline: 'rgba(0,0,0,0.08)',
    accentSoftBg: 'rgba(47,102,0,0.06)', accentBorder: 'rgba(47,102,0,0.35)',
    mainActionBg: '#2f6600',
    mainActionColor: '#ffffff', mainActionBorder: 'none',
    mainActionShadow: '0 4px 14px -4px rgba(0,0,0,0.25)',
  },
};

// Límites de los tres únicos ajustes permitidos (tamaño, espacio,
// intensidad de la transición) — evitan desbordamientos o que el logo
// desplace excesivamente el resto del contenido.
export const DESIGN_LIMITS = {
  logoSizeMin: 60, logoSizeMax: 140, logoSizeDefault: 100,
  logoPaddingMin: 0, logoPaddingMax: 100, logoPaddingDefault: 40,
  gradientIntensityMin: 0, gradientIntensityMax: 100, gradientIntensityDefault: 60,
};

export const DEFAULT_DESIGN = {
  theme: 'dark', // predeterminado cuando no hay elección guardada (ver instrucción)
  logoPresentation: 'direct',
  logoSize: DESIGN_LIMITS.logoSizeDefault,
  logoPadding: DESIGN_LIMITS.logoPaddingDefault,
  gradientIntensity: DESIGN_LIMITS.gradientIntensityDefault,
};

function clampDesignNum(v, min, max, def) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.round(n)));
}

// Nunca acepta CSS/HTML ni valores fuera de la lista cerrada — cualquier
// valor no reconocido o fuera de rango se sustituye por el predeterminado
// (nunca se rechaza toda la publicación por esto: son preferencias
// cosméticas, no datos de contacto). Un registro/borrador SIN `design`
// (creado antes de esta función) recibe DEFAULT_DESIGN completo aquí
// mismo, en el momento de leer/validar — nunca se reescribe nada en el
// almacenamiento hasta que el propio usuario cambie algo y publique.
export function sanitizeDesign(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  return {
    theme: CARD_THEMES.includes(d.theme) ? d.theme : DEFAULT_DESIGN.theme,
    logoPresentation: LOGO_PRESENTATIONS.includes(d.logoPresentation) ? d.logoPresentation : DEFAULT_DESIGN.logoPresentation,
    logoSize: clampDesignNum(d.logoSize, DESIGN_LIMITS.logoSizeMin, DESIGN_LIMITS.logoSizeMax, DESIGN_LIMITS.logoSizeDefault),
    logoPadding: clampDesignNum(d.logoPadding, DESIGN_LIMITS.logoPaddingMin, DESIGN_LIMITS.logoPaddingMax, DESIGN_LIMITS.logoPaddingDefault),
    gradientIntensity: clampDesignNum(d.gradientIntensity, DESIGN_LIMITS.gradientIntensityMin, DESIGN_LIMITS.gradientIntensityMax, DESIGN_LIMITS.gradientIntensityDefault),
  };
}

// Geometría del bloque de logo a partir de las preferencias ya
// saneadas. blockSize es el tamaño del propio logo; outerSize (solo
// relevante en 'integrated') es el área donde respira el degradado
// alrededor — SIEMPRE mayor o igual que blockSize, nunca al revés, así
// el degradado nunca puede recortar ni tapar el logo. innerStopPct
// controla cuánto de ese área extra es "sólido" antes de empezar a
// desvanecer (más intensidad = transición más amplia y gradual).
export function computeLogoLayout(design) {
  const blockBase = 96; // px, tamaño de referencia al 100%
  const blockSize = Math.round(blockBase * design.logoSize / 100); // 58..134
  const paddingPx = Math.round(4 + (design.logoPadding / 100) * 20); // 4..24
  const outerSize = design.logoPresentation === 'integrated' ? Math.round(blockSize * 1.6) : blockSize;
  const innerStopPct = Math.round(45 - (design.gradientIntensity / 100) * 35); // 10..45
  return { blockSize, paddingPx, outerSize, innerStopPct };
}

// Límites de texto/imagen — se aplican EXACTAMENTE igual en cliente
// (business.js) y aquí en servidor. El límite de imagen es bajo a
// propósito: hoy no existe binding de almacenamiento de objetos (R2) en
// este proyecto (solo PLANS_KV y SHARE_KV, ambos KV de texto/JSON), así
// que las imágenes de Business viajan como data URI embebidas dentro del
// mismo registro KV (ver business-publish.js). KV admite valores de hasta
// 25MB, pero servir tarjetas públicas con imágenes grandes incrustadas en
// el HTML sería lento e imposible de cachear en CDN — de ahí el límite
// deliberadamente conservador. Ver INFORME de entrega para la
// recomendación de migrar a R2 si se provisiona más adelante.
export const LIMITS = {
  displayName: 60,
  tagline: 90,
  description: 500,
  serviceItem: 80,
  servicesMax: 6,
  serviceArea: 100,
  address: 160,
  hours: 160,
  phone: 30,
  email: 120,
  contactPerson: 60,
  contactRole: 60,
  url: 300,
  galleryMax: 4,
  imageBytesMax: 260 * 1024,
  payloadBytesMax: 1.5 * 1024 * 1024,
};

// Comparación en tiempo constante — mismo patrón que check-plan.js /
// stripe-webhook.js / register-complete.js.
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Verifica identidad (email+token) contra PLANS_KV y calcula el mismo
// veredicto de plan/trial que check-plan.js (vía plan-access.js) —
// Business nunca decide esto por su cuenta, para no divergir del
// comportamiento ya auditado del resto de la app.
export async function authenticateOwner(env, email, token) {
  if (!email || !token || typeof token !== 'string') return { ok: false, reason: 'credenciales_invalidas' };
  const emailKey = String(email).toLowerCase();

  const status = await getPlanStatus(env, emailKey);
  if (!status) return { ok: false, reason: 'credenciales_invalidas' };
  if (!status.reg.token || !timingSafeEqual(status.reg.token, token)) return { ok: false, reason: 'credenciales_invalidas' };

  return { ok: true, emailKey, plan: status.plan, bloqueado: status.bloqueado, esPago: status.paidActive };
}

// Identificador público opaco, DETERMINISTA a partir del email de la
// cuenta (HMAC-SHA256 con un secreto que solo conoce el servidor,
// env.BUSINESS_ID_SECRET — ver INFORME de entrega para cómo generarlo y
// configurarlo). No es reversible: nadie puede recuperar el email a
// partir del id sin el secreto, así que sigue sin llevar datos
// personales (ver instrucción).
//
// El diseño anterior generaba un id ALEATORIO en el primer publish y lo
// indexaba en 'bizowner:'+emailKey. Bajo dos publicaciones "primera vez"
// verdaderamente simultáneas de la misma cuenta (doble toque en mala
// conexión, dos pestañas, un reintento que llega a la vez que el
// original) existía una ventana de carrera real: ambas podían leer
// 'bizowner:'+emailKey como inexistente antes de que ninguna lo hubiera
// escrito, generar dos ids distintos y dejar una tarjeta huérfana
// publicada para siempre, inalcanzable desde business-unpublish/
// -reactivate/-fetch (que solo conocen el id "ganador"). Derivar el id
// sin ningún paso de lectura-antes-de-escribir elimina esa ventana por
// construcción: dos peticiones concurrentes calculan siempre el MISMO
// id y acaban escribiendo el mismo registro (última escritura gana,
// nunca dos registros). Esto también hace innecesario el índice
// 'bizowner:' — ver business-publish.js/-unpublish.js/-reactivate.js/
// -fetch.js.
export async function deriveBusinessId(env, emailKey) {
  const secret = env.BUSINESS_ID_SECRET;
  if (!secret) throw new Error('falta_configurar_BUSINESS_ID_SECRET');
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('identifly-business:' + emailKey));
  const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, 32); // 128 bits — misma longitud que el UUID-sin-guiones anterior
}

export function isHttpUrl(str, maxLen) {
  if (typeof str !== 'string' || !str || str.length > maxLen) return false;
  let u;
  try { u = new URL(str); } catch (_) { return false; }
  return u.protocol === 'http:' || u.protocol === 'https:';
}

function clampText(v, maxLen) {
  if (v === undefined || v === null) return '';
  const s = String(v).trim();
  if (s.length > maxLen) return null; // señal de "demasiado largo" (se rechaza, no se trunca en silencio)
  return s;
}

// Valida el tamaño real de una imagen data:URI (base64) sin necesitar
// librerías de imagen — cuenta bytes decodificados a partir de la
// longitud de la cadena base64. Solo admite PNG/JPEG/WebP: nunca SVG
// (podría contener <script>) ni otros formatos "activos".
export function validateImageDataUri(dataUri, maxBytes) {
  if (typeof dataUri !== 'string') return null;
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+=*)$/.exec(dataUri);
  if (!m) return null;
  const b64 = m[2];
  const approxBytes = Math.floor(b64.length * 3 / 4);
  if (approxBytes > maxBytes || approxBytes < 16) return null;
  return dataUri;
}

// Construye y valida el payload público de una tarjeta Business a partir
// de datos crudos del cliente. Lista explícita de campos admitidos: nada
// que no esté aquí llega nunca a guardarse ni a publicarse (ver
// instrucción "no envíes el perfil completo para ocultar campos después").
// Devuelve { ok:true, data } o { ok:false, error }.
export function validateBusinessPayload(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'payload_invalido' };

  if (!MODALITIES.includes(raw.modality)) return { ok: false, error: 'modalidad_invalida' };

  const displayName = clampText(raw.displayName, LIMITS.displayName);
  if (displayName === null || !displayName) return { ok: false, error: 'nombre_invalido' };

  const tagline = clampText(raw.tagline, LIMITS.tagline);
  const description = clampText(raw.description, LIMITS.description);
  const serviceArea = clampText(raw.serviceArea, LIMITS.serviceArea);
  const address = clampText(raw.address, LIMITS.address);
  const hours = clampText(raw.hours, LIMITS.hours);
  const phone = clampText(raw.phone, LIMITS.phone);
  const contactPerson = clampText(raw.contactPerson, LIMITS.contactPerson);
  const contactRole = clampText(raw.contactRole, LIMITS.contactRole);
  if ([tagline, description, serviceArea, address, hours, phone, contactPerson, contactRole].includes(null)) {
    return { ok: false, error: 'campo_demasiado_largo' };
  }

  let email = '';
  if (raw.email) {
    const e = clampText(raw.email, LIMITS.email);
    if (e === null) return { ok: false, error: 'campo_demasiado_largo' };
    if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return { ok: false, error: 'email_invalido' };
    email = e;
  }

  const urlFields = ['web', 'catalogUrl', 'bookingUrl', 'quoteUrl'];
  const urls = {};
  for (const f of urlFields) {
    const v = raw[f];
    if (!v) { urls[f] = ''; continue; }
    if (!isHttpUrl(v, LIMITS.url)) return { ok: false, error: 'url_invalida:' + f };
    urls[f] = v;
  }

  const social = {};
  if (raw.social && typeof raw.social === 'object') {
    for (const key of Object.keys(raw.social)) {
      if (!SOCIAL_KEYS.includes(key)) continue; // se ignora cualquier clave no reconocida, no se rechaza el resto
      const v = raw.social[key];
      if (!v) continue;
      if (!isHttpUrl(v, LIMITS.url)) return { ok: false, error: 'url_invalida:social.' + key };
      social[key] = v;
    }
  }

  let services = [];
  if (Array.isArray(raw.services)) {
    if (raw.services.length > LIMITS.servicesMax) return { ok: false, error: 'demasiados_servicios' };
    for (const s of raw.services) {
      const v = clampText(s, LIMITS.serviceItem);
      if (v === null) return { ok: false, error: 'servicio_demasiado_largo' };
      if (v) services.push(v);
    }
  }

  let gallery = [];
  if (Array.isArray(raw.gallery)) {
    if (raw.gallery.length > LIMITS.galleryMax) return { ok: false, error: 'demasiadas_imagenes' };
    for (const img of raw.gallery) {
      const v = validateImageDataUri(img, LIMITS.imageBytesMax);
      if (!v) return { ok: false, error: 'imagen_invalida' };
      gallery.push(v);
    }
  }

  let logo = '';
  if (raw.logo) {
    const v = validateImageDataUri(raw.logo, LIMITS.imageBytesMax);
    if (!v) return { ok: false, error: 'logo_invalido' };
    logo = v;
  }

  if (!PRIMARY_ACTIONS.includes(raw.primaryAction)) return { ok: false, error: 'accion_invalida' };
  const primaryAction = raw.primaryAction;
  // La acción principal solo es válida si su destino real está configurado —
  // nunca se publica un botón sin destino (ver instrucción "no muestres
  // botones vacíos").
  const destinoValido = {
    contact: !!(phone || email),
    quote: !!urls.quoteUrl,
    booking: !!urls.bookingUrl,
    catalog: !!urls.catalogUrl,
  };
  if (!destinoValido[primaryAction]) return { ok: false, error: 'accion_sin_destino' };

  const data = {
    modality: raw.modality,
    displayName,
    logo,
    tagline: tagline || '',
    description: description || '',
    services,
    serviceArea: serviceArea || '',
    address: address || '',
    hours: hours || '',
    phone: phone || '',
    email,
    contactPerson: contactPerson || '',
    contactRole: contactRole || '',
    web: urls.web,
    catalogUrl: urls.catalogUrl,
    bookingUrl: urls.bookingUrl,
    quoteUrl: urls.quoteUrl,
    social,
    gallery,
    primaryAction,
    design: sanitizeDesign(raw.design),
  };

  const size = new TextEncoder().encode(JSON.stringify(data)).length;
  if (size > LIMITS.payloadBytesMax) return { ok: false, error: 'payload_demasiado_grande' };

  return { ok: true, data };
}

export function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
