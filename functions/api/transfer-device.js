// Transferencia de dispositivo (fases 4-5 del lote de licencias). Libera
// un dispositivo existente de la cuenta (lo marca como revocado, NUNCA lo
// borra del servidor -- el propio dispositivo revocado se borra a sí
// mismo en su siguiente check-plan, ver ese archivo) y activa el
// dispositivo nuevo que hace esta llamada.
//
// SOLO con DEVICE_LIMIT_ENFORCED==='true' se ejecuta la transferencia de
// verdad -- con el interruptor apagado, este endpoint no revoca ni activa
// nada (regla 1: todo el bloqueo/gestión de dispositivos depende de él).
import {
  isValidDeviceId, getDevicesList, findDevice, isDeviceActive, markDeviceRevoked,
  forceActivateDevice, isDeviceLimitEnforced, getTransferCooldownUntil, setLastTransferAt,
} from '../_shared/devices.js';
import { onRequestPost as sendEmailPost } from './send-email.js';

const MOTIVOS_VALIDOS = new Set(['cambio_movil', 'robo', 'perdida', 'rotura', 'otro']);
const MAX_FAILED_ATTEMPTS = 5;

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hashIp(ip, salt) {
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function err(status, error, extra) {
  return new Response(JSON.stringify({ ok: false, error, ...extra }), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

// Mismo patrón de consumo que register-complete.js (5 fallos invalidan el
// código, expiration ancla a createdAt, nunca se alarga la ventana).
async function verificarYConsumirCodigo(env, emailKey, code) {
  const raw = await env.PLANS_KV.get('verify:' + emailKey);
  if (!raw) return false;
  let data;
  try { data = JSON.parse(raw); } catch (_) { return false; }

  const ok = !!data?.code && timingSafeEqual(String(data.code), String(code));
  if (ok) return true;

  const now = Math.floor(Date.now() / 1000);
  const attempts = (data.attempts || 0) + 1;
  const expiration = Number.isFinite(data.createdAt) ? Math.floor(data.createdAt / 1000) + 600 : null;
  const debeInvalidarse = attempts >= MAX_FAILED_ATTEMPTS || expiration === null || expiration - now < 60;
  try {
    if (debeInvalidarse) await env.PLANS_KV.delete('verify:' + emailKey);
    else await env.PLANS_KV.put('verify:' + emailKey, JSON.stringify({ ...data, attempts }), { expiration });
  } catch (_) { /* fallo transitorio de KV -- el código ya queda tratado como inválido abajo */ }
  return false;
}

// Textos del email de aviso (regla 9: idioma de la cuenta si existe --
// aquí, el del dispositivo que completa la transferencia-- si no,
// castellano). Motivo ya traducido por separado (ver REASON_LABELS).
const REASON_LABELS = {
  es: { cambio_movil: 'Cambié de móvil', robo: 'Robo', perdida: 'Pérdida', rotura: 'Se rompió', otro: 'Otro' },
  ca: { cambio_movil: 'Vaig canviar de mòbil', robo: 'Robatori', perdida: 'Pèrdua', rotura: 'Es va trencar', otro: 'Altre' },
  eu: { cambio_movil: 'Mugikorra aldatu dut', robo: 'Lapurreta', perdida: 'Galera', rotura: 'Hondatu zen', otro: 'Beste bat' },
  gl: { cambio_movil: 'Cambiei de móbil', robo: 'Roubo', perdida: 'Perda', rotura: 'Rompeuse', otro: 'Outro' },
  en: { cambio_movil: 'I changed phones', robo: 'Theft', perdida: 'Loss', rotura: 'It broke', otro: 'Other' },
  fr: { cambio_movil: "J'ai changé de téléphone", robo: 'Vol', perdida: 'Perte', rotura: "Il s'est cassé", otro: 'Autre' },
  de: { cambio_movil: 'Ich habe das Handy gewechselt', robo: 'Diebstahl', perdida: 'Verlust', rotura: 'Es ist kaputt gegangen', otro: 'Andere' },
  pt: { cambio_movil: 'Troquei de celular', robo: 'Roubo', perdida: 'Perda', rotura: 'Quebrou', otro: 'Outro' },
  hi: { cambio_movil: 'मैंने फ़ोन बदला', robo: 'चोरी', perdida: 'खोना', rotura: 'टूट गया', otro: 'अन्य' },
  zh: { cambio_movil: '更换了手机', robo: '被盗', perdida: '丢失', rotura: '损坏了', otro: '其他' },
  ru: { cambio_movil: 'Я сменил телефон', robo: 'Кража', perdida: 'Потеря', rotura: 'Сломался', otro: 'Другое' },
  ja: { cambio_movil: '携帯を変更した', robo: '盗難', perdida: '紛失', rotura: '故障した', otro: 'その他' },
};

const NOTICE_TEXT = {
  es: { subject: 'IDENTIFLY — Dispositivo actualizado en tu cuenta', alert: 'DISPOSITIVO TRANSFERIDO', intro: 'Se ha liberado un dispositivo de tu cuenta IDENTIFLY y se ha activado uno nuevo.', message: (m) => `Motivo indicado: ${m}. Si no has sido tú, escríbenos a privacidad@identifly.app lo antes posible.` },
  ca: { subject: 'IDENTIFLY — Dispositiu actualitzat al teu compte', alert: 'DISPOSITIU TRANSFERIT', intro: "S'ha alliberat un dispositiu del teu compte IDENTIFLY i se n'ha activat un de nou.", message: (m) => `Motiu indicat: ${m}. Si no has estat tu, escriu-nos a privacidad@identifly.app com més aviat millor.` },
  eu: { subject: 'IDENTIFLY — Zure kontuko gailua eguneratu da', alert: 'GAILUA TRANSFERITU DA', intro: 'Zure IDENTIFLY kontuko gailu bat askatu da eta berri bat aktibatu da.', message: (m) => `Adierazitako arrazoia: ${m}. Ez bazara zu izan, idatzi privacidad@identifly.app helbidera ahalik eta lasterren.` },
  gl: { subject: 'IDENTIFLY — Dispositivo actualizado na túa conta', alert: 'DISPOSITIVO TRANSFERIDO', intro: 'Liberouse un dispositivo da túa conta IDENTIFLY e activouse un novo.', message: (m) => `Motivo indicado: ${m}. Se non foches ti, escríbenos a privacidad@identifly.app canto antes.` },
  en: { subject: 'IDENTIFLY — Device updated on your account', alert: 'DEVICE TRANSFERRED', intro: 'A device on your IDENTIFLY account has been released and a new one has been activated.', message: (m) => `Reason given: ${m}. If this wasn't you, contact privacidad@identifly.app as soon as possible.` },
  fr: { subject: 'IDENTIFLY — Appareil mis à jour sur votre compte', alert: 'APPAREIL TRANSFÉRÉ', intro: 'Un appareil de votre compte IDENTIFLY a été libéré et un nouveau a été activé.', message: (m) => `Motif indiqué : ${m}. Si ce n'était pas vous, contactez privacidad@identifly.app dès que possible.` },
  de: { subject: 'IDENTIFLY — Gerät in deinem Konto aktualisiert', alert: 'GERÄT ÜBERTRAGEN', intro: 'Ein Gerät deines IDENTIFLY-Kontos wurde freigegeben und ein neues wurde aktiviert.', message: (m) => `Angegebener Grund: ${m}. Falls das nicht du warst, kontaktiere bitte schnellstmöglich privacidad@identifly.app.` },
  pt: { subject: 'IDENTIFLY — Dispositivo atualizado na tua conta', alert: 'DISPOSITIVO TRANSFERIDO', intro: 'Um dispositivo da tua conta IDENTIFLY foi liberado e um novo foi ativado.', message: (m) => `Motivo indicado: ${m}. Se não foste tu, contacta privacidad@identifly.app o mais rápido possível.` },
  hi: { subject: 'IDENTIFLY — आपके खाते में डिवाइस अपडेट हुआ', alert: 'डिवाइस ट्रांसफर हुआ', intro: 'आपके IDENTIFLY खाते से एक डिवाइस हटाया गया है और एक नया डिवाइस सक्रिय किया गया है।', message: (m) => `बताया गया कारण: ${m}। यदि यह आप नहीं थे, तो कृपया जल्द से जल्द privacidad@identifly.app पर संपर्क करें।` },
  zh: { subject: 'IDENTIFLY — 您账户中的设备已更新', alert: '设备已转移', intro: '您 IDENTIFLY 账户中的一台设备已被解除，并激活了一台新设备。', message: (m) => `填写的原因：${m}。如果这不是您本人操作，请尽快联系 privacidad@identifly.app。` },
  ru: { subject: 'IDENTIFLY — устройство в вашем аккаунте обновлено', alert: 'УСТРОЙСТВО ПЕРЕНЕСЕНО', intro: 'Одно устройство в вашем аккаунте IDENTIFLY было отключено, и активировано новое.', message: (m) => `Указанная причина: ${m}. Если это были не вы, как можно скорее напишите на privacidad@identifly.app.` },
  ja: { subject: 'IDENTIFLY — アカウントのデバイスが更新されました', alert: 'デバイスが移行されました', intro: 'IDENTIFLYアカウントのデバイスが1台解除され、新しいデバイスが有効化されました。', message: (m) => `記載された理由: ${m}。もし心当たりがない場合は、できるだけ早く privacidad@identifly.app までご連絡ください。` },
};

async function enviarAvisoTransferencia(env, email, lang, motivo) {
  const idioma = NOTICE_TEXT[lang] ? lang : 'es';
  const textos = NOTICE_TEXT[idioma];
  const motivoLabel = (REASON_LABELS[idioma] || REASON_LABELS.es)[motivo] || motivo;
  const body = {
    template: 'notice', to_email: email, to_name: '',
    subject: textos.subject, alert: textos.alert, intro: textos.intro,
    message: textos.message(motivoLabel),
  };
  const fakeRequest = new Request('https://internal/api/send-email', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    await sendEmailPost({ request: fakeRequest, env });
  } catch (_) {
    // El aviso es best-effort -- un fallo de envío nunca debe deshacer
    // una transferencia que ya se aplicó de verdad.
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!isDeviceLimitEnforced(env)) {
    return err(403, 'device_limit_not_enforced');
  }

  let body;
  try { body = await request.json(); } catch (_) { return err(400, 'json_invalido'); }

  const { email, token, deviceIdViejo, deviceIdNuevo, motivo, code, lang } = body || {};
  if (!email || !token || typeof token !== 'string') return err(400, 'faltan_datos');
  if (!isValidDeviceId(deviceIdViejo) || !isValidDeviceId(deviceIdNuevo)) return err(400, 'deviceId_invalido');
  if (deviceIdViejo === deviceIdNuevo) return err(400, 'mismo_dispositivo');
  if (!MOTIVOS_VALIDOS.has(motivo)) return err(400, 'motivo_invalido');
  if (!code || typeof code !== 'string') return err(400, 'codigo_invalido_o_caducado');

  const emailKey = email.toLowerCase();

  // Rate limit por IP -- operación sensible, mismo criterio que
  // delete-account.js (umbral bajo: como mucho un puñado de veces por
  // cuenta en toda su vida).
  const now = Math.floor(Date.now() / 1000);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const ipHash = await hashIp(ip, env.IP_HASH_SALT);
  const rlIpKey = 'ratelimit:ip:transfer-device:' + ipHash;
  const SHORT_WINDOW_IP = 600, SHORT_LIMIT_IP = 5;
  const LONG_WINDOW_IP = 86400, LONG_LIMIT_IP = 20;
  const rlIpRaw = await env.PLANS_KV.get(rlIpKey);
  const rlIp = rlIpRaw ? JSON.parse(rlIpRaw) : { count: 0, windowStart: now, dayCount: 0, dayStart: now };
  if (now - rlIp.windowStart >= SHORT_WINDOW_IP) { rlIp.count = 0; rlIp.windowStart = now; }
  if (now - rlIp.dayStart >= LONG_WINDOW_IP) { rlIp.dayCount = 0; rlIp.dayStart = now; }
  if (rlIp.count >= SHORT_LIMIT_IP || rlIp.dayCount >= LONG_LIMIT_IP) {
    return err(429, 'rate_limited', { retryAfter: SHORT_WINDOW_IP });
  }
  rlIp.count++; rlIp.dayCount++;
  await env.PLANS_KV.put(rlIpKey, JSON.stringify(rlIp), { expirationTtl: LONG_WINDOW_IP });

  // Token real de la cuenta -- mismo patrón timing-safe que check-plan.js.
  const regRaw = await env.PLANS_KV.get('reg:' + emailKey);
  if (!regRaw) return err(401, 'no_verificado');
  let reg;
  try { reg = JSON.parse(regRaw); } catch (_) { return err(401, 'no_verificado'); }
  if (!reg.token || !timingSafeEqual(reg.token, token)) return err(401, 'no_verificado');

  // Código de verificación real (el mismo mecanismo de send-email.js que
  // ya usa register-complete.js) -- se consume aquí mismo.
  const codigoOk = await verificarYConsumirCodigo(env, emailKey, code);
  if (!codigoOk) return err(400, 'codigo_invalido_o_caducado');

  const lista = await getDevicesList(env, emailKey);
  const viejo = findDevice(lista, deviceIdViejo);
  if (!viejo || !isDeviceActive(viejo)) return err(400, 'dispositivo_no_encontrado');

  // Cooldown de 24h entre transferencias -- solo Lifetime (regla 6). Pro
  // no tiene cooldown propio en esta regla.
  const paidRaw = await env.PLANS_KV.get(emailKey);
  let plan = null;
  try { plan = paidRaw ? JSON.parse(paidRaw).plan : null; } catch (_) { plan = null; }

  if (plan === 'lifetime') {
    const puedeDesde = await getTransferCooldownUntil(env, emailKey);
    if (puedeDesde) return err(403, 'cooldown_activo', { puedeDesde });
  }

  const revocado = await markDeviceRevoked(env, emailKey, deviceIdViejo, motivo);
  if (!revocado) return err(500, 'no_se_pudo_revocar');

  await forceActivateDevice(env, emailKey, deviceIdNuevo, request.headers.get('User-Agent'));

  if (plan === 'lifetime') {
    await setLastTransferAt(env, emailKey);
  }

  await enviarAvisoTransferencia(env, email, lang, motivo);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestGet() {
  return err(405, 'metodo_no_permitido');
}
