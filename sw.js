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
const CACHE_NAME = 'identity-v24';
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
  './business.css',
  './business.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const pathname = new URL(event.request.url).pathname;

  // Tarjetas públicas de Business (/c/{id}) y toda la API (/api/*, incluye
  // los endpoints de Business y los ya existentes de plan/registro/pago):
  // siempre red, nunca caché -- ni se lee de caché ni se escribe en ella.
  // Debe ir ANTES que cualquier otra regla (incluida la de "isHTML" más
  // abajo, que si no se excluyera aquí capturaría /c/{id} por llegar como
  // navegación de nivel superior). Ver nota de v15 arriba.
  if (pathname.startsWith('/c/') || pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  const isHTML = event.request.mode === 'navigate' ||
                 pathname.endsWith('.html');

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

// El nombre de una caché por sí solo no demuestra qué versión del propio
// sw.js está realmente en ejecución (una caché vieja puede seguir
// existiendo aunque el Service Worker sí se haya actualizado, o
// viceversa) -- esto responde con la verdad real: CACHE_NAME tal como lo
// ve el código que de verdad se está ejecutando ahora mismo, no una
// inferencia externa. Si el Service Worker activo no responde a este
// mensaje en absoluto, es en sí mismo una prueba de que es una versión
// anterior a este mecanismo (ver diagnósticos).
self.addEventListener('message', (event) => {
  if (event.data === 'IDENTIFLY_QUE_VERSION') {
    event.source.postMessage({ tipo: 'IDENTIFLY_VERSION', cacheName: CACHE_NAME });
  }
});
