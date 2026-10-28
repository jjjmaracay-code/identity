# Teclados integrados y encuadre

28 de octubre de 2026. Mejora de presentación de los teclados numéricos y QWERTY de acceso, registro y recuperación. Se amplían las teclas y las cifras; la altura se adapta al espacio visible y conserva una altura mínima de tecla de 44 px. En horizontal o con menor altura se prioriza mostrar todas las filas. Los teclados del sistema operativo conservan su funcionamiento habitual.

El módulo solo mide elementos marcados con `data-keyboard`. No lee los caracteres introducidos, almacena credenciales, llama a la API, cambia el foco, simula pulsaciones ni envía formularios. Los controles y las verificaciones anteriores conservan sus manejadores.

El desplazamiento es el mínimo necesario para mostrar el teclado y, cuando cabe, su campo y botón de confirmación. Respeta movimiento reducido, giro de pantalla, viewport visual y contenedores internos de desplazamiento. No mueve ni redimensiona el teclado mientras hay un dedo o puntero pulsando. Una acción manual de desplazamiento cancela el ajuste pendiente.

En los pasos con datos personales por delante del teclado, el ajuste inicial espera una interacción para no saltarse esos datos. La ventana de impresión y los QR no se modifican. No cambian autenticación, planes, cobros, límites de dispositivos, cifrado o sincronización. Los dos recursos nuevos se incluyen en la caché instalada de la aplicación.

La prueba de navegador usa las páginas de acceso reales con datos ficticios y respuestas locales. Comprueba tamaños de móvil y escritorio, horizontal, teclas y borrado, orden de registro, modos de movimiento, idiomas y ausencia de peticiones de escritura. Los ensayos de escritorio no sustituyen la revisión en los móviles físicos de los testers.
