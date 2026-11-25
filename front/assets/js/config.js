// Tokens de diseño de Reservando. Se carga justo después del CDN de Tailwind.
// En producción no hay CDN: build/construir.sh compila el CSS con esta misma configuración
// (build/tailwind.config.js la lee de acá). Este archivo igual se carga, por aplicarColoresClub.
var tailwind = window.tailwind || {};
// Valores de la identidad "Noche de cancha" que eligió PC 3 (ver NOTAS-PC3.md en la rama marca).
// Solo PC 3 cambia los valores; los nombres de los tokens no se tocan nunca.
tailwind.config = {
  theme: {
    extend: {
      colors: {
        // Identidad de Reservando
        marca: { DEFAULT: '#C6F432', claro: '#F3F5F0', oscuro: '#0E1311' },
        // Color del complejo: sale de COMPLEJO.colores (datos.js, se carga antes que este archivo).
        // En Django: lo pone el template con los colores del modelo Complejo.
        // Van como variables de CSS (las pone aplicarColoresClub, abajo): así el mismo CSS compilado
        // sirve para todos los complejos y cada uno ve su color.
        club: {
          DEFAULT: 'rgb(var(--club) / <alpha-value>)',
          claro: 'rgb(var(--club-claro) / <alpha-value>)',
          oscuro: 'rgb(var(--club-oscuro) / <alpha-value>)',
        },
        // Estados de turnos y canchas
        libre: '#22B45E',
        ocupado: '#FF5A4E',
        fijo: '#FFB547',
        alerta: '#FF5A4E',
      },
      fontFamily: {
        titulo: ['"Barlow Condensed"', '"Arial Narrow"', 'sans-serif'],
        texto: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
};

// ---------- Color del club ----------
// Convierte los colores del complejo (#RRGGBB) en variables de CSS "R G B" que usa Tailwind.
// En la demo salen de datos.js. Con la API, store-api.js la vuelve a llamar cuando llega el complejo.
function aplicarColoresClub(colores) {
  const porDefecto = { DEFAULT: '#2F7BFF', claro: '#8DB8FF', oscuro: '#1747A6' };
  const c = Object.assign({}, porDefecto, colores || {});
  const rgb = (hex) => {
    const n = String(hex).replace('#', '');
    return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16)).join(' ');
  };
  const raiz = document.documentElement.style;
  raiz.setProperty('--club', rgb(c.DEFAULT));
  raiz.setProperty('--club-claro', rgb(c.claro));
  raiz.setProperty('--club-oscuro', rgb(c.oscuro));
}
aplicarColoresClub(typeof COMPLEJO !== 'undefined' && COMPLEJO.colores);
