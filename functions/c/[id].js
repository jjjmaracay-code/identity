// Tarjeta pública de IDENTIFLY BUSINESS — /c/{id}.
// Página renderizada en servidor, sin JS de edición ni datos privados en
// el HTML. Debe funcionar para visitantes sin cuenta y sin depender del
// localStorage del propietario (ver instrucción).
//
// El id es opaco (crypto.randomUUID, generado en business-publish.js) y
// no lleva datos personales ni credenciales de gestión — nunca depende
// del email ni de ningún secreto de servidor, así que sigue siendo
// permanente aunque cambie cualquier secreto de la app.
import { SOCIAL_KEYS, THEME_TOKENS, sanitizeDesign, computeLogoLayout } from '../_shared/business.js';
import { getPlanStatus } from '../_shared/plan-access.js';

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeAttr(str) { return escapeHtml(str); }

// Mismo cálculo de acceso que check-plan.js/authenticateOwner (vía
// plan-access.js) — la tarjeta pública deja de servirse cuando el acceso
// de pago del propietario caduca, aunque el registro siga marcado como
// publicado (los datos no se borran, ver instrucción). No requiere el
// token del propietario: aquí solo se consulta el estado de SU cuenta,
// ya fijado en el momento de publicar. 'pro' respeta el periodo YA
// PAGADO (currentPeriodEnd) aunque la renovación esté cancelada;
// 'lifetime' nunca caduca — ver plan-access.js.
async function accesoVigente(env, ownerEmailKey) {
  const status = await getPlanStatus(env, ownerEmailKey);
  return !!status && !status.bloqueado;
}

function paginaNoDisponible(status) {
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>IDENTIFLY · Tarjeta no disponible</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#080808;color:rgba(255,255,255,0.75);font-family:'Inter',system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center}
  .box{max-width:360px}
  h1{color:#AAFF00;font-size:14px;letter-spacing:2px;text-transform:uppercase;margin-bottom:12px;text-shadow:0 0 8px rgba(170,255,0,0.4)}
  p{font-size:13px;line-height:1.6;color:rgba(255,255,255,0.45)}
</style></head><body>
  <div class="box"><h1>IDENTIFLY BUSINESS</h1><p>Esta tarjeta no está disponible actualmente. Puede haber sido retirada por su propietario o no existir.</p></div>
</body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
}

// Mismo conjunto que SOCIAL_KEYS (functions/_shared/business.js) — ver
// ese archivo para el porqué de esta lista.
const SOCIAL_LABELS = {
  linkedin: 'LinkedIn', github: 'GitHub', instagram: 'Instagram',
  twitter: 'X / Twitter', youtube: 'YouTube', tiktok: 'TikTok',
};

const ACTION_LABELS = {
  contact: 'Contactar', quote: 'Pedir presupuesto', booking: 'Reservar cita', catalog: 'Ver catálogo',
};

function actionHref(r) {
  if (r.primaryAction === 'contact') {
    if (r.phone) return 'tel:' + encodeURIComponent(r.phone.replace(/\s+/g, ''));
    if (r.email) return 'mailto:' + encodeURIComponent(r.email);
  }
  if (r.primaryAction === 'quote') return r.quoteUrl;
  if (r.primaryAction === 'booking') return r.bookingUrl;
  if (r.primaryAction === 'catalog') return r.catalogUrl;
  return null;
}

function buildVCardPublic(r) {
  let vc = 'BEGIN:VCARD\nVERSION:3.0\n';
  vc += `FN:${r.displayName}\n`;
  if (r.tagline) vc += `TITLE:${r.tagline}\n`;
  if (r.modality === 'company') vc += `ORG:${r.displayName}\n`;
  if (r.phone) vc += `TEL:${r.phone}\n`;
  if (r.email) vc += `EMAIL:${r.email}\n`;
  if (r.web) vc += `URL:${r.web}\n`;
  if (r.address) vc += `ADR:;;${r.address};;;;\n`;
  vc += 'END:VCARD';
  return vc;
}

// Tres presentaciones (ver instrucción, sección de temas y logo):
//   - direct: la imagen tal cual sobre el fondo de la tarjeta, conserva
//     su transparencia si la tiene. Nunca se le aplica ningún fondo
//     propio, así que una imagen con transparencia real la muestra.
//   - framed: superficie discreta (color del tema, no libre) con
//     relieve suave (box-shadow) y bordes redondeados.
//   - integrated: superficie cuyo borde exterior se desvanece con un
//     degradado radial amplio hacia el fondo — el degradado vive
//     ÚNICAMENTE en el contenedor exterior; la imagen se dibuja encima
//     sin ningún filtro/blur/recorte, con su tamaño de siempre (nunca
//     crece con el radio del degradado). Nunca se simula un halo de
//     "fondo eliminado": una imagen con fondo opaco conserva ese fondo
//     tal cual, sin blending ni máscaras.
// Sin logo: no se renderiza ningún bloque (ni marcador de posición) —
// no debe quedar un hueco reservado vacío (ver instrucción).
function renderLogoBlock(r, design, theme) {
  if (!r.logo) return '';
  const { blockSize, paddingPx, outerSize, innerStopPct } = computeLogoLayout(design);
  const imgTag = `<img src="${escapeAttr(r.logo)}" alt="${escapeAttr(r.displayName)}" style="width:100%;height:100%;object-fit:contain;display:block;">`;

  if (design.logoPresentation === 'framed') {
    const radius = Math.round(blockSize * 0.2);
    return `<div class="logo-wrap" style="width:${blockSize}px;height:${blockSize}px;margin:0 auto ${paddingPx}px;padding:${paddingPx}px;box-sizing:border-box;background:${theme.surface};border:1px solid ${theme.surfaceBorder};border-radius:${radius}px;box-shadow:${theme.shadow};display:flex;align-items:center;justify-content:center;">${imgTag}</div>`;
  }
  if (design.logoPresentation === 'integrated') {
    return `<div class="logo-wrap" style="width:${outerSize}px;height:${outerSize}px;margin:0 auto ${paddingPx}px;background:radial-gradient(circle, ${theme.surface} ${innerStopPct}%, transparent 100%);display:flex;align-items:center;justify-content:center;">
      <div style="width:${blockSize}px;height:${blockSize}px;">${imgTag}</div>
    </div>`;
  }
  // 'direct'
  return `<div class="logo-wrap" style="width:${blockSize}px;height:${blockSize}px;margin:0 auto ${paddingPx}px;">${imgTag}</div>`;
}

export async function onRequestGet(context) {
  const { params, env } = context;
  const id = String(params.id || '').replace(/[^a-f0-9]/gi, '');
  if (!id) return paginaNoDisponible(404);

  const raw = await env.BUSINESS_KV.get('biz:' + id);
  if (!raw) return paginaNoDisponible(404);

  let r;
  try { r = JSON.parse(raw); } catch (_) { return paginaNoDisponible(500); }

  if (!r.published) return paginaNoDisponible(404);
  const vigente = await accesoVigente(env, r.ownerEmailKey);
  if (!vigente) return paginaNoDisponible(404);

  // sanitizeDesign() aplica los predeterminados a un registro que
  // todavía no tuviera `design` (publicado antes de esta revisión) —
  // nunca se reescribe el registro en KV solo por leerlo.
  const design = sanitizeDesign(r.design);
  const theme = THEME_TOKENS[design.theme];

  const vcardB64 = btoa(unescape(encodeURIComponent(buildVCardPublic(r))));

  const servicesHtml = (r.services && r.services.length)
    ? `<section class="sec"><h2>Servicios</h2><ul class="services">${r.services.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul></section>`
    : '';

  const galleryHtml = (r.gallery && r.gallery.length)
    ? `<section class="sec"><h2>Galería</h2><div class="gallery">${r.gallery.map(g => `<img src="${escapeAttr(g)}" alt="" loading="lazy">`).join('')}</div></section>`
    : '';

  const locHtml = (r.address || r.hours || r.serviceArea)
    ? `<section class="sec">
        ${r.serviceArea ? `<p class="muted"><strong>Zona de servicio:</strong> ${escapeHtml(r.serviceArea)}</p>` : ''}
        ${r.address ? `<p class="muted"><strong>Dirección:</strong> ${escapeHtml(r.address)}</p>` : ''}
        ${r.hours ? `<p class="muted"><strong>Horario:</strong> ${escapeHtml(r.hours)}</p>` : ''}
      </section>`
    : '';

  const contactLinks = [];
  if (r.phone) contactLinks.push(`<a class="link-btn" href="tel:${escapeAttr(r.phone.replace(/\s+/g, ''))}">Llamar</a>`);
  if (r.email) contactLinks.push(`<a class="link-btn" href="mailto:${escapeAttr(r.email)}">Escribir</a>`);
  if (r.web) contactLinks.push(`<a class="link-btn" href="${escapeAttr(r.web)}" target="_blank" rel="noopener nofollow">Web</a>`);
  for (const key of SOCIAL_KEYS) {
    if (r.social && r.social[key]) contactLinks.push(`<a class="link-btn" href="${escapeAttr(r.social[key])}" target="_blank" rel="noopener nofollow">${SOCIAL_LABELS[key]}</a>`);
  }
  if (r.contactPerson) {
    contactLinks.unshift(`<p class="muted" style="width:100%">${escapeHtml(r.contactPerson)}${r.contactRole ? ' · ' + escapeHtml(r.contactRole) : ''}</p>`);
  }
  const contactHtml = contactLinks.length ? `<section class="sec"><h2>Contacto</h2><div class="links">${contactLinks.join('')}</div></section>` : '';

  const href = actionHref(r);
  const mainActionHtml = href
    ? `<a class="main-action" href="${escapeAttr(href)}" ${/^https?:/i.test(href) ? 'target="_blank" rel="noopener nofollow"' : ''}>${escapeHtml(ACTION_LABELS[r.primaryAction] || 'Contactar')}</a>`
    : '';

  const logoHtml = renderLogoBlock(r, design, theme);

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<meta name="description" content="${escapeAttr(r.tagline || r.displayName)}">
<title>${escapeHtml(r.displayName)} · IDENTIFLY BUSINESS</title>
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  @media (prefers-reduced-motion: reduce){*{animation-duration:0.001ms !important;transition-duration:0.001ms !important}}
  body{background:${theme.bg};color:${theme.text};font-family:'Inter',system-ui,-apple-system,sans-serif;min-height:100vh;padding:24px 16px 48px;display:flex;flex-direction:column;align-items:center}
  a{color:inherit}
  .wrap{width:100%;max-width:420px}
  .name{text-align:center;font-size:19px;font-weight:800;color:${theme.text};letter-spacing:0.3px}
  .tagline{text-align:center;font-size:12px;color:${theme.accent};letter-spacing:1.5px;text-transform:uppercase;margin-top:4px;text-shadow:${theme.accentGlow}}
  .desc{margin-top:16px;font-size:13.5px;line-height:1.7;color:${theme.muted};text-align:center}
  .main-action{display:block;text-align:center;margin:22px 0;padding:15px;border-radius:14px;border:${theme.mainActionBorder};background:${theme.mainActionBg};box-shadow:${theme.mainActionShadow};color:${theme.mainActionColor};font-weight:800;font-size:12.5px;letter-spacing:2px;text-transform:uppercase;text-decoration:none}
  .main-action:active{transform:translateY(1px)}
  .sec{margin-top:22px}
  .sec h2{font-size:10.5px;letter-spacing:2.5px;text-transform:uppercase;color:${theme.accent};margin-bottom:10px}
  .services{list-style:none}
  .services li{font-size:13px;color:${theme.text};opacity:0.85;padding:8px 0;border-bottom:1px solid ${theme.hairline}}
  .muted{font-size:12px;color:${theme.muted};line-height:1.7}
  .links{display:flex;flex-wrap:wrap;gap:8px}
  .link-btn{padding:9px 14px;border-radius:10px;border:1px solid ${theme.accentBorder};background:${theme.accentSoftBg};color:${theme.accent};font-size:11.5px;font-weight:600;letter-spacing:0.5px;text-decoration:none}
  .gallery{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}
  .gallery img{width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:12px;border:1px solid ${theme.hairline}}
  .save-contact{display:block;width:100%;text-align:center;margin-top:28px;padding:13px;border-radius:12px;border:1px solid ${theme.hairline};background:transparent;color:${theme.muted};font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;cursor:pointer}
  .foot{margin-top:24px;text-align:center;font-size:10px;color:${theme.muted};opacity:0.6;letter-spacing:1px}
  :focus-visible{outline:2px solid ${theme.accent};outline-offset:2px}
</style></head>
<body>
  <div class="wrap">
    ${logoHtml}
    <div class="name">${escapeHtml(r.displayName)}</div>
    ${r.tagline ? `<div class="tagline">${escapeHtml(r.tagline)}</div>` : ''}
    ${r.description ? `<p class="desc">${escapeHtml(r.description)}</p>` : ''}
    ${mainActionHtml}
    ${servicesHtml}
    ${galleryHtml}
    ${locHtml}
    ${contactHtml}
    <button class="save-contact" id="btn-save-contact" type="button">Guardar contacto</button>
    <div class="foot">IDENTIFLY BUSINESS</div>
  </div>
  <script>
    document.getElementById('btn-save-contact').addEventListener('click', function () {
      try {
        var vcard = decodeURIComponent(escape(atob('${vcardB64}')));
        var blob = new Blob([vcard], { type: 'text/vcard' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = ${JSON.stringify((r.displayName || 'contacto').replace(/[^\w\- ]/g, '').trim() || 'contacto')} + '.vcf';
        document.body.appendChild(a);
        a.click();
        a.remove();
      } catch (e) {}
    });
  </script>
</body></html>`;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
  });
}
