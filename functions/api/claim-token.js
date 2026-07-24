// Migración para cuentas registradas ANTES de que existiera el sistema
// de token (ver register-complete.js / check-plan.js). Asigna un token
// una única vez por email, y solo si quien lo pide puede demostrar —de
// forma débil— que ya usó la app antes: debe enviar el mismo
// `registeredAt` exacto que el servidor guardó para ese email en su
// momento (ese valor vive en el localStorage del propio navegador desde
// el registro original).
//
// LIMITACIÓN DE SEGURIDAD CONOCIDA (documentada a propósito, no oculta):
// si alguien conoce el email de un usuario YA registrado antes de esta
// migración, Y consigue también su `registeredAt` exacto, podría
// reclamar el token de esa persona antes que ella. El `registeredAt` no
// se expone en ningún sitio público, pero tampoco es un secreto
// criptográfico — solo vive en el localStorage de quien se registró. Es
// una mitigación PARCIAL: cierra el ataque de "solo conozco el email"
// (que es exactamente lo que exploraba la vulnerabilidad de enumeración
// original), pero no protege contra alguien con acceso directo al
// localStorage de la víctima (lo cual ya implicaría acceso a su
// dispositivo, un nivel de compromiso distinto). Una vez reclamado, el
// email queda con token para siempre — no se puede volver a reclamar, ni
// siquiera con el registeredAt correcto.
function genericReject() {
  return new Response(JSON.stringify({ ok: false }), {
    status: 200, headers: { 'Content-Type': 'application/json' }
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let email, registeredAt;
  try {
    ({ email, registeredAt } = await request.json());
  } catch (_) {
    return genericReject();
  }
  if (!email || !registeredAt) return genericReject();

  const emailKey = email.toLowerCase();
  const regRaw = await env.PLANS_KV.get('reg:' + emailKey);
  if (!regRaw) return genericReject();

  let reg;
  try { reg = JSON.parse(regRaw); } catch (_) { return genericReject(); }

  // Ya tiene token asignado: no se puede reclamar de nuevo. Misma
  // respuesta que "no existe" — no revela si el email está registrado
  // ni si ya fue migrado.
  if (reg.token) return genericReject();

  // El registeredAt debe coincidir EXACTO con el que el servidor guardó
  // en su momento — es la prueba débil de que quien pide esto ya se
  // registró antes desde ese dispositivo.
  if (reg.registeredAt !== registeredAt) return genericReject();

  const token = crypto.randomUUID();
  reg.token = token;
  await env.PLANS_KV.put('reg:' + emailKey, JSON.stringify(reg));

  return new Response(JSON.stringify({ ok: true, token }), {
    status: 200, headers: { 'Content-Type': 'application/json' }
  });
}

export async function onRequestGet() {
  return genericReject();
}
