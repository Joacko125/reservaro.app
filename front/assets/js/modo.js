// De dónde saca los datos el front. Se carga ANTES que store-demo.js y store-api.js.
//   'demo' → store-demo.js: todo en el navegador (localStorage), sin servidor.
//   'api'  → store-api.js: habla con la API de Django de Joaco (/api/...).
// Cuando Joaco pase la URL de staging, esto se cambia a 'api'.
//
// Para probar sin tocar este archivo, agregá a la dirección ?modo=api o ?modo=demo.
const RESERVANDO_MODO = (() => {
  const pedido = new URLSearchParams(location.search).get('modo');
  return ['demo', 'api'].includes(pedido) ? pedido : 'demo';
})();
