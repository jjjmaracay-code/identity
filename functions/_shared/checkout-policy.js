// Cierre por defecto: solo la cadena exacta true permite nuevas contrataciones.
export const checkoutEnabled = env => env?.IDENTIFLY_CHECKOUT_ENABLED === 'true';
