# Aviso de bloqueo y carrusel de Mi perfil

Corrección del 29 de octubre de 2026, publicación `identity-v52`.

El aviso azul se insertaba antes del primer `fieldset` protegido. En Mi perfil, ese primer elemento era el botón de guardar situado dentro de la barra de secciones. El aviso terminaba ocupando la misma fila y quitando espacio al carrusel.

El componente utiliza ahora la posición del aviso de respaldo ya prevista en el HTML: una fila propia debajo de la barra. Si falta ese marcador, prefiere un bloque de contenido y evita insertar el aviso dentro de la barra de secciones. El botón de guardar conserva su sitio y su protección.

Solo cambia la ubicación del aviso. Se conservan la confirmación para activar edición, los campos de registro bloqueados, el bloqueo inicial y al reabrir, el guardado local y las protecciones de los editores personal y Business. Las funciones previas del editor y del guardado no cambian.

Verificado mediante `test/form-edit-lock-browser.cjs`, con identidades ficticias y recursos/API locales: posición separada del carrusel, acceso real a las secciones, estados bloqueado y edición, pantallas de 320/390/844/1360 píxeles, orientación horizontal y RTL. También se comprueban la ausencia de cambios al navegar, la protección del botón de guardar, la conservación del borrador y los controles personales y Business.

La versión de caché y la referencia del módulo avanzan a v52. No se cambia ningún dato de usuario, permiso de cuenta, pago o función del servidor.

## Aviso de desplazamiento y carrusel · versión 53

El texto «Desliza para ver arriba» dispone de una fila propia. El carrusel se fija debajo, con 12 píxeles de separación. La altura se mide de nuevo cuando cambian el ancho, la orientación o el texto traducido; los destinos de las secciones respetan esa altura.

Validación local con perfiles ficticios: controles alcanzables en 320, 390, 844 y 1360 píxeles, vertical y horizontal, LTR y RTL. Se comprueba la separación mientras el formulario está desplazado y que el bloqueo, el guardado y la lectura sigan funcionando.
