// Loader i18n compartido por register.html, index.html, recovery.html y share.html.
// Fase 2: multiidioma (es/en/fr/pt/de).
//
// Carga con fetch() ASÍNCRONO a propósito -- un XHR síncrono aquí choca con el
// Service Worker de la app (sw.js intercepta toda petición GET del origen con un
// handler `fetch` basado en promesas; un XHR bloqueante contra una URL controlada
// por el SW deja al hilo principal y al SW esperándose mutuamente y el script
// que sigue al loader deja de ejecutarse con normalidad). fetch() es la API para
// la que los Service Workers están diseñados, así que no tiene ese problema.
//
// Selección de idioma, en orden de prioridad:
//   1. identity_registration.language -- el usuario ya se registró y fijó un
//      idioma para su cuenta (ver applyRegistrationLock() en index.html, que
//      lo bloquea junto con name/email/phone). Todas las páginas (register,
//      index, recovery, share) deben respetar este valor una vez existe.
//   2. navigator.language / navigator.languages -- dispositivo sin registro
//      todavía (usuario nuevo en register.html, o cualquier página cargada
//      sin identity_registration en este dispositivo): se usa el idioma del
//      navegador como default razonable.
//   3. 'es' -- fallback final, tanto si el idioma detectado no está entre los
//      soportados como si el fetch del diccionario correspondiente fallara
//      por cualquier motivo (red, 404, etc.).
//
// Cada página debe arrancar su propio bootstrap (la llamada automática a init(),
// los listeners iniciales, etc.) DENTRO de `window.i18nReady.finally(fn)` en vez
// de invocarlo directo -- así se asegura que t()/data-i18n ya tengan el
// diccionario cargado antes del primer render. `.finally()` (no `.then()`) para
// que la página arranque igual, con las claves crudas como fallback, si ningún
// diccionario llegara a cargar por cualquier motivo.
(function () {
  // 12 idiomas (fase 3): es/ca/eu/gl/en/fr/de/pt/hi/zh/ru/ja -- zh es
  // siempre chino SIMPLIFICADO. La detección usa los 2 primeros
  // caracteres de navigator.language en minúsculas, lo que ya cubre
  // "es-ES"->es, "pt-BR"->pt, "zh-TW"/"zh-HK"/"zh-CN"->zh,
  // "en-US"->en, "fr-CA"->fr, "de-AT"->de, etc. sin lógica aparte.
  var SUPPORTED_LANGS = ['es', 'ca', 'eu', 'gl', 'en', 'fr', 'de', 'pt', 'hi', 'zh', 'ru', 'ja', 'ar'];
  var DICT = {};
  // La demo pública usa solo el idioma del navegador o su selector, sin
  // consultar ni persistir ningún dato del dispositivo o de una cuenta.
  var ISOLATED = document.documentElement.hasAttribute('data-i18n-isolated');

  function updateDocumentLanguage(lang) {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }

  function detectLanguage() {
    if (!ISOLATED) {
      try {
        var reg = JSON.parse(localStorage.getItem('identity_registration') || 'null');
        if (reg && reg.language && SUPPORTED_LANGS.indexOf(reg.language) !== -1) {
          return reg.language;
        }
      } catch (e) {}
      // Elección manual antes de registrarse (p.ej. desde el selector de la
      // pantalla de consentimiento, o el propio selector de register.html
      // antes de completar el registro) -- se guarda en setLanguage() de
      // más abajo. Una vez existe identity_registration.language (cuenta ya
      // registrada), esa es la fuente de verdad y esta queda ignorada.
      try {
        var pref = localStorage.getItem('identity_language_pref');
        if (pref && SUPPORTED_LANGS.indexOf(pref) !== -1) return pref;
      } catch (e) {}
    }
    var navLangs = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || 'en'];
    for (var i = 0; i < navLangs.length; i++) {
      var code = String(navLangs[i] || '').slice(0, 2).toLowerCase();
      if (SUPPORTED_LANGS.indexOf(code) !== -1) return code;
    }
    // Cualquier idioma del navegador que no esté entre los 12 soportados
    // cae en inglés -- antes caía en español, pero español ya es uno de
    // los 12 idiomas explícitos de la lista, no un "idioma por defecto
    // universal" para hablantes de otros idiomas no soportados.
    return 'en';
  }

  var LANG = detectLanguage();
  window.currentLanguage = LANG;
  // document.documentElement.lang es lo que hace coincidir los selectores
  // CSS :lang(hi)/:lang(zh)/:lang(ja) (ver letter-spacing/text-transform
  // en el <style> de cada página) -- sin esto :lang() nunca coincide con
  // nada, porque el <html lang="..."> del documento nunca cambiaba.
  try { updateDocumentLanguage(LANG); } catch (e) {}

  window.t = function (key) {
    return Object.prototype.hasOwnProperty.call(DICT, key) ? DICT[key] : key;
  };

  function applyI18n(root) {
    root = root || document;
    root.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      if (Object.prototype.hasOwnProperty.call(DICT, key)) el.textContent = DICT[key];
    });
    root.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-html');
      if (Object.prototype.hasOwnProperty.call(DICT, key)) el.innerHTML = DICT[key];
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-placeholder');
      if (Object.prototype.hasOwnProperty.call(DICT, key)) el.placeholder = DICT[key];
    });
    root.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-aria');
      if (Object.prototype.hasOwnProperty.call(DICT, key)) el.setAttribute('aria-label', DICT[key]);
    });
    root.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-title');
      if (Object.prototype.hasOwnProperty.call(DICT, key)) el.title = DICT[key];
    });
  }
  window.applyI18n = applyI18n;

  // Cambio de idioma EN VIVO -- usado por el selector de idioma del Paso 1
  // de register.html y por el nuevo selector de la pantalla de
  // consentimiento de index.html (ver screen-consent): el usuario debe
  // ver el resto del formulario/app (toasts, validaciones) en el idioma
  // que acaba de elegir, sin esperar a completar el registro. Recarga el
  // diccionario y vuelve a aplicar data-i18n sobre todo el documento.
  // Además persiste la elección en identity_language_pref (ver
  // detectLanguage() más arriba) para que, si el usuario llega después a
  // register.html (u otra página) SIN haber completado aún el registro
  // -- identity_registration.language todavía no existe -- su elección
  // siga ahí preseleccionada en vez de recalcularse desde
  // navigator.language. Una vez el registro se completa,
  // identity_registration.language pasa a mandar (ver register.html) y
  // esta clave queda sin efecto, aunque no se borra.
  window.setLanguage = function (lang) {
    if (SUPPORTED_LANGS.indexOf(lang) === -1) lang = 'es';
    return fetch('/i18n/' + lang + '.json')
      .then(function (res) { return res.ok ? res.json() : {}; })
      .catch(function () { return {}; })
      .then(function (dict) {
        DICT = dict || {};
        window.currentLanguage = lang;
        try { updateDocumentLanguage(lang); } catch (e) {}
        if (!ISOLATED) {
          try { localStorage.setItem('identity_language_pref', lang); } catch (e) {}
        }
        applyI18n(document);
        return DICT;
      });
  };

  window.i18nReady = fetch('/i18n/' + LANG + '.json')
    .then(function (res) { return res.ok ? res.json() : null; })
    .catch(function () { return null; })
    .then(function (dict) {
      // Si el idioma detectado no cargó (red caída, archivo ausente, etc.) y
      // no era ya español, reintenta con español antes de rendirse -- nunca
      // debe llegarse a una página sin ningún diccionario cargado si se puede
      // evitar.
      if (dict) return dict;
      if (LANG === 'es') return {};
      window.currentLanguage = 'es';
      try { updateDocumentLanguage('es'); } catch (e) {}
      return fetch('/i18n/es.json')
        .then(function (res) { return res.ok ? res.json() : {}; })
        .catch(function () { return {}; });
    })
    .then(function (dict) {
      DICT = dict || {};
      applyI18n(document);
      return DICT;
    });
})();
