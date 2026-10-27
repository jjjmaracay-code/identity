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
