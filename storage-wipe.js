// ============================================================
//  IDENTIFLY — Borrado total de almacenamiento del origen
// ============================================================
// Lógica compartida entre recovery.html ("Borrar todo — Empezar de
// nuevo") e index.html ("Baja voluntaria"). Antes cada pantalla tenía
// su propia copia con una lista manual de claves de localStorage —
// llegaron a divergir entre sí (una tenía un typo que la otra no) y
// ninguna tocaba IndexedDB, Cache Storage ni Service Worker. Se
// extrae aquí para que ambos flujos no puedan volver a divergir.
//
// Deja el origen en un estado equivalente a instalación nueva:
// IndexedDB, localStorage, sessionStorage, Cache Storage y Service
// Worker se enumeran dinámicamente (nunca por nombre fijo) y se
// verifican con una lectura posterior — un catch sin error no prueba
// que el borrado ocurrió de verdad.

// Safari/WebKit tiene bugs documentados donde una llamada a IndexedDB
// se queda colgada para siempre, sin resolver NI rechazar su Promise
// (bug de WebKit #226547 — indexedDB.open() colgado en Safari 14.6 /
// iOS 14.6, corregido en 14.7, pero sin garantía de que una variante
// equivalente no exista en dispositivos con iOS desactualizado). Sin
// este envoltorio, un solo cuelgue deja el "await" esperando para
// siempre: el botón se queda en "Borrando…" sin ningún error en
// consola, y el resto de los pasos (localStorage, caches, service
// worker) nunca llegan a ejecutarse. Cada llamada a una API nativa que
// pueda colgarse pasa por aquí.
function conTimeout(promesa, ms, etiqueta) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error(`tiempo de espera agotado (${ms}ms) en "${etiqueta}" — la API nativa no respondió (ver bug de WebKit #226547 sobre IndexedDB colgado en Safari/iOS)`));
    }, ms);
    promesa.then(
      v => { clearTimeout(t); resolve(v); },
      e => { clearTimeout(t); reject(e); }
    );
  });
}
const WIPE_TIMEOUT_MS = 5000;

async function borrarTodoElAlmacenamiento() {
  const resultados = [];
  function log(paso, ok, detalle) {
    resultados.push({ paso, ok, detalle });
    console[ok ? 'log' : 'error'](`[BORRAR TODO] ${ok ? '✓' : '✗'} ${paso}` + (detalle ? ' — ' + detalle : ''));
  }

  // 1) IndexedDB — enumerar TODAS las bases reales con
  // indexedDB.databases(), no solo un nombre conocido: esta app no crea
  // IndexedDB directamente, pero Tesseract.js (usado para OCR de
  // documentos en index.html) cachea sus datos de idioma ahí por su
  // cuenta, con un nombre que esta función nunca controla ni conoce de
  // antemano.
  try {
    if (indexedDB.databases) {
      const antes = await conTimeout(indexedDB.databases(), WIPE_TIMEOUT_MS, 'indexedDB.databases() inicial');
      await Promise.all(antes.map(db => conTimeout(new Promise(resolve => {
        const req = indexedDB.deleteDatabase(db.name);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
      }), WIPE_TIMEOUT_MS, `indexedDB.deleteDatabase("${db.name}")`).catch(e => {
        log('IndexedDB', false, `no se pudo borrar "${db.name}": ${e.message}`);
      })));
      const despues = await conTimeout(indexedDB.databases(), WIPE_TIMEOUT_MS, 'indexedDB.databases() final');
      log('IndexedDB', despues.length === 0,
        `${antes.length} base(s) encontradas [${antes.map(d => d.name).join(', ') || 'ninguna'}], ${despues.length} restante(s) tras borrar`);
    } else {
      log('IndexedDB', true, 'indexedDB.databases() no soportado en este navegador — nada que enumerar');
    }
  } catch (e) {
    log('IndexedDB', false, e.message);
  }

  // 2) localStorage y sessionStorage — borrado completo, no selectivo
  // por claves. Operación síncrona: no necesita conTimeout.
  try {
    localStorage.clear();
    sessionStorage.clear();
    log('localStorage / sessionStorage', localStorage.length === 0 && sessionStorage.length === 0,
      `localStorage.length=${localStorage.length}, sessionStorage.length=${sessionStorage.length}`);
  } catch (e) {
    log('localStorage / sessionStorage', false, e.message);
  }

  // 3) Cache Storage — enumerar TODAS las cachés existentes. index.html
  // registra en realidad DOS service workers distintos (sw.js, caché
  // 'identity-v8'; y uno adicional generado por Blob URL con su propia
  // caché 'identity-v1') — borrar solo un nombre fijo dejaría la otra
  // intacta.
  try {
    if ('caches' in window) {
      const nombres = await conTimeout(caches.keys(), WIPE_TIMEOUT_MS, 'caches.keys() inicial');
      await Promise.all(nombres.map(n => conTimeout(caches.delete(n), WIPE_TIMEOUT_MS, `caches.delete("${n}")`).catch(e => {
        log('Cache Storage', false, `no se pudo borrar "${n}": ${e.message}`);
      })));
      const restantes = await conTimeout(caches.keys(), WIPE_TIMEOUT_MS, 'caches.keys() final');
      log('Cache Storage', restantes.length === 0,
        `${nombres.length} caché(s) encontradas [${nombres.join(', ') || 'ninguna'}], ${restantes.length} restante(s)`);
    } else {
      log('Cache Storage', true, 'Cache API no soportada — nada que enumerar');
    }
  } catch (e) {
    log('Cache Storage', false, e.message);
  }

  // 4) Service Worker — desregistrar TODAS las registraciones activas
  // (las dos mencionadas arriba), no solo una supuesta.
  try {
    if ('serviceWorker' in navigator) {
      const antes = await conTimeout(navigator.serviceWorker.getRegistrations(), WIPE_TIMEOUT_MS, 'serviceWorker.getRegistrations() inicial');
      await Promise.all(antes.map(r => conTimeout(r.unregister(), WIPE_TIMEOUT_MS, 'serviceWorkerRegistration.unregister()').catch(e => {
        log('Service Worker', false, `no se pudo desregistrar: ${e.message}`);
      })));
      const despues = await conTimeout(navigator.serviceWorker.getRegistrations(), WIPE_TIMEOUT_MS, 'serviceWorker.getRegistrations() final');
      log('Service Worker', despues.length === 0,
        `${antes.length} registro(s) encontrados, ${despues.length} restante(s)`);
    } else {
      log('Service Worker', true, 'Service Worker no soportado — nada que desregistrar');
    }
  } catch (e) {
    log('Service Worker', false, e.message);
  }

  // 5) Sesión de servidor — auditado el backend completo (functions/ de
  // Cloudflare Pages): IDENTIFLY no usa cookies httpOnly ni ningún
  // endpoint de logout — toda la autenticación es un token opaco
  // (identity_access_token) que vive solo en localStorage y que el
  // paso 2 ya borró. Si en el futuro se añade sesión de servidor real,
  // este paso debe reemplazarse por una llamada real a ese endpoint de
  // logout. Por si acaso, de todos modos se limpian las cookies
  // accesibles desde JS (no-op si no hay ninguna).
  try {
    const cookiesAntes = document.cookie;
    document.cookie.split(';').forEach(c => {
      const nombre = c.split('=')[0].trim();
      if (nombre) document.cookie = `${nombre}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    });
    log('Sesión de servidor', true, cookiesAntes
      ? `cookies locales limpiadas — sin endpoint de logout real detectado en el backend actual`
      : 'sin cookies ni sesión de servidor en este backend — no aplica (ver nota en el código)');
  } catch (e) {
    log('Sesión de servidor', false, e.message);
  }

  // 6) Push — esta app no usa la Push API en ningún sitio actualmente;
  // se deja el chequeo real por si se añade una suscripción en el
  // futuro, en vez de omitirlo.
  try {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      const reg = await conTimeout(navigator.serviceWorker.getRegistration(), WIPE_TIMEOUT_MS, 'serviceWorker.getRegistration()');
      const sub = reg ? await conTimeout(reg.pushManager.getSubscription(), WIPE_TIMEOUT_MS, 'pushManager.getSubscription()') : null;
      if (sub) {
        await conTimeout(sub.unsubscribe(), WIPE_TIMEOUT_MS, 'pushSubscription.unsubscribe()');
        log('Push', true, 'suscripción encontrada y cancelada');
      } else {
        log('Push', true, 'sin suscripción push activa — no aplica');
      }
    } else {
      log('Push', true, 'Push API no soportada o sin service worker — no aplica');
    }
  } catch (e) {
    log('Push', false, e.message);
  }

  const fallos = resultados.filter(r => !r.ok);
  console.log(`[BORRAR TODO] Resumen: ${resultados.length - fallos.length}/${resultados.length} pasos OK.`, resultados);
  if (fallos.length) console.error('[BORRAR TODO] Pasos con fallo — revisar antes de asumir que el dispositivo quedó limpio:', fallos);

  return { resultados, fallos };
}
