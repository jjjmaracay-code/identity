# Licencias, fase 6: prueba con tarjeta

Estado del código: preparado para prueba de 30 días de Pro, con tarjeta y renovación mensual. El interruptor `STRIPE_CARD_TRIAL_ENABLED` está apagado cuando no existe o no vale exactamente `true`. Este cambio no crea variables en Cloudflare. `DEVICE_LIMIT_ENFORCED` sigue sin crearse ni activarse: su activación depende de la validación de los testers.

## Comportamiento

Solo los registros nuevos creados con el interruptor de tarjeta encendido reciben `cardTrialRequired`. Las cuentas anteriores conservan su periodo original. La verificación del registro debe responder con éxito y un token antes de guardar una nueva identidad local; si falla la red, el código se puede volver a enviar. Los perfiles existentes siguen funcionando con su política de acceso sin conexión.

Pro usa el precio mensual configurado en `STRIPE_PRICE_PRO`, solicita tarjeta en Stripe Checkout y fija `trial_period_days=30`. Lifetime sigue siendo un pago único con `STRIPE_PRICE_LIFETIME`, sin prueba de suscripción. La pantalla muestra 0 € hoy y 2.99 €/mes después de la prueba, con aceptación expresa de la renovación y una casilla separada para la condición de prestación inmediata ya existente. Antes de activar en otra cuenta, los precios configurados deben coincidir con los mostrados.

El token de cuenta autentica Checkout, la comprobación del retorno y la cancelación. El email de vinculación se fija en el servidor. Los reintentos reutilizan Checkout e idempotencia de Stripe; un plan activo impide otra contratación. Al cambiar de plan, primero se expira la sesión anterior. Una respuesta de creación perdida se conserva y se reconcilia con la misma clave; después de 23 horas sin poder identificar la sesión no se crea otra automáticamente y es necesario revisar el intento en Stripe.

Las fechas del trial y el estado de la suscripción vienen de Stripe. La firma del webhook se comprueba antes de procesar eventos. Los eventos administrados se reconcilian con la suscripción actual, incluidos eventos recibidos en el mismo segundo y las facturas de renovación. La comprobación del retorno es una recuperación adicional, no sustituye el webhook. Un evento tardío no se vincula a una cuenta registrada después con otro token. La marca de prueba usada y la huella de borrado impiden reiniciar el periodo de prueba.

Cancelar renovación mantiene acceso hasta el final de la prueba o del periodo pagado. Solo se confirma si Stripe lo confirma. El borrado de cuenta expira un Checkout pendiente y cancela la suscripción antes de borrar datos. Los fallos conservan los datos para reintentar. La prueba con tarjeta no introduce límites de dispositivos y la gracia sin conexión no prolonga su fecha final.

## Configuración que debe verificarse antes de activar

- Clave restringida de Stripe en un secreto de Cloudflare, con los permisos necesarios para Checkout y lectura/actualización/cancelación de suscripciones. La variable existente `STRIPE_SECRET_KEY` también acepta una clave restringida; no debe incluirse en código ni en archivos versionados. Mantener claves y KV separados para pruebas y producción.
- Precios de Pro y Lifetime del mismo modo de Stripe que la clave, y secreto del webhook correspondiente al destino.
- Webhook de producción habilitado y apuntando al entorno correcto. El webhook de pruebas que apunta a producción no debe reactivarse para probar una rama.
- Eventos de Checkout: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`.
- Ciclo de suscripción: `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`.
- Facturas: `invoice.paid`, `invoice.payment_failed`.
- Activar el email automático de fin de prueba en Stripe, en **Billing → Subscriptions and emails → Manage free trial messaging**, con enlace a la página de Stripe. Los recordatorios alojados por Stripe se envían siete días antes; no se envían en sandbox. `customer.subscription.trial_will_end` sirve para un aviso propio y no sustituye esta configuración. Esta implementación utiliza el correo de Stripe y no manda otro aviso duplicado.
- Verificación de la cuenta real, banco y dominio de pago según el Checkout utilizado. El Checkout alojado sigue usando `checkout.stripe.com`.

Las peticiones fijan `Stripe-Version: 2026-09-30.endive`, versión estable actual comprobada en la documentación oficial el 20-10-2026. Checkout filtra las opciones con `allowed_payment_method_types=['card']`, porque Endive eliminó `payment_method_types`. Los eventos del webhook existente con versión Dahlia siguen admitidos; el lector reconoce el fin de periodo en la suscripción o en su primer elemento. La versión del endpoint debe probarse y alinearse al configurar el destino definitivo, sin cambiar la versión general de la cuenta.

## Validación

Ejecutar con Node:

```sh
node --test test/*.test.js test/*.test.mjs
```

En PowerShell se debe pasar la lista de archivos de prueba a Node, ya que su expansión de comodines difiere de la de bash. `test/business-concurrency-test.mjs` es una herramienta manual que necesita servidor y argumentos, no una prueba unitaria que deba ejecutarse sin configuración.

Las pruebas cubren registro, autorización, consentimiento, idempotencia, prueba, cobro posterior, cancelación, baja, eventos repetidos y de facturas, protección contra reutilización, caché offline y pago en los trece idiomas. La prueba de DOM con jsdom no equivale a una inspección visual en navegador. Los testers conservan las pruebas de uso en dispositivos.

## Fuentes

- https://docs.stripe.com/api/versioning
- https://docs.stripe.com/changelog/endive
- https://docs.stripe.com/payments/checkout/free-trials
- https://docs.stripe.com/billing/subscriptions/trials/manage-trial-compliance
- https://docs.stripe.com/billing/subscriptions/webhooks
