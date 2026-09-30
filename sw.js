// v25: causa de fondo de que un dispositivo siguiera ejecutando un
// business.js antiguo aunque el Service Worker nuevo se instalara: el
// precache (cache.addAll) y la estrategia "cache primero" de los .js/.css
// usaban el modo de caché por defecto de fetch(), que PUEDE responder
// desde la caché HTTP del propio navegador en vez de ir a la red. Una
// copia vieja de business.js guardada en la caché HTTP del dispositivo
// (p. ej. con un max-age largo impuesto antes por el Browser Cache TTL de
// Cloudflare -- cambiar ese ajuste NO invalida lo que el dispositivo ya
// guardó) terminaba copiada dentro de la caché nueva en la instalación,
// y desde ahí se servía para siempre sin volver a mirar la red. Chromium
// con un perfil limpio no puede reproducirlo porque no tiene esa copia.
// Cambios:
//   - La instalación descarga cada recurso con cache:'reload' (red
//     siempre, ignora la caché HTTP) y solo sustituye la versión anterior
//     si TODO se descargó bien; si algo falla, la instalación falla y el
//     Service Worker anterior sigue activo (el modo sin conexión nunca se
//     queda a medias).
//   - El código propio (.js/.css/.json del mismo origen) y el HTML pasan
//     a "red primero" con revalidación (cache:'no-cache', 304 barato), con
//     la copia local como respaldo sin conexión o si la red tarda.
//   - business.js/business.css se piden versionados (?v=25) desde
//     index.html: otra URL, así que ninguna copia vieja puede coincidir.
//   - Precache con rutas canónicas ('/', '/register'...): Cloudflare Pages
//     responde /index.html con 308 -> '/', y una respuesta redirigida
//     guardada en caché es rechazada por Safari/Chrome al servir una
//     navegación -- el arranque sin conexión desde start_url fallaba.
//   - Mensaje IDENTIFLY_REFRESCAR para el botón "Actualizar aplicación":
//     vuelve a descargar todo el precache desde la red y solo lo sustituye
//     si la descarga completa tiene éxito. No toca localStorage.
//
// v24: corrección definitiva del prerrelleno -- rastreo POR CAMPO
// (draft._personalDataAppliedValues) en vez de una marca global
// (_personalDataLinked/_personalDataIncorporatedCount): esa marca única
// dejaba bloqueados el resto de campos para siempre en cuanto se
// incorporaba uno solo (bug real confirmado). Ahora cada campo se
// recuerda por separado, así que un borrador con incorporación parcial
// de una versión anterior completa el resto de sus campos vacíos sin
// tocar los que ya tienen contenido propio ni reponer los que constan
// como borrados a propósito. Se retira el mecanismo de marca global.
// También evita perder cambios de Business sin guardar al recargar tras
// una actualización de Service Worker: el registro del script principal
// comprueba isEditorDirty() (expuesta como
// window.identityHayEdicionSinGuardar) antes de recargar, y pospone la
// recarga en vez de descartar la edición en curso. Sube la versión por
// el cambio real de contenido en business.js/index.html.
//
// v23: diagnóstico del ordenador con este mismo cache (identity-v11,
// commit bc2916e): confirmado leyendo ese código histórico que YA usaba
// la misma estrategia "red primero" para HTML que esta versión -- así
// que index.html (y su script de registro) debería obtenerse fresco de
// red en cada visita con conexión, no de una copia vieja. Se comprobaron
// además, uno a uno contra producción ahora mismo, los 12 recursos de
// CACHE_URLS: todos responden con éxito, sin ningún rechazo que
// explicara un fallo de cache.addAll() en el paso de instalación (esa
// causa queda descartada por evidencia, no por suposición, para el
// estado actual del servidor). El nombre de una caché no demuestra qué
// código ejecuta el Service Worker activo -- se añade un mensaje
// (IDENTIFLY_QUE_VERSION) para que el propio Service Worker responda con
// su CACHE_NAME real; si no responde, es en sí mismo la prueba de que es
// una versión anterior a este mecanismo. Sube la versión por el cambio
// real de contenido en business.js.
//
// v22: la corrección del doble Service Worker (v21) se probó con un
// navegador real (Chromium vía Puppeteer, no jsdom): partiendo de la
// versión con el botón manual antiguo ya instalada, con almacenamiento y
// cachés conservados, un único "cerrar y volver a abrir" simulado basta
// para pasar a la versión nueva -- confirmado, no supuesto. El
// dispositivo real seguía sin actualizar incluso con v21 publicado, lo
// que apunta a una particularidad de actualización de Service Worker
// propia de Safari/iOS en apps instaladas, no a un fallo del código. Se
// añade sw-diagnostico.html: página independiente, deliberadamente FUERA
// del precache y sin ninguna dependencia de business.js, para poder leer
// el estado real de Service Worker/cachés de un dispositivo aunque
// business.js siga atascado en una versión antigua (evita depender de lo
// mismo que se está diagnosticando). También añade el recuento total de
// registros de Service Worker (getRegistrations()) al panel de
// diagnóstico ya existente. Sube la versión por el cambio real de
// contenido en business.js.
//
// v21: encontrada la causa real de que el prerrelleno (y otras
// correcciones) nunca llegaran a algunos dispositivos: index.html
// registraba DOS Service Workers en cada carga -- uno real (./sw.js,
// este archivo) y otro completamente aparte, vestigial, construido al
// vuelo con un Blob (cache 'identity-v1', sin relación con este sistema
// de versiones), probablemente un resto de un prototipo anterior a la
// PWA actual. Registrar dos veces para el mismo scope en cada carga es
// terreno conocido de bugs de actualización en Service Workers,
// especialmente en Safari/iOS -- se elimina el registro vestigial por
// completo. Se añade además una comprobación activa de actualización
// (reg.update()) y una recarga automática al detectar que un Service
// Worker nuevo toma el control (evento 'controllerchange'), y
// Cache-Control: no-cache explícito para /sw.js (ver _headers) para que
// ninguna caché intermedia pueda servir una copia vieja del propio
// archivo de actualización. Se añade también un panel de diagnóstico
// TEMPORAL (solo lectura, sin enviar nada a ningún servidor) para
// confirmar en el dispositivo real qué versión se está ejecutando. Sube
// la versión por el cambio real de contenido en business.js.
//
// v20: corrige un bug real de v19 -- _personalDataLinked se marcaba
// true incluso con 0 campos incorporados (perfil vacío o no disponible
// todavía en ese momento), bloqueando el prerrelleno para siempre en ese
// borrador aunque el perfil se completara después. Ahora la marca solo se
// congela cuando el perfil estaba realmente disponible; si no lo estaba,
// se reintenta la próxima vez que se abra esa modalidad. También extiende
// persona de contacto y cargo a Profesional/Autónomo (antes solo Empresa)
// y confirma que el correo de contacto nunca usa el de acceso/login. Sube
// la versión por el cambio real de contenido en business.js.
//
// v19: corrige el prerrelleno de IDENTIFLY BUSINESS desde el perfil
// personal -- leía window.profileData, que nunca existió (profileData es
// `let` de ámbito de módulo en index.html, nunca se expuso en window),
// así que nunca encontraba nada que copiar (LinkedIn/GitHub y el resto
// aparecían vacíos aunque el perfil los tuviera). Ahora lee
// 'identity_data' (STORAGE_KEY) directamente y se aplica una sola vez por
// borrador (marca persistida), sin reponer campos borrados a propósito.
// Sustituye el botón manual "Ver qué se copiaría" por un aviso breve.
// Sube la versión por el cambio real de contenido en business.js y por
// las claves i18n modificadas (copy_profile_* sustituidas por
// copy_profile_incorporated) en los 5 diccionarios.
//
// v18: corrige que rotar BUSINESS_ID_SECRET dejara huérfanas las
// tarjetas ya publicadas (ese secreto se elimina por completo — el id
// vuelve a ser aleatorio, permanente, localizado vía un índice interno
// 'bizowner:'+email que no depende de ningún secreto). Añade control de
// concurrencia optimista (`version`, token opaco) para que una
// actualización/despublicación/reactivación en vuelo desde una pestaña
// no pise a ciegas lo que el usuario acaba de hacer en otra. Sube la
// versión por el cambio de contenido real en business.js y una clave
// nueva (index.business.version_conflict_toast) en los 5 diccionarios.
//
// v17: corrige tres detalles de la fase anterior sin cambiar
// funcionalidad: (1) el tema claro ya no lleva ningún verde de acento
// (era un resto sin querer, ver instrucción "fondo blanco y tipografía
// negra también en títulos y controles"); (2) la lista de redes de
// Business pasa a coincidir con las que ya existían en el resto de la
// app (se quita 'facebook'/'whatsapp', inventadas sin base, y se añade
// 'github', que sí existe en el perfil personal y en QR SELECT); (3)
// textos cortos aprobados para QR SELECT/Business/presentaciones del
// logo en los 5 idiomas. Sube la versión porque business.js/business.css
// cambian de contenido real y los 5 diccionarios llevan valores nuevos
// para claves que un dispositivo ya podría tener cacheadas desde v16.
//
// v16: añade los dos temas exclusivos ("Oscuro IDENTIFLY"/"Claro") y las
// tres presentaciones del logo (directo/con soporte/integrado) de
// IDENTIFLY BUSINESS. Sube la versión porque cambia el contenido real de
// business.js/business.css (ya en el precache desde v14) y se añaden 11
// claves nuevas (index.business.section_design y siguientes) a los 5
// diccionarios — sin esto, un dispositivo que ya tuviera esos dos
// archivos o un idioma cacheados desde antes de esta fase seguiría
// sirviendo las versiones viejas. No se toca la tarjeta personal, el QR
// vCard, QR SELECT ni el diseñador matriz — ninguno de esos recursos
// cambió.
//
// v15: corrige una brecha de privacidad real en IDENTIFLY BUSINESS: el
// handler de 'fetch' de v14 seguía cacheando genéricamente CUALQUIER
// respuesta GET exitosa que no terminara en .html, incluida
// /c/{id} -- una tarjeta pública abierta como navegación de nivel
// superior (event.request.mode === 'navigate', el caso normal al abrir un
// enlace compartido) entraba en la rama "isHTML" (que cachea SIEMPRE la
// respuesta con éxito, aunque intente red primero) simplemente por no
// terminar en ".html". Si el propietario despublicaba la tarjeta después,
// un visitante sin red (o el propio Service Worker sirviendo desde caché
// ante cualquier fallo de red futuro) podía seguir viendo la versión
// cacheada -- justo lo que la instrucción pide evitar explícitamente
// ("gestiona explícitamente la caché... para que no mantenga accesible
// deliberadamente una publicación retirada"). Ahora /c/* y /api/* se
// excluyen ANTES de cualquier otra regla, sin pasar nunca por caché ni en
// lectura ni en escritura -- ninguna regla genérica posterior puede
// volver a atraparlos. Las respuestas de /api/* ya declaran
// Cache-Control: no-store (ver functions/_shared/business.js
// jsonResponse) y /c/{id} también (ver functions/c/[id].js), así que esto
// es además una segunda capa, no la única.
//
// v14: añade IDENTIFLY BUSINESS (hub + editor + vista previa, ver
// business.js/business.css). Sube la versión por dos motivos: (1) se
// añaden business.css y business.js al precache -- sin esto, un
// dispositivo que instalara la PWA por primera vez sin red no tendría el
// hub/editor disponible para trabajar en el borrador local sin conexión
// (publicar/actualizar sí exigen red, ver instrucción); (2) se añaden
// claves nuevas (index.business.*) a los 5 diccionarios -- un dispositivo
// con un idioma ya cacheado desde antes de esta fase seguiría sirviendo
// ese diccionario viejo sin ellas. A propósito NO se añade ninguna
// tarjeta pública (/c/{id}) al precache: son páginas dinámicas por
// propietario, nunca recursos fijos del cascarón de la app.
//
// v13: misma razón que v12/v11/v10 -- corrige el botón "Ampliar QR" de QR
// SELECT (antes fallaba en silencio cuando el QR individual aún no había
// terminado de renderizar) y añade el aviso correspondiente
// (index.myqr.qr_loading_toast) a los 5 diccionarios. Sin subir la
// versión, un dispositivo con un idioma ya cacheado seguiría sin ese
// aviso (mostraría la key cruda si algo llegara a necesitarlo) hasta que
// algo purgue esa caché.
//
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
const APP_VERSION = '25';
const CACHE_NAME = 'identity-v' + APP_VERSION;
// Rutas canónicas tal como las sirve Cloudflare Pages (sin redirección).
const CACHE_URLS = [
  '/',
  '/register',
  '/recovery',
  '/paywall',
  '/install',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/assets/logo-wings.png',
  '/vendor/qr-code-styling/qr-code-styling.js',
  '/storage-wipe.js',
  '/i18n/loader.js',
  '/i18n/es.json',
  '/i18n/en.json',
  '/i18n/fr.json',
  '/i18n/pt.json',
  '/i18n/de.json',
  '/business.css?v=' + APP_VERSION,
  '/business.js?v=' + APP_VERSION,
];

// Si la red tarda más que esto y hay copia local, se sirve la copia (la
// respuesta de red, si llega después, igualmente actualiza la caché).
const NETWORK_TIMEOUT_MS = 6000;

// Una respuesta que llegó tras una redirección no puede servirse a una
// navegación (Safari/Chrome la rechazan) -- se reconstruye sin esa marca.
async function limpiarRedireccion(response) {
  if (!response.redirected) return response;
  const body = await response.blob();
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

// Descarga TODOS los recursos desde la red (cache:'reload' ignora la caché
// HTTP del dispositivo). Si uno solo falla, rechaza sin escribir nada.
async function descargarPrecache() {
  return Promise.all(CACHE_URLS.map(async (url) => {
    const response = await fetch(new Request(url, { cache: 'reload', credentials: 'same-origin' }));
    if (!response.ok) throw new Error(url + ' -> HTTP ' + response.status);
    return [url, await limpiarRedireccion(response)];
  }));
}

async function guardarPrecache(pares) {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(pares.map(([url, response]) => cache.put(url, response)));
}

self.addEventListener('install', (event) => {
  event.waitUntil(descargarPrecache().then(guardarPrecache));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Equivalente sin redirección de una ruta .html de Cloudflare Pages
// (/index.html -> /, /register.html -> /register).
function rutaCanonica(pathname) {
  if (pathname === '/index.html') return '/';
  if (pathname.endsWith('.html')) return pathname.slice(0, -5);
  return pathname;
}

async function buscarEnCache(request, esNavegacion) {
  const url = new URL(request.url);
  const cached = await caches.match(request)
    || await caches.match(url.origin + rutaCanonica(url.pathname) + url.search)
    // business.js pedido sin ?v= (o con otra versión) desde una página
    // antigua: sirve la copia vigente en vez de fallar sin conexión.
    || await caches.match(request, { ignoreSearch: true })
    || (esNavegacion ? await caches.match('/') : undefined);
  return cached ? limpiarRedireccion(cached) : undefined;
}

// Red primero, revalidando (nunca la caché HTTP a ciegas); copia local si
// no hay red o si la red tarda y existe copia.
function redPrimero(event, esNavegacion) {
  const request = event.request;
  const peticionRed = esNavegacion
    // Una navegación no admite RequestInit sobre el Request original; se
    // reconstruye con la misma URL y redirect:'manual' para que el
    // navegador siga él mismo las redirecciones (308 de /index.html).
    ? fetch(request.url, { cache: 'no-cache', credentials: 'same-origin', redirect: 'manual' })
    : fetch(new Request(request, { cache: 'no-cache' }));

  const deRed = peticionRed.then((response) => {
    if (response && response.status === 200 && response.type === 'basic') {
      const copia = response.clone();
      event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copia)).catch(() => {}));
    }
    return response;
  });

  return new Promise((resolve, reject) => {
    let resuelto = false;
    const usarCache = async () => {
      const cached = await buscarEnCache(request, esNavegacion);
      if (cached && !resuelto) { resuelto = true; resolve(cached); }
      return cached;
    };
    const timer = setTimeout(usarCache, NETWORK_TIMEOUT_MS);
    deRed.then((response) => {
      clearTimeout(timer);
      if (!resuelto) { resuelto = true; resolve(response); }
    }).catch(async (err) => {
      clearTimeout(timer);
      const cached = await usarCache();
      if (!cached && !resuelto) { resuelto = true; reject(err); }
    });
  });
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const pathname = url.pathname;
  const mismoOrigen = url.origin === self.location.origin;

  // Tarjetas públicas de Business (/c/{id}) y toda la API: siempre red,
  // nunca caché (ver nota de v15). Debe ir antes que cualquier otra regla.
  if (mismoOrigen && (pathname.startsWith('/c/') || pathname.startsWith('/api/'))) {
    event.respondWith(fetch(event.request));
    return;
  }

  // La Cache API solo admite GET.
  if (event.request.method !== 'GET') {
    event.respondWith(fetch(event.request));
    return;
  }

  const esNavegacion = event.request.mode === 'navigate';
  if (mismoOrigen && (esNavegacion || pathname.endsWith('.html'))) {
    event.respondWith(redPrimero(event, esNavegacion));
    return;
  }

  // Código propio de la app: red primero para que una corrección llegue
  // en la siguiente apertura con conexión, sin depender de subir versión.
  if (mismoOrigen && /\.(js|css|json)$/.test(pathname)) {
    event.respondWith(redPrimero(event, false));
    return;
  }

  // Resto (imágenes, vídeos, librerías de CDN): cache primero, igual que antes.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type === 'opaque') {
          return response;
        }
        const toCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, toCache));
        return response;
      });
    })
  );
});

// Mensajes desde la página:
//  - 'IDENTIFLY_QUE_VERSION': responde con la versión real en ejecución
//    (ver diagnósticos, v23).
//  - { tipo: 'IDENTIFLY_REFRESCAR' }: vuelve a descargar todo el precache
//    desde la red; solo lo sustituye si la descarga completa tiene éxito.
//    Responde por el MessagePort recibido. Nunca toca localStorage.
self.addEventListener('message', (event) => {
  if (event.data === 'IDENTIFLY_QUE_VERSION') {
    event.source.postMessage({ tipo: 'IDENTIFLY_VERSION', cacheName: CACHE_NAME });
    return;
  }
  if (event.data && event.data.tipo === 'IDENTIFLY_REFRESCAR') {
    const port = event.ports && event.ports[0];
    event.waitUntil(
      descargarPrecache()
        .then(guardarPrecache)
        .then(() => { if (port) port.postMessage({ ok: true, cacheName: CACHE_NAME }); })
        .catch((err) => { if (port) port.postMessage({ ok: false, error: String(err && err.message || err) }); })
    );
  }
});
