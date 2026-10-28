# Relieve de los botones principales

Se añade `button-depth.css` a la aplicación, registro, recuperación, planes, instalación y demostración. El acabado utiliza brillo interior, borde inferior simulado y sombra para dar volumen. Al pasar el puntero se eleva un píxel y al pulsar se hunde tres; la preferencia de movimiento reducido elimina ese desplazamiento y las transiciones nuevas.

La hoja no redefine colores, fondos, tipografía, dimensiones, bordes ni opacidad. Cada botón conserva su color original, incluidos los estados de interacción ya definidos por la aplicación. Se mantienen los estados desactivados. No se incluyen las teclas del teclado de acceso ni los selectores pequeños del formulario.

Las acciones cubiertas incluyen entrada, guardado, compartir, QR SELECT, tarjeta profesional, edición/importación, navegación principal, planes y recuperación. Los seis HTML solo incorporan el enlace a la hoja; sus scripts y manejadores son idénticos a la versión anterior. No cambia ningún módulo de datos, QR, autenticación, dispositivos, pagos o APIs.

La caché sube de `identity-v45` a `identity-v46` y precarga la nueva hoja. En las pruebas existentes solo se actualizan las dos expectativas que nombraban la versión anterior.

## Comprobaciones

`node --test --test-reporter=tap test/*.test.js test/*.test.mjs` supera las **217 pruebas existentes**, según el total emitido por el ejecutor, con cero fallos.

La comprobación visual temporal en Chromium compara los estilos originales con la hoja desactivada y activada: color de texto, fondo, imagen de fondo, colores de borde, radio, fuente, dimensiones, opacidad, puntero y estado desactivado permanecen iguales.

| Pantalla | Controles comparados |
| --- | ---: |
| Aplicación | 66 |
| Registro | 6 |
| Recuperación | 7 |
| Planes | 9 |
| Instalación | 1 |
| Demostración | 1 |
| Total | 90 |

Se revisan los accesos principales a 320, 390, 768 y 1360 px en los trece idiomas existentes, además del relieve al pasar/pulsar y el movimiento reducido. Las pantallas se muestran con datos de presentación locales, sin acceder a cuentas reales ni publicar identidades. Son tamaños simulados de navegador, no pruebas físicas en todos los modelos de móvil.

El navegador aislado produce una advertencia sobre un service worker en un contexto sandbox; se reproduce también con el HTML original sin la hoja nueva. No se cambia ese comportamiento en esta revisión visual.

## Panel principal: relieve reforzado

La versión 51 incorpora `main-action-depth.css` únicamente en la aplicación principal. Los controles inferiores de la tarjeta, incluidos QR SELECT, Business, recomendación, ubicación y enlaces de alertas, usan un canto verde visible, una base oscura y luz superior. Las acciones se hunden al pulsarlas. Los enlaces de alertas tienen separación adicional para que la base no alcance al siguiente control.

Se conservan los fondos y colores originales, las dimensiones, los iconos, los nombres, los destinos y los manejadores existentes. La iluminación decorativa no recibe eventos. Movimiento reducido mantiene el relieve sin el desplazamiento nuevo. La nueva hoja se precarga para uso sin conexión. Esta revisión no cambia los QR ni los módulos de datos o de autenticación.
