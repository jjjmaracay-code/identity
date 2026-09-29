// v12: misma razón que v11/v10 -- esta fase ("Mis QR · Redes y web") añade
// 15 claves nuevas a los 5 diccionarios (index.myqr.*). Sin subir la
// versión, un dispositivo que ya tuviera un idioma cacheado desde antes
// seguiría sirviendo ese diccionario viejo (mostrando la key cruda en vez
// del texto del nuevo panel) hasta que algo purgue esa caché. No se
// añaden recursos nuevos a CACHE_URLS: los iconos de plataforma son SVG
// inline en index.html, no archivos aparte.
//
// v11: mismo motivo que v10 -- esta fase añadió claves nuevas a los 5
// diccionarios (ayudas de prerrellenado de redes sociales, aviso de
// enlace inválido). Sin subir la versión, un dispositivo que ya tuviera
// un idioma cacheado desde antes de esta fase seguiría sin esas claves
// (se le mostraría la key cruda en vez del texto) hasta que algo purgue
// esa caché.
//
// v10: los diccionarios /i18n/*.json son recursos no-HTML -- caen en la
// misma estrategia "cache primero" que qr-code-styling.js (ver el
// handler de fetch mas abajo) y no estan en CACHE_URLS, pero se cachean
// igual la primera vez que index.html/register.html/etc. los piden. Un
// dispositivo que ya tuviera un idioma cacheado desde antes de anadir la
// clave index.main.expand_qr_button seguiria sirviendo ese diccionario
// viejo para siempre sin este cambio de version, sin importar que el
// servidor ya tenga el archivo correcto.
//
// v9: sube la version para forzar que activate() purgue la cache v8 --
// necesario porque los recursos no-HTML (incluido qr-code-styling.js) se
// sirven con estrategia "cache primero" (ver el handler de fetch mas
// abajo): sin este cambio de version, cualquier usuario que ya hubiera
// cacheado una copia (desde el CDN externo anterior, o incluso una copia
// parcial/corrupta servida durante el propio despliegue) seguiria
// recibiendola para siempre, sin importar que se corrija en el
// servidor. Se añade tambien el archivo auto-hospedado al precache para
// que estè disponible desde el primer arranque, no solo tras la
// primera visita online.
const CACHE_NAME = 'identity-v12';
const CACHE_URLS = [
  './index.html',
  './register.html',
  './recovery.html',
  './paywall.html',
  './install.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './assets/logo-wings.png',
  './vendor/qr-code-styling/qr-code-styling.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const isHTML = event.request.mode === 'navigate' ||
                 new URL(event.request.url).pathname.endsWith('.html');

  if (isHTML) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.status === 200) {
            const toCache = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, toCache));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // La Cache API solo admite GET — cachear una respuesta de POST/PUT/etc.
  // (ej. /api/register-complete) lanza una excepción en cache.put(). Esas
  // peticiones van directo a red, sin pasar por cache en ningún sentido.
  if (event.request.method !== 'GET') {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200 || response.type === 'opaque') {
          return response;
        }
        const toCache = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, toCache));
        return response;
      });
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});
