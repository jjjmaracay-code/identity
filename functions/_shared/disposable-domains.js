// Lista de dominios de email desechables/temporales, usada por send-email.js
// para negar el envío de códigos (y por tanto el registro/trial) a quien usa
// una dirección de un solo uso -- ver INFORME Fase 0 (licencias/antiabuso).
//
// PROCEDENCIA (importante, para que quien amplíe esta lista sepa qué hay
// aquí exactamente):
//
// - GRUPO A: las primeras ~40 entradas (orden alfabético, prefijos
//   numéricos) se obtuvieron mediante una herramienta de red en esta sesión
//   leyendo directamente el archivo real:
//     https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf
//   del repositorio:
//     https://github.com/disposable-email-domains/disposable-email-domains
//   Licencia: CC0 1.0 Universal (dominio público), confirmada en el README
//   de ese repositorio el 2026-10-14.
//
// - GRUPO B: proveedores de email desechable ampliamente conocidos y
//   documentados públicamente (Mailinator, GuerrillaMail, YOPmail, 10 Minute
//   Mail, etc.). Esta sesión no tuvo acceso para descargar y verificar byte
//   a byte el archivo completo de arriba (~3500 dominios) -- en vez de
//   copiarlo de memoria y arriesgar una atribución falsa a esa fuente y
//   licencia, este grupo se añadió a mano. Son solo nombres de dominio (no
//   contenido con derechos de autor), así que no hay cuestión de licencia
//   sobre ellos.
//
// Para ampliar esta lista con cobertura mucho mayor (miles de dominios,
// mantenida activamente), sustituye o complementa este archivo con el
// contenido íntegro de disposable_email_blocklist.conf del repositorio de
// arriba -- su licencia CC0 permite copiarlo sin restricción.
//
// La comparación (ver isDisposableDomain) es siempre por DOMINIO COMPLETO en
// minúsculas, nunca por subcadena, para no bloquear por error un dominio
// legítimo que simplemente contenga una de estas palabras.
export const DISPOSABLE_EMAIL_DOMAINS = new Set([
  // --- Grupo A: fuente verificada por red, ver nota de licencia arriba ---
  '0-mail.com',
  '0-mailer.dynv6.net',
  '000-webmail.myhome-server.de',
  '000000000000000.theworkpc.com',
  '000000000000000000.dynv6.net',
  '000webmail.ddnss.de',
  '000webmail.ddnss.org',
  '000webmail.dyn-ip24.de',
  '000webmail.dyn.ddnss.de',
  '000webmail.dyn.home-webserver.de',
  '000webmail.dyndns.ddnss.de',
  '000webmail.dyndns1.de',
  '000webmail.home-webserver.de',
  '00jac.com',
  '01022.hk',
  '010530.xyz',
  '01130.hk',
  '020307.xyz',
  '027168.com',
  '045692.xyz',
  '062e.com',
  '0815.ru',
  '0815.su',
  '0845.ru',
  '092088.xyz',
  '0box.eu',
  '0cd.cn',
  '0clickemail.com',
  '0cpub2.tech',
  '0n0ff.net',
  '0nelce.com',
  '0rg.fr',
  '0v.ro',
  '0w.ro',
  '0wnd.net',
  '0wnd.org',
  '0x207.info',
  '1-8.biz',
  '1-mintue-mail.ddnsgeek.com',
  '1-second-mail.site',

  // --- Grupo B: proveedores conocidos añadidos a mano, ver nota arriba ---
  'mailinator.com',
  'guerrillamail.com',
  'guerrillamail.net',
  'guerrillamail.org',
  'guerrillamail.biz',
  'guerrillamailblock.com',
  'sharklasers.com',
  'grr.la',
  'pokemail.net',
  'spam4.me',
  '10minutemail.com',
  '10minutemail.net',
  '20minutemail.com',
  'temp-mail.org',
  'tempmail.com',
  'tempmailo.com',
  'throwawaymail.com',
  'trashmail.com',
  'trashmail.net',
  'trash-mail.com',
  'yopmail.com',
  'yopmail.net',
  'yopmail.fr',
  'maildrop.cc',
  'getnada.com',
  'getairmail.com',
  'dispostable.com',
  'fakeinbox.com',
  'mailnesia.com',
  'mohmal.com',
  'moakt.com',
  'emailondeck.com',
  'mytemp.email',
  'mintemail.com',
  'mailcatch.com',
  'spamgourmet.com',
  'mailnull.com',
  'discard.email',
  'tempinbox.com',
  'anonbox.net',
  'burnermail.io',
  'einrot.com',
  'fakemailgenerator.com',
  'inboxbear.com',
  'spambog.com',
  'spamex.com',
  'tempr.email',
  'luxusmail.org',
  'wegwerfemail.de',
  'wegwerfmail.de',
  'trbvm.com',
  'nada.email',
  'crazymailing.com',
  '33mail.com',
]);

export function isDisposableDomain(email) {
  if (!email || typeof email !== 'string') return false;
  const at = email.lastIndexOf('@');
  if (at === -1) return false;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return DISPOSABLE_EMAIL_DOMAINS.has(domain);
}
