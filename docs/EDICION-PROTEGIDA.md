# Edición protegida de las tarjetas

Los editores de tarjeta personal y Business se abren en lectura. La pestaña azul del borde permanece visible al desplazarse y muestra «Bloqueada» o «Editando».

1. Pulsar el candado abre un diálogo; no habilita directamente los campos.
2. «Activar edición» permite modificar y guardar mediante los flujos existentes.
3. Pulsar de nuevo el candado conserva las entradas y bloquea los controles. El candado no provoca un guardado. El autoguardado previo de la tarjeta personal mantiene su funcionamiento.
4. Volver a entrar en el editor, recargar, restaurar una página desde la caché de navegación o cambiar de identidad vuelve a bloquear.

Se protegen campos, opciones visuales, galería, privacidad, configuración editable, guardado y acciones que sustituyen o publican datos. La consulta de QR, navegación y vistas previas permanece accesible. Desbloquear nunca quita los bloqueos individuales de nombre, correo, teléfono o idioma registrados. No cambia la validación, el PIN, el doble factor, los planes ni los permisos del servidor.

Los controles nacen dentro de `fieldset disabled` en HTML. Una protección inicial de eventos impide que las opciones personalizadas se activen mientras están bloqueadas, incluso si el módulo de la pestaña no carga. En ese caso aparece un aviso para recargar. Los controles dinámicos de Business también heredan el bloqueo. El final de un arrastre no activa una opción y la rueda no cambia un campo numérico enfocado.

Es una protección de interfaz contra cambios involuntarios, no una autorización ni una garantía contra todos los errores humanos cuando la edición se activa expresamente. No añade almacenamiento, servicios o dependencias de producción.

## Validación

`test/form-edit-lock-browser.cjs` usa Chromium, datos ficticios y API local. Comprueba ambos editores reales, restricciones de registro, controles personalizados, autoguardado existente, separación de vista previa, fallo de carga del módulo, arrastres, rueda, recarga, 13 idiomas y tamaños de 320 a 1360 px con RTL. Requiere Playwright disponible en el entorno de pruebas.

`node --test test/*.test.js test/*.test.mjs` ejecuta las regresiones existentes de seguridad, dispositivos, pagos, sincronización y precarga sin conexión.
