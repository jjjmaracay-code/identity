# Excepción individual de dispositivos

La política del servidor contiene una sola excepción autorizada de cinco dispositivos para la huella SHA-256 de una cuenta concreta. No es una credencial ni un permiso administrativo: las rutas siguen verificando el token opaco de esa misma cuenta, o el código de correo de recuperación/registro, antes de aplicar el límite. No se acepta un límite enviado por el cliente. No se añade el correo en claro al código de la excepción.

El resto conserva los límites existentes: Pro tres, Lifetime uno; el comportamiento previo del periodo de prueba y del interruptor `DEVICE_LIMIT_ENFORCED` no cambia. La excepción no concede un plan de pago ni activa las compras. No desrevoca dispositivos ni cambia perfiles, documentos, códigos de verificación o tokens.

`check-plan`, `register-complete` y `claim-token` usan el mismo cálculo efectivo. La cuenta autorizada recibe `deviceLimit:5`; las respuestas de las otras cuentas conservan su estructura anterior. Cinco dispositivos activos pueden acceder; un sexto nuevo recibe el flujo de sustitución existente. En esa cuenta no se preselecciona silenciosamente un dispositivo para sustituir cuando se supera el límite. Continúan aplicándose las reglas existentes de revocación y transferencia.

Las pruebas verifican la excepción, los límites ordinarios, el rechazo del sexto dispositivo, los tokens incorrectos, las revocaciones y la conservación del registro de pago. El correo real se comprobó de forma local contra la huella configurada; las pruebas publicadas usan una cuenta ficticia.

Los registros de dispositivos siguen usando el almacenamiento KV existente. Esta modificación conserva su modelo de concurrencia y consistencia eventual: no introduce un contador transaccional ni promete una nueva garantía frente a altas simultáneas. No cambia el estado del interruptor global ni reduce límites de otras cuentas.
