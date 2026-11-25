// Configuración de Tailwind para el build de producción (la usa construir.sh).
// No repite nada: lee los colores y las fuentes de front/assets/js/config.js, el mismo archivo
// que usa el CDN en desarrollo. Si cambia config.js, el build lo toma solo.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FRONT = path.join(__dirname, '..', 'front');
const contexto = { window: {}, document: { documentElement: { style: { setProperty() {} } } } };
vm.createContext(contexto);
vm.runInContext(fs.readFileSync(path.join(FRONT, 'assets/js/config.js'), 'utf8'), contexto);

module.exports = Object.assign({}, contexto.tailwind.config, {
  // Dónde buscar las clases: el HTML y también el JS (hay clases armadas en los .js)
  content: [path.join(FRONT, '**/*.html'), path.join(FRONT, 'assets/js/**/*.js')],
});
