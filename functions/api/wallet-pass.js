// Genera un enlace "Save to Google Wallet" con una tarjeta IDENTIFLY que
// muestra SOLO nombre y empresa, más un QR con EXACTAMENTE el mismo
// contenido que el QR principal de la app (buildVCard() en index.html,
// que el cliente envía tal cual en contenidoQR).
//
// Requiere SIEMPRE, verificado en servidor:
//   1. Identidad válida (email + token opaco, mismo mecanismo que
//      check-plan.js y business-*.js vía authenticateOwner).
//   2. Plan de pago vigente ahora mismo (pro con periodo pagado vigente,
//      o lifetime), calculado en functions/_shared/plan-access.js. Ni la
//      prueba de 30 días ni la prueba con tarjeta (pro en 'trialing', que
//      computePaidActive sí cuenta como pago) dan acceso. Nunca se confía
//      en el cliente.
//
// IDENTIFLY es local-first: esta función NO guarda nada (ni en KV ni en
// ningún otro almacenamiento). Cada llamada crea un pase NUEVO con un id
// de objeto aleatorio; no hay actualización de pases existentes.
//
// La clave de la cuenta de servicio (GOOGLE_WALLET_SA_KEY) nunca se
// registra en logs ni se devuelve al cliente, ni siquiera parcialmente.
import { authenticateOwner, jsonResponse } from '../_shared/business.js';
import { getPlanStatus } from '../_shared/plan-access.js';

const MAX_NOMBRE = 80;
const MAX_EMPRESA = 80;
// Capacidad máxima de un QR (versión 40) en modo byte con el nivel de
// corrección 'Q' que usa el QR principal (generateQR() en index.html):
// 1663 bytes. Un contenido más largo tampoco cabría en el QR de la app.
const MAX_QR_BYTES = 1663;
const ORIGEN_APP = 'https://www.identifly.app';
// Asset existente del propio dominio (sin CDN externos).
const LOGO_URL = ORIGEN_APP + '/icons/icon-512.png';

function base64UrlFromBytes(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlFromJson(obj) {
  return base64UrlFromBytes(new TextEncoder().encode(JSON.stringify(obj)));
}

// Convierte la private_key PEM (PKCS#8) de la cuenta de servicio a bytes.
function pemToPkcs8(pem) {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function firmarJwtRS256(payload, privateKeyPem) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const contenido = base64UrlFromJson(header) + '.' + base64UrlFromJson(payload);
  const key = await crypto.subtle.importKey(
    'pkcs8', pemToPkcs8(privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );
  const firma = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(contenido));
  return contenido + '.' + base64UrlFromBytes(new Uint8Array(firma));
}

// Valida estrictamente la entrada. Devuelve null si no cumple.
function validarEntrada(body) {
  const { nombre, empresa, contenidoQR } = body || {};
  if (typeof nombre !== 'string' || typeof contenidoQR !== 'string') return null;
  if (empresa !== undefined && empresa !== null && typeof empresa !== 'string') return null;

  const nombreLimpio = nombre.trim();
  const empresaLimpia = typeof empresa === 'string' ? empresa.trim() : '';
  if (!nombreLimpio || nombreLimpio.length > MAX_NOMBRE) return null;
  if (empresaLimpia.length > MAX_EMPRESA) return null;
  if (!contenidoQR || new TextEncoder().encode(contenidoQR).length > MAX_QR_BYTES) return null;

  return { nombre: nombreLimpio, empresa: empresaLimpia, contenidoQR };
}

function textoLocalizado(valor) {
  return { defaultValue: { language: 'es', value: valor } };
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try { body = await request.json(); } catch (_) { return jsonResponse({ ok: false, error: 'payload_invalido' }, 400); }

  const { email, token } = body || {};
  const auth = await authenticateOwner(env, email, token);
  if (!auth.ok) return jsonResponse({ ok: false, error: 'no_autorizado' }, 401);
  if (!auth.esPago) return jsonResponse({ ok: false, error: 'plan_no_habilitado' }, 403);
  // Solo lectura: excluye la prueba con tarjeta, que esPago sí incluye.
  const status = await getPlanStatus(env, auth.emailKey);
  if (!status || status.trialActive) return jsonResponse({ ok: false, error: 'plan_no_habilitado' }, 403);

  const entrada = validarEntrada(body);
  if (!entrada) return jsonResponse({ ok: false, error: 'payload_invalido' }, 400);

  try {
    const issuerId = env.WALLET_ISSUER_ID;
    const sa = JSON.parse(env.GOOGLE_WALLET_SA_KEY || '');
    if (!issuerId || !sa || typeof sa.client_email !== 'string' || typeof sa.private_key !== 'string') {
      throw new Error('config');
    }

    const classId = `${issuerId}.identifly_card`;
    const objeto = {
      id: `${issuerId}.${crypto.randomUUID()}`,
      classId,
      state: 'ACTIVE',
      cardTitle: textoLocalizado('IDENTIFLY'),
      header: textoLocalizado(entrada.nombre),
      barcode: { type: 'QR_CODE', value: entrada.contenidoQR },
      hexBackgroundColor: '#000000',
      logo: { sourceUri: { uri: LOGO_URL } },
    };
    if (entrada.empresa) objeto.subheader = textoLocalizado(entrada.empresa);

    const payload = {
      iss: sa.client_email,
      aud: 'google',
      typ: 'savetowallet',
      iat: Math.floor(Date.now() / 1000),
      origins: [ORIGEN_APP],
      payload: {
        genericClasses: [{ id: classId }],
        genericObjects: [objeto],
      },
    };

    const jwt = await firmarJwtRS256(payload, sa.private_key);
    return jsonResponse({ url: 'https://pay.google.com/gp/v/save/' + jwt }, 200);
  } catch (_) {
    // Sin detalles: ni el error interno ni nada del secret llega al
    // cliente ni a los logs.
    console.log('[wallet-pass] error al generar el pase');
    return jsonResponse({ ok: false, error: 'error_interno' }, 500);
  }
}

export async function onRequestGet() {
  return jsonResponse({ ok: false, error: 'metodo_no_permitido' }, 405);
}
