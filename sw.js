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
const CACHE_NAME = 'identity-v9';
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
