// Store de PRODUCCIÓN: los mismos métodos que store-demo.js, pero contra la API de Django.
// Solo se arma si RESERVANDO_MODO es 'api' (modo.js). Las pantallas no se enteran del cambio.
//
// Reglas (las mismas de la demo):
//   - Reglas del negocio (turno ocupado, teléfono mal escrito...): la Promise se resuelve con
//     { ok: false, error: 'texto para mostrar' }. La API responde 4xx con ese mismo JSON.
//   - Problemas de red o del servidor (sin conexión, 5xx): la Promise se RECHAZA (throw).
//     Las pantallas lo agarran con try/catch y muestran "Reintentar".
//
// PARA JOACO: las rutas de abajo son una PROPUESTA. Si en Django quedaron con otro nombre,
// se cambian acá y en ningún otro lado. Todas responden JSON con { ok, ... }.
//   GET  /api/complejo                         → { ok, complejo }   (complejo incluye canchas)
//   GET  /api/turnos?fecha=AAAA-MM-DD[&cancha=] → { ok, turnos }
//        cada turno: { canchaId, fecha, hora, estado, precio, precioNormal, promo, reservaId, pasado }
//        promo: null | { tipo: 'turno', id } (la puso el dueño) | { tipo: 'horario' } (lun a vie 13 a 19)
//   POST /api/reservas                         → { ok, reserva }
//   GET  /api/mis-reservas                     → { ok, reservas }   (del usuario logueado)
//   GET  /api/reservas/<id>/cancelacion        → { ok, senaSeDevuelve, senaPagada, sena, puntos }
//   POST /api/reservas/<id>/cancelar           → { ok, reserva }
//   GET  /api/panel/reservas?fecha=            → { ok, reservas }   (solo dueño, incluye fijos)
//   POST /api/panel/reservas/<id>/asistencia   { estado }  → { ok, reserva }
//   POST /api/panel/reservas/<id>/sena         { medio }   → { ok, reserva }
//   GET  /api/panel/senas-pendientes           → { ok, reservas }   (web, sin seña, de la más vieja a la más nueva)
//   POST /api/panel/reservas/<id>/liberar      → { ok, reserva }    (no llegó la seña: el turno queda libre)
//   GET  /api/promos                           → { ok, promos }     (público: las usa la app del jugador)
//   POST /api/panel/promos     { canchaId, fecha, hora, precio } → { ok, promo }
//   DELETE /api/panel/promos/<id>              → { ok, promo }
//   GET  /api/panel/fijos                      → { ok, fijos }
//   POST /api/panel/fijos/fechas/<fijo-ID-AAAA-MM-DD>/cancelar { avisoEn } → { ok, reserva, cancelacion }
//        cancelacion: { fecha, avisoEn, registradaEn, anticipacionHoras }  (la usa el puntaje)
//   DELETE /api/panel/fijos/<id>/cancelaciones/<AAAA-MM-DD> → { ok }  (deshacer)
//   POST /api/panel/fijos                      → { ok, turnoFijo }
//   DELETE /api/panel/fijos/<id>               → { ok, turnoFijo }
//   POST /api/auth/codigo     { telefono }           → { ok }       (manda el código por WhatsApp)
//   POST /api/auth/verificar  { telefono, codigo }   → { ok }
//   POST /api/auth/login      { telefono, nombre, ambito } → { ok, usuario }
//   GET  /api/auth/yo?ambito=                  → { ok, usuario }    (usuario null si no hay sesión)
//   POST /api/auth/logout     { ambito }         → { ok }
//   GET  /api/auth/es-duenio?telefono=         → { ok, esDuenio }
//   GET  /api/cambios?desde=<cursor>           → { ok, cursor, eventos: [{ tipo, datos }] }
var Store = RESERVANDO_MODO !== 'api' ? Store : (() => {
  const ZONA_HORARIA = 'America/Argentina/Buenos_Aires';
  const CADA_CUANTO_CONSULTAR = 10000; // ms entre consultas de cambios (polling)

  // ---------- El helper ----------

  function leerCookie(nombre) {
    const par = document.cookie.split('; ').find((uno) => uno.startsWith(nombre + '='));
    return par ? decodeURIComponent(par.split('=')[1]) : '';
  }

  // Habla con la API. Devuelve el JSON { ok, ... }. Tira error si no hubo respuesta o si el servidor falló.
  async function api(metodo, ruta, cuerpo) {
    const respuesta = await fetch('/api' + ruta, {
      method: metodo,
      credentials: 'same-origin', // manda la cookie de sesión
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': leerCookie('csrftoken') },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    if (respuesta.status >= 500) throw new Error(`API: error ${respuesta.status} en ${metodo} ${ruta}`);
    let datos;
    try {
      datos = await respuesta.json();
    } catch (error) {
      throw new Error(`API: la respuesta de ${metodo} ${ruta} no es JSON`);
    }
    // Un 4xx sin mensaje: igual lo convertimos en { ok: false, error } para que la pantalla lo muestre
    if (!respuesta.ok && datos.ok !== false) return { ok: false, error: 'No se pudo hacer. Probá de nuevo.' };
    return datos;
  }

  const enLaRuta = (texto) => encodeURIComponent(String(texto));

  // ---------- Fechas (hora de Argentina, igual que la demo) ----------

  function hoy() {
    const partes = {};
    new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_HORARIA, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date()).forEach(({ type, value }) => { partes[type] = value; });
    return `${partes.year}-${partes.month}-${partes.day}`;
  }

  function sumarDias(fecha, dias) {
    const [anio, mes, dia] = fecha.split('-').map(Number);
    return new Date(Date.UTC(anio, mes - 1, dia + dias)).toISOString().slice(0, 10);
  }

  // Mismo código que la demo: no toca datos, así que no hace falta preguntarle al servidor
  function normalizarTelefono(texto) {
    let digitos = String(texto || '').replace(/\D/g, '');
    if (digitos.length > 10 && digitos.startsWith('54')) digitos = digitos.slice(2);
    if (digitos.length === 11 && digitos.startsWith('9')) digitos = digitos.slice(1);
    if (digitos.startsWith('0')) digitos = digitos.slice(1);
    if (digitos.length === 12) {
      const largoArea = [2, 3, 4].find((largo) => digitos.substr(largo, 2) === '15');
      if (largoArea) digitos = digitos.slice(0, largoArea) + digitos.slice(largoArea + 2);
    }
    return /^[1-3]\d{9}$/.test(digitos) ? digitos : null;
  }

  // ---------- El complejo se pide una sola vez por página ----------

  let pedidoComplejo = null;
  function traerComplejo() {
    if (!pedidoComplejo) {
      pedidoComplejo = api('GET', '/complejo').then((r) => {
        if (!r.ok) throw new Error('API: no se pudo leer el complejo');
        return r.complejo;
      });
      pedidoComplejo.catch(() => { pedidoComplejo = null; }); // si falló, el "Reintentar" vuelve a pedir
    }
    return pedidoComplejo;
  }

  const copia = (valor) => JSON.parse(JSON.stringify(valor));

  // ---------- Cambios en vivo (polling) ----------

  const oyentes = [];
  let cursor = 0;
  let consultando = null;

  async function consultarCambios() {
    if (document.hidden || !oyentes.length) return; // no gastar si no se ve la página
    try {
      const r = await api('GET', `/cambios?desde=${cursor}`);
      if (!r.ok) return;
      cursor = r.cursor;
      (r.eventos || []).forEach((evento) => {
        oyentes.slice().forEach((callback) => {
          try {
            callback({ tipo: evento.tipo, datos: evento.datos });
          } catch (error) {
            console.error('Store.alCambiar: error en un callback', error);
          }
        });
      });
    } catch (error) {
      // Sin conexión: se vuelve a probar en la próxima vuelta
    }
  }

  // Al volver a la pestaña, consulta enseguida en vez de esperar los 10 segundos
  document.addEventListener('visibilitychange', () => { if (!document.hidden) consultarCambios(); });

  // ---------- API pública (mismos nombres que store-demo.js) ----------

  return Object.freeze({
    // ----- Complejo y canchas -----
    async complejo() { return copia(await traerComplejo()); },
    async canchas() { return copia((await traerComplejo()).canchas); },

    // ----- Fechas -----
    async hoy() { return hoy(); },
    async proximosDias(n) {
      const cantidad = n || (await traerComplejo()).ventanaDias || 7;
      const inicio = hoy();
      return Array.from({ length: cantidad }, (_, i) => sumarDias(inicio, i));
    },

    // ----- Turnos y reservas -----
    async turnosDelDia(fecha, canchaId) {
      const r = await api('GET', `/turnos?fecha=${enLaRuta(fecha)}${canchaId ? '&cancha=' + enLaRuta(canchaId) : ''}`);
      return r.ok ? r.turnos : [];
    },
    async reservar(datos = {}) { return api('POST', '/reservas', datos); },
    async reservasDelDia(fecha) {
      const r = await api('GET', `/panel/reservas?fecha=${enLaRuta(fecha)}`);
      return r.ok ? r.reservas : [];
    },
    // El servidor sabe quién es por la sesión: el teléfono no viaja
    async reservasDeUsuario() {
      const r = await api('GET', '/mis-reservas');
      return r.ok ? r.reservas : [];
    },
    async impactoCancelacion(reservaId) { return api('GET', `/reservas/${enLaRuta(reservaId)}/cancelacion`); },
    async cancelarReserva(reservaId) { return api('POST', `/reservas/${enLaRuta(reservaId)}/cancelar`); },
    async marcarAsistencia(reservaId, estado) {
      return api('POST', `/panel/reservas/${enLaRuta(reservaId)}/asistencia`, { estado });
    },
    async marcarSenaRecibida(reservaId, medio) {
      return api('POST', `/panel/reservas/${enLaRuta(reservaId)}/sena`, { medio });
    },
    async marcarSenaEfectivo(reservaId) {
      return api('POST', `/panel/reservas/${enLaRuta(reservaId)}/sena`, { medio: 'efectivo' });
    },

    // ----- Señas pendientes y promos -----
    async senasPendientes() {
      const r = await api('GET', '/panel/senas-pendientes');
      return r.ok ? r.reservas : [];
    },
    async liberarReserva(reservaId) { return api('POST', `/panel/reservas/${enLaRuta(reservaId)}/liberar`); },
    async promos() {
      const r = await api('GET', '/promos');
      return r.ok ? r.promos : [];
    },
    async ponerEnPromo(datos = {}) { return api('POST', '/panel/promos', datos); },
    async quitarPromo(promoId) { return api('DELETE', `/panel/promos/${enLaRuta(promoId)}`); },

    // ----- Turnos fijos: cancelar una fecha -----
    async cancelarFechaFijo(reservaId, avisoEn) {
      return api('POST', `/panel/fijos/fechas/${enLaRuta(reservaId)}/cancelar`, { avisoEn: avisoEn || null });
    },
    async restaurarFechaFijo(turnoFijoId, fecha) {
      return api('DELETE', `/panel/fijos/${enLaRuta(turnoFijoId)}/cancelaciones/${enLaRuta(fecha)}`);
    },

    // ----- Turnos fijos -----
    async turnosFijos() {
      const r = await api('GET', '/panel/fijos');
      return r.ok ? r.fijos : [];
    },
    async crearTurnoFijo(datos = {}) { return api('POST', '/panel/fijos', datos); },
    async borrarTurnoFijo(id) { return api('DELETE', `/panel/fijos/${enLaRuta(id)}`); },

    // ----- Sesión -----
    // El código llega por WhatsApp de verdad: acá nunca se devuelve (por eso '' y no el código)
    async enviarCodigo(telefono) {
      const r = await api('POST', '/auth/codigo', { telefono });
      return r.ok ? '' : null;
    },
    async verificarCodigo(telefono, codigo) {
      const r = await api('POST', '/auth/verificar', { telefono, codigo });
      return Boolean(r.ok);
    },
    async login(telefono, nombre, ambito = 'jugador') {
      const r = await api('POST', '/auth/login', { telefono, nombre, ambito });
      return r.ok ? r.usuario : null;
    },
    async usuarioActual(ambito = 'jugador') {
      const r = await api('GET', `/auth/yo?ambito=${enLaRuta(ambito)}`);
      return r.ok ? r.usuario : null;
    },
    async logout(ambito = 'jugador') { await api('POST', '/auth/logout', { ambito }); },
    async esDuenio(telefono) {
      const r = await api('GET', `/auth/es-duenio?telefono=${enLaRuta(telefono)}`);
      return Boolean(r.ok && r.esDuenio);
    },
    normalizarTelefono,

    // ----- Demo: en producción no hay nada que reiniciar -----
    async reiniciarDemo() {},

    // ----- Cambios en vivo: misma firma que en la demo, ahora consultando cada 10 s -----
    alCambiar(callback) {
      oyentes.push(callback);
      if (!consultando) consultando = setInterval(consultarCambios, CADA_CUANTO_CONSULTAR);
      return () => {
        const posicion = oyentes.indexOf(callback);
        if (posicion >= 0) oyentes.splice(posicion, 1);
      };
    },
  });
})();
