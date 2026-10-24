# Pausa temporal de nuevas contrataciones

La API create-checkout solo permite nuevas compras (Pro y Lifetime) y pruebas con tarjeta cuando la variable de Cloudflare Pages IDENTIFLY_CHECKOUT_ENABLED vale exactamente la cadena true. Ausente, false, vacía o con otro valor: cierre por defecto, HTTP 503 con checkout_paused, Cache-Control no-store, sin leer el cuerpo, KV ni Stripe y sin devolver una sesión pendiente. No hay excepciones para administradores ni para claves de prueba.

check-plan comunica checkoutEnabled sin cambiar los cálculos del plan, registro, prueba, límites de dispositivos o transferencia. billing.js deshabilita nuevas contrataciones y muestra un aviso; una pestaña antigua recibe el rechazo del servidor. SW v45 renueva la interfaz cacheada. La autorización real siempre está en el servidor.

## Publicación y reapertura

Publicar esta revisión en el proyecto Cloudflare Pages identity. No cambiar identifly-admin ni identifly-entrada. Asegurarse de que IDENTIFLY_CHECKOUT_ENABLED no está configurada como true en Producción. Para un cierre explícito, establecerla como false y volver a desplegar. Preview puede configurarse por separado, pero también está cerrado por defecto.

Para reabrir: tras resolver las obligaciones y verificar la integración, establecer IDENTIFLY_CHECKOUT_ENABLED=true en el entorno que corresponda y desplegar de nuevo. Comprobar después el recorrido de compra. No eliminar ni sustituir las claves Stripe para cerrar las compras.

## Alcance y cobros anteriores

Este cambio NO detiene páginas de Checkout ya creadas y abiertas en Stripe, pagos ya en proceso, renovaciones, facturas, pruebas existentes que puedan terminar en cobro ni Payment Links creados fuera de esta API. Revisar esos objetos en Stripe. Las sesiones abiertas requieren expiración explícita; no se implementa cancelación masiva de suscripciones ni se borran registros. Los webhooks y check-session permanecen operativos para conciliar operaciones anteriores. Bloquear nuevas compras no equivale a garantizar cero cobros.

La API puede verificarse con un POST vacío a /api/create-checkout: mientras está cerrado debe devolver HTTP 503 y {"error":"checkout_paused"}. Esa llamada no crea sesiones. Un fallo de red no acredita el bloqueo. Hay que comprobar el despliegue de Producción y, si procede, www.identifly.app.
