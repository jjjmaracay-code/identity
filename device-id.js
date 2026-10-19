// Identificador aleatorio por DISPOSITIVO (nunca por cuenta ni por
// persona) -- permite al servidor contar cuántos dispositivos usan un
// mismo plan sin guardar ningún dato personal: no es una huella real del
// hardware/navegador, solo un UUID v4 que el propio dispositivo elige una
// vez y recuerda. Se genera la primera vez que hace falta y vive en
// localStorage.identity_device_id -- nunca se borra al cerrar sesión,
// solo con "Eliminar todos mis datos" (ver storage-wipe.js, que borra
// TODO localStorage sin excepción, esta clave incluida).
function getOrCreateDeviceId() {
  let id = localStorage.getItem('identity_device_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('identity_device_id', id);
  }
  return id;
}
