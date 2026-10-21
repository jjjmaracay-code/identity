# Protección de la creación de enlaces de contacto

El POST `/api/share-qr` exige email de registro y token de cuenta, verificados contra `PLANS_KV`. El cliente utiliza el email de la cuenta, que puede ser distinto al del contacto, y el token de acceso existente. Todos los planes registrados conservan esta función. No se modifican licencias, transferencias, dispositivos ni el consumo del enlace. El GET público y los enlaces anteriores siguen sin exigir registro al destinatario.

## Límites de la función

- JSON de hasta 128 KiB (128 × 1024 bytes). Se cuenta el cuerpo real durante la lectura; no se confía solo en `Content-Length`.
- vCard de hasta 64 KiB, texto delimitado por `BEGIN:VCARD` y `END:VCARD`; nombre de hasta 256 unidades UTF-16. No se almacenan email de cuenta ni token dentro del contacto compartido.
- Reserva de frecuencia por cuenta: 30 creaciones por ventana de diez minutos y 200 por ventana de 24 horas. Se devuelve 429 y `Retry-After` cuando corresponde. Las ventanas empiezan con la primera reserva; los contadores caducan.
- Se guarda la reserva antes del contacto. Un fallo de autenticación, lectura de cuotas o escritura de la reserva impide crear el contacto. Los errores internos no se devuelven al cliente.
- Si llega un `Origin` ajeno se rechaza; este control complementa la autenticación y no la sustituye. Se exige JSON.

## Alcance de las cuotas

Las cuotas utilizan el binding `SHARE_KV` existente y no requieren desplegar otro Worker ni cambiar la configuración de la cuenta. La concurrencia de reservas de una misma cuenta se rechaza dentro del mismo isolate. Un rechazo 429 del propio KV también impide crear el contacto.

**Estas cuotas KV no constituyen un límite global transaccional exacto.** KV tiene consistencia eventual y dos centros de datos pueden observar contadores distintos. No se debe afirmar que exactamente la petición 31 o 201 será rechazada bajo cualquier concurrencia mundial. La prueba local de reservas simultáneas comprueba únicamente el mismo isolate. Para límites globales estrictos se necesita almacenamiento transaccional coordinado, por ejemplo un Durable Object, con su despliegue correspondiente.

No se han comprobado reglas privadas WAF, protección de bots, cuotas facturadas ni limitadores externos de Cloudflare. Esta corrección no las presupone y no acredita protección frente a todo ataque de tráfico. Las peticiones rechazadas todavía pueden consumir ejecución/lecturas; la autenticación elimina las escrituras anónimas de contactos, no todo coste de recibir tráfico.

## Entrega y comprobación

Servidor, cliente y Service Worker deben publicarse juntos. La versión de caché pasa de 43 a 44 para renovar el `index.html` instalado que ahora envía credenciales. Una pestaña antigua ya abierta necesita recargarse para usar el nuevo cliente. No hay migración ni borrado de datos locales. Nunca debe reabrirse el POST anónimo como compatibilidad con un cliente antiguo.

Pruebas: `node --test test/*.test.js test/*.test.mjs`. Los datos son ficticios y el almacenamiento de las pruebas está simulado; no prueban la configuración ni la carga de producción. Incluyen credenciales ausentes/incorrectas, los tres planes, apertura pública y enlaces anteriores, tamaño real/streaming/multibyte, formato, frecuencia corta/diaria, concurrencia local, fallos de dependencias y credenciales enviadas por el cliente. Las suites existentes cubren también dispositivos, transferencia, pagos y offline.

Fuentes oficiales:

- https://developers.cloudflare.com/kv/concepts/how-kv-works/
- https://developers.cloudflare.com/kv/api/write-key-value-pairs/
