// =====================================================================
// IDENTIFLY BUSINESS — lógica de cliente (hub, editor, vista previa,
// publicación). Se carga DESPUÉS del script principal de index.html (ver
// <script src="business.js"> al final del body), así que puede usar
// directamente sus funciones y variables globales ya definidas:
// profileData, t(), tOrFallback(), showToast(), applyI18n(), qrDesign,
// buildQROptions(), ensureQRCodeStylingLoaded(), QRCodeStyling,
// openQrZoom()/closeQrZoom()/isQrZoomOpen(). No las redefine ni las
// toca — solo las reutiliza.
//
// Separado por completo de identity_data / profileData: Business vive en
// sus propias claves de localStorage (ver DRAFT_KEY / META_KEY) y nunca
// escribe en STORAGE_KEY ('identity_data'). Guardar un borrador NUNCA
// publica ni sube nada — solo Publicar/Actualizar/Despublicar/Reactivar
// llaman al servidor (ver instrucción, sección 5).
(function () {
  'use strict';

  const DRAFT_KEY = 'identity_business_draft';
  const META_KEY = 'identity_business_publish_meta';

  // Sube junto con CACHE_NAME en sw.js en cada cambio real de este
  // archivo -- únicamente para el diagnóstico temporal (ver
  // diagnosticoBusinessTexto), no afecta a ninguna lógica de negocio.
  const BUSINESS_CODE_VERSION = 'v23';

  const MODALITIES = ['professional', 'freelance', 'company'];
  // MISMO conjunto que functions/_shared/business.js SOCIAL_KEYS -- ver
  // ese archivo para el porqué (se corrige aquí una lista anterior que
  // inventaba 'facebook'/'whatsapp' sin base real y omitía 'github').
  const SOCIAL_KEYS = ['linkedin', 'github', 'instagram', 'twitter', 'youtube', 'tiktok'];
  const SOCIAL_LABELS = { linkedin: 'LinkedIn', github: 'GitHub', instagram: 'Instagram', twitter: 'X / Twitter', youtube: 'YouTube', tiktok: 'TikTok' };
  const ACTION_KEYS = ['contact', 'quote', 'booking', 'catalog'];

  // MISMOS límites que functions/_shared/business.js — si se cambian ahí,
  // hay que cambiarlos aquí también (documentado en ambos sitios).
  const LIMITS = {
    displayName: 60, tagline: 90, description: 500, serviceItem: 80, servicesMax: 6,
    serviceArea: 100, address: 160, hours: 160, phone: 30, email: 120,
    contactPerson: 60, contactRole: 60, url: 300, galleryMax: 4,
    imageBytesMax: 260 * 1024,
  };

  // Temas y presentación del logo — MISMOS valores y fórmulas que
  // functions/_shared/business.js (CARD_THEMES/LOGO_PRESENTATIONS/
  // THEME_TOKENS/DESIGN_LIMITS/computeLogoLayout). business.js es un
  // <script> clásico de navegador y no puede importar ese módulo, así
  // que se duplican aquí — si se cambian allí, cambiar también aquí.
  const CARD_THEMES = ['dark', 'light'];
  const LOGO_PRESENTATIONS = ['direct', 'framed', 'integrated'];
  const DESIGN_LIMITS = {
    logoSizeMin: 60, logoSizeMax: 140, logoSizeDefault: 100,
    logoPaddingMin: 0, logoPaddingMax: 100, logoPaddingDefault: 40,
    gradientIntensityMin: 0, gradientIntensityMax: 100, gradientIntensityDefault: 60,
  };
  const DEFAULT_DESIGN = {
    theme: 'dark', logoPresentation: 'direct',
    logoSize: DESIGN_LIMITS.logoSizeDefault, logoPadding: DESIGN_LIMITS.logoPaddingDefault,
    gradientIntensity: DESIGN_LIMITS.gradientIntensityDefault,
  };

  function clampDesignNum(v, min, max, def) {
    const n = Number(v);
    if (!Number.isFinite(n)) return def;
    return Math.min(max, Math.max(min, Math.round(n)));
  }
  // Nunca acepta CSS/HTML: cualquier valor desconocido/fuera de rango cae
  // al predeterminado — un borrador/registro sin `design` (creado antes de
  // esta función) recibe DEFAULT_DESIGN completo aquí mismo, sin reescribir
  // nada hasta que el usuario cambie algo y guarde/publique.
  function sanitizeDesignClient(raw) {
    const d = raw && typeof raw === 'object' ? raw : {};
    return {
      theme: CARD_THEMES.includes(d.theme) ? d.theme : DEFAULT_DESIGN.theme,
      logoPresentation: LOGO_PRESENTATIONS.includes(d.logoPresentation) ? d.logoPresentation : DEFAULT_DESIGN.logoPresentation,
      logoSize: clampDesignNum(d.logoSize, DESIGN_LIMITS.logoSizeMin, DESIGN_LIMITS.logoSizeMax, DESIGN_LIMITS.logoSizeDefault),
      logoPadding: clampDesignNum(d.logoPadding, DESIGN_LIMITS.logoPaddingMin, DESIGN_LIMITS.logoPaddingMax, DESIGN_LIMITS.logoPaddingDefault),
      gradientIntensity: clampDesignNum(d.gradientIntensity, DESIGN_LIMITS.gradientIntensityMin, DESIGN_LIMITS.gradientIntensityMax, DESIGN_LIMITS.gradientIntensityDefault),
    };
  }
  function computeLogoLayoutClient(design) {
    const blockBase = 96;
    const blockSize = Math.round(blockBase * design.logoSize / 100);
    const paddingPx = Math.round(4 + (design.logoPadding / 100) * 20);
    const outerSize = design.logoPresentation === 'integrated' ? Math.round(blockSize * 1.6) : blockSize;
    const innerStopPct = Math.round(45 - (design.gradientIntensity / 100) * 35);
    return { blockSize, paddingPx, outerSize, innerStopPct };
  }
  // Construye el bloque del logo (misma lógica de las tres presentaciones
  // que functions/c/[id].js renderLogoBlock — implementación independiente
  // pero con las mismas reglas, ver esa función). `small` reduce todo a
  // escala para las miniaturas del selector, sin cambiar las proporciones
  // relativas entre bloque/degradado/padding. Sin logo -> cadena vacía
  // (ningún bloque, ver instrucción "oculta su bloque sin dejar un hueco").
  function renderLogoBlockHtml(logoSrc, design, opts) {
    if (!logoSrc) return '';
    const scale = (opts && opts.scale) || 1;
    const { blockSize: bs, paddingPx: pp, outerSize: os, innerStopPct } = computeLogoLayoutClient(design);
    const blockSize = Math.round(bs * scale), paddingPx = Math.round(pp * scale), outerSize = Math.round(os * scale);
    const imgTag = `<img src="${escapeHtml(logoSrc)}" alt="" style="width:100%;height:100%;object-fit:contain;display:block;">`;
    if (design.logoPresentation === 'framed') {
      const radius = Math.round(blockSize * 0.2);
      return `<div class="biz-pv-logo-wrap" style="width:${blockSize}px;height:${blockSize}px;padding:${paddingPx}px;box-sizing:border-box;background:var(--pv-surface);border:1px solid var(--pv-surface-border);border-radius:${radius}px;box-shadow:var(--pv-shadow);">${imgTag}</div>`;
    }
    if (design.logoPresentation === 'integrated') {
      return `<div class="biz-pv-logo-wrap" style="width:${outerSize}px;height:${outerSize}px;background:radial-gradient(circle, var(--pv-surface) ${innerStopPct}%, transparent 100%);">
        <div style="width:${blockSize}px;height:${blockSize}px;">${imgTag}</div>
      </div>`;
    }
    return `<div class="biz-pv-logo-wrap" style="width:${blockSize}px;height:${blockSize}px;">${imgTag}</div>`;
  }

  function tf(key, fallback) {
    if (typeof window.tOrFallback === 'function') return window.tOrFallback(key, fallback);
    if (typeof window.t === 'function') { const v = window.t(key); return v === key ? fallback : v; }
    return fallback;
  }

  function toast(msg) { if (typeof window.showToast === 'function') window.showToast(msg); }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // =================== ESTADO ===================
  function loadDraft() {
    try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (_) { return null; }
  }
  function saveDraftToStorage(d) {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); return true; } catch (_) { return false; }
  }
  function loadMeta() {
    try { return JSON.parse(localStorage.getItem(META_KEY) || 'null'); } catch (_) { return null; }
  }
  function saveMeta(m) {
    try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch (_) {}
  }

  function emptyDraft(modality) {
    return {
      modality, displayName: '', logo: '', tagline: '', description: '',
      services: [], serviceArea: '', address: '', hours: '', phone: '', email: '',
      contactPerson: '', contactRole: '', web: '', catalogUrl: '', bookingUrl: '', quoteUrl: '',
      social: {}, gallery: [], primaryAction: 'contact',
      design: { ...DEFAULT_DESIGN },
    };
  }

  // Copia superficial "segura" para trabajar en memoria sin tocar el
  // borrador guardado hasta que el usuario pulse "Guardar en mi dispositivo".
  let workingDraft = null;
  let savedSnapshotJson = null; // JSON del último borrador GUARDADO (para detectar cambios sin guardar)

  function isEditorDirty() {
    if (!workingDraft) return false;
    return JSON.stringify(workingDraft) !== savedSnapshotJson;
  }

  // =================== ACCESO / PLAN ===================
  // Reutiliza EXACTAMENTE el mismo mecanismo de identidad y el mismo
  // margen de gracia offline (24h desde el último veredicto de servidor)
  // que ya usa el resto de la app (ver _verificarTrialServidor() en el
  // script principal) — no se inventa una vía de acceso offline nueva ni
  // más débil.
  function getRegAndToken() {
    let reg = null;
    try { reg = JSON.parse(localStorage.getItem('identity_registration') || 'null'); } catch (_) {}
    const token = localStorage.getItem('identity_access_token');
    if (!reg || !reg.email || !token) return null;
    return { email: reg.email, token };
  }

  async function getAccessStatus() {
    const cred = getRegAndToken();
    if (cred) {
      try {
        const res = await fetch('/api/check-plan', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: cred.email, token: cred.token }),
        });
        const data = await res.json();
        if (data.ok) {
          localStorage.setItem('identity_plan_verified', JSON.stringify({ bloqueado: data.bloqueado, plan: data.plan, verifiedAt: Date.now() }));
          return { plan: data.plan, bloqueado: data.bloqueado, esPago: ['pro', 'lifetime'].includes(data.plan) && !data.bloqueado, verified: true, cred };
        }
      } catch (_) { /* sin red — recurso de gracia offline abajo */ }
    }
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem('identity_plan_verified') || 'null'); } catch (_) {}
    if (cached && (Date.now() - cached.verifiedAt) < 24 * 3600 * 1000) {
      return { plan: cached.plan, bloqueado: cached.bloqueado, esPago: ['pro', 'lifetime'].includes(cached.plan) && !cached.bloqueado, verified: true, offline: true, cred };
    }
    return { plan: 'free', bloqueado: true, esPago: false, verified: false, cred };
  }

  // =================== NAVEGACIÓN / OVERLAYS ===================
  let _prevFocusHub = null, _prevFocusEditor = null, _prevFocusPreview = null;
  let _keydownHub = null, _keydownEditor = null, _keydownPreview = null;

  function pinScreenVisible() {
    const pin = document.getElementById('screen-pin');
    return pin && !pin.classList.contains('hidden');
  }

  // Se pone a true al bloquear y a false al volver a abrir el hub/editor.
  // No basta con quitar la clase 'open' (eso ya oculta las pantallas vía
  // transform, ver business.css): una operación asíncrona en curso en el
  // momento del bloqueo (una verificación de plan, una publicación, una
  // recuperación desde el servidor) seguiría resolviendo DESPUÉS del
  // bloqueo y podría mutar el DOM de esas pantallas o disparar un toast
  // con datos de la tarjeta — invisible mientras el overlay siga oculto,
  // pero writes "vale, tu tarjeta se publicó" es información real que no
  // debería aparecer tras un bloqueo. Cada callback asíncrono relevante
  // comprueba este flag antes de tocar nada.
  let _locked = false;

  function closeAllBusinessScreens() {
    _locked = true;
    ['screen-business', 'screen-business-editor', 'screen-business-preview'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('open');
    });
    if (_keydownHub) { document.removeEventListener('keydown', _keydownHub); _keydownHub = null; }
    if (_keydownEditor) { document.removeEventListener('keydown', _keydownEditor); _keydownEditor = null; }
    if (_keydownPreview) { document.removeEventListener('keydown', _keydownPreview); _keydownPreview = null; }
    _bizQrToken++; // invalida cualquier render de QR pendiente
  }
  // Expuesta en window para que otros mecanismos de bloqueo del script
  // principal (ver index.html, confirmación de "Baja voluntaria" —
  // storage-wipe.js borra los datos, pero el DOM ya renderizado del
  // editor Business podría seguir mostrando el borrador de la cuenta
  // recién eliminada si esta pantalla estuviera abierta detrás) puedan
  // cerrar las vistas privadas de Business sin depender de que btn-lock
  // sea el único camino hacia screen-pin.
  window.closeAllBusinessScreens = closeAllBusinessScreens;
  // business.js se carga como <script> clásico cerca del final del body
  // (después de #btn-lock, ver index.html), así que el elemento ya existe
  // en el DOM en este punto — no hace falta esperar a DOMContentLoaded.
  document.getElementById('btn-lock')?.addEventListener('click', closeAllBusinessScreens);

  async function openBusinessHub() {
    if (pinScreenVisible()) return;
    const screen = document.getElementById('screen-business');
    if (!screen) return;
    _locked = false;
    _prevFocusHub = document.activeElement;
    screen.classList.add('open');
    await renderHub();
    if (_locked) return; // se bloqueó mientras renderHub() esperaba la red
    _keydownHub = (e) => { if (e.key === 'Escape' && !isQrZoomSafe()) closeBusinessHub(); };
    document.addEventListener('keydown', _keydownHub);
    document.getElementById('btn-close-business')?.focus();
  }
  function isQrZoomSafe() { return typeof isQrZoomOpen === 'function' && isQrZoomOpen(); }

  function closeBusinessHub() {
    const screen = document.getElementById('screen-business');
    if (screen) screen.classList.remove('open');
    if (_keydownHub) { document.removeEventListener('keydown', _keydownHub); _keydownHub = null; }
    if (_prevFocusHub && typeof _prevFocusHub.focus === 'function') _prevFocusHub.focus();
    _prevFocusHub = null;
  }

  async function renderHub() {
    const access = await getAccessStatus();
    if (_locked) return; // se bloqueó la app mientras se esperaba la verificación de plan
    const banner = document.getElementById('business-paywall-banner');
    const statusLine = document.getElementById('business-status-line');
    const cards = document.querySelectorAll('.biz-modality-card');
    const unpublishFromHub = document.getElementById('btn-business-unpublish-hub');

    if (banner) banner.style.display = access.esPago ? 'none' : 'block';
    cards.forEach((c) => { c.disabled = !access.esPago; });
    // Despublicar debe poder alcanzarse aunque el editor de pago esté
    // bloqueado -- el endpoint ya lo permite sin plan vigente (ver
    // business-unpublish.js), pero antes el ÚNICO botón "Despublicar"
    // vivía dentro del editor, inalcanzable precisamente cuando más hace
    // falta. Se muestra siempre que el acceso no esté activo, incluso sin
    // ningún dato local de que exista una tarjeta (recuperación entre
    // dispositivos): unpublish() ya informa con claridad si no hay nada
    // que despublicar en el servidor.
    if (unpublishFromHub) unpublishFromHub.style.display = access.esPago ? 'none' : 'block';

    const meta = loadMeta();
    if (statusLine) {
      if (!access.esPago && meta) {
        statusLine.style.display = 'flex';
        statusLine.className = 'biz-status-line st-inactive';
        statusLine.textContent = tf('index.business.status_access_inactive', 'Acceso de pago inactivo — tus datos se conservan');
      } else if (meta && meta.published === false) {
        statusLine.style.display = 'flex';
        statusLine.className = 'biz-status-line st-unpublished';
        statusLine.textContent = tf('index.business.status_unpublished', 'No publicada');
      } else if (meta && meta.published === true) {
        const dirty = isPublishedDirty();
        statusLine.style.display = 'flex';
        statusLine.className = dirty ? 'biz-status-line st-pending' : 'biz-status-line st-published';
        statusLine.textContent = dirty
          ? tf('index.business.status_pending', 'Publicada — cambios pendientes de publicar')
          : tf('index.business.status_published', 'Publicada');
      } else {
        const draft = loadDraft();
        if (draft) {
          statusLine.style.display = 'flex';
          statusLine.className = 'biz-status-line';
          statusLine.textContent = tf('index.business.status_draft', 'Borrador local — sin publicar');
        } else {
          statusLine.style.display = 'none';
        }
      }
    }
    asegurarBotonDiagnostico();
    if (window.applyI18n) window.applyI18n(screen_business_el());
  }
  function screen_business_el() { return document.getElementById('screen-business'); }

  // Botón temporal de diagnóstico (ver DIAGNÓSTICO TEMPORAL más abajo):
  // se crea por JS, sin tocar el HTML, e idempotente (no duplica si el
  // hub se vuelve a renderizar). Discreto: mismo estilo que el enlace
  // secundario ya existente (btn-biz-pull-server), al final del scroll.
  function asegurarBotonDiagnostico() {
    if (document.getElementById('btn-biz-diagnostico')) return;
    const scroll = document.getElementById('business-hub-scroll');
    if (!scroll) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'btn-biz-diagnostico';
    btn.className = 'biz-secondary-link';
    btn.style.marginTop = '16px';
    btn.textContent = 'Diagnóstico';
    btn.addEventListener('click', mostrarDiagnosticoBusiness);
    scroll.appendChild(btn);
  }

  function isPublishedDirty() {
    const meta = loadMeta();
    const draft = loadDraft();
    if (!meta || !draft || meta.published !== true) return false;
    return JSON.stringify(buildPublicPayloadFromDraft(draft)) !== JSON.stringify(meta.payload);
  }

  // =================== EDITOR ===================
  async function tryOpenEditor(modality) {
    const access = await getAccessStatus();
    if (_locked || pinScreenVisible()) return; // se bloqueó mientras se verificaba el plan
    if (!access.esPago) {
      toast(tf('index.business.paid_feature_toast', 'IDENTIFLY BUSINESS es una función de pago. Mejora tu plan para editar y publicar.'));
      return;
    }
    const draftGuardado = loadDraft();
    const draft = draftGuardado || emptyDraft(modality);
    // Cambiar de modalidad adapta la presentación y conserva el borrador
    // (instrucción) — nunca se crea un segundo borrador.
    draft.modality = modality;
    // Compatibilidad con borradores guardados antes de que existiera
    // `design` (tema/presentación del logo): se aplican los
    // predeterminados aquí mismo, en memoria, sin reescribir el borrador
    // guardado hasta que el usuario cambie algo y pulse Guardar/Publicar.
    draft.design = sanitizeDesignClient(draft.design);
    // Prerrelleno desde el perfil personal. Se reintenta mientras no haya
    // quedado marcado con datos reales (_personalDataLinked true Y
    // _personalDataIncorporatedCount > 0) -- una marca puesta con 0
    // incorporados nunca demuestra que el perfil existiera en ese momento
    // (pudo estar vacío, sin cargar todavía, o genuinamente sin nada
    // nuevo que ofrecer): en cualquiera de esos casos, reintentar es
    // inofensivo (si de verdad no hay nada nuevo, vuelve a incorporar 0) y
    // corrige el caso real en que sí había datos pero no se llegaron a
    // leer. En cuanto una vez SÍ se incorpora algo (>0), la marca se
    // congela para siempre: no vuelve a aplicarse, así que un campo que el
    // usuario borre a propósito después y guarde se queda borrado.
    if (!draft._personalDataLinked || !draft._personalDataIncorporatedCount) {
      const resultado = aplicarDatosPersonalesAlBorrador(draft);
      if (resultado.perfilDisponible) {
        draft._personalDataLinked = true;
        draft._personalDataIncorporatedCount = resultado.incorporados;
      }
      // Perfil no disponible todavía (identity_data vacío/inexistente en
      // este momento): no se marca linked -- se reintenta la próxima vez
      // que se abra esta modalidad, en vez de quedar bloqueado para
      // siempre con un borrador vacío.
    }
    workingDraft = JSON.parse(JSON.stringify(draft));
    savedSnapshotJson = JSON.stringify(draftGuardado ? { ...draftGuardado, modality } : draft);
    openBusinessEditor();
  }

  function openBusinessEditor() {
    closeBusinessHub();
    const screen = document.getElementById('screen-business-editor');
    if (!screen) return;
    _locked = false;
    _prevFocusEditor = document.activeElement;
    screen.classList.add('open');
    renderEditorForm();
    _keydownEditor = (e) => { if (e.key === 'Escape' && !isQrZoomSafe()) attemptCloseEditor(); };
    document.addEventListener('keydown', _keydownEditor);
  }

  function attemptCloseEditor(goHome) {
    if (isEditorDirty()) {
      const ok = window.confirm(tf('index.business.unsaved_changes_confirm', 'Tienes cambios sin guardar en el borrador. ¿Salir sin guardar?'));
      if (!ok) return;
    }
    const screen = document.getElementById('screen-business-editor');
    if (screen) screen.classList.remove('open');
    if (_keydownEditor) { document.removeEventListener('keydown', _keydownEditor); _keydownEditor = null; }
    if (goHome) {
      closeAllBusinessScreens();
    } else {
      openBusinessHub();
    }
  }

  const MODALITY_SECTION_ORDER = {
    professional: ['identity', 'design', 'presentation', 'services', 'contact', 'links', 'gallery', 'action'],
    freelance: ['identity', 'design', 'presentation', 'services', 'area', 'contact', 'links', 'gallery', 'action'],
    company: ['identity', 'design', 'presentation', 'services', 'address', 'contact', 'links', 'gallery', 'action'],
  };

  function renderEditorForm() {
    const modLabel = document.getElementById('biz-editor-modality-label');
    const names = {
      professional: tf('index.business.mode_professional_name', 'Profesional'),
      freelance: tf('index.business.mode_freelance_name', 'Autónomo'),
      company: tf('index.business.mode_company_name', 'Empresa'),
    };
    if (modLabel) modLabel.textContent = names[workingDraft.modality] || '';

    const order = MODALITY_SECTION_ORDER[workingDraft.modality] || MODALITY_SECTION_ORDER.professional;
    const container = document.getElementById('biz-editor-form');
    if (!container) return;

    const sections = {
      identity: sectionIdentity(),
      design: sectionDesign(),
      presentation: sectionPresentation(),
      services: sectionServices(),
      area: sectionAreaHours(),
      address: sectionAddressHours(),
      contact: sectionContact(),
      links: sectionLinks(),
      gallery: sectionGallery(),
      action: sectionAction(),
    };

    container.innerHTML = copyProfileBoxHtml() + order.map((k) => sections[k]).join('');
    if (window.applyI18n) window.applyI18n(container);
    wireEditorEvents(container);
    renderPublishFooter();
  }

  function field(labelKey, labelFallback, inputHtml, helpKey, helpFallback) {
    return `<div class="biz-field">
      <label data-i18n="${labelKey}">${escapeHtml(labelFallback)}</label>
      ${inputHtml}
      ${helpKey ? `<div class="biz-help" data-i18n="${helpKey}">${escapeHtml(helpFallback || '')}</div>` : ''}
    </div>`;
  }

  function sectionIdentity() {
    const d = workingDraft;
    return `<div class="biz-section">
      <div class="biz-section-title" data-i18n="index.business.section_identity">${tf('index.business.section_identity', 'Identidad')}</div>
      <div class="biz-field">
        <label data-i18n="index.business.field_logo">${tf('index.business.field_logo', 'Logo o foto')}</label>
        <div id="biz-logo-tile" class="biz-image-tile">${d.logo ? `<img src="${d.logo}" alt=""><button type="button" class="biz-image-remove" id="biz-logo-remove">✕</button>` : `<span>${tf('index.business.add_image', 'Añadir')}</span>`}</div>
        <input type="file" id="biz-logo-input" accept="image/png,image/jpeg,image/webp" style="display:none">
      </div>
      ${field('index.business.field_display_name', 'Nombre visible o comercial', `<input type="text" id="biz-displayName" maxlength="${LIMITS.displayName}" value="${escapeHtml(d.displayName)}">`)}
    </div>`;
  }

  // SVG neutro (cuadrado con una "L" discreta) usado solo en las
  // miniaturas de presentación cuando todavía no hay logo subido — así el
  // usuario puede comparar las tres presentaciones desde el principio,
  // sin depender de subir antes una imagen. En cuanto hay logo, las
  // miniaturas usan el logo real (más fiel, ver instrucción).
  const LOGO_PLACEHOLDER_SVG = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='14' fill='%23888'/><text x='50' y='66' font-family='sans-serif' font-size='46' font-weight='700' text-anchor='middle' fill='white'>L</text></svg>";

  // Dos temas EXCLUSIVOS y tres presentaciones del logo, con miniaturas
  // reales (usan el propio logo del usuario cuando existe, ver
  // instrucción "prioriza que el usuario pueda comparar las tres
  // opciones visualmente"). Sin selector de color libre: el color del
  // soporte lo decide el tema (var(--pv-surface)), nunca un valor
  // arbitrario del usuario.
  function sectionDesign() {
    const d = workingDraft;
    const design = d.design;
    const logoForPreview = d.logo || LOGO_PLACEHOLDER_SVG;

    const themeThumb = (id, label) => `<button type="button" class="biz-theme-thumb${id === 'light' ? ' light-sample' : ''}${design.theme === id ? ' selected' : ''}" data-theme-choice="${id}">
        <div class="biz-theme-thumb-title">Aa</div>
        <div class="biz-theme-thumb-line"></div>
        <div class="biz-theme-thumb-line" style="width:45%"></div>
        <div class="biz-theme-thumb-label">${escapeHtml(label)}</div>
      </button>`;

    const presThumb = (id, label, descKey, descFallback) => `<button type="button" class="biz-logopres-thumb${design.logoPresentation === id ? ' selected' : ''}" data-pres-choice="${id}">
        <div class="biz-pv-card biz-logopres-preview" data-theme="${design.theme}">${renderLogoBlockHtml(logoForPreview, { ...design, logoPresentation: id }, { scale: 0.5 })}</div>
        <div class="biz-logopres-label">${escapeHtml(label)}</div>
        <div class="biz-logopres-desc" data-i18n="${descKey}">${escapeHtml(tf(descKey, descFallback))}</div>
      </button>`;

    return `<div class="biz-section">
      <div class="biz-section-title" data-i18n="index.business.section_design">${tf('index.business.section_design', 'Diseño de la tarjeta')}</div>
      <div class="biz-help" style="margin-bottom:10px;" data-i18n="index.business.design_help">${tf('index.business.design_help', 'Dos temas y tres formas de mostrar tu logo. Sin colores ni tipografías personalizadas — la vista previa pública usa exactamente esto.')}</div>

      <div class="biz-theme-grid" id="biz-theme-grid">
        ${themeThumb('dark', tf('index.business.theme_dark', 'Oscuro IDENTIFLY'))}
        ${themeThumb('light', tf('index.business.theme_light', 'Claro'))}
      </div>

      <div class="biz-field"><label data-i18n="index.business.field_logo_presentation">${tf('index.business.field_logo_presentation', 'Presentación del logo')}</label></div>
      <div class="biz-logopres-grid" id="biz-logopres-grid">
        ${presThumb('direct', tf('index.business.pres_direct', 'Directo'), 'index.business.pres_direct_desc', 'Tu logo sobre el fondo de la tarjeta.')}
        ${presThumb('framed', tf('index.business.pres_framed', 'Con soporte'), 'index.business.pres_framed_desc', 'Una base suave para destacar tu logo.')}
        ${presThumb('integrated', tf('index.business.pres_integrated', 'Integrado'), 'index.business.pres_integrated_desc', 'Un contorno degradado que suaviza la transición.')}
      </div>

      <div class="biz-slider-row">
        <label><span data-i18n="index.business.field_logo_size">${tf('index.business.field_logo_size', 'Tamaño del logo')}</span><span>${design.logoSize}%</span></label>
        <input type="range" id="biz-logoSize" min="${DESIGN_LIMITS.logoSizeMin}" max="${DESIGN_LIMITS.logoSizeMax}" value="${design.logoSize}">
      </div>
      <div class="biz-slider-row">
        <label><span data-i18n="index.business.field_logo_padding">${tf('index.business.field_logo_padding', 'Espacio alrededor')}</span><span>${design.logoPadding}%</span></label>
        <input type="range" id="biz-logoPadding" min="${DESIGN_LIMITS.logoPaddingMin}" max="${DESIGN_LIMITS.logoPaddingMax}" value="${design.logoPadding}">
      </div>
      <div class="biz-slider-row${design.logoPresentation === 'integrated' ? '' : ' disabled'}" id="biz-gradient-row">
        <label><span data-i18n="index.business.field_gradient_intensity">${tf('index.business.field_gradient_intensity', 'Intensidad de la transición')}</span><span>${design.gradientIntensity}%</span></label>
        <input type="range" id="biz-gradientIntensity" min="${DESIGN_LIMITS.gradientIntensityMin}" max="${DESIGN_LIMITS.gradientIntensityMax}" value="${design.gradientIntensity}" ${design.logoPresentation === 'integrated' ? '' : 'disabled'}>
      </div>
    </div>`;
  }

  function sectionPresentation() {
    const d = workingDraft;
    const taglineLabel = d.modality === 'company' ? 'index.business.field_activity' : 'index.business.field_specialty';
    const taglineFallback = d.modality === 'company' ? 'Actividad' : 'Especialidad';
    return `<div class="biz-section">
      <div class="biz-section-title" data-i18n="index.business.section_presentation">${tf('index.business.section_presentation', 'Presentación')}</div>
      ${field(taglineLabel, taglineFallback, `<input type="text" id="biz-tagline" maxlength="${LIMITS.tagline}" value="${escapeHtml(d.tagline)}">`)}
      ${field('index.business.field_description', 'Presentación breve', `<textarea id="biz-description" maxlength="${LIMITS.description}">${escapeHtml(d.description)}</textarea>`)}
    </div>`;
  }

  function sectionServices() {
    const d = workingDraft;
    const rows = d.services.map((s, i) => `<div class="biz-service-row" data-i="${i}">
        <input type="text" class="biz-service-input" maxlength="${LIMITS.serviceItem}" value="${escapeHtml(s)}">
        <button type="button" class="biz-service-remove" data-i="${i}">✕</button>
      </div>`).join('');
    return `<div class="biz-section">
      <div class="biz-section-title" data-i18n="index.business.section_services">${tf('index.business.section_services', 'Servicios')}</div>
      <div id="biz-services-list">${rows}</div>
      ${d.services.length < LIMITS.servicesMax ? `<button type="button" class="biz-add-service" id="biz-add-service" data-i18n="index.business.add_service_button">${tf('index.business.add_service_button', '+ Añadir servicio')}</button>` : ''}
    </div>`;
  }

  function sectionAreaHours() {
    const d = workingDraft;
    return `<div class="biz-section">
      <div class="biz-section-title" data-i18n="index.business.section_area">${tf('index.business.section_area', 'Zona y horario')}</div>
      ${field('index.business.field_service_area', 'Zona de servicio', `<input type="text" id="biz-serviceArea" maxlength="${LIMITS.serviceArea}" value="${escapeHtml(d.serviceArea)}">`)}
      ${field('index.business.field_hours', 'Horarios (opcional)', `<input type="text" id="biz-hours" maxlength="${LIMITS.hours}" value="${escapeHtml(d.hours)}">`)}
    </div>`;
  }

  function sectionAddressHours() {
    const d = workingDraft;
    return `<div class="biz-section">
      <div class="biz-section-title" data-i18n="index.business.section_address">${tf('index.business.section_address', 'Dirección y horario')}</div>
      ${field('index.business.field_address', 'Dirección comercial (opcional)', `<input type="text" id="biz-address" maxlength="${LIMITS.address}" value="${escapeHtml(d.address)}">`)}
      ${field('index.business.field_hours', 'Horarios (opcional)', `<input type="text" id="biz-hours" maxlength="${LIMITS.hours}" value="${escapeHtml(d.hours)}">`)}
    </div>`;
  }

  function sectionContact() {
    const d = workingDraft;
    return `<div class="biz-section">
      <div class="biz-section-title" data-i18n="index.business.section_contact">${tf('index.business.section_contact', 'Contacto')}</div>
      ${field('index.business.field_phone', 'Teléfono', `<input type="tel" id="biz-phone" maxlength="${LIMITS.phone}" value="${escapeHtml(d.phone)}">`)}
      ${field('index.business.field_email', 'Correo de contacto', `<input type="email" id="biz-email" maxlength="${LIMITS.email}" value="${escapeHtml(d.email)}">`)}
      ${field('index.business.field_contact_person', 'Persona de contacto (opcional)', `<input type="text" id="biz-contactPerson" maxlength="${LIMITS.contactPerson}" value="${escapeHtml(d.contactPerson)}">`)}
      ${field('index.business.field_contact_role', 'Cargo (opcional)', `<input type="text" id="biz-contactRole" maxlength="${LIMITS.contactRole}" value="${escapeHtml(d.contactRole)}">`)}
      ${field('index.business.field_web', 'Web', `<input type="url" id="biz-web" maxlength="${LIMITS.url}" placeholder="https://" value="${escapeHtml(d.web)}">`)}
    </div>`;
  }

  function sectionLinks() {
    const d = workingDraft;
    const socialRows = SOCIAL_KEYS.map((k) => `<div class="biz-social-row">
        <div class="biz-social-label">${SOCIAL_LABELS[k]}</div>
        <input type="url" class="biz-social-input" data-key="${k}" maxlength="${LIMITS.url}" placeholder="https://" value="${escapeHtml((d.social || {})[k] || '')}">
      </div>`).join('');
    return `<div class="biz-section">
      <div class="biz-section-title" data-i18n="index.business.section_links">${tf('index.business.section_links', 'Enlaces')}</div>
      ${field('index.business.field_catalog_url', 'Enlace a catálogo (opcional)', `<input type="url" id="biz-catalogUrl" maxlength="${LIMITS.url}" placeholder="https://" value="${escapeHtml(d.catalogUrl)}">`)}
      ${field('index.business.field_booking_url', 'Enlace a reservas (opcional)', `<input type="url" id="biz-bookingUrl" maxlength="${LIMITS.url}" placeholder="https://" value="${escapeHtml(d.bookingUrl)}">`)}
      ${field('index.business.field_quote_url', 'Enlace para pedir presupuesto (opcional)', `<input type="url" id="biz-quoteUrl" maxlength="${LIMITS.url}" placeholder="https://" value="${escapeHtml(d.quoteUrl)}">`)}
      <div class="biz-field"><label data-i18n="index.business.field_social">${tf('index.business.field_social', 'Redes (opcional, elige tú cuáles)')}</label>
        <div class="biz-social-grid">${socialRows}</div>
      </div>
    </div>`;
  }

  function sectionGallery() {
    const d = workingDraft;
    const tiles = d.gallery.map((g, i) => `<div class="biz-image-tile" data-i="${i}"><img src="${g}" alt=""><button type="button" class="biz-image-remove biz-gallery-remove" data-i="${i}">✕</button></div>`).join('');
    const addTile = d.gallery.length < LIMITS.galleryMax ? `<div class="biz-image-tile" id="biz-gallery-add"><span>${tf('index.business.add_image', 'Añadir')}</span></div>` : '';
    return `<div class="biz-section">
      <div class="biz-section-title" data-i18n="index.business.section_gallery">${tf('index.business.section_gallery', 'Galería (opcional)')}</div>
      <div class="biz-gallery-grid">${tiles}${addTile}</div>
      <input type="file" id="biz-gallery-input" accept="image/png,image/jpeg,image/webp" style="display:none">
    </div>`;
  }

  function sectionAction() {
    const d = workingDraft;
    const optLabels = {
      contact: tf('index.business.action_contact', 'Contactar'),
      quote: tf('index.business.action_quote', 'Pedir presupuesto'),
      booking: tf('index.business.action_booking', 'Reservar cita'),
      catalog: tf('index.business.action_catalog', 'Ver catálogo'),
    };
    const opts = ACTION_KEYS.map((k) => `<option value="${k}" ${d.primaryAction === k ? 'selected' : ''}>${escapeHtml(optLabels[k])}</option>`).join('');
    return `<div class="biz-section">
      <div class="biz-section-title" data-i18n="index.business.section_action">${tf('index.business.section_action', 'Acción principal')}</div>
      ${field('index.business.field_primary_action', 'Qué botón verá quien abra tu tarjeta', `<select id="biz-primaryAction">${opts}</select>`, 'index.business.action_help', 'Solo puedes elegir una acción si su destino está configurado (teléfono/correo para Contactar, o el enlace correspondiente).')}
    </div>`;
  }

  // Lee el perfil personal directamente de su almacenamiento real
  // ('identity_data', ver STORAGE_KEY en el script principal) -- NUNCA de
  // window.profileData: ese objeto vive como `let profileData` de ámbito
  // de módulo en index.html, nunca se expuso como propiedad de window, así
  // que window.profileData siempre fue `undefined` y el prerrelleno nunca
  // encontraba nada que copiar (causa real del fallo reportado: LinkedIn/
  // GitHub existían en el perfil pero Business los veía vacíos). Leer la
  // misma clave de localStorage que ya usa el perfil evita inventar un
  // segundo esquema y funciona igual sin conexión.
  function getPersonalProfileData() {
    try { return JSON.parse(localStorage.getItem('identity_data') || '{}'); } catch (_) { return {}; }
  }

  // Incorpora al borrador (mutándolo) los datos del perfil personal que
  // tengan una correspondencia clara y que el borrador todavía tenga
  // vacíos -- nunca sobrescribe un campo que Business ya tenga, sea de
  // antes o recién escrito por el usuario. Se lee independientemente de
  // los controles t-* que solo deciden qué se comparte en la vCard
  // principal (instrucción): esos controles no afectan si el DATO existe.
  // Devuelve cuántos campos se incorporaron Y si el perfil estaba
  // realmente disponible (identity_data existía con algún dato) --
  // distinguir esto de "incorporados===0" es necesario para que
  // tryOpenEditor() sepa si puede congelar la marca _personalDataLinked o
  // si debe reintentar la próxima vez (ver ese comentario).
  function aplicarDatosPersonalesAlBorrador(draft) {
    const pd = getPersonalProfileData();
    const perfilDisponible = Object.keys(pd).length > 0;
    let incorporados = 0;
    const asignar = (key, val) => {
      const limpio = (val == null) ? '' : String(val).trim();
      if (limpio && !draft[key]) { draft[key] = limpio; incorporados++; }
    };

    // Nombre personal vs. razón social: nunca se usa el nombre de la
    // persona como nombre de una Empresa (instrucción) -- solo pd.company
    // cuenta para displayName en esa modalidad; si no existe, se deja
    // vacío en vez de inventar un dato empresarial sin equivalente.
    if (draft.modality === 'company') {
      asignar('displayName', pd.company);
    } else {
      asignar('displayName', pd.name);
    }
    // Persona de contacto y cargo: correspondencia clara en las TRES
    // modalidades (instrucción), no solo Empresa -- son quien atiende la
    // tarjeta, independientemente de qué nombre se use como displayName.
    asignar('contactPerson', pd.name);
    asignar('contactRole', pd.job);

    if (pd.phoneNumber) {
      asignar('phone', (pd.phoneCountryCode ? pd.phoneCountryCode + ' ' : '') + pd.phoneNumber);
    }
    // Correo de CONTACTO del perfil (pd.email) -- nunca el correo de
    // acceso/login (identity_registration.email): son conceptos distintos
    // y esta función no lee ese almacenamiento en absoluto.
    asignar('email', pd.email);
    asignar('web', pd.web);
    asignar('address', pd.address);

    draft.social = draft.social || {};
    SOCIAL_KEYS.forEach((k) => {
      const val = pd[k] ? String(pd[k]).trim() : '';
      if (val && !draft.social[k]) { draft.social[k] = val; incorporados++; }
    });

    return { incorporados, perfilDisponible };
  }

  // =================== DIAGNÓSTICO TEMPORAL (solo lectura) ===================
  // Ver INFORME de entrega: el prerrelleno funciona en las pruebas locales
  // (jsdom, 32/32 casos) pero un dispositivo real sigue reportándolo
  // vacío tras la corrección publicada -- esto reúne, en el propio
  // dispositivo, evidencia real en vez de otra hipótesis. Nunca escribe
  // nada (ni siquiera para "probar" el prerrelleno: se simula sobre una
  // COPIA, nunca sobre el borrador real) ni envía nada a ningún servidor.
  // Se retira en cuanto deje de hacer falta.
  const CAMPOS_PERSONALES_DIAGNOSTICO = ['name', 'job', 'company', 'phoneCountryCode', 'phoneNumber', 'email', 'web', 'address', ...SOCIAL_KEYS];

  async function diagnosticoBusinessTexto() {
    const lineas = [];
    lineas.push('=== DIAGNÓSTICO BUSINESS (temporal, solo lectura) ===');
    lineas.push('Código Business en ejecución: ' + BUSINESS_CODE_VERSION);
    lineas.push('Origen: ' + location.origin);
    lineas.push('');

    // Cachés realmente instaladas en ESTE dispositivo -- si "identity-vNN"
    // (la versión actual, ver CACHE_NAME en sw.js) no aparece aquí, el
    // Service Worker de esta versión nunca terminó de instalarse en este
    // dispositivo, sea cual sea el motivo (confirma o descarta la caché
    // del dispositivo con datos, no con suposiciones).
    try {
      const nombres = await caches.keys();
      lineas.push('Cachés instaladas: ' + (nombres.length ? nombres.join(', ') : '(ninguna)'));
    } catch (e) {
      lineas.push('Cachés instaladas: (no se pudo consultar: ' + e.message + ')');
    }

    // Service Worker que controla ESTA pestaña ahora mismo, y el estado
    // real del registro (activo/en espera/instalando) -- "waiting" no
    // vacío es la señal clásica de una actualización descargada que
    // nunca llegó a activarse (típico si la pestaña/PWA nunca se cerró
    // del todo).
    try {
      const controller = navigator.serviceWorker && navigator.serviceWorker.controller;
      lineas.push('Service Worker controlando esta página: ' + (controller ? 'sí (' + controller.scriptURL + ')' : 'no'));
      const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
      if (reg) {
        lineas.push('Registro SW -> active: ' + (reg.active ? reg.active.scriptURL : '(ninguno)'));
        lineas.push('Registro SW -> waiting: ' + (reg.waiting ? reg.waiting.scriptURL + '  <-- hay una versión nueva esperando activarse' : '(ninguno)'));
        lineas.push('Registro SW -> installing: ' + (reg.installing ? reg.installing.scriptURL : '(ninguno)'));
      } else {
        lineas.push('Registro SW: (sin registro de Service Worker en este origen)');
      }
      const regs = navigator.serviceWorker && await navigator.serviceWorker.getRegistrations();
      lineas.push('Total de registros de Service Worker en este origen: ' + (regs ? regs.length : '(no se pudo consultar)'));

      // El NOMBRE de una caché no demuestra por sí solo qué código
      // ejecuta el Service Worker activo -- se le pregunta DIRECTAMENTE
      // (mismo mecanismo que sw-diagnostico.html). Sin respuesta en 1.5s
      // es en sí mismo una prueba de que es una versión anterior a esto.
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        const version = await new Promise((resolve) => {
          const t = setTimeout(() => resolve('(sin respuesta en 1.5s -- versión anterior a este mecanismo)'), 1500);
          function handler(e) {
            if (e.data && e.data.tipo === 'IDENTIFLY_VERSION') {
              clearTimeout(t);
              navigator.serviceWorker.removeEventListener('message', handler);
              resolve(e.data.cacheName);
            }
          }
          navigator.serviceWorker.addEventListener('message', handler);
          navigator.serviceWorker.controller.postMessage('IDENTIFLY_QUE_VERSION');
        });
        lineas.push('Versión que el Service Worker activo dice de sí mismo: ' + version);
      }
    } catch (e) {
      lineas.push('Service Worker: (no se pudo consultar: ' + e.message + ')');
    }
    lineas.push('');

    // identity_data: solo presencia de campos, nunca valores.
    let pd = null, pdError = null;
    try { pd = JSON.parse(localStorage.getItem('identity_data') || 'null'); } catch (e) { pdError = e.message; }
    lineas.push('identity_data existe: ' + (localStorage.getItem('identity_data') != null ? 'sí' : 'no'));
    lineas.push('identity_data es JSON válido: ' + (pdError ? 'NO (' + pdError + ')' : 'sí'));
    if (pd && typeof pd === 'object') {
      const presencia = CAMPOS_PERSONALES_DIAGNOSTICO.map((k) => k + (pd[k] ? '✓' : '✗')).join('  ');
      lineas.push('Campos del perfil (solo presencia, nunca el valor): ' + presencia);
    }
    lineas.push('');

    // Borrador Business real -- mismo loadDraft() que usa la app.
    const draft = loadDraft();
    lineas.push('Borrador Business existe: ' + (draft ? 'sí' : 'no'));
    if (draft) {
      lineas.push('_personalDataLinked: ' + (Object.prototype.hasOwnProperty.call(draft, '_personalDataLinked') ? String(draft._personalDataLinked) : '(no existe en este borrador)'));
      lineas.push('_personalDataIncorporatedCount: ' + (Object.prototype.hasOwnProperty.call(draft, '_personalDataIncorporatedCount') ? String(draft._personalDataIncorporatedCount) : '(no existe en este borrador)'));
    }
    lineas.push('');

    // Simulación con la MISMA función real (aplicarDatosPersonalesAlBorrador),
    // sobre una COPIA -- nunca sobre el borrador real, nunca se guarda.
    // Reproduce exactamente la condición real de tryOpenEditor() para que
    // el motivo de omisión, si lo hay, sea el mismo que decidiría la app.
    const draftBase = draft ? JSON.parse(JSON.stringify(draft)) : emptyDraft('professional');
    const yaVinculadoConDatos = !!(draft && draft._personalDataLinked && draft._personalDataIncorporatedCount);
    if (yaVinculadoConDatos) {
      lineas.push('Prerrelleno: NO se ejecutaría de nuevo al abrir. Motivo: ya está vinculado con datos reales (' + draft._personalDataIncorporatedCount + ' campos incorporados anteriormente) -- esto es definitivo por diseño, no un fallo.');
    } else {
      const copia = JSON.parse(JSON.stringify(draftBase));
      const resultado = aplicarDatosPersonalesAlBorrador(copia);
      if (!resultado.perfilDisponible) {
        lineas.push('Prerrelleno: se OMITIRÍA al abrir. Motivo exacto: identity_data no está disponible (vacío, ausente o no legible) en este dispositivo AHORA MISMO.');
      } else if (resultado.incorporados > 0) {
        lineas.push('Prerrelleno: SÍ se ejecutaría al abrir y incorporaría ' + resultado.incorporados + ' campo(s) ahora mismo.');
      } else {
        lineas.push('Prerrelleno: se ejecutaría, pero incorporaría 0 campos -- el perfil está disponible pero no tiene ningún dato compatible que el borrador no tenga ya.');
      }
    }
    return lineas.join('\n');
  }

  function mostrarDiagnosticoBusiness() {
    let overlay = document.getElementById('biz-diagnostico-overlay');
    if (overlay) overlay.remove();
    overlay = document.createElement('div');
    overlay.id = 'biz-diagnostico-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#0a0a0a;color:#ccc;padding:20px;overflow:auto;font-family:monospace;font-size:11px;white-space:pre-wrap;';
    overlay.textContent = 'Generando diagnóstico...';
    const cerrar = document.createElement('button');
    cerrar.type = 'button';
    cerrar.textContent = '✕ Cerrar diagnóstico';
    cerrar.style.cssText = 'position:sticky;top:0;display:block;margin-bottom:14px;padding:10px 16px;background:#AAFF00;color:#000;border:none;border-radius:8px;font-weight:700;font-family:sans-serif;';
    cerrar.addEventListener('click', () => overlay.remove());
    document.body.appendChild(overlay);
    diagnosticoBusinessTexto().then((texto) => {
      overlay.textContent = '';
      overlay.appendChild(cerrar);
      const pre = document.createElement('div');
      pre.textContent = texto;
      overlay.appendChild(pre);
    });
  }

  // Sustituye el antiguo botón manual "Ver qué se copiaría" (exigía
  // reintroducir los datos o pulsar un botón aparte cada vez, ver
  // instrucción): el prerrelleno ya ocurrió al abrir el editor
  // (tryOpenEditor), así que aquí solo se informa, y únicamente cuando de
  // verdad se incorporó algo -- un borrador sin ningún dato de perfil
  // compatible no muestra nada.
  function copyProfileBoxHtml() {
    if (!workingDraft || !workingDraft._personalDataIncorporatedCount) return '';
    return `<div class="biz-copy-profile-box" id="biz-copy-profile-box">
      <p style="font-size:11.5px;color:rgba(255,255,255,0.5);" data-i18n="index.business.copy_profile_incorporated">${tf('index.business.copy_profile_incorporated', 'Datos de tu perfil incorporados. Puedes editarlos antes de publicar.')}</p>
    </div>`;
  }

  function wireEditorEvents(container) {
    const setField = (id, key) => {
      const el = container.querySelector('#' + id);
      if (!el) return;
      el.addEventListener('input', () => { workingDraft[key] = el.value; renderPublishFooter(); });
    };
    ['displayName', 'tagline', 'description', 'serviceArea', 'address', 'hours', 'phone', 'email',
      'contactPerson', 'contactRole', 'web', 'catalogUrl', 'bookingUrl', 'quoteUrl'].forEach((k) => setField('biz-' + k, k));

    container.querySelector('#biz-primaryAction')?.addEventListener('change', (e) => {
      workingDraft.primaryAction = e.target.value; renderPublishFooter();
    });

    // Diseño: tema, presentación del logo y los tres únicos ajustes
    // numéricos. Cualquier cambio aquí re-renderiza el formulario entero
    // (mismo patrón que servicios/galería) para que las miniaturas y el
    // slider de intensidad (solo activo en "Integrado") se actualicen de
    // inmediato, sin ninguna petición al servidor.
    container.querySelectorAll('[data-theme-choice]').forEach((btn) => {
      btn.addEventListener('click', () => {
        workingDraft.design.theme = btn.dataset.themeChoice;
        renderEditorForm();
      });
    });
    container.querySelectorAll('[data-pres-choice]').forEach((btn) => {
      btn.addEventListener('click', () => {
        workingDraft.design.logoPresentation = btn.dataset.presChoice;
        renderEditorForm();
      });
    });
    // 'input' (mientras se arrastra): solo actualiza el número visible,
    // sin re-renderizar -- reconstruir el formulario entero en cada
    // fotograma del arrastre destruiría el propio <input type="range">
    // a medio gesto (pierde el "agarre" del pulgar). 'change' (al soltar):
    // ahí sí se aplica de verdad y se refresca la miniatura -- sigue
    // siendo inmediato (sin red) y evita el parpadeo/salto del slider.
    const wireSlider = (id, key, limits) => {
      const el = container.querySelector('#' + id);
      if (!el) return;
      el.addEventListener('input', (e) => {
        const label = el.closest('.biz-slider-row')?.querySelector('label span:last-child');
        if (label) label.textContent = e.target.value + '%';
      });
      el.addEventListener('change', (e) => {
        workingDraft.design[key] = clampDesignNum(e.target.value, limits.min, limits.max, limits.def);
        renderEditorForm();
      });
    };
    wireSlider('biz-logoSize', 'logoSize', { min: DESIGN_LIMITS.logoSizeMin, max: DESIGN_LIMITS.logoSizeMax, def: DESIGN_LIMITS.logoSizeDefault });
    wireSlider('biz-logoPadding', 'logoPadding', { min: DESIGN_LIMITS.logoPaddingMin, max: DESIGN_LIMITS.logoPaddingMax, def: DESIGN_LIMITS.logoPaddingDefault });
    wireSlider('biz-gradientIntensity', 'gradientIntensity', { min: DESIGN_LIMITS.gradientIntensityMin, max: DESIGN_LIMITS.gradientIntensityMax, def: DESIGN_LIMITS.gradientIntensityDefault });

    container.querySelectorAll('.biz-social-input').forEach((inp) => {
      inp.addEventListener('input', () => {
        workingDraft.social = workingDraft.social || {};
        workingDraft.social[inp.dataset.key] = inp.value;
        renderPublishFooter();
      });
    });

    container.querySelectorAll('.biz-service-input').forEach((inp) => {
      inp.addEventListener('input', () => {
        const row = inp.closest('.biz-service-row');
        const i = Number(row.dataset.i);
        workingDraft.services[i] = inp.value;
        renderPublishFooter();
      });
    });
    container.querySelectorAll('.biz-service-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.i);
        workingDraft.services.splice(i, 1);
        renderEditorForm();
      });
    });
    container.querySelector('#biz-add-service')?.addEventListener('click', () => {
      if (workingDraft.services.length >= LIMITS.servicesMax) return;
      workingDraft.services.push('');
      renderEditorForm();
    });

    // Logo
    container.querySelector('#biz-logo-tile')?.addEventListener('click', (e) => {
      if (e.target.closest('#biz-logo-remove')) return;
      container.querySelector('#biz-logo-input')?.click();
    });
    container.querySelector('#biz-logo-remove')?.addEventListener('click', (e) => {
      e.stopPropagation(); workingDraft.logo = ''; renderEditorForm();
    });
    container.querySelector('#biz-logo-input')?.addEventListener('change', async (e) => {
      const file = e.target.files[0]; if (!file) return;
      try {
        workingDraft.logo = await compressImageFile(file, 480, LIMITS.imageBytesMax);
        renderEditorForm();
      } catch (_) { toast(tf('index.business.image_error_toast', 'No se pudo procesar la imagen.')); }
      e.target.value = '';
    });

    // Galería
    container.querySelector('#biz-gallery-add')?.addEventListener('click', () => container.querySelector('#biz-gallery-input')?.click());
    container.querySelectorAll('.biz-gallery-remove').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        workingDraft.gallery.splice(Number(btn.dataset.i), 1);
        renderEditorForm();
      });
    });
    container.querySelector('#biz-gallery-input')?.addEventListener('change', async (e) => {
      const file = e.target.files[0]; if (!file) return;
      if (workingDraft.gallery.length >= LIMITS.galleryMax) { e.target.value = ''; return; }
      try {
        const dataUri = await compressImageFile(file, 800, LIMITS.imageBytesMax);
        workingDraft.gallery.push(dataUri);
        renderEditorForm();
      } catch (_) { toast(tf('index.business.image_error_toast', 'No se pudo procesar la imagen.')); }
      e.target.value = '';
    });

  }

  // =================== IMÁGENES ===================
  function compressImageFile(file, maxDim, maxBytes) {
    return new Promise((resolve, reject) => {
      if (!/^image\/(png|jpeg|jpg|webp)$/.test(file.type)) { reject(new Error('tipo_no_admitido')); return; }
      const img = new Image();
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('lectura_fallida'));
      reader.onload = () => {
        img.onerror = () => reject(new Error('imagen_invalida'));
        img.onload = () => {
          let w = img.width, h = img.height;
          if (w > maxDim || h > maxDim) {
            const scale = maxDim / Math.max(w, h);
            w = Math.round(w * scale); h = Math.round(h * scale);
          }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);

          let quality = 0.85;
          let out = canvas.toDataURL('image/jpeg', quality);
          let bytes = Math.floor(out.length * 3 / 4);
          let attempts = 0;
          while (bytes > maxBytes && quality > 0.35 && attempts < 8) {
            quality -= 0.1;
            out = canvas.toDataURL('image/jpeg', quality);
            bytes = Math.floor(out.length * 3 / 4);
            attempts++;
          }
          if (bytes > maxBytes) { reject(new Error('imagen_demasiado_grande')); return; }
          resolve(out);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // =================== VALIDACIÓN / PAYLOAD ===================
  function buildPublicPayloadFromDraft(d) {
    const social = {};
    SOCIAL_KEYS.forEach((k) => { if (d.social && d.social[k]) social[k] = d.social[k].trim(); });
    return {
      modality: d.modality,
      displayName: (d.displayName || '').trim(),
      logo: d.logo || '',
      tagline: (d.tagline || '').trim(),
      description: (d.description || '').trim(),
      services: (d.services || []).map((s) => s.trim()).filter(Boolean),
      serviceArea: (d.serviceArea || '').trim(),
      address: (d.address || '').trim(),
      hours: (d.hours || '').trim(),
      phone: (d.phone || '').trim(),
      email: (d.email || '').trim(),
      contactPerson: (d.contactPerson || '').trim(),
      contactRole: (d.contactRole || '').trim(),
      web: (d.web || '').trim(),
      catalogUrl: (d.catalogUrl || '').trim(),
      bookingUrl: (d.bookingUrl || '').trim(),
      quoteUrl: (d.quoteUrl || '').trim(),
      social,
      gallery: d.gallery || [],
      primaryAction: d.primaryAction,
      design: sanitizeDesignClient(d.design),
    };
  }

  function isHttpUrlClient(v) {
    if (!v) return true; // vacío es válido (campo opcional)
    try { const u = new URL(v); return u.protocol === 'http:' || u.protocol === 'https:'; } catch (_) { return false; }
  }

  function validateForPublish(payload) {
    if (!payload.displayName) return 'nombre_invalido';
    const urls = [payload.web, payload.catalogUrl, payload.bookingUrl, payload.quoteUrl, ...Object.values(payload.social)];
    if (urls.some((u) => !isHttpUrlClient(u))) return 'url_invalida';
    if (payload.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) return 'email_invalido';
    const destino = {
      contact: !!(payload.phone || payload.email),
      quote: !!payload.quoteUrl, booking: !!payload.bookingUrl, catalog: !!payload.catalogUrl,
    };
    if (!destino[payload.primaryAction]) return 'accion_sin_destino';
    return null;
  }

  // =================== ACCIONES: GUARDAR / PUBLICAR / DESPUBLICAR ===================
  function renderPublishFooter() {
    const publishBtn = document.getElementById('btn-biz-publish');
    const unpublishBtn = document.getElementById('btn-biz-unpublish');
    const reactivateBtn = document.getElementById('btn-biz-reactivate');
    const meta = loadMeta();
    if (publishBtn) {
      publishBtn.textContent = (meta && meta.id)
        ? tf('index.business.update_button', 'Actualizar tarjeta pública')
        : tf('index.business.publish_button', 'Publicar tarjeta');
    }
    if (unpublishBtn) unpublishBtn.style.display = (meta && meta.published) ? 'block' : 'none';
    if (reactivateBtn) reactivateBtn.style.display = (meta && meta.id && meta.published === false) ? 'block' : 'none';
    renderQrBlock(meta);
  }

  function saveLocal() {
    if (!workingDraft.displayName || !workingDraft.displayName.trim()) {
      toast(tf('index.business.save_needs_name_toast', 'Escribe al menos un nombre visible antes de guardar.'));
      return;
    }
    if (!saveDraftToStorage(workingDraft)) {
      toast(tf('index.business.save_error_toast', 'No se pudo guardar en este dispositivo (almacenamiento lleno o bloqueado).'));
      return;
    }
    savedSnapshotJson = JSON.stringify(workingDraft);
    toast(tf('index.business.save_success_toast', 'Borrador guardado en este dispositivo.'));
    renderPublishFooter();
  }

  let _publishing = false;
  async function publish() {
    if (_publishing) return;
    const payload = buildPublicPayloadFromDraft(workingDraft);
    const err = validateForPublish(payload);
    if (err) { toast(tf('index.business.validation_' + err, 'Revisa los datos: hay un campo obligatorio o un enlace no válido.')); return; }

    const cred = getRegAndToken();
    if (!cred) { toast(tf('index.business.no_account_toast', 'Necesitas una cuenta registrada para publicar.')); return; }

    _publishing = true;
    const btn = document.getElementById('btn-biz-publish');
    if (btn) { btn.disabled = true; }
    try {
      // baseVersion: el token opaco `version` que este cliente conocía
      // antes de editar (si ninguno, se manda null y el servidor no exige
      // nada -- compatibilidad con la primera publicación o con no tener
      // meta local, ver business-publish.js). Protege contra reintentos
      // desincronizados: si la tarjeta cambió en el servidor mientras esta
      // petición seguía en vuelo (por ejemplo, se despublicó desde otra
      // pestaña), el servidor rechaza en vez de resucitarla a ciegas. Se
      // usa un token opaco y no `updatedAt`: dos escrituras dentro del
      // mismo milisegundo de reloj (real bajo reintentos rápidos)
      // producirían el mismo `updatedAt` y el chequeo se saltaría en falso.
      const metaPrevia = loadMeta();
      const res = await fetch('/api/business-publish', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cred.email, token: cred.token, baseVersion: metaPrevia?.version || null, ...payload }),
      });
      if (_locked) return; // la app se bloqueó mientras la petición estaba en curso
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        saveDraftToStorage(workingDraft);
        savedSnapshotJson = JSON.stringify(workingDraft);
        saveMeta({ id: data.id, url: data.url, publishedAt: data.publishedAt, updatedAt: data.updatedAt, version: data.version, published: true, payload });
        toast(tf('index.business.publish_success_toast', 'Tarjeta publicada.'));
        renderEditorForm();
      } else if (res.status === 402) {
        toast(tf('index.business.plan_inactive_toast', 'Tu plan de pago no está activo — no se puede publicar.'));
      } else if (res.status === 429) {
        toast(tf('index.business.rate_limited_toast', 'Espera unos segundos antes de volver a intentarlo.'));
      } else if (res.status === 401) {
        toast(tf('index.business.reauth_toast', 'No se pudo verificar tu cuenta. Vuelve a intentarlo tras reabrir la app.'));
      } else if (res.status === 409) {
        // La tarjeta cambió en el servidor desde la última vez que este
        // dispositivo la conoció (otra pestaña/dispositivo la tocó
        // mientras tanto) -- se refresca el estado local conocido para
        // que el próximo intento ya parta del real, en vez de reintentar
        // a ciegas sobre datos obsoletos.
        if (data.id) { const m = loadMeta() || {}; m.id = data.id; m.updatedAt = data.updatedAt; m.version = data.version; m.published = data.published; saveMeta(m); }
        toast(tf('index.business.version_conflict_toast', 'Esta tarjeta cambió en otro dispositivo o pestaña mientras tanto. Vuelve a intentarlo.'));
      } else {
        toast(tf('index.business.publish_error_toast', 'No se pudo publicar. Se conserva tu borrador para reintentarlo.'));
      }
    } catch (_) {
      toast(tf('index.business.network_error_toast', 'Sin conexión — no se pudo publicar. Se conserva tu borrador.'));
    } finally {
      _publishing = false;
      if (btn) btn.disabled = false;
    }
  }

  // Alcanzable desde dos sitios: el pie del editor (cuando el acceso de
  // pago está activo) y el hub directamente (cuando NO lo está, ver
  // renderHub) -- el servidor ya permitía despublicar sin plan vigente,
  // pero antes el único botón vivía dentro del editor, que se bloqueaba
  // precisamente en ese caso. No depende de datos locales (meta): si no
  // hay ninguna tarjeta en el servidor para esta cuenta, se informa con
  // claridad en vez de un error genérico.
  async function unpublish() {
    const cred = getRegAndToken();
    if (!cred) { toast(tf('index.business.no_account_toast', 'Necesitas una cuenta registrada para publicar.')); return; }
    const ok = window.confirm(tf('index.business.unpublish_confirm', '¿Despublicar tu tarjeta? Dejará de estar disponible en su enlace. Tus datos y la URL se conservan.'));
    if (!ok) return;
    try {
      const metaPrevia = loadMeta();
      const res = await fetch('/api/business-unpublish', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cred.email, token: cred.token, baseVersion: metaPrevia?.version || null }),
      });
      if (_locked) return; // bloqueada mientras esperábamos la respuesta
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        const meta = loadMeta() || {};
        meta.published = false; meta.updatedAt = data.updatedAt; meta.version = data.version; if (data.id) meta.id = data.id;
        saveMeta(meta);
        toast(tf('index.business.unpublish_success_toast', 'Tarjeta despublicada.'));
      } else if (res.status === 404) {
        toast(tf('index.business.nothing_published_toast', 'Todavía no hay ninguna tarjeta publicada para esta cuenta.'));
      } else if (res.status === 409) {
        if (data.id) { const m = loadMeta() || {}; m.id = data.id; m.updatedAt = data.updatedAt; m.version = data.version; m.published = data.published; saveMeta(m); }
        toast(tf('index.business.version_conflict_toast', 'Esta tarjeta cambió en otro dispositivo o pestaña mientras tanto. Vuelve a intentarlo.'));
      } else {
        toast(tf('index.business.unpublish_error_toast', 'No se pudo despublicar. Inténtalo de nuevo.'));
      }
      if (document.getElementById('screen-business-editor')?.classList.contains('open')) renderPublishFooter();
      if (document.getElementById('screen-business')?.classList.contains('open')) renderHub();
    } catch (_) { toast(tf('index.business.network_error_toast', 'Sin conexión — no se pudo despublicar.')); }
  }

  async function reactivate() {
    const cred = getRegAndToken();
    if (!cred) return;
    try {
      const metaPrevia = loadMeta();
      const res = await fetch('/api/business-reactivate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cred.email, token: cred.token, baseVersion: metaPrevia?.version || null }),
      });
      if (_locked) return;
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        const meta = loadMeta() || {};
        meta.published = true; meta.id = data.id; meta.url = data.url; meta.updatedAt = data.updatedAt; meta.version = data.version;
        saveMeta(meta);
        toast(tf('index.business.reactivate_success_toast', 'Tarjeta reactivada en su misma dirección.'));
        renderPublishFooter();
      } else if (res.status === 402) {
        toast(tf('index.business.plan_inactive_toast', 'Tu plan de pago no está activo — no se puede reactivar.'));
      } else if (res.status === 409) {
        if (data.id) { const m = loadMeta() || {}; m.id = data.id; m.updatedAt = data.updatedAt; m.version = data.version; m.published = data.published; saveMeta(m); }
        toast(tf('index.business.version_conflict_toast', 'Esta tarjeta cambió en otro dispositivo o pestaña mientras tanto. Vuelve a intentarlo.'));
      } else {
        toast(tf('index.business.reactivate_error_toast', 'No se pudo reactivar.'));
      }
    } catch (_) { toast(tf('index.business.network_error_toast', 'Sin conexión.')); }
  }

  async function pullFromServer() {
    const cred = getRegAndToken();
    if (!cred) return;
    try {
      const res = await fetch('/api/business-fetch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cred.email, token: cred.token }),
      });
      if (_locked) return;
      const data = await res.json().catch(() => ({}));
      if (!data.ok) { toast(tf('index.business.network_error_toast', 'No se pudo consultar el servidor.')); return; }
      if (!data.exists) { toast(tf('index.business.nothing_published_toast', 'Todavía no hay ninguna tarjeta publicada para esta cuenta.')); return; }
      const ok = window.confirm(tf('index.business.pull_confirm', 'Esto reemplazará tu borrador local con la última versión publicada en el servidor. ¿Continuar?'));
      if (!ok) return;
      if (_locked) return; // se bloqueó mientras se mostraba el confirm()
      const r = data.record;
      workingDraft = {
        modality: r.modality, displayName: r.displayName, logo: r.logo, tagline: r.tagline,
        description: r.description, services: r.services || [], serviceArea: r.serviceArea,
        address: r.address, hours: r.hours, phone: r.phone, email: r.email,
        contactPerson: r.contactPerson, contactRole: r.contactRole, web: r.web,
        catalogUrl: r.catalogUrl, bookingUrl: r.bookingUrl, quoteUrl: r.quoteUrl,
        social: r.social || {}, gallery: r.gallery || [], primaryAction: r.primaryAction,
        design: sanitizeDesignClient(r.design), // recupera también la presentación (ver instrucción)
      };
      saveDraftToStorage(workingDraft);
      savedSnapshotJson = JSON.stringify(workingDraft);
      saveMeta({ id: r.id, url: data.url, publishedAt: r.publishedAt, updatedAt: r.updatedAt, version: r.version, published: r.published, payload: buildPublicPayloadFromDraft(workingDraft) });
      toast(tf('index.business.pull_success_toast', 'Borrador actualizado desde el servidor.'));
      renderEditorForm();
    } catch (_) { toast(tf('index.business.network_error_toast', 'Sin conexión.')); }
  }

  // =================== QR DE TARJETA PÚBLICA ===================
  let _bizQrToken = 0;
  async function renderQrBlock(meta) {
    const holder = document.getElementById('biz-qr-holder');
    if (!holder) return;
    if (!meta || !meta.url) { holder.innerHTML = ''; return; }
    const myToken = ++_bizQrToken;
    holder.innerHTML = `<div class="biz-qr-block">
      <div id="biz-qr-render"></div>
      <div class="biz-qr-label" data-i18n="index.business.qr_label">${tf('index.business.qr_label', 'QR de tarjeta pública')}</div>
      <div style="display:flex;gap:8px;margin-top:10px;">
        <button type="button" class="btn-myqr-action" id="biz-qr-expand" style="margin:0;" data-i18n="index.main.expand_qr_button">${tf('index.main.expand_qr_button', 'Ampliar QR')}</button>
        <button type="button" class="btn-myqr-action" id="biz-qr-download" style="margin:0;" data-i18n="index.business.qr_download_button">${tf('index.business.qr_download_button', 'Descargar PNG')}</button>
      </div>
    </div>`;
    try {
      await window.ensureQRCodeStylingLoaded();
      if (myToken !== _bizQrToken) return;
      const design = window.qrDesign;
      const opts = window.buildQROptions(design, 220, meta.url, 'Q');
      const qr = new window.QRCodeStyling(opts);
      const target = document.getElementById('biz-qr-render');
      if (!target || myToken !== _bizQrToken) return;
      qr.append(target);
    } catch (_) { /* si falla la carga de la librería, el bloque queda sin QR pero el resto del editor sigue usable */ }

    document.getElementById('biz-qr-expand')?.addEventListener('click', () => {
      const svg = document.getElementById('biz-qr-render')?.querySelector('svg');
      if (svg && typeof window.openQrZoom === 'function') window.openQrZoom(svg);
    });
    document.getElementById('biz-qr-download')?.addEventListener('click', async () => {
      try {
        await window.ensureQRCodeStylingLoaded();
        const design = window.qrDesign;
        const qr = new window.QRCodeStyling(window.buildQROptions(design, 512, meta.url, 'Q'));
        const tmp = document.createElement('div');
        qr.append(tmp);
        await new Promise((r) => setTimeout(r, 250));
        const blob = await qr.getRawData('png');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'identifly_business_qr.png';
        a.click();
      } catch (_) { toast(tf('index.business.qr_download_error_toast', 'No se pudo generar el PNG del QR.')); }
    });
  }

  // =================== VISTA PREVIA ===================
  const ACTION_LABELS_PV = { contact: 'Contactar', quote: 'Pedir presupuesto', booking: 'Reservar cita', catalog: 'Ver catálogo' };
  function previewActionHref(p) {
    if (p.primaryAction === 'contact') return p.phone ? 'tel:' + p.phone : (p.email ? 'mailto:' + p.email : null);
    if (p.primaryAction === 'quote') return p.quoteUrl || null;
    if (p.primaryAction === 'booking') return p.bookingUrl || null;
    if (p.primaryAction === 'catalog') return p.catalogUrl || null;
    return null;
  }

  function openPreview() {
    const payload = buildPublicPayloadFromDraft(workingDraft);
    const body = document.getElementById('business-preview-body');
    if (!body) return;

    // Sin logo: ningún bloque (ni marcador de posición) — ver instrucción
    // "oculta su bloque sin dejar un hueco vacío".
    const logoHtml = renderLogoBlockHtml(payload.logo, payload.design);
    body.setAttribute('data-theme', payload.design.theme);

    const servicesHtml = payload.services.length
      ? `<div class="biz-pv-sec"><h3>${tf('index.business.section_services', 'Servicios')}</h3><ul class="biz-pv-services">${payload.services.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul></div>` : '';

    const galleryHtml = payload.gallery.length
      ? `<div class="biz-pv-sec"><h3>${tf('index.business.section_gallery', 'Galería')}</h3><div class="biz-pv-gallery">${payload.gallery.map((g) => `<img src="${g}" alt="">`).join('')}</div></div>` : '';

    const locBits = [];
    if (payload.serviceArea) locBits.push(`<p class="biz-pv-muted"><strong>${tf('index.business.field_service_area', 'Zona de servicio')}:</strong> ${escapeHtml(payload.serviceArea)}</p>`);
    if (payload.address) locBits.push(`<p class="biz-pv-muted"><strong>${tf('index.business.field_address', 'Dirección')}:</strong> ${escapeHtml(payload.address)}</p>`);
    if (payload.hours) locBits.push(`<p class="biz-pv-muted"><strong>${tf('index.business.field_hours', 'Horario')}:</strong> ${escapeHtml(payload.hours)}</p>`);
    const locHtml = locBits.length ? `<div class="biz-pv-sec">${locBits.join('')}</div>` : '';

    const links = [];
    if (payload.contactPerson) links.push(`<p class="biz-pv-muted" style="width:100%">${escapeHtml(payload.contactPerson)}${payload.contactRole ? ' · ' + escapeHtml(payload.contactRole) : ''}</p>`);
    if (payload.phone) links.push(`<a class="biz-pv-link-btn" href="tel:${escapeHtml(payload.phone)}">${tf('index.business.action_call', 'Llamar')}</a>`);
    if (payload.email) links.push(`<a class="biz-pv-link-btn" href="mailto:${escapeHtml(payload.email)}">${tf('index.business.action_write', 'Escribir')}</a>`);
    if (payload.web && isHttpUrlClient(payload.web)) links.push(`<a class="biz-pv-link-btn" href="${escapeHtml(payload.web)}" target="_blank" rel="noopener">Web</a>`);
    SOCIAL_KEYS.forEach((k) => { if (payload.social[k] && isHttpUrlClient(payload.social[k])) links.push(`<a class="biz-pv-link-btn" href="${escapeHtml(payload.social[k])}" target="_blank" rel="noopener">${SOCIAL_LABELS[k]}</a>`); });
    const contactHtml = links.length ? `<div class="biz-pv-sec"><h3>${tf('index.business.section_contact', 'Contacto')}</h3><div class="biz-pv-links">${links.join('')}</div></div>` : '';

    const href = previewActionHref(payload);
    const actionHtml = href ? `<a class="biz-pv-action" href="javascript:void(0)">${escapeHtml(ACTION_LABELS_PV[payload.primaryAction] || 'Contactar')}</a>` : `<p class="biz-pv-muted" style="text-align:center;">${tf('index.business.no_action_configured', 'Configura un destino para la acción principal antes de publicar.')}</p>`;

    body.innerHTML = `
      ${logoHtml}
      <div class="biz-pv-name">${escapeHtml(payload.displayName || tf('index.business.preview_untitled', 'Sin nombre todavía'))}</div>
      ${payload.tagline ? `<div class="biz-pv-tagline">${escapeHtml(payload.tagline)}</div>` : ''}
      ${payload.description ? `<p class="biz-pv-desc">${escapeHtml(payload.description)}</p>` : ''}
      ${actionHtml}
      ${servicesHtml}
      ${galleryHtml}
      ${locHtml}
      ${contactHtml}
    `;

    const screen = document.getElementById('screen-business-preview');
    if (!screen) return;
    _prevFocusPreview = document.activeElement;
    screen.classList.add('open');
    _keydownPreview = (e) => { if (e.key === 'Escape') closePreview(); };
    document.addEventListener('keydown', _keydownPreview);
  }

  function closePreview() {
    const screen = document.getElementById('screen-business-preview');
    if (screen) screen.classList.remove('open');
    if (_keydownPreview) { document.removeEventListener('keydown', _keydownPreview); _keydownPreview = null; }
    if (_prevFocusPreview && typeof _prevFocusPreview.focus === 'function') _prevFocusPreview.focus();
    _prevFocusPreview = null;
  }

  // =================== ARRANQUE ===================
  function init() {
    document.getElementById('btn-open-business')?.addEventListener('click', openBusinessHub);
    document.getElementById('btn-close-business')?.addEventListener('click', closeBusinessHub);
    document.getElementById('btn-business-upgrade')?.addEventListener('click', () => { window.location.href = '/paywall.html'; });
    document.getElementById('btn-business-unpublish-hub')?.addEventListener('click', unpublish);

    document.querySelectorAll('.biz-modality-card').forEach((card) => {
      card.addEventListener('click', () => tryOpenEditor(card.dataset.modality));
    });

    document.getElementById('btn-close-business-editor')?.addEventListener('click', () => attemptCloseEditor(true));
    document.getElementById('btn-biz-back-hub')?.addEventListener('click', () => attemptCloseEditor(false));
    document.getElementById('btn-biz-back-home')?.addEventListener('click', () => attemptCloseEditor(true));
    document.getElementById('btn-biz-save-local')?.addEventListener('click', saveLocal);
    document.getElementById('btn-biz-preview')?.addEventListener('click', openPreview);
    document.getElementById('btn-biz-publish')?.addEventListener('click', publish);
    document.getElementById('btn-biz-unpublish')?.addEventListener('click', unpublish);
    document.getElementById('btn-biz-reactivate')?.addEventListener('click', reactivate);
    document.getElementById('btn-biz-pull-server')?.addEventListener('click', pullFromServer);
    document.getElementById('btn-close-business-preview')?.addEventListener('click', closePreview);

    if (window.i18nReady && typeof window.i18nReady.finally === 'function') {
      window.i18nReady.finally(() => {
        if (window.applyI18n) window.applyI18n(document.getElementById('screen-business'));
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
