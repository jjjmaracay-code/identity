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
  const BUSINESS_CODE_VERSION = 'v26';

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
  let _incorporadosAlAbrir = 0; // campos del perfil incorporados al abrir el editor (solo para el aviso)

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
  // Consultado por el registro del Service Worker en el script principal
  // antes de recargar automáticamente al activarse una versión nueva --
  // una recarga forzada mientras hay cambios de Business sin guardar los
  // perdería (instrucción). isEditorDirty ya existe para el aviso de
  // "salir sin guardar" del propio editor; se reutiliza tal cual, no se
  // duplica su lógica.
  window.identityHayEdicionSinGuardar = () => isEditorDirty();
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
    draft._personalDataAppliedValues = draft._personalDataAppliedValues || {};
    // Restos de versiones anteriores: ya no se guardan en el borrador.
    delete draft._personalDataIncorporatedCount;
    delete draft._personalDataLinked;
    // Referencia para "cambios sin guardar": el borrador tal como está
    // (ya normalizado) ANTES del prerrelleno. Antes se comparaba contra
    // el borrador guardado sin normalizar, y el contador de prerrelleno
    // añadido al borrador lo marcaba siempre como modificado -- eso
    // pedía confirmar al salir sin motivo y bloqueaba la recarga tras una
    // actualización mientras el editor estuviera abierto. Si el
    // prerrelleno incorpora algo, sí cuenta como cambio sin guardar.
    const antesDelPrerrelleno = JSON.stringify(draft);
    // Prerrelleno desde el perfil personal: rastreo por campo dentro de
    // la propia función (ver su comentario) -- siempre es seguro
    // llamarla, nunca sobrescribe nada ni repone algo borrado a
    // propósito, así que se ejecuta en cada apertura sin necesitar una
    // marca global que decida si "ya tocaba" o no.
    const resultadoPrerrelleno = aplicarDatosPersonalesAlBorrador(draft);
    _incorporadosAlAbrir = resultadoPrerrelleno.incorporados;
    workingDraft = JSON.parse(JSON.stringify(draft));
    savedSnapshotJson = resultadoPrerrelleno.incorporados > 0 ? antesDelPrerrelleno : JSON.stringify(draft);
    openBusinessEditor();
  }

  function openBusinessEditor() {
    closeBusinessHub();
    const screen = document.getElementById('screen-business-editor');
    if (!screen) return;
    _locked = false;
    _prevFocusEditor = document.activeElement;
    screen.classList.add('open');
    const bloque = document.getElementById('biz-public-block');
    if (bloque) delete bloque.dataset.tipo; // se regenera con el estado actual
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
    const bloque = document.getElementById('biz-public-block');
    if (bloque && !bloque.dataset.tipo) renderPublicBlock();
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
    try { return JSON.parse(localStorage.getItem('identity_data') || '{}') || {}; } catch (_) { return {}; }
  }
  function getRegistrationName() {
    try { return (JSON.parse(localStorage.getItem('identity_registration') || 'null') || {}).name || ''; } catch (_) { return ''; }
  }

  // Incorpora al borrador (mutándolo) los datos del perfil personal que
  // tengan una correspondencia clara. Rastreo POR CAMPO, no una marca
  // global para todo el borrador (ver INFORME de entrega: una marca única
  // dejaba bloqueados el resto de campos para siempre en cuanto se
  // incorporaba uno solo). Para cada campo candidato:
  //   - Si ya tiene contenido en el borrador (propio o ya copiado antes),
  //     nunca se toca.
  //   - Si está vacío y NUNCA se llegó a incorporar un valor real para
  //     ÉL, se intenta rellenar ahora si el perfil tiene algo que ofrecer
  //     -- así un borrador donde antes solo se completó un campo (o uno
  //     de antes de que existiera este rastreo) no bloquea los demás, y
  //     un dato que el perfil no tuviera al principio pero sí más tarde
  //     puede seguir llegando en una apertura posterior.
  //   - Si está vacío pero SÍ hay constancia de que aquí se incorporó un
  //     valor en el pasado (draft._personalDataAppliedValues[campo]),
  //     es que el usuario lo borró después a propósito: nunca se repone.
  // Se lee independientemente de los controles t-* que solo deciden qué
  // se comparte en la vCard principal (instrucción): esos controles no
  // afectan si el DATO existe. Devuelve cuántos campos se incorporaron
  // EN ESTA llamada y si el perfil tenía algún dato en absoluto (solo
  // informativo, para el panel de diagnóstico).
  function aplicarDatosPersonalesAlBorrador(draft) {
    const pd = getPersonalProfileData();
    const perfilDisponible = Object.keys(pd).length > 0;
    draft._personalDataAppliedValues = draft._personalDataAppliedValues || {};
    const aplicados = draft._personalDataAppliedValues;
    let incorporados = 0;

    const asignar = (key, val) => {
      if (draft[key] || Object.prototype.hasOwnProperty.call(aplicados, key)) return;
      const limpio = (val == null) ? '' : String(val).trim();
      if (limpio) { draft[key] = limpio.slice(0, LIMITS[key] || LIMITS.url); aplicados[key] = true; incorporados++; }
    };
    const telefono = (prefijo, numero) => {
      const n = numero ? String(numero).trim() : '';
      return n ? ((prefijo ? prefijo + ' ' : '') + n) : '';
    };

    // Nombre: el mismo que muestra la tarjeta principal (perfil guardado >
    // nombre del registro, ver computeDisplayNameAndJob en index.html).
    // Antes solo se leía pd.name: una ficha cuyo nombre visible venía del
    // registro quedaba sin nombre en Business.
    const nombre = pd.name || getRegistrationName();

    // Nombre personal vs. razón social: nunca se usa el nombre de la
    // persona como nombre de una Empresa (instrucción) -- solo pd.company
    // cuenta para displayName en esa modalidad; si no existe, se deja
    // vacío en vez de inventar un dato empresarial sin equivalente.
    if (draft.modality === 'company') {
      asignar('displayName', pd.company);
    } else {
      asignar('displayName', nombre);
    }
    // Persona de contacto y cargo: correspondencia clara en las TRES
    // modalidades (instrucción), no solo Empresa -- son quien atiende la
    // tarjeta, independientemente de qué nombre se use como displayName.
    asignar('contactPerson', nombre);
    asignar('contactRole', pd.job);

    // Teléfono: el principal y, si está vacío, el móvil o el fijo -- antes
    // solo se miraba el principal y una ficha con solo móvil no aportaba
    // ningún teléfono.
    asignar('phone', telefono(pd.phoneCountryCode, pd.phoneNumber)
      || telefono(pd.mobileCountryCode, pd.mobileNumber)
      || telefono(pd.landlineCountryCode, pd.landlineNumber));
    // Correo de CONTACTO del perfil (principal, o el de trabajo/secundario
    // si el principal está vacío) -- nunca el correo de acceso/login
    // (identity_registration.email): son conceptos distintos.
    asignar('email', pd.email || pd.emailWork || pd.email2);
    asignar('web', pd.web);
    asignar('address', pd.address);

    draft.social = draft.social || {};
    SOCIAL_KEYS.forEach((k) => {
      const campoClave = 'social_' + k;
      if (draft.social[k] || Object.prototype.hasOwnProperty.call(aplicados, campoClave)) return;
      const val = pd[k] ? String(pd[k]).trim() : '';
      if (val) { draft.social[k] = val.slice(0, LIMITS.url); aplicados[campoClave] = true; incorporados++; }
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
      const aplicados = draft._personalDataAppliedValues;
      lineas.push('Campos con un valor ya incorporado alguna vez (nunca se reponen si se borran): ' + (aplicados && Object.keys(aplicados).length ? Object.keys(aplicados).join(', ') : '(ninguno todavía)'));
    }
    lineas.push('');

    // Simulación con la MISMA función real (aplicarDatosPersonalesAlBorrador),
    // sobre una COPIA -- nunca sobre el borrador real, nunca se guarda.
    // Ya no hay una marca global que omita la llamada entera: se ejecuta
    // siempre (rastreo por campo, ver esa función), así que esto muestra
    // exactamente cuántos campos NUEVOS incorporaría ahora mismo.
    const draftBase = draft ? JSON.parse(JSON.stringify(draft)) : emptyDraft('professional');
    const resultado = aplicarDatosPersonalesAlBorrador(draftBase);
    if (!resultado.perfilDisponible) {
      lineas.push('Prerrelleno: identity_data no está disponible (vacío, ausente o no legible) en este dispositivo AHORA MISMO -- no hay nada que ofrecer todavía.');
    } else if (resultado.incorporados > 0) {
      lineas.push('Prerrelleno: SÍ incorporaría ' + resultado.incorporados + ' campo(s) nuevo(s) al abrir ahora mismo.');
    } else {
      lineas.push('Prerrelleno: no incorporaría ningún campo nuevo -- o ya están todos completados/con un valor propio, o los que faltan ya se borraron a propósito antes.');
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
    if (!workingDraft || !_incorporadosAlAbrir) return '';
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

  // Bloquea un botón mientras dura una acción asíncrona y lo restaura
  // SIEMPRE (éxito, error, cancelación o bloqueo de la app) -- ningún
  // botón puede quedarse deshabilitado tras un fallo. Si el botón ya está
  // ocupado, la segunda pulsación se ignora (evita dobles envíos).
  async function conBotonOcupado(btn, textoOcupado, fn) {
    if (btn && btn.dataset.ocupado === '1') return;
    const textoOriginal = btn ? btn.textContent : '';
    if (btn) { btn.dataset.ocupado = '1'; btn.disabled = true; btn.setAttribute('aria-busy', 'true'); if (textoOcupado) btn.textContent = textoOcupado; }
    try {
      return await fn();
    } finally {
      if (btn) {
        delete btn.dataset.ocupado;
        btn.disabled = false;
        btn.removeAttribute('aria-busy');
        // Si mientras tanto se re-renderizó el texto (p. ej. Publicar ->
        // Actualizar publicación), se respeta ese texto nuevo.
        if (textoOcupado && btn.textContent === textoOcupado) btn.textContent = textoOriginal;
      }
      // El texto del botón principal depende del estado (Publicar /
      // Actualizar publicación): se recalcula tras cualquier acción.
      renderPublishFooter();
    }
  }

  // Las operaciones que necesitan red lo explican antes de intentarlo, sin
  // tocar el trabajo en curso (el editor y el borrador siguen intactos).
  function hayRed() {
    if (navigator.onLine === false) {
      toast(tf('index.business.offline_needs_network_toast', 'Sin conexión. Esta acción necesita Internet; tus cambios siguen en el editor.'));
      return false;
    }
    return true;
  }

  // Solo se acepta como enlace público la URL que devolvió el servidor
  // con la forma real de una tarjeta (/c/{id}) -- nunca una URL inventada,
  // de vista previa local ni con un token.
  function urlPublicaValida(meta) {
    const url = meta && meta.url;
    if (typeof url !== 'string') return null;
    try {
      const u = new URL(url);
      if ((u.protocol === 'https:' || u.protocol === 'http:') && /^\/c\/[a-f0-9-]+$/i.test(u.pathname) && !u.search && !u.hash) return u.href;
    } catch (_) { /* no es una URL */ }
    return null;
  }

  function estadoPublicacion() {
    const meta = loadMeta();
    const url = urlPublicaValida(meta);
    if (meta && meta.published === true && url) {
      const pendiente = !!workingDraft && JSON.stringify(buildPublicPayloadFromDraft(workingDraft)) !== JSON.stringify(meta.payload);
      return { tipo: pendiente ? 'pending' : 'published', meta, url };
    }
    if (meta && meta.id && meta.published === false) return { tipo: 'unpublished', meta, url };
    return { tipo: 'draft', meta, url: null };
  }

  function textoEstadoLocal() {
    if (isEditorDirty()) return tf('index.business.local_dirty', 'Cambios sin guardar en este dispositivo');
    if (loadDraft()) return tf('index.business.local_saved', 'Borrador guardado en este dispositivo');
    return tf('index.business.local_none', 'Todavía no has guardado este borrador');
  }

  // Actualización barata (solo textos), llamada en cada pulsación: nunca
  // reconstruye el bloque ni el QR -- antes cada tecla regeneraba el QR
  // entero y podía perderse un toque sobre sus botones a media
  // reconstrucción.
  function renderPublishFooter() {
    const est = estadoPublicacion();
    const publishBtn = document.getElementById('btn-biz-publish');
    if (publishBtn && publishBtn.dataset.ocupado !== '1') {
      publishBtn.textContent = (est.tipo === 'published' || est.tipo === 'pending')
        ? tf('index.business.update_short', 'Actualizar publicación')
        : tf('index.business.publish_short', 'Publicar');
    }
    const badge = document.getElementById('biz-public-badge');
    if (badge) {
      const textos = {
        draft: tf('index.business.public_state_draft', 'Borrador'),
        published: tf('index.business.public_state_published', 'Publicada'),
        pending: tf('index.business.public_state_pending', 'Publicada · cambios sin publicar'),
        unpublished: tf('index.business.public_state_unpublished', 'Despublicada'),
      };
      badge.textContent = textos[est.tipo];
      badge.className = 'biz-public-badge st-' + est.tipo;
    }
    const local = document.getElementById('biz-local-state');
    if (local) local.textContent = textoEstadoLocal();
    // Si el tipo de estado cambió (p. ej. por otra acción), el bloque
    // completo se regenera una sola vez.
    const bloque = document.getElementById('biz-public-block');
    if (bloque && bloque.dataset.tipo !== (est.tipo === 'pending' ? 'published' : est.tipo)) renderPublicBlock();
  }

  // Bloque "Tu tarjeta pública": enlace real, abrir, compartir, copiar y QR.
  // Antes de publicar solo se explica cómo obtenerlos -- nunca controles
  // que aparenten funcionar sobre un enlace que no existe.
  function renderPublicBlock() {
    const bloque = document.getElementById('biz-public-block');
    if (!bloque) return;
    const est = estadoPublicacion();
    const tipoBloque = est.tipo === 'pending' ? 'published' : est.tipo;
    bloque.dataset.tipo = tipoBloque;
    _bizQrToken++; // invalida cualquier QR en curso del bloque anterior
    _bizQrPng = null;
    _bizQrUrl = null;

    const cabecera = `<div class="biz-public-head">
        <h2 class="biz-public-title" id="biz-public-title">${escapeHtml(tf('index.business.public_title', 'Tu tarjeta pública'))}</h2>
        <span class="biz-public-badge" id="biz-public-badge"></span>
      </div>
      <p class="biz-public-local" id="biz-local-state"></p>`;

    let cuerpo = '';
    if (tipoBloque === 'draft') {
      cuerpo = `<p class="biz-public-hint">${escapeHtml(tf('index.business.public_hint_unpublished', 'Publica tu tarjeta para obtener un enlace y un QR.'))}</p>`;
    } else if (tipoBloque === 'unpublished') {
      cuerpo = `<p class="biz-public-hint">${escapeHtml(tf('index.business.public_unpublished_desc', 'El enlace y su QR ya no muestran la tarjeta. Si la reactivas, vuelve a estar disponible en la misma dirección.'))}</p>
        ${est.url ? `<p class="biz-public-url-off">${escapeHtml(est.url)}</p>` : ''}
        <button type="button" class="btn-myqr-action" id="btn-biz-reactivate">${escapeHtml(tf('index.business.reactivate_button', 'Reactivar publicación'))}</button>`;
    } else {
      cuerpo = `<label class="biz-public-label" for="biz-public-url">${escapeHtml(tf('index.business.public_url_label', 'Enlace público'))}</label>
        <input type="text" class="biz-public-url" id="biz-public-url" readonly value="${escapeHtml(est.url)}">
        <div class="biz-public-actions">
          <a class="btn-myqr-action" id="biz-open-public" href="${escapeHtml(est.url)}" target="_blank" rel="noopener">${escapeHtml(tf('index.business.open_card_button', 'Abrir tarjeta publicada'))}</a>
          <button type="button" class="btn-myqr-action" id="biz-share-link">${escapeHtml(tf('index.business.share_link_button', 'Compartir enlace'))}</button>
          <button type="button" class="btn-myqr-action" id="biz-copy-link">${escapeHtml(tf('index.business.copy_link_button', 'Copiar enlace'))}</button>
        </div>
        <div class="biz-qr-block">
          <div id="biz-qr-render" role="img" aria-label="${escapeHtml(tf('index.business.qr_label', 'QR de tarjeta pública'))}"></div>
          <div class="biz-qr-status" id="biz-qr-status" aria-live="polite"></div>
          <div class="biz-public-actions two">
            <button type="button" class="btn-myqr-action" id="biz-qr-expand" disabled>${escapeHtml(tf('index.main.expand_qr_button', 'Ampliar QR'))}</button>
            <button type="button" class="btn-myqr-action" id="biz-qr-download" disabled>${escapeHtml(tf('index.business.qr_download_button', 'Descargar QR'))}</button>
          </div>
        </div>
        <button type="button" class="biz-secondary-link biz-danger-link" id="btn-biz-unpublish">${escapeHtml(tf('index.business.unpublish_button', 'Despublicar'))}</button>`;
    }
    bloque.innerHTML = `<section class="biz-public-card" aria-labelledby="biz-public-title">${cabecera}${cuerpo}</section>`;

    bloque.querySelector('#btn-biz-reactivate')?.addEventListener('click', (e) => reactivate(e.currentTarget));
    bloque.querySelector('#btn-biz-unpublish')?.addEventListener('click', (e) => unpublish(e.currentTarget));
    bloque.querySelector('#biz-share-link')?.addEventListener('click', compartirEnlace);
    bloque.querySelector('#biz-copy-link')?.addEventListener('click', () => copiarEnlace());
    bloque.querySelector('#biz-public-url')?.addEventListener('focus', (e) => e.target.select());
    bloque.querySelector('#biz-qr-expand')?.addEventListener('click', ampliarQr);
    bloque.querySelector('#biz-qr-download')?.addEventListener('click', (e) => descargarQr(e.currentTarget));

    renderPublishFooter();
    if (tipoBloque === 'published') renderPublicQr(est.url);
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
    const est = estadoPublicacion();
    toast(est.tipo === 'pending'
      ? tf('index.business.save_success_pending_toast', 'Guardado en este dispositivo. Pulsa «Actualizar publicación» para llevarlo a tu tarjeta pública.')
      : tf('index.business.save_success_toast', 'Borrador guardado en este dispositivo.'));
    renderPublishFooter();
  }

  async function publish() {
    const btn = document.getElementById('btn-biz-publish');
    const payload = buildPublicPayloadFromDraft(workingDraft);
    const err = validateForPublish(payload);
    if (err) { toast(tf('index.business.validation_' + err, 'Revisa los datos: hay un campo obligatorio o un enlace no válido.')); return; }
    if (estadoPublicacion().tipo === 'published') {
      toast(tf('index.business.already_up_to_date_toast', 'Tu tarjeta pública ya está al día.'));
      return;
    }

    const cred = getRegAndToken();
    if (!cred) { toast(tf('index.business.no_account_toast', 'Necesitas una cuenta registrada para publicar.')); return; }
    if (!hayRed()) return;

    await conBotonOcupado(btn, tf('index.business.busy_publishing', 'Publicando…'), async () => {
      try {
        // baseVersion: token opaco de concurrencia optimista (ver v18 en sw.js).
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
          toast(tf('index.business.publish_success_toast', 'Tarjeta publicada. Ya tienes tu enlace y tu QR.'));
          renderPublicBlock();
          document.getElementById('biz-public-block')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else if (res.status === 402) {
          toast(tf('index.business.plan_inactive_toast', 'Tu plan de pago no está activo — no se puede publicar.'));
        } else if (res.status === 429) {
          toast(tf('index.business.rate_limited_toast', 'Espera unos segundos antes de volver a intentarlo.'));
        } else if (res.status === 401) {
          toast(tf('index.business.reauth_toast', 'No se pudo verificar tu cuenta. Vuelve a intentarlo tras reabrir la app.'));
        } else if (res.status === 409) {
          if (data.id) { const m = loadMeta() || {}; m.id = data.id; m.updatedAt = data.updatedAt; m.version = data.version; m.published = data.published; saveMeta(m); }
          toast(tf('index.business.version_conflict_toast', 'Esta tarjeta cambió en otro dispositivo o pestaña mientras tanto. Vuelve a intentarlo.'));
          renderPublicBlock();
        } else if (res.status === 400) {
          toast(tf('index.business.validation_' + (data.error || ''), tf('index.business.publish_error_toast', 'No se pudo publicar. Se conserva tu borrador para reintentarlo.')));
        } else {
          toast(tf('index.business.publish_error_toast', 'No se pudo publicar. Se conserva tu borrador para reintentarlo.'));
        }
      } catch (_) {
        toast(tf('index.business.network_error_toast', 'Sin conexión — no se pudo completar la acción. Se conserva tu borrador.'));
      }
    });
  }

  // Alcanzable desde el bloque "Tu tarjeta pública" (acceso activo) y
  // desde el hub (acceso inactivo, ver renderHub) -- el servidor permite
  // despublicar sin plan vigente.
  async function unpublish(btnArg) {
    const btn = (btnArg && btnArg.nodeType === 1) ? btnArg : null;
    const cred = getRegAndToken();
    if (!cred) { toast(tf('index.business.no_account_toast', 'Necesitas una cuenta registrada para publicar.')); return; }
    if (!hayRed()) return;
    const ok = window.confirm(tf('index.business.unpublish_confirm', '¿Despublicar tu tarjeta? Su enlace y su QR dejarán de mostrarla. Tus datos y la dirección se conservan para reactivarla.'));
    if (!ok) return;
    await conBotonOcupado(btn, tf('index.business.busy_unpublishing', 'Despublicando…'), async () => {
      try {
        const metaPrevia = loadMeta();
        const res = await fetch('/api/business-unpublish', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: cred.email, token: cred.token, baseVersion: metaPrevia?.version || null }),
        });
        if (_locked) return;
        const data = await res.json().catch(() => ({}));
        if (data.ok) {
          const meta = loadMeta() || {};
          meta.published = false; meta.updatedAt = data.updatedAt; meta.version = data.version; if (data.id) meta.id = data.id;
          saveMeta(meta);
          toast(tf('index.business.unpublish_success_toast', 'Tarjeta despublicada. Su enlace y su QR ya no la muestran.'));
        } else if (res.status === 404) {
          toast(tf('index.business.nothing_published_toast', 'Todavía no hay ninguna tarjeta publicada para esta cuenta.'));
        } else if (res.status === 409) {
          if (data.id) { const m = loadMeta() || {}; m.id = data.id; m.updatedAt = data.updatedAt; m.version = data.version; m.published = data.published; saveMeta(m); }
          toast(tf('index.business.version_conflict_toast', 'Esta tarjeta cambió en otro dispositivo o pestaña mientras tanto. Vuelve a intentarlo.'));
        } else {
          toast(tf('index.business.unpublish_error_toast', 'No se pudo despublicar. Inténtalo de nuevo.'));
        }
      } catch (_) {
        toast(tf('index.business.network_error_toast', 'Sin conexión — no se pudo completar la acción. Se conserva tu borrador.'));
      }
    });
    if (_locked) return;
    if (document.getElementById('screen-business-editor')?.classList.contains('open')) renderPublicBlock();
    if (document.getElementById('screen-business')?.classList.contains('open')) renderHub();
  }

  async function reactivate(btnArg) {
    const btn = (btnArg && btnArg.nodeType === 1) ? btnArg : null;
    const cred = getRegAndToken();
    if (!cred) { toast(tf('index.business.no_account_toast', 'Necesitas una cuenta registrada para publicar.')); return; }
    if (!hayRed()) return;
    await conBotonOcupado(btn, tf('index.business.busy_reactivating', 'Reactivando…'), async () => {
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
        } else if (res.status === 402) {
          toast(tf('index.business.plan_inactive_toast', 'Tu plan de pago no está activo — no se puede reactivar.'));
        } else if (res.status === 409) {
          if (data.id) { const m = loadMeta() || {}; m.id = data.id; m.updatedAt = data.updatedAt; m.version = data.version; m.published = data.published; saveMeta(m); }
          toast(tf('index.business.version_conflict_toast', 'Esta tarjeta cambió en otro dispositivo o pestaña mientras tanto. Vuelve a intentarlo.'));
        } else {
          toast(tf('index.business.reactivate_error_toast', 'No se pudo reactivar. Inténtalo de nuevo.'));
        }
      } catch (_) {
        toast(tf('index.business.network_error_toast', 'Sin conexión — no se pudo completar la acción. Se conserva tu borrador.'));
      }
    });
    if (!_locked) renderPublicBlock();
  }

  async function pullFromServer(ev) {
    const btn = ev && ev.currentTarget && ev.currentTarget.nodeType === 1 ? ev.currentTarget : null;
    const cred = getRegAndToken();
    if (!cred) { toast(tf('index.business.no_account_toast', 'Necesitas una cuenta registrada para publicar.')); return; }
    if (!hayRed()) return;
    await conBotonOcupado(btn, tf('index.business.busy_generic', 'Un momento…'), async () => {
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
        if (!ok || _locked) return;
        const r = data.record;
        workingDraft = {
          modality: r.modality, displayName: r.displayName, logo: r.logo, tagline: r.tagline,
          description: r.description, services: r.services || [], serviceArea: r.serviceArea,
          address: r.address, hours: r.hours, phone: r.phone, email: r.email,
          contactPerson: r.contactPerson, contactRole: r.contactRole, web: r.web,
          catalogUrl: r.catalogUrl, bookingUrl: r.bookingUrl, quoteUrl: r.quoteUrl,
          social: r.social || {}, gallery: r.gallery || [], primaryAction: r.primaryAction,
          design: sanitizeDesignClient(r.design),
          _personalDataAppliedValues: (workingDraft && workingDraft._personalDataAppliedValues) || {},
        };
        saveDraftToStorage(workingDraft);
        savedSnapshotJson = JSON.stringify(workingDraft);
        saveMeta({ id: r.id, url: data.url, publishedAt: r.publishedAt, updatedAt: r.updatedAt, version: r.version, published: r.published, payload: buildPublicPayloadFromDraft(workingDraft) });
        toast(tf('index.business.pull_success_toast', 'Borrador actualizado desde el servidor.'));
        renderEditorForm();
      } catch (_) {
        toast(tf('index.business.network_error_toast', 'Sin conexión — no se pudo completar la acción. Se conserva tu borrador.'));
      }
    });
  }

  // =================== COMPARTIR / COPIAR ===================
  function urlActual() {
    return urlPublicaValida(loadMeta());
  }

  // Selector nativo del dispositivo si existe; si no existe o falla (salvo
  // que el usuario lo cancele), se ofrece copiar. Cancelar nunca deja
  // nada bloqueado: no hay estado "ocupado" que depender de la promesa.
  let _compartiendo = false;
  function compartirEnlace() {
    const url = urlActual();
    if (!url) { toast(tf('index.business.public_hint_unpublished', 'Publica tu tarjeta para obtener un enlace y un QR.')); return; }
    if (typeof navigator.share !== 'function') { copiarEnlace(); return; }
    if (_compartiendo) return;
    _compartiendo = true;
    let promesa;
    try {
      promesa = navigator.share({ title: loadMeta()?.payload?.displayName || 'IDENTIFLY BUSINESS', url });
    } catch (e) {
      _compartiendo = false;
      copiarEnlace();
      return;
    }
    Promise.resolve(promesa)
      .catch((e) => { if (!e || e.name !== 'AbortError') copiarEnlace(); })
      .finally(() => { _compartiendo = false; });
  }

  async function copiarEnlace() {
    const url = urlActual();
    if (!url) return;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(url);
        toast(tf('index.business.link_copied_toast', 'Enlace copiado'));
        return;
      }
    } catch (_) { /* sin permiso o sin gesto: se prueba la vía clásica */ }
    const input = document.getElementById('biz-public-url');
    let copiado = false;
    if (input) {
      input.focus();
      input.select();
      try { input.setSelectionRange(0, url.length); } catch (_) {}
      try { copiado = document.execCommand('copy'); } catch (_) { copiado = false; }
    }
    // Último recurso: el enlace queda seleccionado y visible para copiarlo a mano.
    toast(copiado
      ? tf('index.business.link_copied_toast', 'Enlace copiado')
      : tf('index.business.copy_manual_toast', 'Mantén pulsado el enlace seleccionado para copiarlo.'));
  }

  // =================== QR DE TARJETA PÚBLICA ===================
  let _bizQrToken = 0;
  let _bizQrPng = null; // PNG ya preparado (para que "Descargar" no pierda el gesto del usuario)
  let _bizQrUrl = null; // URL que codifica el QR actualmente mostrado

  // Diseño del QR acordado (el mismo del QR principal). Antes se leía
  // window.qrDesign, que nunca existió (qrDesign es `let` de ámbito de
  // módulo en index.html): buildQROptions(undefined) lanzaba y el catch
  // vacío dejaba "Ampliar QR"/"Descargar PNG" sin ningún QR.
  const QR_DESIGN_DEFAULT = {
    dotsType: 'square', dotsColor: '#1a1a1a', bgColor: '#f5f5f5',
    cornerSquareType: 'square', cornerDotType: 'square', cornerSquareColor: '#1a1a1a', cornerDotColor: '#1a1a1a',
  };
  function disenoQr() {
    try {
      const d = typeof window.identiflyQrDesign === 'function' ? window.identiflyQrDesign() : null;
      return { ...QR_DESIGN_DEFAULT, ...(d || {}) };
    } catch (_) { return { ...QR_DESIGN_DEFAULT }; }
  }

  function esperar(ms) { return new Promise((r) => setTimeout(r, ms)); }

  async function renderPublicQr(url) {
    const myToken = ++_bizQrToken;
    _bizQrPng = null;
    _bizQrUrl = null;
    const target = document.getElementById('biz-qr-render');
    const estado = document.getElementById('biz-qr-status');
    const btnAmpliar = document.getElementById('biz-qr-expand');
    const btnDescargar = document.getElementById('biz-qr-download');
    if (!target) return;
    if (btnAmpliar) btnAmpliar.disabled = true;
    if (btnDescargar) btnDescargar.disabled = true;
    if (estado) estado.textContent = tf('index.business.qr_loading', 'Generando QR…');
    target.innerHTML = '';
    try {
      await window.ensureQRCodeStylingLoaded();
      if (myToken !== _bizQrToken) return;
      const qr = new window.QRCodeStyling(window.buildQROptions(disenoQr(), 220, url, 'Q'));
      qr.append(target);
      // El SVG se dibuja de forma asíncrona dentro de la librería.
      for (let i = 0; i < 40 && !(target.querySelector('svg rect, svg path, svg circle')); i++) await esperar(50);
      if (myToken !== _bizQrToken) return;
      if (!target.querySelector('svg')) throw new Error('qr_sin_svg');
      _bizQrUrl = url;
      if (estado) estado.textContent = '';
      if (btnAmpliar) btnAmpliar.disabled = false;
      if (btnDescargar) btnDescargar.disabled = false;
      // Se prepara el PNG en segundo plano: al pulsar "Descargar QR" ya
      // está listo y el selector del dispositivo no pierde el gesto.
      prepararPngQr(url, myToken);
    } catch (_) {
      if (myToken !== _bizQrToken) return;
      target.innerHTML = '';
      if (estado) {
        estado.innerHTML = `<span>${escapeHtml(tf('index.business.qr_error', 'No se pudo generar el QR.'))}</span> <button type="button" class="biz-secondary-link" id="biz-qr-retry">${escapeHtml(tf('index.business.qr_retry_button', 'Reintentar'))}</button>`;
        document.getElementById('biz-qr-retry')?.addEventListener('click', () => renderPublicQr(url));
      }
    }
  }

  // PNG a partir de la propia matriz del QR (módulos cuadrados con los
  // colores del diseño) -- respaldo cuando la conversión SVG->PNG de la
  // librería sale en blanco (bug conocido de Safari/WebKit, ver
  // isImageBlobBlank en index.html).
  function pngDesdeMatriz(qr, design, lado) {
    const matriz = qr && qr._qr;
    if (!matriz || typeof matriz.getModuleCount !== 'function') return Promise.reject(new Error('sin_matriz'));
    const n = matriz.getModuleCount();
    const margen = 4;
    const celda = Math.max(1, Math.floor(lado / (n + margen * 2)));
    const total = celda * (n + margen * 2);
    const canvas = document.createElement('canvas');
    canvas.width = total; canvas.height = total;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = design.bgColor || '#ffffff';
    ctx.fillRect(0, 0, total, total);
    ctx.fillStyle = design.dotsColor || '#000000';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (matriz.isDark(r, c)) ctx.fillRect((c + margen) * celda, (r + margen) * celda, celda, celda);
      }
    }
    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/png'));
  }

  async function generarPngQr(url) {
    await window.ensureQRCodeStylingLoaded();
    const design = disenoQr();
    const qr = new window.QRCodeStyling(window.buildQROptions(design, 1024, url, 'Q'));
    qr.append(document.createElement('div'));
    await esperar(300);
    let blob = null;
    try { blob = await qr.getRawData('png'); } catch (_) { blob = null; }
    const enBlanco = !blob || (typeof window.isImageBlobBlank === 'function' ? await window.isImageBlobBlank(blob) : false);
    return enBlanco ? pngDesdeMatriz(qr, design, 1024) : blob;
  }

  async function prepararPngQr(url, token) {
    try {
      const blob = await generarPngQr(url);
      if (token === _bizQrToken) _bizQrPng = blob;
    } catch (_) { /* se reintentará al pulsar Descargar */ }
  }

  function ampliarQr() {
    const svg = document.getElementById('biz-qr-render')?.querySelector('svg');
    if (!svg || typeof window.openQrZoom !== 'function') {
      toast(tf('index.myqr.qr_loading_toast', 'El código aún se está generando. Espera un momento e inténtalo de nuevo.'));
      return;
    }
    window.openQrZoom(svg);
  }

  function nombreArchivoQr() { return 'identifly-business-qr.png'; }

  function descargarBlob(blob) {
    const a = document.createElement('a');
    const href = URL.createObjectURL(blob);
    a.href = href;
    a.download = nombreArchivoQr();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 30000);
    toast(tf('index.business.qr_downloaded_toast', 'QR descargado'));
  }

  // En móvil se usa el selector del dispositivo con el PNG (en iOS es la
  // forma fiable de "Guardar imagen"); en ordenador, descarga directa.
  async function descargarQr(btn) {
    const url = _bizQrUrl;
    if (!url) { ampliarQr(); return; }
    const esMovil = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    if (_bizQrPng && esMovil && typeof navigator.share === 'function' && typeof navigator.canShare === 'function') {
      const file = new File([_bizQrPng], nombreArchivoQr(), { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file] }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
      }
    }
    await conBotonOcupado(btn, tf('index.business.busy_generic', 'Un momento…'), async () => {
      try {
        const blob = _bizQrPng || await generarPngQr(url);
        if (url === _bizQrUrl) _bizQrPng = blob;
        descargarBlob(blob);
      } catch (_) {
        toast(tf('index.business.qr_download_error_toast', 'No se pudo generar la imagen del QR. Puedes ampliarlo y hacer una captura.'));
      }
    });
  }

  // =================== VISTA PREVIA ===================
  const ACTION_LABELS_PV = { contact: 'Contactar', quote: 'Pedir presupuesto', booking: 'Reservar cita', catalog: 'Ver catálogo' };
  // Mismo criterio que la tarjeta pública (functions/c/[id].js): el
  // teléfono solo conserva '+' y dígitos.
  function telHref(phone) { const limpio = String(phone || '').replace(/[^\d+]/g, ''); return limpio ? 'tel:' + limpio : null; }
  function previewActionHref(p) {
    if (p.primaryAction === 'contact') return p.phone ? telHref(p.phone) : (p.email ? 'mailto:' + p.email : null);
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
      ? `<div class="biz-pv-sec"><h3>${escapeHtml(tf('index.business.pv_label_gallery', 'Galería'))}</h3><div class="biz-pv-gallery">${payload.gallery.map((g) => `<img src="${g}" alt="">`).join('')}</div></div>` : '';

    const locBits = [];
    // Etiquetas propias del contenido público -- nunca las del formulario
    // (que llevan "(opcional)"). Mismos textos que functions/c/[id].js.
    if (payload.serviceArea) locBits.push(`<p class="biz-pv-muted"><strong>${escapeHtml(tf('index.business.pv_label_area', 'Zona de servicio'))}:</strong> ${escapeHtml(payload.serviceArea)}</p>`);
    if (payload.address) locBits.push(`<p class="biz-pv-muted"><strong>${escapeHtml(tf('index.business.pv_label_address', 'Dirección'))}:</strong> ${escapeHtml(payload.address)}</p>`);
    if (payload.hours) locBits.push(`<p class="biz-pv-muted"><strong>${escapeHtml(tf('index.business.pv_label_hours', 'Horario'))}:</strong> ${escapeHtml(payload.hours)}</p>`);
    const locHtml = locBits.length ? `<div class="biz-pv-sec">${locBits.join('')}</div>` : '';

    const links = [];
    if (payload.contactPerson) links.push(`<p class="biz-pv-muted" style="width:100%">${escapeHtml(payload.contactPerson)}${payload.contactRole ? ' · ' + escapeHtml(payload.contactRole) : ''}</p>`);
    if (payload.phone && telHref(payload.phone)) links.push(`<a class="biz-pv-link-btn" href="${escapeHtml(telHref(payload.phone))}">${tf('index.business.action_call', 'Llamar')}</a>`);
    if (payload.email) links.push(`<a class="biz-pv-link-btn" href="mailto:${escapeHtml(payload.email)}">${tf('index.business.action_write', 'Escribir')}</a>`);
    if (payload.web && isHttpUrlClient(payload.web)) links.push(`<a class="biz-pv-link-btn" href="${escapeHtml(payload.web)}" target="_blank" rel="noopener">Web</a>`);
    SOCIAL_KEYS.forEach((k) => { if (payload.social[k] && isHttpUrlClient(payload.social[k])) links.push(`<a class="biz-pv-link-btn" href="${escapeHtml(payload.social[k])}" target="_blank" rel="noopener">${SOCIAL_LABELS[k]}</a>`); });
    const contactHtml = links.length ? `<div class="biz-pv-sec"><h3>${tf('index.business.section_contact', 'Contacto')}</h3><div class="biz-pv-links">${links.join('')}</div></div>` : '';

    const href = previewActionHref(payload);
    const actionHtml = href ? `<a class="biz-pv-action" href="${escapeHtml(href)}"${/^https?:/i.test(href) ? ' target="_blank" rel="noopener"' : ''}>${escapeHtml(ACTION_LABELS_PV[payload.primaryAction] || 'Contactar')}</a>` : `<p class="biz-pv-muted" style="text-align:center;">${tf('index.business.no_action_configured', 'Configura un destino para la acción principal antes de publicar.')}</p>`;

    body.innerHTML = `
      <p class="biz-pv-draft-note">${escapeHtml(tf('index.business.preview_draft_note', 'Borrador: así se verá al publicar. No es la versión publicada.'))}</p>
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
    document.getElementById('btn-business-unpublish-hub')?.addEventListener('click', (e) => unpublish(e.currentTarget));

    document.querySelectorAll('.biz-modality-card').forEach((card) => {
      card.addEventListener('click', () => tryOpenEditor(card.dataset.modality));
    });

    document.getElementById('btn-close-business-editor')?.addEventListener('click', () => attemptCloseEditor(true));
    document.getElementById('btn-biz-back-hub')?.addEventListener('click', () => attemptCloseEditor(false));
    document.getElementById('btn-biz-save-local')?.addEventListener('click', saveLocal);
    document.getElementById('btn-biz-preview')?.addEventListener('click', openPreview);
    document.getElementById('btn-biz-publish')?.addEventListener('click', publish);
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
