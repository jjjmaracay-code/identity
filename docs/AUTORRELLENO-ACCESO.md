# Autorrelleno de acceso · versión 54

Identifly representaba las contraseñas mediante elementos `div` y un teclado propio. Los gestores de contraseñas no disponían de campos nativos que pudieran reconocer, rellenar o asociar al correo.

El acceso utiliza ahora un formulario real con correo `autocomplete="username"` y contraseña `autocomplete="current-password"`. El correo se completa inicialmente con la identidad guardada en el dispositivo. Si el gestor propone otra cuenta, se rechaza la entrada y se mantiene la identidad original. Rellenar los campos no inicia sesión automáticamente.

El registro, la confirmación y la recuperación utilizan campos `new-password` asociados a su correo, para permitir guardar o actualizar la contraseña en el gestor del usuario. Se mantienen la verificación de correo, los requisitos de contraseña y el hash local existente. Los formularios impiden la navegación de envío; la contraseña no se incluye en las peticiones de la aplicación ni se añade a su almacenamiento persistente en texto plano.

Los campos permiten escritura, pegado y autocompletado nativos. Al utilizarlos se oculta temporalmente el teclado de Identifly; al salir del campo vuelve el teclado propio con su ajuste de pantalla. La restauración se realiza después de activar el botón o la casilla tocada, para evitar desplazarlos bajo el dedo durante una pulsación.

La opción «Recordarme en este dispositivo (15 días)», el doble factor y el bloqueo por intentos fallidos conservan sus comprobaciones. El cambio de interfaz no prolonga sesiones ni evita verificaciones.

## Uso

Tras cargar esta actualización, introduce tus credenciales una vez y acepta guardar o actualizar la contraseña si tu gestor lo ofrece. Cuando vuelva a solicitarse el acceso, toca el campo y elige las credenciales guardadas. La oferta de guardado, la selección de credenciales y una eventual confirmación biométrica pertenecen al gestor del móvil; Identifly no puede obligarlo a mostrarlas.

## Verificación

Pruebas de navegador con credenciales ficticias: asignación de valores con y sin eventos de autocompletado, ausencia de entrada automática, rechazo de otro correo, escritura nativa y teclado propio, botones y casillas sin desplazamiento durante el toque, hash real, 15 días exactos, sesión recordada vigente y caducada, autenticador obligatorio, tres intentos fallidos, registro confirmado por API simulada y cambio de contraseña. Se comprueban anchuras de 320 a 1360 píxeles, horizontal, RTL, teclados y formularios bloqueados.

Estas pruebas utilizan Chromium y respuestas locales. No validan el diálogo del gestor en un iPhone o Android físico ni equivalen a un envío real de correo.

## Documentación de plataforma

- Apple: [Enabling Password AutoFill on an HTML input element](https://developer.apple.com/documentation/security/enabling-password-autofill-on-an-html-input-element).
- Chromium: [Password Form Styles that Chromium Understands](https://www.chromium.org/developers/design-documents/form-styles-that-chromium-understands/).
- Google: [Build a sign-in form that follows best practice](https://developer.chrome.com/docs/modern-web-guidance/guides/forms/autofill-sign-in-form).

## Tamaño del teclado · versión 55

El formulario nativo limitaba involuntariamente el ancho del teclado a 340 píxeles. Se restablece el límite anterior de 480 píxeles, ajustándose al espacio disponible. Comparación en navegador con el código anterior al autorrelleno: a 390 píxeles de pantalla el teclado vuelve de 340 a 358 píxeles; a 430 vuelve de 340 a 398; en horizontal y escritorio recupera 480 píxeles. En pantallas de 320 ya tenía los 288 píxeles disponibles. Las alturas de las teclas y sus fuentes se conservan. Se comprueban estas dimensiones junto con el acceso y el autorrelleno.
