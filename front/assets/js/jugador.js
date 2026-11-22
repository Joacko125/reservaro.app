// Lógica de la app del jugador (index.html), usada con x-data="jugador()".
// Todo pasa por Store con await: en Django, Store pide a la API y este archivo queda igual.
// Dispara 'cambio-horario' { fecha, hora } y escucha 'cancha-elegida' { canchaId } (del plano).
//
// Patrón de carga (el mismo en cada componente):
//   estado = 'cargando' → se muestra el esqueleto
//   estado = 'listo'    → los datos (y si la lista vino vacía, el mensaje de vacío)
//   estado = 'error'    → un mensaje y el botón "Reintentar"
// Acá hay tres: estado (la página entera), estadoTurnos (la grilla del día) y estadoMisReservas.
// Las recargas por cambios en vivo son "silenciosas": no vuelven a mostrar el esqueleto.

// Mientras carga, el complejo trae valores vacíos para que el HTML no rompa
const COMPLEJO_VACIO = { nombre: '', bajada: '', subdominio: '', direccion: '', logo: '', whatsapp: '', senaPorHora: 0, horario: { desde: 0, hasta: 0 }, pagos: {}, minutosParaSenar: {} };

function jugador() {
  return {
    estado: 'cargando',           // la página: 'cargando' | 'listo' | 'error'
    estadoTurnos: 'cargando',     // la grilla del día elegido
    estadoMisReservas: 'listo',   // la hoja "Mis reservas"
    _pedidoTurnos: 0,             // para descartar respuestas viejas si cambia de día rápido
    complejo: COMPLEJO_VACIO,
    canchas: [],
    horas: [],           // horas de inicio de los turnos: 13..23
    dias: [],            // los días de la ventana de reserva (14), 'AAAA-MM-DD'
    libresPorDia: {},    // { 'AAAA-MM-DD': cantidad de turnos libres }
    fecha: null,
    turnos: [],          // [Turno] del día elegido, de las dos canchas
    filas: [],           // [{ hora, turnos: [Turno de cada cancha] }] para dibujar la grilla
    horaMirada: null,    // la hora que se avisa con 'cambio-horario'
    seleccion: null,     // { canchaId, desde, horas }: turnos seguidos de una misma cancha
    destacada: null,     // canchaId que se tocó en el plano
    cambiando: false,    // para la transición al cambiar de día
    usuario: null,       // sesión del ámbito 'jugador'
    despuesDelLogin: null, // 'resumen' | 'mis-reservas': adónde seguir cuando termine de entrar
    misReservas: [],     // reservas futuras del jugador, listas para mostrar
    paso: null,          // null (grilla) | 'resumen' | 'sena' | 'pago' | 'confirmada' | 'mis-reservas'
    pedido: null,        // foto de la selección al abrir el resumen
    pagando: false,      // mientras se guarda la reserva (con transferencia o con Mercado Pago)
    reserva: null,       // la Reserva que devolvió el Store al reservar
    senaDesde: null,     // de dónde se abrió la pantalla de la seña: 'resumen' | 'mis-reservas'
    copiado: '',         // 'alias' | 'cvu': para mostrar "¡Copiado!" un ratito
    cancelacion: null,   // { item, estado: 'cargando' | 'listo' | 'error', impacto, cancelando, error }
    mensaje: '',
    temporizadorMensaje: null,

    async init() {
      // Los oyentes van antes del primer await, así no se pierde ningún evento mientras carga
      window.addEventListener('cancha-elegida', (evento) => this.alElegirCancha(evento.detail.canchaId));
      window.addEventListener('sesion-iniciada', (evento) => this.alIniciarSesion(evento.detail));

      // Si entra una reserva (en esta pestaña o en otra) la grilla se repinta sola
      Store.alCambiar(async ({ tipo }) => {
        if (this.estado !== 'listo') return;
        // Reiniciar la demo cierra las sesiones
        if (tipo === 'demo-reiniciada') {
          try {
            this.usuario = await Store.usuarioActual('jugador');
          } catch (error) { /* se resuelve en la próxima recarga */ }
        }
        this.actualizar({ silencioso: true });
      });

      await this.cargar();
    },

    // ---------- Datos ----------

    // Carga de la página: complejo, canchas, sesión, días y la grilla del primer día
    async cargar() {
      this.estado = 'cargando';
      try {
        // En Django: complejo, canchas y usuario vienen de la vista del complejo
        const [complejo, canchas, usuario, dias] = await Promise.all([
          Store.complejo(),
          Store.canchas(),
          Store.usuarioActual('jugador'),
          Store.proximosDias(), // la ventana del complejo: complejo().ventanaDias
        ]);
        this.complejo = complejo;
        this.canchas = canchas;
        this.usuario = usuario;
        this.dias = dias;
        document.title = `${complejo.nombre} · Reservá tu cancha`;
        const { desde, hasta } = complejo.horario;
        this.horas = Array.from({ length: hasta - desde }, (_, i) => desde + i);

        this.fecha = this.dias[0];
        await this.actualizar();
        // Si hoy ya no queda ningún turno por jugar, arrancamos mostrando mañana
        if (this.estadoTurnos === 'listo' && !this.turnos.some((turno) => !turno.pasado) && this.dias[1]) {
          this.fecha = this.dias[1];
          await this.actualizar();
        }
        this.horaMirada = this.primeraHoraDisponible();
        this.estado = 'listo';
      } catch (error) {
        console.error('jugador: no se pudo cargar la página', error);
        this.estado = 'error';
        return;
      }

      // El plano llega con include.js: le avisamos el horario cuando ya está escuchando
      const avisarAlPlano = () => setTimeout(() => this.avisarHorario(), 0);
      if (window.componentesListos) avisarAlPlano();
      else window.addEventListener('componentes-listos', avisarAlPlano, { once: true });
      this.$nextTick(() => window.lucide && lucide.createIcons());
    },

    // Turnos del día elegido y libres de cada día de la tira.
    // En Django: conviene una sola vista que devuelva los libres de los 14 días juntos.
    async actualizar({ silencioso = false } = {}) {
      const pedido = ++this._pedidoTurnos;
      if (!silencioso) this.estadoTurnos = 'cargando';
      try {
        const porDia = await Promise.all(this.dias.map((dia) => Store.turnosDelDia(dia)));
        if (pedido !== this._pedidoTurnos) return; // llegó tarde: ya se pidió otro día
        const indice = this.dias.indexOf(this.fecha);
        this.turnos = indice >= 0 ? porDia[indice] : await Store.turnosDelDia(this.fecha);
        this.filas = this.horas.map((hora) => ({
          hora,
          turnos: this.canchas.map((cancha) => this.turno(cancha.id, hora)),
        }));
        this.libresPorDia = Object.fromEntries(this.dias.map((dia, i) => [
          dia,
          porDia[i].filter((turno) => turno.estado === 'libre' && !turno.pasado).length,
        ]));
        this.estadoTurnos = 'listo';
      } catch (error) {
        if (pedido !== this._pedidoTurnos) return;
        console.error('jugador: no se pudieron cargar los turnos', error);
        // En una recarga silenciosa se dejan los datos que ya se veían
        if (!silencioso) this.estadoTurnos = 'error';
        return;
      }
      this.revisarSeleccion();
      await this.cargarMisReservas({ silencioso: true });
    },

    // Botón "Reintentar" de la grilla
    reintentarTurnos() {
      this.actualizar();
    },

    // En Django: esto viene de la vista "Mis reservas"
    async cargarMisReservas({ silencioso = false } = {}) {
      if (!this.usuario) {
        this.misReservas = [];
        this.estadoMisReservas = 'listo';
        return;
      }
      if (!silencioso) this.estadoMisReservas = 'cargando';
      let reservas;
      try {
        reservas = await Store.reservasDeUsuario(this.usuario.telefono);
      } catch (error) {
        console.error('jugador: no se pudieron cargar tus reservas', error);
        if (!silencioso) this.estadoMisReservas = 'error';
        return;
      }
      this.estadoMisReservas = 'listo';
      this.misReservas = reservas.map((reserva) => ({
        reserva,
        cancha: this.nombreCancha(reserva.canchaId),
        etiquetaDia: this.nombreDia(reserva.fecha, this.dias.indexOf(reserva.fecha)),
        numeroDia: this.numeroDia(reserva.fecha),
        dia: Fmt.diaLargo(reserva.fecha),
        rango: Fmt.rango(reserva.hora, reserva.horas),
        sena: reserva.senaPagada ? `Seña ${Fmt.pesos(reserva.sena)} pagada` : `Seña ${Fmt.pesos(reserva.sena)} pendiente`,
        // Se puede cancelar mientras no haya empezado (la regla final la tiene el Store)
        cancelable: !this.yaEmpezo(reserva),
      }));
    },

    yaEmpezo(reserva) {
      const ahora = this.horaArgentina();
      return reserva.fecha < this.dias[0] || (reserva.fecha === this.dias[0] && reserva.hora <= ahora);
    },

    horaArgentina() {
      return Number(new Intl.DateTimeFormat('es-AR', { hour: 'numeric', hourCycle: 'h23', timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())) % 24;
    },

    turno(canchaId, hora) {
      return this.turnos.find((turno) => turno.canchaId === canchaId && turno.hora === hora) || null;
    },

    disponible(turno) {
      return Boolean(turno) && turno.estado === 'libre' && !turno.pasado;
    },

    // Si alguien reservó lo que el jugador tenía elegido, se limpia la selección.
    // Con el resumen o el pago abiertos no: eso lo resuelve pagar()
    revisarSeleccion() {
      const s = this.seleccion;
      if (!s || this.paso) return;
      for (let hora = s.desde; hora < s.desde + s.horas; hora++) {
        if (!this.disponible(this.turno(s.canchaId, hora))) {
          this.seleccion = null;
          this.avisar('Alguien acaba de reservar ese horario. Elegí otro.');
          return;
        }
      }
    },

    primeraHoraDisponible() {
      const libre = this.turnos.find((turno) => this.disponible(turno));
      if (libre) return libre.hora;
      const porJugar = this.turnos.find((turno) => !turno.pasado);
      return porJugar ? porJugar.hora : null;
    },

    // ---------- Días ----------

    async elegirDia(fecha) {
      if (fecha === this.fecha) return;
      this.cambiando = true;
      await new Promise((listo) => setTimeout(listo, 150));
      this.fecha = fecha;
      this.seleccion = null;
      this.cambiando = false;
      await this.actualizar();
      if (this.fecha !== fecha || this.estadoTurnos !== 'listo') return;
      // Se mantiene la hora que estaba mirando, si ese día todavía sirve
      const sigue = this.turnos.some((turno) => turno.hora === this.horaMirada && !turno.pasado);
      if (!sigue) this.horaMirada = this.primeraHoraDisponible();
      this.avisarHorario();
    },

    // 'Hoy', 'Mañana' y después el día de la semana ('Vie')
    nombreDia(fecha, indice) {
      if (indice === 0) return 'Hoy';
      if (indice === 1) return 'Mañana';
      return Fmt.dia(fecha).split(' ')[0];
    },

    numeroDia(fecha) {
      return Fmt.dia(fecha).split(' ')[1];
    },

    textoLibres(fecha) {
      const libres = this.libresPorDia[fecha] || 0;
      if (libres === 0) return 'Completo';
      return libres === 1 ? '1 libre' : `${libres} libres`;
    },

    // ---------- Turnos ----------

    // 'pasado' | 'elegido' | 'libre' | 'reservado' | 'fijo'
    estadoCelda(turno) {
      if (!turno || turno.pasado) return 'pasado';
      if (this.estaElegido(turno)) return 'elegido';
      return turno.estado;
    },

    textoCelda(turno) {
      const textos = { pasado: 'Ya pasó', elegido: 'Elegido', libre: 'Libre', reservado: 'Reservado', fijo: 'Fijo' };
      return textos[this.estadoCelda(turno)];
    },

    estaElegido(turno) {
      const s = this.seleccion;
      return Boolean(s) && turno.canchaId === s.canchaId && turno.hora >= s.desde && turno.hora < s.desde + s.horas;
    },

    // Tocar un libre lo elige. Tocar uno libre pegado a la selección (misma cancha) la estira.
    // Tocar una punta de la selección la achica. Cualquier otro arranca una selección nueva.
    tocar(turno) {
      this.horaMirada = turno.hora;
      this.avisarHorario();

      const estado = this.estadoCelda(turno);
      const cancha = this.nombreCancha(turno.canchaId);
      if (estado === 'pasado') return this.avisar('Ese horario ya pasó.');
      if (estado === 'reservado') return this.avisar(`La ${cancha} ya está reservada a las ${Fmt.hora(turno.hora)}.`);
      if (estado === 'fijo') return this.avisar(`Las ${Fmt.hora(turno.hora)} de la ${cancha} es un turno fijo.`);

      if (this.destacada && this.destacada !== turno.canchaId) this.destacada = turno.canchaId;

      const s = this.seleccion;
      const nueva = { canchaId: turno.canchaId, desde: turno.hora, horas: 1 };
      if (!s || s.canchaId !== turno.canchaId) {
        this.seleccion = nueva;
      } else if (estado === 'elegido') {
        if (s.horas === 1) this.seleccion = null;
        else if (turno.hora === s.desde) this.seleccion = { ...s, desde: s.desde + 1, horas: s.horas - 1 };
        else if (turno.hora === s.desde + s.horas - 1) this.seleccion = { ...s, horas: s.horas - 1 };
        else this.seleccion = nueva;
      } else if (turno.hora === s.desde - 1) {
        this.seleccion = { ...s, desde: s.desde - 1, horas: s.horas + 1 };
      } else if (turno.hora === s.desde + s.horas) {
        this.seleccion = { ...s, horas: s.horas + 1 };
      } else {
        this.seleccion = nueva;
      }
    },

    // ---------- Canchas ----------

    nombreCancha(canchaId) {
      const cancha = this.canchas.find((una) => una.id === canchaId);
      return cancha ? cancha.nombre : canchaId;
    },

    // Columna atenuada cuando se destacó la otra cancha
    atenuada(canchaId) {
      return this.destacada !== null && this.destacada !== canchaId;
    },

    alternarDestacada(canchaId) {
      this.destacada = this.destacada === canchaId ? null : canchaId;
    },

    // El plano avisa la cancha que tocó el jugador: se destaca y, si está libre, se elige ese turno
    alElegirCancha(canchaId) {
      this.destacada = canchaId;
      const turno = this.horaMirada === null ? null : this.turno(canchaId, this.horaMirada);
      if (this.disponible(turno) && !this.estaElegido(turno)) {
        this.seleccion = { canchaId, desde: turno.hora, horas: 1 };
      }
      this.$nextTick(() => {
        const destino = document.getElementById(`turno-${canchaId}-${this.horaMirada}`) || this.$refs.grilla;
        if (destino) destino.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    },

    // ---------- Resumen de la selección ----------
    // En Django: los montos los calcula la vista al armar la reserva

    get resumen() {
      const s = this.seleccion;
      if (!s) return null;
      const cancha = this.canchas.find((una) => una.id === s.canchaId);
      return {
        cancha: cancha.tipo, // corto, para que entre a 360 px
        dia: this.fecha === this.dias[0] ? 'Hoy' : Fmt.dia(this.fecha),
        rango: Fmt.rango(s.desde, s.horas),
        horas: s.horas === 1 ? '1 hora' : `${s.horas} horas`,
        total: Fmt.pesos(cancha.precioHora * s.horas),
        sena: Fmt.pesos(this.complejo.senaPorHora * s.horas),
      };
    },

    // ---------- Sesión ----------

    // "Reservar": con sesión va directo al resumen; sin sesión pide el celular (componente login-telefono)
    reservar() {
      if (!this.seleccion) return;
      if (this.usuario) return this.abrirResumen();
      this.pedirLogin('resumen');
    },

    // El ícono de arriba: con sesión abre "Mis reservas"; sin sesión pide el celular primero
    abrirMisReservas() {
      if (!this.usuario) return this.pedirLogin('mis-reservas');
      this.paso = 'mis-reservas';
      this.cargarMisReservas();
    },

    pedirLogin(despues) {
      this.despuesDelLogin = despues;
      window.dispatchEvent(new CustomEvent('pedir-login', { detail: { ambito: 'jugador' } }));
    },

    alIniciarSesion({ ambito, usuario }) {
      if (ambito !== 'jugador') return;
      this.usuario = usuario;
      this.cargarMisReservas({ silencioso: true });
      if (this.despuesDelLogin === 'resumen' && this.seleccion) this.abrirResumen();
      if (this.despuesDelLogin === 'mis-reservas') this.abrirMisReservas();
      this.despuesDelLogin = null;
    },

    async salir() {
      try {
        // En Django: esto es el POST de logout
        await Store.logout('jugador');
      } catch (error) {
        console.error('jugador: no se pudo cerrar sesión', error);
        this.avisar('No pudimos cerrar sesión. Probá de nuevo.');
        return;
      }
      this.usuario = null;
      this.misReservas = [];
      this.paso = null;
      this.avisar('Cerraste sesión. La próxima vez que reserves te pedimos el celular.');
    },

    get primerNombre() {
      return this.usuario ? this.usuario.nombre.split(' ')[0] : '';
    },

    // ---------- Resumen, pago y confirmación ----------

    // Se guarda una foto de la selección: si la grilla se repinta mientras paga, el pedido no cambia.
    // En Django: los montos los calcula la vista al armar la reserva
    abrirResumen() {
      const s = this.seleccion;
      const cancha = this.canchas.find((una) => una.id === s.canchaId);
      const total = cancha.precioHora * s.horas;
      const sena = this.complejo.senaPorHora * s.horas;
      this.pedido = {
        canchaId: s.canchaId,
        cancha: cancha.nombre,
        fecha: this.fecha,
        dia: Fmt.diaLargo(this.fecha),
        hora: s.desde,
        horas: s.horas,
        rango: Fmt.rango(s.desde, s.horas),
        cantidadHoras: s.horas === 1 ? '1 hora' : `${s.horas} horas`,
        total: Fmt.pesos(total),
        sena: Fmt.pesos(sena),
        senaPorHora: Fmt.pesos(this.complejo.senaPorHora),
        saldo: Fmt.pesos(total - sena),
      };
      this.paso = 'resumen';
    },

    // Con Mercado Pago va a su pantalla. Sin Mercado Pago (la prueba) se guarda el turno y se muestra el alias.
    irAPagar() {
      if (this.complejo.pagos.mercadoPago) {
        this.paso = 'pago';
        return;
      }
      this.reservarConTransferencia();
    },

    cerrarPaso() {
      if (this.pagando) return;
      if (this.paso === 'sena') return this.cerrarSena();
      this.paso = this.paso === 'pago' ? 'resumen' : null;
      // Por si mientras miraba el resumen alguien reservó esos turnos
      if (!this.paso) this.revisarSeleccion();
    },

    // ---------- Seña por transferencia ----------

    // Guarda el turno con la seña pendiente. El dueño la marca como recibida cuando le llega el comprobante.
    async reservarConTransferencia() {
      if (this.pagando) return;
      this.pagando = true;
      const p = this.pedido;
      let resultado;
      try {
        // En Django: esto es el POST de la vista de reservas
        resultado = await Store.reservar({
          canchaId: p.canchaId,
          fecha: p.fecha,
          hora: p.hora,
          horas: p.horas,
          nombre: this.usuario.nombre,
          telefono: this.usuario.telefono,
          origen: 'web',
          medioSena: null,
        });
      } catch (error) {
        console.error('jugador: no se pudo guardar la reserva', error);
        this.pagando = false;
        this.avisar('No pudimos guardar la reserva. Revisá tu conexión y probá de nuevo.', 6000);
        return;
      }
      this.pagando = false;
      if (!resultado.ok) return this.reservaRechazada(resultado);
      this.seleccion = null;
      this.reserva = resultado.reserva;
      this.senaDesde = 'resumen';
      this.paso = 'sena';
      this.cargarMisReservas({ silencioso: true });
    },

    // Desde "Mis reservas", para una reserva con la seña pendiente
    abrirSena(reserva) {
      this.reserva = reserva;
      this.senaDesde = 'mis-reservas';
      this.paso = 'sena';
    },

    // Lo que muestra la pantalla de la seña, armado desde la reserva guardada
    get datosSena() {
      const r = this.reserva;
      if (!r) return null;
      const pagos = this.complejo.pagos || {};
      return {
        cancha: this.nombreCancha(r.canchaId),
        dia: Fmt.diaLargo(r.fecha),
        rango: Fmt.rango(r.hora, r.horas),
        sena: Fmt.pesos(r.sena),
        alias: pagos.alias || '',
        cvu: pagos.cvu || '',
        titular: pagos.titular || this.complejo.nombre,
        minutos: (this.complejo.minutosParaSenar || {}).minimo || 15,
        pagada: r.senaPagada,
      };
    },

    // Abre el WhatsApp del complejo con el mensaje armado: el jugador solo adjunta la foto del comprobante
    get enlaceComprobante() {
      const d = this.datosSena;
      if (!d) return '#';
      const texto = [
        `¡Hola ${this.complejo.nombre}! Te mando el comprobante de la seña.`,
        `${d.cancha} · ${d.dia.charAt(0).toUpperCase() + d.dia.slice(1)} · ${d.rango}`,
        `A nombre de ${this.usuario ? this.usuario.nombre : ''}. Seña: ${d.sena}.`,
      ].join('\n');
      return `https://wa.me/549${this.complejo.whatsapp}?text=${encodeURIComponent(texto)}`;
    },

    // Copia el alias o el CVU. Si el navegador no deja usar el portapapeles, usa el método viejo.
    async copiar(que) {
      const texto = this.datosSena ? this.datosSena[que] : '';
      if (!texto) return;
      try {
        await navigator.clipboard.writeText(texto);
      } catch (error) {
        const campo = document.createElement('textarea');
        campo.value = texto;
        campo.setAttribute('readonly', '');
        campo.style.position = 'fixed';
        campo.style.opacity = '0';
        document.body.append(campo);
        campo.select();
        try { document.execCommand('copy'); } catch (e) { /* no hay forma de copiar */ }
        campo.remove();
      }
      this.copiado = que;
      setTimeout(() => { if (this.copiado === que) this.copiado = ''; }, 2000);
    },

    // "Ya mandé el comprobante": si venía de reservar, la confirmación; si venía de Mis reservas, vuelve ahí
    listoSena() {
      if (this.senaDesde === 'mis-reservas') {
        this.paso = 'mis-reservas';
        this.cargarMisReservas({ silencioso: true });
        return;
      }
      this.paso = 'confirmada';
    },

    // Cerrar sin mandar el comprobante: el turno queda guardado con la seña pendiente
    cerrarSena() {
      if (this.senaDesde === 'mis-reservas') {
        this.paso = 'mis-reservas';
        return;
      }
      this.volverATurnos();
      this.avisar('Tu turno quedó guardado con la seña pendiente. El alias está en "Mis reservas".', 6000);
    },

    // ---------- Cancelar desde Mis reservas ----------

    // Primero se pregunta qué pierde (el Store sabe las reglas) y recién después se confirma
    async pedirCancelacion(item) {
      this.cancelacion = { item, estado: 'cargando', impacto: null, cancelando: false, error: '' };
      try {
        // En Django: GET a la vista de cancelación
        const impacto = await Store.impactoCancelacion(item.reserva.id);
        if (!this.cancelacion) return;
        if (!impacto.ok) {
          this.cancelacion.estado = 'listo';
          this.cancelacion.error = impacto.error;
          return;
        }
        this.cancelacion.impacto = impacto;
        this.cancelacion.estado = 'listo';
      } catch (error) {
        console.error('jugador: no se pudo consultar la cancelación', error);
        if (this.cancelacion) this.cancelacion.estado = 'error';
      }
    },

    reintentarCancelacion() {
      if (this.cancelacion) this.pedirCancelacion(this.cancelacion.item);
    },

    cerrarCancelacion() {
      if (this.cancelacion && this.cancelacion.cancelando) return;
      this.cancelacion = null;
    },

    // Los textos de lo que pierde, según lo que devolvió el Store
    get textosCancelacion() {
      const c = this.cancelacion;
      if (!c || !c.impacto) return null;
      const i = c.impacto;
      let sena;
      if (!i.senaPagada) sena = 'Todavía no pagaste la seña, así que no perdés plata.';
      else if (i.senaSeDevuelve) sena = `Te devolvemos la seña de ${Fmt.pesos(i.sena)}.`;
      else sena = `No se devuelve la seña de ${Fmt.pesos(i.sena)}.`;
      return {
        sena,
        senaPierde: i.senaPagada && !i.senaSeDevuelve,
        puntos: `Esta cancelación te baja ${i.puntos} puntos.`,
      };
    },

    async confirmarCancelacion() {
      const c = this.cancelacion;
      if (!c || c.cancelando) return;
      c.cancelando = true;
      c.error = '';
      let resultado;
      try {
        // En Django: POST a la vista de cancelación
        resultado = await Store.cancelarReserva(c.item.reserva.id, this.usuario.telefono);
      } catch (error) {
        console.error('jugador: no se pudo cancelar', error);
        c.cancelando = false;
        c.error = 'No pudimos cancelar. Revisá tu conexión y probá de nuevo.';
        return;
      }
      c.cancelando = false;
      if (!resultado.ok) {
        c.error = resultado.error;
        return;
      }
      this.cancelacion = null;
      await this.cargarMisReservas({ silencioso: true });
      this.actualizar({ silencioso: true });
      this.avisar(`Listo, cancelaste el turno del ${c.item.dia} (${c.item.rango}).`, 5000);
    },

    // Mercado Pago simulado: un spinner de 2 segundos y después se guarda la reserva con la seña pagada
    async pagar() {
      if (this.pagando) return;
      this.pagando = true;
      await new Promise((listo) => setTimeout(listo, 2000));
      const p = this.pedido;
      let resultado;
      try {
        // En Django: esto es el POST de la vista de reservas, cuando Mercado Pago confirma el pago
        resultado = await Store.reservar({
          canchaId: p.canchaId,
          fecha: p.fecha,
          hora: p.hora,
          horas: p.horas,
          nombre: this.usuario.nombre,
          telefono: this.usuario.telefono,
          origen: 'web',
          medioSena: 'mercadopago',
        });
      } catch (error) {
        // Falló la conexión: no sabemos si se guardó. Se queda en el pago para que pruebe de nuevo.
        console.error('jugador: no se pudo guardar la reserva', error);
        this.pagando = false;
        this.avisar('No pudimos confirmar la reserva. Revisá tu conexión y probá de nuevo.', 6000);
        return;
      }
      this.pagando = false;
      if (!resultado.ok) return this.reservaRechazada(resultado);
      this.seleccion = null;
      this.reserva = resultado.reserva;
      this.paso = 'confirmada';
    },

    // El Store no dejó guardar: casi siempre es que otro se llevó el turno mientras tanto
    reservaRechazada(resultado) {
      this.seleccion = null;
      this.paso = null;
      this.actualizar();
      const ocupado = /ocupado/i.test(resultado.error || '');
      this.avisar(ocupado
        ? '¡Uy! Alguien reservó ese horario recién. Tranqui, no se te cobró nada: elegí otro turno.'
        : (resultado.error || 'No pudimos guardar la reserva. Probá de nuevo.'), 6000);
      this.$nextTick(() => this.$refs.grilla.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    },

    volverATurnos() {
      this.paso = null;
      this.pedido = null;
      this.reserva = null;
      this.$nextTick(() => this.$refs.grilla.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    },

    // Archivo .ics generado en el navegador. Argentina es UTC-3 todo el año (sin horario de verano)
    descargarCalendario(r) {
      if (!r) return;
      const cancha = this.canchas.find((una) => una.id === r.canchaId);
      const sena = Fmt.pesos(r.sena);
      const saldo = Fmt.pesos(cancha.precioHora * r.horas - (r.senaPagada ? r.sena : 0));
      const [anio, mes, dia] = r.fecha.split('-').map(Number);
      const enUtc = (hora) => new Date(Date.UTC(anio, mes - 1, dia, hora + 3)).toISOString().replace(/[-:]|\.\d{3}/g, '');
      const texto = (valor) => String(valor).replace(/\\/g, '\\\\').replace(/([,;])/g, '\\$1').replace(/\n/g, '\\n');
      const lineas = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Reservando//Demo//ES',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        `UID:${r.id}@reservando.com`,
        `DTSTAMP:${new Date().toISOString().replace(/[-:]|\.\d{3}/g, '')}`,
        `DTSTART:${enUtc(r.hora)}`,
        `DTEND:${enUtc(r.hora + r.horas)}`,
        `SUMMARY:${texto(`Fútbol en ${this.complejo.nombre} · ${cancha.nombre}`)}`,
        `LOCATION:${texto(this.complejo.direccion)}`,
        `DESCRIPTION:${texto(`${r.senaPagada ? `Seña pagada: ${sena}` : `Seña pendiente: ${sena}`}. A pagar en el complejo: ${saldo}.\nSin cancelación gratuita.`)}`,
        'BEGIN:VALARM',
        'TRIGGER:-PT2H',
        'ACTION:DISPLAY',
        `DESCRIPTION:${texto(`Hoy jugás en ${this.complejo.nombre}`)}`,
        'END:VALARM',
        'END:VEVENT',
        'END:VCALENDAR',
      ];
      const archivo = new Blob([lineas.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
      const enlace = document.createElement('a');
      enlace.href = URL.createObjectURL(archivo);
      enlace.download = `turno-${this.complejo.id}-${r.fecha}.ics`;
      document.body.append(enlace);
      enlace.click();
      enlace.remove();
      setTimeout(() => URL.revokeObjectURL(enlace.href), 1000);
    },

    get enlaceCompartir() {
      const p = this.pedido;
      if (!p) return '#';
      const dia = p.dia.charAt(0).toUpperCase() + p.dia.slice(1);
      const texto = [
        `⚽ ¡Tenemos cancha en ${this.complejo.nombre}!`,
        `${p.cancha} · ${dia}`,
        `⏰ ${p.rango}`,
        `📍 ${this.complejo.direccion}`,
        '',
        `Reservado con ${this.complejo.subdominio}`,
      ].join('\n');
      return `https://wa.me/?text=${encodeURIComponent(texto)}`;
    },

    // ---------- Encabezado ----------

    get enlaceWhatsapp() {
      const texto = `¡Hola ${this.complejo.nombre}! Quería consultar por un turno.`;
      return `https://wa.me/549${this.complejo.whatsapp}?text=${encodeURIComponent(texto)}`;
    },

    // ---------- Avisos ----------

    avisarHorario() {
      if (this.horaMirada === null) return;
      window.dispatchEvent(new CustomEvent('cambio-horario', { detail: { fecha: this.fecha, hora: this.horaMirada } }));
    },

    avisar(texto, duracion = 3200) {
      this.mensaje = texto;
      clearTimeout(this.temporizadorMensaje);
      this.temporizadorMensaje = setTimeout(() => { this.mensaje = ''; }, duracion);
    },
  };
}
