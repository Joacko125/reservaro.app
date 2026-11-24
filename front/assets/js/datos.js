// Datos del complejo cliente y reservas de ejemplo de la demo.
// Las pantallas no leen este archivo: todo pasa por Store (Store.complejo(), Store.canchas()).
// En Django: esto viene de los modelos Complejo, Cancha y Reserva.
// Se carga ANTES que config.js: los colores del club de Tailwind salen de COMPLEJO.colores.
// Datos reales que pasó el dueño de El Más Grande por WhatsApp el 17/11/2026.

const COMPLEJO = {
  id: 'elmasgrande',
  nombre: 'El Más Grande',
  bajada: 'Complejo deportivo · Fútbol 5 y 8 · Canchas techadas',
  subdominio: 'elmasgrande.reservaro.app',   // A CONFIRMAR: depende del dominio que compremos
  direccion: 'Av. Bartolomé Mitre 1642, Moreno',
  entreCalles: 'entre Quilmes y Arribeños',
  mapa: 'https://maps.app.goo.gl/oYVNYA6uoER7Kfu5A',
  instagram: 'https://www.instagram.com/reel/DdHdRT6pTlf/', // A CONFIRMAR: es un reel; pedir el link del perfil
  whatsapp: '1172200546',                     // 10 dígitos, se muestra con Fmt.telefono
  telefonoDuenio: '1172200546',               // el dueño usa el mismo celu que el club (con este entra al panel)
  logo: '/assets/img/elmasgrande-escudo.png', // escudo sin el texto "Complejo deportivo"
  logoCompleto: '/assets/img/elmasgrande-logo.png',
  // Verdes sacados del escudo. DEFAULT oscurecido para que el texto blanco se lea bien encima.
  colores: { DEFAULT: '#4F8A10', claro: '#B0E03C', oscuro: '#2E5408' },
  horario: { desde: 13, hasta: 24 },          // el último turno es de 23:00 a 00:00 (A CONFIRMAR con el dueño)
  duracionTurno: 1,                           // en horas
  ventanaDias: 14,                            // el jugador reserva hasta 2 semanas adelante (pedido del dueño)
  senaPorHora: 5000,                          // A CONFIRMAR: no lo volvió a mencionar
  // Seña por transferencia mientras no esté Mercado Pago
  pagos: {
    alias: 'elmasgrande2024.mp',
    cvu: '0000003100067279994810',
    titular: 'El Más Grande',                 // A CONFIRMAR: a nombre de quién está la cuenta
    mercadoPago: false,                       // true en la semana de pulido: vuelve la pantalla de Mercado Pago
  },
  minutosParaSenar: { minimo: 15, maximo: 30 }, // cuánto se guarda un turno sin seña antes de liberarlo
  turnosFijos: 'los carga el dueño',
  cancelacionGratuita: false,
  // Puntaje de confiabilidad de cada jugador (por teléfono). A CALIBRAR con el dueño en el mes sin cargo.
  puntaje: {
    inicial: 100,
    // Cancelar: puntos según cuántas horas antes avisó. Menos de 6 h: masAlTope.
    porAnticipacion: [{ desdeHoras: 72, puntos: 5 }, { desdeHoras: 24, puntos: 10 }, { desdeHoras: 6, puntos: 20 }],
    masAlTope: 30,
    noVino: 40,                 // no vino y no avisó
    vino: 3,                    // suma cada vez que el dueño marca "Vino" (tope: inicial)
    reincidencia: 0.5,          // ×(1 + 0,5 × cancelaciones anteriores en la ventana)
    ventanaDias: 60,
    verdeDesde: 70,             // 70 a 100: Al día
    amarilloDesde: 40,          // 40 a 69: En observación · menos de 40: En riesgo
    alertaFijo: { avisar: 2, baja: 3 }, // cancelaciones en la ventana de un titular de turno fijo
  },
  comisionMercadoPago: 'complejo',            // la paga el complejo, no el jugador
  // Promo de lunes a viernes de 13:00 a 18:00 inclusive (último turno en promo: 18 a 19). El precio lo calcula el Store (turnosDelDia y reservar).
  promo: { dias: [1, 2, 3, 4, 5], desde: 13, hasta: 19 },
  canchas: [
    { id: 'f5', nombre: 'Cancha F5', tipo: 'F5', techada: true, superficie: 'Sintético', precioHora: 44000, precioPromo: 38000 },
    { id: 'f8', nombre: 'Cancha F8', tipo: 'F8', techada: true, superficie: 'Sintético', precioHora: 68000, precioPromo: 58000 },
  ],
};

// Reservas de ejemplo, relativas a la fecha de hoy: dia 0 = hoy, dia 1 = mañana.
// Quedan libres a propósito algunos horarios buenos (hoy F5 19, 21 y 23; F8 18, 21 y 23) para reservar en vivo.
// medioSena null = la seña todavía no se pagó.
const RESERVAS_EJEMPLO = [
  { dia: 0, canchaId: 'f8', hora: 16, horas: 1, nombre: 'Diego Sosa',       telefono: '1138472615', origen: 'manual', medioSena: 'efectivo' },
  { dia: 0, canchaId: 'f5', hora: 18, horas: 1, nombre: 'Martín Gómez',     telefono: '1134567812', origen: 'web',    medioSena: 'mercadopago' },
  { dia: 0, canchaId: 'f8', hora: 19, horas: 2, nombre: 'Juan Rodríguez',   telefono: '1167890145', origen: 'web',    medioSena: 'mercadopago' },
  { dia: 0, canchaId: 'f5', hora: 20, horas: 1, nombre: 'Lucas Fernández',  telefono: '1145678923', origen: 'web',    medioSena: 'mercadopago' },
  { dia: 0, canchaId: 'f5', hora: 22, horas: 1, nombre: 'Nicolás Pérez',    telefono: '1156789034', origen: 'manual', medioSena: null },
  { dia: 1, canchaId: 'f8', hora: 18, horas: 1, nombre: 'Santiago Romero',  telefono: '1129384756', origen: 'manual', medioSena: null },
  { dia: 1, canchaId: 'f5', hora: 19, horas: 1, nombre: 'Federico Díaz',    telefono: '1178901256', origen: 'web',    medioSena: 'mercadopago' },
  { dia: 1, canchaId: 'f8', hora: 20, horas: 1, nombre: 'Facundo Álvarez',  telefono: '1150617283', origen: 'web',    medioSena: 'mercadopago' },
  { dia: 1, canchaId: 'f5', hora: 21, horas: 2, nombre: 'Matías López',     telefono: '1189012367', origen: 'web',    medioSena: 'mercadopago' },
  { dia: 1, canchaId: 'f8', hora: 22, horas: 1, nombre: 'Agustín Torres',   telefono: '1161728394', origen: 'web',    medioSena: 'mercadopago' },
];
