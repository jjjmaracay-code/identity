// Loader i18n compartido por register.html, index.html, recovery.html y share.html.
// Fase 1: solo existe es.json (español).
//
// Carga con fetch() ASÍNCRONO a propósito -- un XHR síncrono aquí choca con el
// Service Worker de la app (sw.js intercepta toda petición GET del origen con un
// handler `fetch` basado en promesas; un XHR bloqueante contra una URL controlada
// por el SW deja al hilo principal y al SW esperándose mutuamente y el script
// que sigue al loader deja de ejecutarse con normalidad). fetch() es la API para
// la que los Service Workers están diseñados, así que no tiene ese problema.
//
// Cada página debe arrancar su propio bootstrap (la llamada automática a init(),
// los listeners iniciales, etc.) DENTRO de `window.i18nReady.finally(fn)` en vez
// de invocarlo directo -- así se asegura que t()/data-i18n ya tengan el
// diccionario cargado antes del primer render. `.finally()` (no `.then()`) para
// que la página arranque igual, con las claves crudas como fallback, si
// /i18n/es.json no llegara a cargar por cualquier motivo.
(function () {
  var DICT = {};

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

  window.i18nReady = fetch('/i18n/es.json')
    .then(function (res) { return res.ok ? res.json() : {}; })
    .catch(function () { return {}; })
    .then(function (dict) {
      DICT = dict || {};
      applyI18n(document);
      return DICT;
    });
})();
