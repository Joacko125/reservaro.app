// Store de la DEMO: la ÚNICA puerta a los datos mientras no esté la API de Django.
// Ninguna pantalla lee ni escribe localStorage por su cuenta: todo pasa por acá.
// Todo se guarda con el prefijo 'reservando:'.
//
// TODOS los métodos son async (devuelven una Promise), igual que van a ser las llamadas a la API:
//   const turnos = await Store.turnosDelDia(fecha);
// Por dentro sigue usando localStorage. Cuando esté el backend, este archivo se cambia por
// store-api.js (mismos nombres, mismas respuestas, con fetch) y las pantallas no se tocan.
//
// Dos maneras de "fallar":
//   - Reglas del negocio (turno ocupado, teléfono mal escrito...): la Promise se resuelve con
//     { ok: false, error: 'texto para mostrar' }. Igual que antes.
//   - Problemas de red o del servidor: la Promise se RECHAZA (throw). Las pantallas lo agarran
//     con try/catch y muestran su estado de error con "Reintentar".
//
// Para probar los estados de carga y de error, agregá a la dirección:
//   ?lento            → cada llamada tarda 1,5 s (para ver los "cargando")
//   ?fallar=todo      → todas las llamadas fallan (para ver los "error")
//   ?fallar=turnosDelDia,reservasDeUsuario → fallan solo esos métodos
// Las excepciones sin espera: alCambiar (suscribirse a cambios) y normalizarTelefono (no toca datos).
//
// Este archivo solo arma el Store si RESERVANDO_MODO es 'demo' (modo.js). Con 'api' lo arma store-api.js.
var Store = RESERVANDO_MODO !== 'demo' ? undefined : (() => {
  const PREFIJO = 'reservando:';
  const CLAVES = {
    reservas: 'reservas',
    canceladas: 'canceladas',    // reservas que canceló el jugador (sirven para el puntaje)
    fijos: 'fijos',
    marcasFijos: 'marcas-fijos', // asistencia y seña de cada día de un turno fijo
    codigos: 'codigos',          // códigos simulados enviados por "WhatsApp"
    semilla: 'semilla',          // fecha en que se generaron las reservas de ejemplo
    evento: 'evento',            // último cambio, para avisar a otras pestañas e iframes
    sesion: (ambito) => `sesion:${ambito}`,
  };
  const ZONA_HORARIA = 'America/Argentina/Buenos_Aires';
  const DESDE = COMPLEJO.horario.desde; // 13
  const HASTA = COMPLEJO.horario.hasta; // 24: el último turno es de 23 a 00
  const AMBITOS = ['jugador', 'panel'];
  const ORIGENES = ['web', 'manual'];
  const MEDIOS_SENA = ['mercadopago', 'transferencia', 'efectivo'];
  // A DEFINIR (tarea del viernes, puntaje): depende de la anticipación y de si es reincidente.
  // Por ahora toda cancelación baja lo mismo.
  const PUNTOS_POR_CANCELAR = 15;
  const oyentes = [];

  // ---------- localStorage ----------

  function leer(clave, porDefecto) {
    try {
      const texto = localStorage.getItem(PREFIJO + clave);
      return texto === null ? porDefecto : JSON.parse(texto);
    } catch (error) {
      return porDefecto;
    }
  }

  function guardar(clave, valor) {
    try {
      localStorage.setItem(PREFIJO + clave, JSON.stringify(valor));
    } catch (error) {
      console.warn('Store: no se pudo guardar', clave, error);
    }
  }

  function borrar(clave) {
    try {
      localStorage.removeItem(PREFIJO + clave);
    } catch (error) { /* sin localStorage no hay nada que borrar */ }
  }

  // ---------- Ayudas ----------

  const fallo = (error) => ({ ok: false, error });
  const nuevoId = (prefijo) => `${prefijo}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const copia = (valor) => JSON.parse(JSON.stringify(valor));
  const buscarCancha = (canchaId) => COMPLEJO.canchas.find((cancha) => cancha.id === canchaId);
  const senaDe = (horas) => COMPLEJO.senaPorHora * horas;
  const seSuperponen = (a, b) => a.hora < b.hora + b.horas && b.hora < a.hora + a.horas;

  // Fecha y hora actuales en Argentina, sea cual sea la zona del navegador
  function ahora() {
    const partes = {};
    new Intl.DateTimeFormat('en-CA', {
      timeZone: ZONA_HORARIA, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).forEach(({ type, value }) => { partes[type] = value; });
    return { fecha: `${partes.year}-${partes.month}-${partes.day}`, hora: Number(partes.hour) % 24 };
  }

  function sumarDias(fecha, dias) {
    const [anio, mes, dia] = fecha.split('-').map(Number);
    return new Date(Date.UTC(anio, mes - 1, dia + dias)).toISOString().slice(0, 10);
  }

  function diaDeLaSemana(fecha) {
    const [anio, mes, dia] = fecha.split('-').map(Number);
    return new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay(); // 0 = domingo
  }

  function fechaValida(fecha) {
    return typeof fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fecha) && sumarDias(fecha, 0) === fecha;
  }

  // Un turno "ya pasó" cuando su hora de inicio ya llegó
  function yaEmpezo(fecha, hora, momento = ahora()) {
    return fecha < momento.fecha || (fecha === momento.fecha && hora <= momento.hora);
  }

  // Acepta '+54 9 11 2345-6789', '011 15 2345-6789', '11 2345 6789'... → '1123456789' | null
  function normalizarTelefono(texto) {
    let digitos = String(texto || '').replace(/\D/g, '');
    if (digitos.length > 10 && digitos.startsWith('54')) digitos = digitos.slice(2); // código de país
    if (digitos.length === 11 && digitos.startsWith('9')) digitos = digitos.slice(1); // 9 de celulares
    if (digitos.startsWith('0')) digitos = digitos.slice(1);                           // 0 de larga distancia
    if (digitos.length === 12) {                                                       // 15 después del área
      const largoArea = [2, 3, 4].find((largo) => digitos.substr(largo, 2) === '15');
      if (largoArea) digitos = digitos.slice(0, largoArea) + digitos.slice(largoArea + 2);
    }
    return /^[1-3]\d{9}$/.test(digitos) ? digitos : null;
  }

  // ---------- Datos guardados ----------

  // Las reservas de ejemplo se generan relativas a hoy. Si la demo se abre otro día,
  // se regeneran solas sin tocar las reservas reales ni los turnos fijos.
  function sembrarSiHaceFalta() {
    const hoy = ahora().fecha;
    if (leer(CLAVES.semilla, null) === hoy) return;
    const reservas = leer(CLAVES.reservas, []).filter((reserva) => !reserva.ejemplo);
    const fijos = leer(CLAVES.fijos, []);
    RESERVAS_EJEMPLO.forEach((ejemplo) => {
      const fecha = sumarDias(hoy, ejemplo.dia);
      const pisa = ocupacionDelDia(reservas, fijos, fecha)
        .some((otra) => otra.canchaId === ejemplo.canchaId && seSuperponen(otra, ejemplo));
      if (pisa) return;
      reservas.push({
        id: nuevoId('r'),
        canchaId: ejemplo.canchaId,
        fecha,
        hora: ejemplo.hora,
        horas: ejemplo.horas,
        nombre: ejemplo.nombre,
        telefono: ejemplo.telefono,
        origen: ejemplo.origen,
        sena: senaDe(ejemplo.horas),
        senaPagada: ejemplo.medioSena !== null,
        medioSena: ejemplo.medioSena,
        asistencia: null,
        creadaEn: new Date().toISOString(),
        ejemplo: true,
      });
    });
    guardar(CLAVES.reservas, reservas);
    guardar(CLAVES.semilla, hoy);
  }

  function reservasGuardadas() {
    sembrarSiHaceFalta();
    return leer(CLAVES.reservas, []);
  }

  function fijosGuardados() {
    return leer(CLAVES.fijos, []);
  }

  // Los turnos fijos valen todas las semanas a partir del día en que se cargan
  function fijosDelDia(fijos, fecha) {
    const diaSemana = diaDeLaSemana(fecha);
    return fijos.filter((fijo) => fijo.diaSemana === diaSemana && fecha >= fijo.desde);
  }

  // Lo que ocupa cada cancha ese día: reservas y turnos fijos
  function ocupacionDelDia(reservas, fijos, fecha) {
    return reservas.filter((reserva) => reserva.fecha === fecha).concat(fijosDelDia(fijos, fecha));
  }

  // Un turno fijo, en un día puntual, se muestra como una Reserva con origen 'fijo'
  function reservaDeFijo(fijo, fecha, marcas = leer(CLAVES.marcasFijos, {})) {
    const id = `fijo-${fijo.id}-${fecha}`;
    const marca = marcas[id] || {};
    return {
      id,
      canchaId: fijo.canchaId,
      fecha,
      hora: fijo.hora,
      horas: fijo.horas,
      nombre: fijo.responsable,
      telefono: fijo.telefono,
      origen: 'fijo',
      sena: senaDe(fijo.horas),
      senaPagada: Boolean(marca.medioSena),
      medioSena: marca.medioSena || null,
      asistencia: marca.asistencia || null,
      creadaEn: fijo.creadoEn,
      turnoFijoId: fijo.id,
    };
  }

  // 'fijo-<idDelFijo>-AAAA-MM-DD' → Reserva del fijo ese día, o null
  function buscarReservaDeFijo(reservaId) {
    const fecha = reservaId.slice(-10);
    const fijoId = reservaId.slice(5, -11);
    if (!fechaValida(fecha)) return null;
    const fijo = fijosDelDia(fijosGuardados(), fecha).find((uno) => uno.id === fijoId);
    return fijo ? reservaDeFijo(fijo, fecha) : null;
  }

  // Una reserva guardada o un día de un turno fijo → Reserva | null
  function buscarReserva(reservaId) {
    const id = String(reservaId || '');
    if (id.startsWith('fijo-')) return buscarReservaDeFijo(id);
    return reservasGuardadas().find((reserva) => reserva.id === id) || null;
  }

  // Cambia una reserva (o un día de un turno fijo) y avisa
  function actualizarReserva(reservaId, cambios) {
    const id = String(reservaId || '');
    if (id.startsWith('fijo-')) {
      if (!buscarReservaDeFijo(id)) return fallo('No encontramos ese turno.');
      const marcas = leer(CLAVES.marcasFijos, {});
      marcas[id] = Object.assign({}, marcas[id], cambios);
      guardar(CLAVES.marcasFijos, marcas);
      const reserva = buscarReservaDeFijo(id);
      avisar('reserva-actualizada', reserva);
      return { ok: true, reserva };
    }
    const reservas = reservasGuardadas();
    const reserva = reservas.find((una) => una.id === id);
    if (!reserva) return fallo('No encontramos esa reserva.');
    Object.assign(reserva, cambios);
    guardar(CLAVES.reservas, reservas);
    avisar('reserva-actualizada', reserva);
    return { ok: true, reserva };
  }

  // ---------- Cambios en vivo ----------

  function avisar(tipo, datos) {
    // Escribir esta clave dispara el evento 'storage' en las otras pestañas e iframes
    guardar(CLAVES.evento, { tipo, datos, id: nuevoId('e') });
    notificar({ tipo, datos });
  }

  function notificar(cambio) {
    oyentes.slice().forEach((callback) => {
      try {
        callback(cambio);
      } catch (error) {
        console.error('Store.alCambiar: error en un callback', error);
      }
    });
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (evento) => {
      if (evento.key !== PREFIJO + CLAVES.evento || !evento.newValue) return;
      try {
        const { tipo, datos } = JSON.parse(evento.newValue);
        notificar({ tipo, datos });
      } catch (error) { /* evento con formato desconocido */ }
    });
  }

  // ---------- API pública ----------

  const api = {
    // ----- Complejo y canchas -----

    // En Django: esto viene de la vista del complejo
    complejo() {
      return copia(COMPLEJO);
    },

    canchas() {
      return copia(COMPLEJO.canchas);
    },

    // ----- Fechas (hora de Argentina) -----

    hoy() {
      return ahora().fecha;
    },

    // Por defecto, la ventana de reserva del complejo (complejo().ventanaDias)
    proximosDias(n = COMPLEJO.ventanaDias || 7) {
      const hoy = ahora().fecha;
      return Array.from({ length: n }, (_, i) => sumarDias(hoy, i));
    },

    // ----- Turnos y reservas -----

    // [Turno] de 13 a 23 (el de 23 termina a las 00), por cancha y por hora.
    // Además del contrato trae 'pasado': true si la hora de inicio ya llegó.
    // En Django: esto viene de la vista de turnos del día
    turnosDelDia(fecha, canchaId) {
      if (!fechaValida(fecha)) return [];
      const momento = ahora();
      const canchas = canchaId ? COMPLEJO.canchas.filter((cancha) => cancha.id === canchaId) : COMPLEJO.canchas;
      const ocupadas = api.reservasDelDia(fecha);
      const turnos = [];
      canchas.forEach((cancha) => {
        for (let hora = DESDE; hora < HASTA; hora++) {
          const reserva = ocupadas.find((una) => una.canchaId === cancha.id && hora >= una.hora && hora < una.hora + una.horas);
          turnos.push({
            canchaId: cancha.id,
            fecha,
            hora,
            estado: !reserva ? 'libre' : reserva.origen === 'fijo' ? 'fijo' : 'reservado',
            precio: cancha.precioHora,
            reservaId: reserva ? reserva.id : null,
            pasado: yaEmpezo(fecha, hora, momento),
          });
        }
      });
      return turnos;
    },

    // datos = { canchaId, fecha, hora, horas = 1, nombre, telefono, origen = 'web', medioSena? }
    // medioSena null = seña pendiente. Así entra la reserva web mientras la seña sea por transferencia:
    // el dueño la marca como recibida cuando le llega el comprobante (marcarSenaRecibida).
    // En Django: esto es el POST de la vista de reservas
    reservar(datos = {}) {
      const cancha = buscarCancha(datos.canchaId);
      if (!cancha) return fallo('Esa cancha no existe.');
      if (!fechaValida(datos.fecha)) return fallo('La fecha no es válida.');
      const hora = Number(datos.hora);
      const horas = Number(datos.horas === undefined ? 1 : datos.horas);
      if (!Number.isInteger(hora) || !Number.isInteger(horas) || horas < 1) return fallo('El turno no es válido.');
      if (hora < DESDE || hora + horas > HASTA) {
        return fallo(`Los turnos son de ${Fmt.hora(DESDE)} a ${Fmt.hora(HASTA)}.`);
      }

      const origen = datos.origen === undefined ? 'web' : datos.origen;
      if (!ORIGENES.includes(origen)) return fallo('El origen de la reserva no es válido.');
      // Desde la web no se reserva un turno que ya empezó; el dueño sí puede cargar el que está en curso
      const momento = ahora();
      const empezo = origen === 'manual'
        ? datos.fecha < momento.fecha || (datos.fecha === momento.fecha && hora < momento.hora)
        : yaEmpezo(datos.fecha, hora, momento);
      if (empezo) return fallo('Ese horario ya pasó.');
      // Desde la web se reserva hasta el último día de la ventana; el dueño carga cualquier fecha
      const ultimoDia = sumarDias(momento.fecha, (COMPLEJO.ventanaDias || 7) - 1);
      if (origen === 'web' && datos.fecha > ultimoDia) {
        return fallo(`Se puede reservar hasta ${COMPLEJO.ventanaDias || 7} días para adelante.`);
      }

      const nombre = String(datos.nombre || '').trim();
      if (!nombre) return fallo('Falta el nombre.');
      const telefono = normalizarTelefono(datos.telefono);
      if (!telefono) return fallo('El teléfono no es válido.');

      const medioSena = 'medioSena' in datos ? datos.medioSena : null;
      if (medioSena !== null && !MEDIOS_SENA.includes(medioSena)) return fallo('El medio de pago de la seña no es válido.');

      const choque = api.reservasDelDia(datos.fecha)
        .find((otra) => otra.canchaId === cancha.id && seSuperponen(otra, { hora, horas }));
      if (choque) return fallo(`Ese horario ya está ocupado (${Fmt.rango(choque.hora, choque.horas)}).`);

      const reserva = {
        id: nuevoId('r'),
        canchaId: cancha.id,
        fecha: datos.fecha,
        hora,
        horas,
        nombre,
        telefono,
        origen,
        sena: senaDe(horas),
        senaPagada: medioSena !== null,
        medioSena,
        asistencia: null,
        creadaEn: new Date().toISOString(),
      };
      const reservas = reservasGuardadas();
      reservas.push(reserva);
      guardar(CLAVES.reservas, reservas);
      avisar('reserva-nueva', reserva);
      return { ok: true, reserva };
    },

    // [Reserva] del día, incluidos los turnos fijos (origen 'fijo'), ordenadas por hora y cancha
    // En Django: esto viene de la vista de agenda del panel
    reservasDelDia(fecha) {
      if (!fechaValida(fecha)) return [];
      const marcas = leer(CLAVES.marcasFijos, {});
      const delDia = reservasGuardadas()
        .filter((reserva) => reserva.fecha === fecha)
        .concat(fijosDelDia(fijosGuardados(), fecha).map((fijo) => reservaDeFijo(fijo, fecha, marcas)));
      return delDia.sort((a, b) => a.hora - b.hora || a.canchaId.localeCompare(b.canchaId));
    },

    // [Reserva] que todavía no terminaron (incluye la que está en curso), ordenadas por fecha y hora.
    // No incluye turnos fijos: esos los maneja el dueño.
    // En Django: esto viene de la vista "Mis reservas"
    reservasDeUsuario(telefono) {
      const numero = normalizarTelefono(telefono);
      if (!numero) return [];
      const momento = ahora();
      return reservasGuardadas()
        .filter((reserva) => reserva.telefono === numero)
        .filter((reserva) => reserva.fecha > momento.fecha
          || (reserva.fecha === momento.fecha && reserva.hora + reserva.horas > momento.hora))
        .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.hora - b.hora);
    },

    // estado: 'vino' | 'no_vino' (null deshace la marca)
    marcarAsistencia(reservaId, estado) {
      if (![null, 'vino', 'no_vino'].includes(estado)) return fallo('La asistencia no es válida.');
      return actualizarReserva(reservaId, { asistencia: estado });
    },

    // medio: 'transferencia' | 'efectivo'. Lo marca el dueño cuando le llega la plata.
    // En Django: POST a la vista que registra la seña
    marcarSenaRecibida(reservaId, medio) {
      if (!['transferencia', 'efectivo'].includes(medio)) return fallo('El medio de pago de la seña no es válido.');
      const reserva = buscarReserva(reservaId);
      if (!reserva) return fallo('No encontramos esa reserva.');
      if (reserva.senaPagada) return fallo('La seña ya está pagada.');
      return actualizarReserva(reservaId, { senaPagada: true, medioSena: medio });
    },

    marcarSenaEfectivo(reservaId) {
      return api.marcarSenaRecibida(reservaId, 'efectivo');
    },

    // Lo que pierde el jugador si cancela. Se muestra ANTES de confirmar.
    // → { ok, senaSeDevuelve, senaPagada, sena, puntos }
    // En Django: GET a la vista de cancelación (las reglas las tiene el servidor)
    impactoCancelacion(reservaId) {
      const reserva = buscarReserva(reservaId);
      if (!reserva || reserva.origen === 'fijo') return fallo('No encontramos esa reserva.');
      return {
        ok: true,
        senaSeDevuelve: Boolean(COMPLEJO.cancelacionGratuita),
        senaPagada: reserva.senaPagada,
        sena: reserva.sena,
        puntos: PUNTOS_POR_CANCELAR,
      };
    },

    // El jugador cancela una reserva suya que todavía no empezó. El turno vuelve a quedar libre.
    // En Django: POST a la vista de cancelación
    cancelarReserva(reservaId, telefono) {
      const reservas = reservasGuardadas();
      const reserva = reservas.find((una) => una.id === reservaId);
      if (!reserva) return fallo('No encontramos esa reserva. Puede que ya esté cancelada.');
      if (reserva.telefono !== normalizarTelefono(telefono)) return fallo('Esa reserva no es tuya.');
      if (yaEmpezo(reserva.fecha, reserva.hora)) return fallo('Ese turno ya empezó: no se puede cancelar.');
      guardar(CLAVES.reservas, reservas.filter((una) => una.id !== reservaId));
      const cancelada = Object.assign({}, reserva, { canceladaEn: new Date().toISOString(), puntos: PUNTOS_POR_CANCELAR });
      guardar(CLAVES.canceladas, leer(CLAVES.canceladas, []).concat(cancelada));
      avisar('reserva-cancelada', cancelada);
      return { ok: true, reserva: cancelada };
    },

    // ----- Turnos fijos -----

    turnosFijos() {
      return fijosGuardados()
        .sort((a, b) => a.diaSemana - b.diaSemana || a.hora - b.hora || a.canchaId.localeCompare(b.canchaId));
    },

    // datos = { canchaId, diaSemana (0 = domingo), hora, horas = 1, responsable, telefono? }
    // Rechaza si choca con otro fijo o con una reserva de hoy en adelante.
    // En Django: esto es el POST de la vista de turnos fijos
    crearTurnoFijo(datos = {}) {
      const cancha = buscarCancha(datos.canchaId);
      if (!cancha) return fallo('Esa cancha no existe.');
      const diaSemana = Number(datos.diaSemana);
      if (!Number.isInteger(diaSemana) || diaSemana < 0 || diaSemana > 6) return fallo('El día no es válido.');
      const hora = Number(datos.hora);
      const horas = Number(datos.horas === undefined ? 1 : datos.horas);
      if (!Number.isInteger(hora) || !Number.isInteger(horas) || horas < 1) return fallo('El turno no es válido.');
      if (hora < DESDE || hora + horas > HASTA) {
        return fallo(`Los turnos son de ${Fmt.hora(DESDE)} a ${Fmt.hora(HASTA)}.`);
      }
      const responsable = String(datos.responsable || '').trim();
      if (!responsable) return fallo('Falta el nombre del responsable.');
      let telefono = '';
      if (String(datos.telefono || '').trim()) {
        telefono = normalizarTelefono(datos.telefono);
        if (!telefono) return fallo('El teléfono no es válido.');
      }

      const nuevo = { canchaId: cancha.id, diaSemana, hora, horas };
      const fijos = fijosGuardados();
      const otroFijo = fijos.find((fijo) => fijo.canchaId === cancha.id && fijo.diaSemana === diaSemana && seSuperponen(fijo, nuevo));
      if (otroFijo) {
        return fallo(`Ya hay un turno fijo los ${Fmt.diaSemana(diaSemana)} de ${Fmt.rango(otroFijo.hora, otroFijo.horas)}.`);
      }
      const hoy = ahora().fecha;
      const reserva = reservasGuardadas()
        .filter((una) => una.fecha >= hoy && una.canchaId === cancha.id && diaDeLaSemana(una.fecha) === diaSemana)
        .sort((a, b) => a.fecha.localeCompare(b.fecha))
        .find((una) => seSuperponen(una, nuevo));
      if (reserva) {
        return fallo(`Choca con la reserva de ${reserva.nombre} del ${Fmt.dia(reserva.fecha)} de ${Fmt.rango(reserva.hora, reserva.horas)}.`);
      }

      const turnoFijo = Object.assign({ id: nuevoId('tf') }, nuevo, {
        responsable,
        telefono,
        desde: hoy,
        creadoEn: new Date().toISOString(),
      });
      fijos.push(turnoFijo);
      guardar(CLAVES.fijos, fijos);
      avisar('fijo-nuevo', turnoFijo);
      return { ok: true, turnoFijo };
    },

    borrarTurnoFijo(id) {
      const fijos = fijosGuardados();
      const turnoFijo = fijos.find((fijo) => fijo.id === id);
      if (!turnoFijo) return fallo('No encontramos ese turno fijo.');
      guardar(CLAVES.fijos, fijos.filter((fijo) => fijo.id !== id));
      // Las marcas de asistencia y seña de ese fijo ya no sirven
      const marcas = leer(CLAVES.marcasFijos, {});
      Object.keys(marcas).filter((clave) => clave.startsWith(`fijo-${id}-`)).forEach((clave) => delete marcas[clave]);
      guardar(CLAVES.marcasFijos, marcas);
      avisar('fijo-borrado', turnoFijo);
      return { ok: true, turnoFijo };
    },

    // ----- Sesión. Ámbitos 'jugador' y 'panel', independientes entre sí -----

    // Devuelve el código simulado de 6 dígitos (null si el teléfono no es válido).
    // En Django: acá se manda el código por WhatsApp y no se devuelve nunca
    enviarCodigo(telefono) {
      const numero = normalizarTelefono(telefono);
      if (!numero) return null;
      const codigo = String(100000 + Math.floor(Math.random() * 900000));
      const codigos = leer(CLAVES.codigos, {});
      codigos[numero] = codigo;
      guardar(CLAVES.codigos, codigos);
      return codigo;
    },

    verificarCodigo(telefono, codigo) {
      const numero = normalizarTelefono(telefono);
      const codigos = leer(CLAVES.codigos, {});
      if (!numero || !codigos[numero] || codigos[numero] !== String(codigo || '').trim()) return false;
      delete codigos[numero]; // cada código sirve una sola vez
      guardar(CLAVES.codigos, codigos);
      return true;
    },

    // La sesión queda guardada: si recarga la página, sigue logueado
    login(telefono, nombre, ambito = 'jugador') {
      const numero = normalizarTelefono(telefono);
      if (!numero || !AMBITOS.includes(ambito)) return null;
      const usuario = {
        telefono: numero,
        nombre: String(nombre || '').trim(),
        rol: api.esDuenio(numero) ? 'duenio' : 'jugador',
      };
      guardar(CLAVES.sesion(ambito), usuario);
      return usuario;
    },

    usuarioActual(ambito = 'jugador') {
      if (!AMBITOS.includes(ambito)) return null;
      return leer(CLAVES.sesion(ambito), null);
    },

    logout(ambito = 'jugador') {
      if (AMBITOS.includes(ambito)) borrar(CLAVES.sesion(ambito));
    },

    esDuenio(telefono) {
      return normalizarTelefono(telefono) === COMPLEJO.telefonoDuenio;
    },

    // Agregado al contrato: '+54 9 11 2345-6789' → '1123456789' | null
    normalizarTelefono,

    // ----- Demo -----

    // Borra todo (reservas, fijos y sesiones) y vuelve a los datos iniciales
    reiniciarDemo() {
      try {
        const claves = [];
        for (let i = 0; i < localStorage.length; i++) claves.push(localStorage.key(i));
        claves
          .filter((clave) => clave && clave.startsWith(PREFIJO))
          .forEach((clave) => localStorage.removeItem(clave));
      } catch (error) { /* sin localStorage no hay nada que borrar */ }
      sembrarSiHaceFalta();
      avisar('demo-reiniciada', {});
    },

    // ----- Cambios en vivo -----

    // callback({ tipo, datos }). Avisa en esta pestaña y en otras pestañas o iframes.
    // Devuelve una función para dejar de escuchar.
    alCambiar(callback) {
      oyentes.push(callback);
      return () => {
        const posicion = oyentes.indexOf(callback);
        if (posicion >= 0) oyentes.splice(posicion, 1);
      };
    },
  };

  // ---------- Capa async ----------
  // Envuelve cada método en una Promise con una demora chica, como si viajara al servidor.

  const SIN_ESPERA = ['alCambiar', 'normalizarTelefono'];
  const parametros = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
  const LENTO = parametros.has('lento');
  const FALLAN = (parametros.get('fallar') || '').split(',').map((nombre) => nombre.trim()).filter(Boolean);
  const esperar = () => new Promise((listo) => setTimeout(listo, LENTO ? 1500 : 120 + Math.random() * 180));

  const publica = {};
  Object.keys(api).forEach((nombre) => {
    if (SIN_ESPERA.includes(nombre)) {
      publica[nombre] = api[nombre];
      return;
    }
    publica[nombre] = async (...argumentos) => {
      await esperar();
      if (FALLAN.includes('todo') || FALLAN.includes(nombre)) {
        throw new Error(`Store (demo): falla simulada en ${nombre}`);
      }
      return api[nombre](...argumentos);
    };
  });

  return Object.freeze(publica);
})();
