/* Panel del dueño del complejo.
   Lógica de panel/index.html, usada con x-data="panel()".
   Todo pasa por Store: en Django, Store se reemplaza por vistas y este archivo queda igual.

   Patrón de carga (el mismo que la app del jugador, ver jugador.js):
     estado       → la página entera: 'cargando' (esqueleto) | 'listo' | 'error' (Reintentar)
     estadoAgenda → la agenda y los fijos: se vuelve a 'cargando' al cambiar de día.
   Las recargas por cambios en vivo, el reloj y las acciones son silenciosas: no muestran el esqueleto
   y, si fallan, dejan lo que ya se veía. */

const PANEL_MAX_HORAS_MANUAL = 4;

const PANEL_DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const PANEL_DIAS_PLURAL = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'];
// Orden de la semana para mostrar: de lunes a domingo.
const PANEL_SEMANA = [1, 2, 3, 4, 5, 6, 0];

const PANEL_ORIGENES = {
  web: { icono: 'smartphone', texto: 'Web' },
  manual: { icono: 'pencil-line', texto: 'Manual' },
  fijo: { icono: 'repeat', texto: 'Fijo' },
};

function panel() {
  return {
    estado: 'cargando',        // la página: 'cargando' | 'listo' | 'error'
    estadoAgenda: 'cargando',  // la agenda del día elegido y los fijos
    usuario: null,
    complejo: {},
    canchas: [],
    horas: [],
    semana: PANEL_SEMANA,
    nombresDias: PANEL_DIAS,
    vista: 'agenda',
    fijos: [],
    formFijo: null,
    detalle: null,
    borrando: null,
    _timerBorrar: null,
    menu: false,
    config: false,
    confirmarReinicio: false,
    hoy: '',
    fecha: '',
    dias: [],
    columnas: [],
    resumen: { reservados: 0, total: 0, ocupacion: 0, libres: 0, porDelante: 0, senas: 0, senasMP: 0, senasTransferencia: 0, senasEfectivo: 0, pendientes: 0 },
    horaActual: 0,
    resaltada: null,
    resaltadaHoy: false,
    aviso: null,
    form: null,
    formPromo: null,     // { cancha, fecha, hora, precio, precioNormal, promoId, error, guardando }
    senas: null,         // hoja de señas pendientes: { estado, lista, liberando: id | null }
    pendientes: [],      // señas pendientes de todos los días (para el contador del resumen)
    ahoraMs: Date.now(), // para "hace 12 min": se actualiza cada minuto
    calendario: null,    // { mes: 'AAAA-MM', promos: { 'AAAA-MM-DD': true } }
    cancelaFijo: null,
    // Clientes y puntaje
    clientes: [],
    estadoClientes: 'cargando', // 'cargando' | 'listo' | 'error'
    alertas: [],                // se cargan con la agenda (para el número de la pestaña)
    ficha: null,                // { estado, datos } de un cliente
    bajaFijo: null,             // id del fijo que espera el segundo toque para darse de baja   // { reservaId, modo: null | 'elegir', cuando: 'AAAA-MM-DDTHH:MM', error, guardando }
    logoOk: false,
    toque: null,
    _timerAviso: null,
    _timerResaltada: null,
    _audio: null,
    _titulo: document.title,

    async init() {
      // Los oyentes van antes del primer await, así no se pierde ningún evento mientras carga.
      // En modo API, alCambiar consulta al servidor cada 10 segundos (store-api.js).
      Store.alCambiar((cambio) => {
        if (this.estado === 'listo') this.alCambiarDatos(cambio);
      });

      // El componente login-telefono avisa cuando el dueño terminó de entrar.
      window.addEventListener('sesion-iniciada', async (e) => {
        if (e.detail.ambito !== 'panel') return;
        this.usuario = e.detail.usuario || this.usuario;
        try {
          this.usuario = await Store.usuarioActual('panel');
        } catch (error) { /* nos quedamos con el usuario que mandó el login */ }
        this.recargar();
      });

      // El navegador solo deja sonar audio después de que el usuario tocó la página.
      window.addEventListener('pointerdown', () => this.prepararSonido(), { once: true });
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) document.title = this._titulo;
      });

      // Cada minuto actualiza "ahora" y, a la medianoche, pasa al día nuevo.
      setInterval(async () => {
        if (this.estado !== 'listo') return;
        try {
          const hoy = await Store.hoy();
          if (hoy !== this.hoy) {
            if (this.fecha === this.hoy) this.fecha = hoy;
            this.hoy = hoy;
          }
        } catch (error) { /* se prueba en el próximo minuto */ }
        this.horaActual = horaArgentina();
        this.recargar({ silencioso: true });
      }, 60000);

      await this.cargar();
    },

    // Carga de la página: complejo, canchas, sesión y la agenda de hoy.
    // En Django: complejo, canchas y usuario vienen de la vista del complejo y de la sesión.
    async cargar() {
      this.estado = 'cargando';
      try {
        const [complejo, canchas, usuario, hoy] = await Promise.all([
          Store.complejo(), Store.canchas(), Store.usuarioActual('panel'), Store.hoy(),
        ]);
        this.complejo = complejo || {};
        this.canchas = canchas;
        if (this.complejo.nombre) document.title = `Panel · ${this.complejo.nombre}`;
        this._titulo = document.title;
        // Horas de inicio de los turnos: de 13 a 23 (el último termina a las 00)
        const horario = this.complejo.horario || { desde: 13, hasta: 24 };
        this.horas = Array.from({ length: horario.hasta - horario.desde }, (_, i) => horario.desde + i);
        this.logoOk = Boolean(this.complejo.logo);
        this.usuario = usuario;
        this.hoy = hoy;
        if (!this.fecha) this.fecha = this.hoy;
        this.horaActual = horaArgentina();
      } catch (error) {
        console.error('panel: no se pudo cargar la página', error);
        this.estado = 'error';
        this.iconos();
        return;
      }
      this.estado = 'listo';
      // Sin sesión no se pide la agenda: primero tiene que entrar (y la pide al iniciar sesión)
      if (this.usuario) await this.recargar();
      this.iconos();
    },

    // --- Sesión ---

    async salir() {
      try {
        await Store.logout('panel');
      } catch (error) {
        return this.avisarError('No se pudo cerrar la sesión');
      }
      this.usuario = null;
      this.cerrarModales();
      this.iconos();
      // Vuelve a mostrar el ingreso con teléfono
      window.dispatchEvent(new CustomEvent('pedir-login', { detail: { ambito: 'panel' } }));
    },

    cerrarModales() {
      this.form = null;
      this.formFijo = null;
      this.formPromo = null;
      this.senas = null;
      this.calendario = null;
      this.cancelaFijo = null;
      this.ficha = null;
      this.detalle = null;
      this.menu = false;
      this.config = false;
      this.confirmarReinicio = false;
    },

    get hayModal() {
      return Boolean(this.form || this.formFijo || this.formPromo || this.senas || this.calendario || this.ficha || this.detalle || this.config || this.confirmarReinicio);
    },

    // --- Menú ---

    abrirConfig() {
      this.menu = false;
      this.config = true;
      this.iconos();
    },

    irALoQueViene() {
      this.menu = false;
      const seccion = document.getElementById('lo-que-viene');
      if (seccion) seccion.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },

    pedirReinicio() {
      this.menu = false;
      this.confirmarReinicio = true;
      this.iconos();
    },

    // Vuelve a los datos de ejemplo. Si el reinicio cierra la sesión, el dueño vuelve a entrar
    // solo, así la presentación no se corta.
    async reiniciarDemo() {
      const usuario = this.usuario;
      try {
        await Store.reiniciarDemo();
        if (usuario && !(await Store.usuarioActual('panel'))) {
          this.usuario = await Store.login(usuario.telefono, usuario.nombre, 'panel');
        }
      } catch (error) {
        this.cerrarModales();
        return this.avisarError('No se pudo reiniciar la demo');
      }
      this.cerrarModales();
      this.vista = 'agenda';
      this.fecha = this.hoy;
      await this.recargar();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      this.mostrarAviso({ tipo: 'ok', titulo: 'Demo reiniciada', texto: 'Volvieron las reservas de ejemplo y los turnos fijos quedaron vacíos.' });
    },

    // --- Configuración (solo vista) ---
    // En Django: estos valores vienen del modelo del complejo y se podrán editar.

    get horarioTexto() {
      return Fmt.hora(this.horas[0]) + ' a ' + Fmt.hora(this.horas[this.horas.length - 1] + 1);
    },

    get duracionTexto() {
      const horas = this.complejo.duracionTurno || 1;
      return horas === 1 ? '1 hora' : horas + ' horas';
    },

    get senaPorHora() {
      return this.complejo.senaPorHora || 0;
    },

    get comisionDelComplejo() {
      return this.complejo.comisionMercadoPago === 'complejo';
    },

    // Alto de cada fila de la agenda, una por hora
    get filasAgenda() {
      return 'grid-template-rows: repeat(' + this.horas.length + ', 5.75rem)';
    },

    // --- Datos ---

    // Pide todo junto y recién después dibuja. Si llega tarde (cambiaron de día), se descarta.
    // silencioso: no muestra el esqueleto y, si falla, deja lo que ya se veía.
    async recargar({ silencioso = false } = {}) {
      const pedido = (this._pedido = (this._pedido || 0) + 1);
      const fecha = this.fecha;
      if (!silencioso) this.estadoAgenda = 'cargando';
      let datos;
      try {
        datos = await Promise.all([
          Store.proximosDias(14),
          Store.turnosDelDia(fecha),
          Store.reservasDelDia(fecha),
          Store.turnosDelDia(this.hoy),
          Store.reservasDelDia(this.hoy),
          // En Django: esto viene de la vista de turnos fijos del panel.
          Store.turnosFijos(),
          // En Django: esto viene de la vista de señas pendientes del panel.
          Store.senasPendientes(),
          // En Django: esto viene de la vista de alertas del panel.
          Store.alertas(),
        ]);
      } catch (error) {
        if (pedido !== this._pedido) return;
        console.error('panel: no se pudo cargar la agenda', error);
        if (!silencioso) this.estadoAgenda = 'error';
        this.iconos();
        return;
      }
      if (pedido !== this._pedido) return;
      const [dias, delDia, reservasDelDia, deHoy, reservasDeHoy, fijos, pendientes, alertas] = datos;
      this.alertas = alertas;
      if (this.vista === 'clientes') this.cargarClientes({ silencioso: true });
      if (this.ficha && this.ficha.estado === 'listo') this.verFicha(this.ficha.datos.telefono, { silencioso: true });
      this.pendientes = pendientes;
      this.ahoraMs = Date.now();
      if (this.senas && this.senas.estado === 'listo') this.senas.lista = pendientes;
      this.estadoAgenda = 'listo';
      this.dias = dias;
      this.columnas = this.canchas.map((cancha) => this.armarColumna(cancha, delDia, reservasDelDia));
      this.resumen = this.calcularResumen(deHoy, reservasDeHoy);
      this.fijos = fijos;
      this.refrescarDetalle();
      this.iconos();
    },

    // Bloques de una cancha para el día elegido: una reserva de varias horas es un solo bloque.
    // En Django: los turnos y las reservas vienen de la vista de agenda del panel.
    armarColumna(cancha, turnosDelDia, reservasDelDia) {
      const turnos = turnosDelDia.filter((t) => t.canchaId === cancha.id);
      const reservas = reservasDelDia.filter((r) => r.canchaId === cancha.id);
      const ultima = this.horas[this.horas.length - 1];
      const bloques = [];

      for (let h = this.horas[0]; h <= ultima; ) {
        const r = reservas.find((x) => x.hora === h);
        if (r) {
          const horas = Math.max(1, Math.min(r.horas || 1, ultima + 1 - h));
          bloques.push({
            key: [cancha.id, h, r.id, r.senaPagada, r.medioSena, r.asistencia].join('-'),
            tipo: r.origen === 'fijo' ? 'fijo' : 'reserva',
            hora: h,
            horas,
            reserva: r,
            sena: estadoSena(r),
            origen: PANEL_ORIGENES[r.origen] || PANEL_ORIGENES.web,
            pasado: this.esPasado(h + horas),
          });
          h += horas;
        } else {
          const turno = turnos.find((t) => t.hora === h) || {};
          const promo = turno.promo && turno.promo.tipo === 'turno' ? turno.promo : null;
          bloques.push({
            key: [cancha.id, h, 'libre', promo ? promo.id + turno.precio : ''].join('-'),
            tipo: 'libre',
            hora: h,
            horas: 1,
            precio: turno.precio || cancha.precioHora,
            precioNormal: turno.precioNormal || cancha.precioHora,
            promo, // promo del dueño en este turno (la de horario no se marca: es de todas las semanas)
            pasado: this.esPasado(h + 1),
          });
          h += 1;
        }
      }

      return {
        cancha,
        bloques,
        total: turnos.length,
        ocupados: turnos.filter((t) => t.estado !== 'libre').length,
      };
    },

    // El resumen es siempre de hoy, aunque la agenda muestre otro día.
    calcularResumen(turnos, reservasDeHoy) {
      const libres = turnos.filter((t) => t.estado === 'libre');
      const reservados = turnos.length - libres.length;
      const pagadas = reservasDeHoy.filter((r) => r.senaPagada);
      const suma = (lista) => lista.reduce((total, r) => total + (r.sena || 0), 0);

      return {
        reservados,
        total: turnos.length,
        ocupacion: turnos.length ? Math.round((reservados * 100) / turnos.length) : 0,
        libres: libres.length,
        porDelante: libres.filter((t) => t.hora >= this.horaActual).length,
        senas: suma(pagadas),
        senasMP: suma(pagadas.filter((r) => r.medioSena === 'mercadopago')),
        senasTransferencia: suma(pagadas.filter((r) => r.medioSena === 'transferencia')),
        senasEfectivo: suma(pagadas.filter((r) => r.medioSena === 'efectivo')),
        // Reservas de la web que todavía esperan el comprobante de la seña
        pendientes: reservasDeHoy.filter((r) => !r.senaPagada && r.origen === 'web').length,
      };
    },

    // ¿Hay alguna reserva (o fijo) en el día que se está mirando?
    get diaSinReservas() {
      return this.columnas.every((col) => col.bloques.every((b) => b.tipo === 'libre'));
    },

    // --- En vivo ---

    async alCambiarDatos({ tipo, datos }) {
      if (tipo === 'demo-reiniciada') {
        // Aunque se reinicie desde otra pestaña, el dueño sigue adentro del panel.
        const antes = this.usuario;
        this.usuario = await Store.usuarioActual('panel');
        if (antes && !this.usuario) this.usuario = await Store.login(antes.telefono, antes.nombre, 'panel');
        this.cerrarModales();
        this.fecha = this.hoy;
      }

      const reserva = tipo === 'reserva-nueva' ? (datos && (datos.reserva || datos)) || {} : null;
      const deJugador = reserva && reserva.origen !== 'manual' && this.usuario;

      // Si la reserva del jugador es de otro día, la agenda salta a ese día para que se vea.
      if (deJugador) this.vista = 'agenda';
      const saltaDeDia = deJugador && reserva.fecha && reserva.fecha !== this.fecha;
      if (saltaDeDia) this.fecha = reserva.fecha;
      await this.recargar({ silencioso: !saltaDeDia });

      if (reserva && this.usuario) this.resaltar(reserva);
      if (deJugador) this.anunciar(reserva);
      if (tipo === 'reserva-cancelada' && datos && this.usuario) this.avisarCancelacion(datos);
    },

    // ¿Se puede poner en promo? Solo si el turno no empezó todavía.
    sePuedePromocionar(r) {
      return r.fecha > this.hoy || (r.fecha === this.hoy && r.hora > this.horaActual);
    },

    // Un jugador canceló desde "Mis reservas": el turno ya quedó libre en la agenda.
    avisarCancelacion(r) {
      const cancha = this.canchas.find((c) => c.id === r.canchaId) || {};
      const nombre = (r.nombre || 'Un jugador').trim().split(' ')[0];
      const cuando = r.fecha === this.hoy ? 'Hoy' : Fmt.dia(r.fecha);
      this.mostrarAviso({
        tipo: 'cancelada',
        titulo: nombre + ' canceló — ' + (cancha.tipo || cancha.nombre || '') + ', ' + r.hora + ' hs',
        texto: cuando + ' · ' + Fmt.rango(r.hora, r.horas || 1) + ' · el turno quedó libre',
        // El pedido del dueño: ofrecer ponerlo en promo con el precio para editar
        accion: this.sePuedePromocionar(r)
          ? { texto: '¿Lo ponés en promo?', hacer: () => this.abrirPromo(cancha, r.fecha, r.hora) }
          : null,
        duracion: 15000,
      });
      this.sonar();
    },

    // ---------- Promos ----------

    // Precio que se propone: el de promo de la cancha (datos.js) o un 15 % menos, redondeado a mil
    precioSugerido(cancha) {
      if (cancha.precioPromo && cancha.precioPromo < cancha.precioHora) return cancha.precioPromo;
      return Math.round((cancha.precioHora * 0.85) / 1000) * 1000;
    },

    // Abre la hoja de la promo. Si el turno ya está en promo, la abre para cambiar el precio o quitarla.
    abrirPromo(cancha, fecha, hora, promo = null, precioActual = null) {
      this.aviso = null;
      this.form = null;
      this.formPromo = {
        cancha,
        fecha,
        hora,
        precio: String(promo && precioActual ? precioActual : this.precioSugerido(cancha)),
        precioNormal: cancha.precioHora,
        promoId: promo ? promo.id : null,
        error: '',
        guardando: false,
      };
      this.iconos();
      this.$nextTick(() => this.$refs.precioPromo && this.$refs.precioPromo.select());
    },

    // Desde un hueco libre de la agenda (botón en la hoja de reserva manual)
    abrirPromoDesdeManual() {
      const f = this.form;
      const bloque = this.columnas.find((c) => c.cancha.id === f.cancha.id).bloques.find((b) => b.hora === f.hora) || {};
      this.abrirPromo(f.cancha, f.fecha, f.hora, bloque.promo, bloque.precio);
    },

    get descuentoPromo() {
      const f = this.formPromo;
      const precio = Number(String(f ? f.precio : '').replace(/\D/g, ''));
      if (!f || !precio || precio >= f.precioNormal) return '';
      return Math.round((1 - precio / f.precioNormal) * 100) + ' % menos';
    },

    async guardarPromo() {
      const f = this.formPromo;
      if (!f || f.guardando) return;
      const precio = Number(String(f.precio).replace(/\D/g, ''));
      f.guardando = true;
      f.error = '';
      let resultado;
      try {
        // En Django: POST a la vista de promos del panel
        resultado = await Store.ponerEnPromo({ canchaId: f.cancha.id, fecha: f.fecha, hora: f.hora, precio });
      } catch (error) {
        f.guardando = false;
        f.error = 'No se pudo guardar: revisá la conexión y probá de nuevo.';
        return;
      }
      f.guardando = false;
      if (!resultado.ok) {
        f.error = resultado.error;
        return;
      }
      this.formPromo = null;
      if (f.fecha !== this.fecha) this.fecha = f.fecha;
      await this.recargar({ silencioso: true });
      this.mostrarAviso({
        tipo: 'ok',
        titulo: f.promoId ? 'Precio de la promo cambiado' : 'Turno en promo',
        texto: (f.cancha.tipo || f.cancha.nombre) + ' · ' + Fmt.dia(f.fecha) + ' ' + Fmt.rango(f.hora) + ' · ' + Fmt.pesos(precio) + ' · ya brilla en la app',
      });
    },

    async quitarPromo() {
      const f = this.formPromo;
      if (!f || !f.promoId || f.guardando) return;
      f.guardando = true;
      try {
        // En Django: DELETE a la vista de promos del panel
        await Store.quitarPromo(f.promoId);
      } catch (error) {
        f.guardando = false;
        f.error = 'No se pudo quitar: revisá la conexión y probá de nuevo.';
        return;
      }
      this.formPromo = null;
      await this.recargar({ silencioso: true });
      this.mostrarAviso({ tipo: 'ok', titulo: 'Promo quitada', texto: (f.cancha.tipo || f.cancha.nombre) + ' · ' + Fmt.dia(f.fecha) + ' ' + Fmt.rango(f.hora) });
    },

    // ---------- Señas pendientes ----------

    async abrirSenas() {
      this.senas = { estado: 'cargando', lista: [], liberando: null };
      this.iconos();
      try {
        const lista = await Store.senasPendientes();
        if (!this.senas) return;
        this.senas.lista = lista;
        this.senas.estado = 'listo';
        this.pendientes = lista;
        this.ahoraMs = Date.now();
      } catch (error) {
        if (this.senas) this.senas.estado = 'error';
      }
      this.iconos();
    },

    // Minutos desde que se hizo la reserva y en qué color mostrarlo
    // ok: todavía en tiempo · aviso: pasó el mínimo · vencida: pasó el máximo (se puede liberar)
    esperaSena(r) {
      const minutos = Math.max(0, Math.floor((this.ahoraMs - Date.parse(r.creadaEn)) / 60000));
      const limites = this.complejo.minutosParaSenar || { minimo: 15, maximo: 30 };
      let texto;
      if (minutos < 1) texto = 'recién';
      else if (minutos < 60) texto = 'hace ' + minutos + ' min';
      else if (minutos < 60 * 24) texto = 'hace ' + Math.floor(minutos / 60) + ' h ' + (minutos % 60 ? (minutos % 60) + ' min' : '');
      else texto = 'hace ' + Math.floor(minutos / (60 * 24)) + ' días';
      const nivel = minutos >= limites.maximo ? 'vencida' : minutos >= limites.minimo ? 'aviso' : 'ok';
      return { texto: texto.trim(), nivel };
    },

    textoTurno(r) {
      const cancha = this.canchas.find((c) => c.id === r.canchaId) || {};
      const cuando = r.fecha === this.hoy ? 'Hoy' : Fmt.dia(r.fecha);
      return (cancha.tipo || cancha.nombre || '') + ' · ' + cuando + ' · ' + Fmt.rango(r.hora, r.horas || 1);
    },

    async senaRecibidaDesdeLista(r, medio) {
      let resultado;
      try {
        resultado = await Store.marcarSenaRecibida(r.id, medio);
      } catch (error) {
        return this.avisarError('No se pudo registrar la seña');
      }
      if (!resultado.ok) return this.mostrarAviso({ tipo: 'error', titulo: 'No se registró la seña', texto: resultado.error });
      await this.recargar({ silencioso: true });
      this.mostrarAviso({
        tipo: 'ok',
        titulo: medio === 'transferencia' ? 'Seña recibida por transferencia' : 'Seña cobrada en efectivo',
        texto: r.nombre + ' · ' + Fmt.pesos(r.sena),
      });
    },

    // Primer toque: pide confirmar. Segundo toque: libera.
    async liberar(r) {
      if (this.senas.liberando !== r.id) {
        this.senas.liberando = r.id;
        return;
      }
      let resultado;
      try {
        // En Django: POST a la vista que libera la reserva
        resultado = await Store.liberarReserva(r.id);
      } catch (error) {
        this.senas.liberando = null;
        return this.avisarError('No se pudo liberar el turno');
      }
      this.senas.liberando = null;
      if (!resultado.ok) return this.mostrarAviso({ tipo: 'error', titulo: 'No se liberó', texto: resultado.error });
      await this.recargar({ silencioso: true });
      const cancha = this.canchas.find((c) => c.id === r.canchaId) || {};
      this.mostrarAviso({
        tipo: 'cancelada',
        titulo: 'Liberaste el turno de ' + (r.nombre || '').trim().split(' ')[0],
        texto: this.textoTurno(r) + ' · ya está libre en la app',
        accion: this.sePuedePromocionar(r)
          ? { texto: '¿Lo ponés en promo?', hacer: () => { this.senas = null; this.abrirPromo(cancha, r.fecha, r.hora); } }
          : null,
        duracion: 15000,
      });
    },

    // Una acción no se pudo hacer (sin conexión o el servidor falló)
    avisarError(titulo) {
      this.mostrarAviso({ tipo: 'error', titulo, texto: 'Revisá la conexión y probá de nuevo.' });
    },

    resaltar(reserva) {
      clearTimeout(this._timerResaltada);
      this.resaltada = reserva.id;
      this.resaltadaHoy = reserva.fecha === this.hoy;
      this._timerResaltada = setTimeout(() => {
        this.resaltada = null;
        this.resaltadaHoy = false;
      }, 8000);
    },

    // El momento fuerte de la demo: aviso, destello, sonido y la agenda va hasta el turno.
    anunciar(r) {
      const cancha = this.canchas.find((c) => c.id === r.canchaId) || {};
      const nombre = (r.nombre || 'un jugador').trim().split(' ')[0];
      const cuando = r.fecha === this.hoy ? 'Hoy' : Fmt.dia(r.fecha);
      const sena = r.senaPagada ? 'seña ' + Fmt.pesos(r.sena) + ' pagada' : 'seña pendiente';

      this.mostrarAviso({
        tipo: 'nueva',
        titulo: 'Nueva reserva de ' + nombre + ' — ' + (cancha.tipo || cancha.nombre || '') + ', ' + r.hora + ' hs',
        texto: cuando + ' · ' + Fmt.rango(r.hora, r.horas || 1) + ' · ' + sena,
      });
      this.sonar();
      if (navigator.vibrate) navigator.vibrate([80, 60, 80]);
      if (document.hidden) document.title = '● Nueva reserva · ' + this._titulo;

      this.$nextTick(() => {
        const bloque = document.querySelector('[data-reserva="' + r.id + '"]');
        if (bloque) bloque.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
    },

    // aviso = { tipo, titulo, texto, accion?: { texto, hacer }, duracion? (ms, 6500 por defecto) }
    mostrarAviso(aviso) {
      clearTimeout(this._timerAviso);
      this.aviso = Object.assign({ id: Date.now(), duracion: 6500 }, aviso);
      this.iconos();
      this._timerAviso = setTimeout(() => (this.aviso = null), this.aviso.duracion);
    },

    hacerAccionAviso() {
      const accion = this.aviso && this.aviso.accion;
      this.aviso = null;
      if (accion) accion.hacer();
    },

    prepararSonido() {
      try {
        this._audio = this._audio || new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        this._audio = null;
      }
    },

    // Dos notas cortas, tipo notificación.
    sonar() {
      const ctx = this._audio;
      if (!ctx) return;
      try {
        if (ctx.state === 'suspended') ctx.resume();
        [880, 1318.5].forEach((frecuencia, i) => {
          const osc = ctx.createOscillator();
          const vol = ctx.createGain();
          const inicio = ctx.currentTime + i * 0.13;
          osc.type = 'sine';
          osc.frequency.value = frecuencia;
          vol.gain.setValueAtTime(0.0001, inicio);
          vol.gain.exponentialRampToValueAtTime(0.18, inicio + 0.02);
          vol.gain.exponentialRampToValueAtTime(0.0001, inicio + 0.35);
          osc.connect(vol).connect(ctx.destination);
          osc.start(inicio);
          osc.stop(inicio + 0.4);
        });
      } catch (e) { /* sin sonido no pasa nada */ }
    },

    // --- Reserva manual ---

    // Se abre al tocar un hueco libre. Deja elegir cuántas horas seguidas, hasta el próximo turno ocupado.
    abrirManual(col, indice) {
      const bloque = col.bloques[indice];
      if (bloque.pasado) return;

      let seguidas = 0;
      for (const b of col.bloques.slice(indice)) {
        if (b.tipo !== 'libre') break;
        seguidas += 1;
      }

      this.form = {
        cancha: col.cancha,
        fecha: this.fecha,
        hora: bloque.hora,
        horas: 1,
        maxHoras: Math.min(seguidas, PANEL_MAX_HORAS_MANUAL),
        precio: bloque.precio || 0,
        promo: bloque.promo || null, // promo del dueño en este turno
        nombre: '',
        telefono: '',
        senaEfectivo: false,
        error: '',
      };
      this.iconos();
      this.$nextTick(() => this.$refs.nombreManual && this.$refs.nombreManual.focus());
    },

    cerrarManual() {
      this.form = null;
    },

    // En Django: la seña por hora viene de la configuración del complejo.
    get senaManual() {
      return this.form ? this.senaPorHora * this.form.horas : 0;
    },

    async guardarManual() {
      const f = this.form;
      const nombre = f.nombre.trim();
      const telefono = Store.normalizarTelefono(f.telefono);

      if (!nombre) {
        f.error = 'Poné el nombre de quien reserva.';
        return;
      }
      if (!telefono) {
        f.error = 'Revisá el teléfono: va con código de área, sin 0 ni 15.';
        return;
      }

      // En Django: POST a la vista de reserva manual del panel.
      let resultado;
      try {
        resultado = await Store.reservar({
        canchaId: f.cancha.id,
        fecha: f.fecha,
        hora: f.hora,
        horas: f.horas,
        nombre,
        telefono,
        origen: 'manual',
        medioSena: f.senaEfectivo ? 'efectivo' : null,
        });
      } catch (error) {
        f.error = 'No se pudo guardar: revisá la conexión y probá de nuevo.';
        return;
      }

      if (!resultado.ok) {
        f.error = resultado.error || 'No se pudo guardar la reserva.';
        return;
      }

      this.form = null;
      await this.recargar({ silencioso: true });
      this.resaltar(resultado.reserva);
      this.mostrarAviso({
        tipo: 'ok',
        titulo: 'Reserva guardada',
        texto: nombre + ' · ' + (f.cancha.tipo || f.cancha.nombre) + ' · ' + Fmt.dia(f.fecha) + ' ' + Fmt.rango(f.hora, f.horas),
      });
    },

    // --- Detalle de una reserva: asistencia y seña ---

    abrirDetalle(col, bloque) {
      this.detalle = {
        reserva: bloque.reserva,
        cancha: col.cancha,
        horas: bloque.horas,
        sena: bloque.sena,
        origen: bloque.origen,
      };
      this.iconos();
    },

    // Después de cada cambio, el detalle abierto se vuelve a leer del Store.
    refrescarDetalle() {
      if (!this.detalle) return;
      const id = this.detalle.reserva.id;
      for (const col of this.columnas) {
        const bloque = col.bloques.find((b) => b.reserva && b.reserva.id === id);
        if (bloque) {
          this.detalle = { reserva: bloque.reserva, cancha: col.cancha, horas: bloque.horas, sena: bloque.sena, origen: bloque.origen };
          return;
        }
      }
      this.detalle = null;
    },

    // Tocar de nuevo la opción marcada la deshace.
    // En Django: POST a la vista de asistencia.
    async marcarAsistencia(estado) {
      const r = this.detalle.reserva;
      try {
        await Store.marcarAsistencia(r.id, r.asistencia === estado ? null : estado);
      } catch (error) {
        return this.avisarError('No se pudo marcar la asistencia');
      }
      await this.recargar({ silencioso: true });
    },

    // medio: 'transferencia' (llegó el comprobante) | 'efectivo' (pagó en la cancha).
    // En Django: POST a la vista que registra la seña.
    async cobrarSena(medio) {
      const r = this.detalle.reserva;
      let resultado;
      try {
        resultado = await Store.marcarSenaRecibida(r.id, medio);
      } catch (error) {
        return this.avisarError('No se pudo registrar la seña');
      }
      await this.recargar({ silencioso: true });
      if (!resultado.ok) return this.mostrarAviso({ tipo: 'error', titulo: 'No se registró la seña', texto: resultado.error });
      const titulo = medio === 'transferencia' ? 'Seña recibida por transferencia' : 'Seña cobrada en efectivo';
      this.mostrarAviso({ tipo: 'ok', titulo, texto: r.nombre + (r.sena ? ' · ' + Fmt.pesos(r.sena) : '') });
    },

    cobrarSenaEfectivo() {
      return this.cobrarSena('efectivo');
    },

    // --- Turnos fijos ---

    // Agrupados por día de la semana, de lunes a domingo.
    get fijosPorDia() {
      return PANEL_SEMANA
        .map((dia) => ({
          dia,
          nombre: PANEL_DIAS[dia],
          fijos: this.fijos
            .filter((f) => f.diaSemana === dia)
            .sort((a, b) => a.hora - b.hora || String(a.canchaId).localeCompare(String(b.canchaId))),
        }))
        .filter((grupo) => grupo.fijos.length);
    },

    abrirFijo() {
      this.formFijo = {
        canchaId: this.canchas.length ? this.canchas[0].id : '',
        diaSemana: new Date(this.fecha + 'T12:00:00Z').getUTCDay(),
        hora: 21,
        horas: 1,
        responsable: '',
        telefono: '',
        error: '',
      };
      this.iconos();
    },

    elegirHoraFijo(hora) {
      this.formFijo.hora = hora;
      this.formFijo.horas = Math.min(this.formFijo.horas, 24 - hora);
    },

    get maxHorasFijo() {
      return this.formFijo ? Math.min(PANEL_MAX_HORAS_MANUAL, 24 - this.formFijo.hora) : 1;
    },

    async guardarFijo() {
      const f = this.formFijo;
      const responsable = f.responsable.trim();
      const telefono = Store.normalizarTelefono(f.telefono);

      if (!responsable) {
        f.error = 'Poné el nombre del responsable del turno.';
        return;
      }
      if (!telefono) {
        f.error = 'Revisá el teléfono: va con código de área, sin 0 ni 15.';
        return;
      }

      // En Django: POST a la vista de turnos fijos.
      let resultado;
      try {
        resultado = await Store.crearTurnoFijo({
        canchaId: f.canchaId,
        diaSemana: f.diaSemana,
        hora: f.hora,
        horas: f.horas,
        responsable,
        telefono,
        });
      } catch (error) {
        f.error = 'No se pudo guardar: revisá la conexión y probá de nuevo.';
        return;
      }

      if (!resultado.ok) {
        f.error = resultado.error || 'No se pudo guardar el turno fijo.';
        return;
      }

      this.formFijo = null;
      await this.recargar({ silencioso: true });
      this.mostrarAviso({ tipo: 'ok', titulo: 'Turno fijo guardado', texto: this.textoFijo(resultado.turnoFijo || f) });
    },

    // Borrar pide confirmación: el primer toque arma el botón y el segundo borra.
    async borrarFijo(fijo) {
      if (this.borrando !== fijo.id) {
        clearTimeout(this._timerBorrar);
        this.borrando = fijo.id;
        this._timerBorrar = setTimeout(() => (this.borrando = null), 4000);
        return;
      }
      clearTimeout(this._timerBorrar);
      this.borrando = null;
      // En Django: POST a la vista que borra el turno fijo.
      try {
        await Store.borrarTurnoFijo(fijo.id);
      } catch (error) {
        return this.avisarError('No se pudo borrar el turno fijo');
      }
      await this.recargar({ silencioso: true });
      this.mostrarAviso({ tipo: 'ok', titulo: 'Turno fijo borrado', texto: fijo.responsable + ' · ' + this.textoFijo(fijo) });
    },

    nombreCancha(canchaId) {
      const cancha = this.canchas.find((c) => c.id === canchaId) || {};
      return cancha.tipo || cancha.nombre || canchaId;
    },

    textoFijo(f) {
      return this.nombreCancha(f.canchaId) + ' · Todos los ' + PANEL_DIAS_PLURAL[f.diaSemana] + ' · ' + Fmt.rango(f.hora, f.horas);
    },

    // --- Clientes y puntaje ---

    abrirClientes() {
      this.vista = 'clientes';
      this.cargarClientes();
      this.iconos();
    },

    async cargarClientes({ silencioso = false } = {}) {
      if (!silencioso) this.estadoClientes = 'cargando';
      try {
        // En Django: esto viene de la vista de clientes del panel.
        const [clientes, alertas] = await Promise.all([Store.clientes(), Store.alertas()]);
        this.clientes = clientes;
        this.alertas = alertas;
        this.estadoClientes = 'listo';
      } catch (error) {
        console.error('panel: no se pudieron cargar los clientes', error);
        if (!silencioso) this.estadoClientes = 'error';
      }
      this.iconos();
    },

    async verFicha(telefono, { silencioso = false } = {}) {
      if (!silencioso) this.ficha = { estado: 'cargando', datos: { telefono } };
      try {
        const datos = await Store.fichaCliente(telefono);
        if (!this.ficha) return;
        if (!datos.ok) {
          this.ficha = null;
          return this.mostrarAviso({ tipo: 'error', titulo: 'No se encontró el cliente', texto: datos.error });
        }
        this.ficha = { estado: 'listo', datos };
      } catch (error) {
        if (this.ficha && !silencioso) this.ficha.estado = 'error';
      }
      this.iconos();
    },

    // Colores del semáforo (los mismos que en la app del jugador)
    claseSemaforo(color) {
      return { verde: 'bg-libre text-white', amarillo: 'bg-fijo text-marca-oscuro', rojo: 'bg-alerta text-white' }[color] || 'bg-marca-oscuro/10';
    },

    // Una línea del historial de la ficha
    textoEvento(e) {
      const titulos = {
        cancelo: 'Canceló desde la app',
        'cancelo-fijo': 'Canceló su turno fijo',
        'no-vino': 'No vino y no avisó',
        vino: 'Vino a jugar',
      };
      const cancha = this.canchas.find((c) => c.id === e.canchaId) || {};
      const turno = (cancha.tipo || '') + ' · ' + Fmt.dia(e.fecha) + ' ' + Fmt.hora(e.hora);
      let detalle = '';
      if (e.tipo === 'cancelo' || e.tipo === 'cancelo-fijo') {
        const h = e.anticipacionHoras;
        detalle = h < 0 ? 'Avisó tarde' : 'Avisó con ' + (h >= 48 ? Math.round(h / 24) + ' días' : Math.round(h) + ' h');
      }
      if (e.multiplicador > 1) detalle += (detalle ? ' · ' : '') + 'reincide ×' + String(e.multiplicador).replace('.', ',');
      if (e.tipo === 'cancelo-fijo') detalle += (detalle ? ' · ' : '') + 'lo cargó el dueño';
      return { titulo: titulos[e.tipo], turno, detalle };
    },

    // Desde una alerta o la ficha. Primer toque: pide confirmar. Segundo: lo borra.
    async darDeBajaFijo(fijo) {
      if (this.bajaFijo !== fijo.id) {
        this.bajaFijo = fijo.id;
        return;
      }
      this.bajaFijo = null;
      try {
        // En Django: DELETE a la vista de turnos fijos
        await Store.borrarTurnoFijo(fijo.id);
      } catch (error) {
        return this.avisarError('No se pudo dar de baja el turno fijo');
      }
      await this.recargar({ silencioso: true });
      await this.cargarClientes({ silencioso: true });
      this.mostrarAviso({ tipo: 'ok', titulo: 'Turno fijo dado de baja', texto: fijo.responsable + ' · ' + this.textoFijo(fijo) + ' · ese horario queda libre' });
    },

    // --- Navegación de días ---

    // ¿La fecha elegida está fuera de la tira de 14 días? (se llegó con el calendario o con las flechas)
    get fechaFueraDeLaTira() {
      return Boolean(this.fecha) && !this.dias.includes(this.fecha);
    },

    // --- Calendario mensual: saltar a cualquier fecha hasta un año adelante ---

    get ultimaFechaCalendario() {
      return sumarDias(this.hoy, 365);
    },

    async abrirCalendario() {
      this.calendario = { mes: this.fecha.slice(0, 7), promos: {} };
      this.iconos();
      // Puntito lima en los días con promos del dueño. Si falla, el calendario anda igual.
      try {
        const promos = await Store.promos();
        if (this.calendario) this.calendario.promos = Object.fromEntries(promos.map((p) => [p.fecha, true]));
      } catch (error) { /* sin puntitos */ }
    },

    cambiarMes(n) {
      const [anio, mes] = this.calendario.mes.split('-').map(Number);
      const nuevo = new Date(Date.UTC(anio, mes - 1 + n, 1)).toISOString().slice(0, 7);
      if (nuevo < this.hoy.slice(0, 7) || nuevo > this.ultimaFechaCalendario.slice(0, 7)) return;
      this.calendario.mes = nuevo;
    },

    get puedeMesAnterior() {
      return this.calendario && this.calendario.mes > this.hoy.slice(0, 7);
    },

    get puedeMesSiguiente() {
      return this.calendario && this.calendario.mes < this.ultimaFechaCalendario.slice(0, 7);
    },

    get tituloMes() {
      if (!this.calendario) return '';
      const [anio, mes] = this.calendario.mes.split('-').map(Number);
      const nombres = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
      return nombres[mes - 1] + ' ' + anio;
    },

    // Semanas del mes, de lunes a domingo. Cada día: { fecha, numero, enMes, deshabilitado, ... }
    get semanasCalendario() {
      if (!this.calendario) return [];
      const primero = this.calendario.mes + '-01';
      const diaSemana = new Date(primero + 'T12:00:00Z').getUTCDay(); // 0 = domingo
      let fecha = sumarDias(primero, -((diaSemana + 6) % 7));      // el lunes de esa semana
      const semanas = [];
      do {
        const semana = [];
        for (let i = 0; i < 7; i++) {
          semana.push({
            fecha,
            numero: Number(fecha.slice(8)),
            enMes: fecha.slice(0, 7) === this.calendario.mes,
            deshabilitado: fecha > this.ultimaFechaCalendario,
            pasado: fecha < this.hoy,
            esHoy: fecha === this.hoy,
            elegido: fecha === this.fecha,
            promo: Boolean(this.calendario.promos[fecha]),
          });
          fecha = sumarDias(fecha, 1);
        }
        semanas.push(semana);
      } while (fecha.slice(0, 7) === this.calendario.mes);
      return semanas;
    },

    elegirDelCalendario(dia) {
      if (dia.deshabilitado) return;
      this.calendario = null;
      this.vista = 'agenda';
      this.irA(dia.fecha);
    },

    irAHoyDesdeCalendario() {
      this.calendario = null;
      this.irA(this.hoy);
    },

    // --- Turno fijo: "Canceló esta fecha" ---

    // Fecha y hora de ahora (Argentina) en el formato del <input type="datetime-local">
    ahoraParaInput() {
      const partes = {};
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      }).formatToParts(new Date()).forEach(({ type, value }) => { partes[type] = value; });
      return `${partes.year}-${partes.month}-${partes.day}T${partes.hour}:${partes.minute}`;
    },

    pedirCancelarFijo() {
      this.cancelaFijo = { reservaId: this.detalle.reserva.id, modo: null, cuando: this.ahoraParaInput(), error: '', guardando: false };
      this.iconos();
    },

    // "Avisó con 2 días y 3 h de anticipación" / "Avisó 30 min tarde"
    textoAnticipacion(reserva, avisoEn) {
      const inicio = new Date(`${reserva.fecha}T${String(reserva.hora).padStart(2, '0')}:00:00-03:00`);
      const minutos = Math.round((inicio - avisoEn) / 60000);
      const partes = (total) => {
        const dias = Math.floor(total / 1440), horas = Math.floor((total % 1440) / 60), mins = total % 60;
        if (dias) return dias + (dias === 1 ? ' día' : ' días') + (horas ? ' y ' + horas + ' h' : '');
        if (horas) return horas + ' h' + (mins ? ' ' + mins + ' min' : '');
        return mins + ' min';
      };
      if (minutos < 0) return 'Avisó ' + partes(-minutos) + ' tarde (el turno ya había empezado)';
      return 'Avisó con ' + partes(minutos) + ' de anticipación';
    },

    // El <input> se lee como hora de Argentina
    get avisoElegido() {
      const c = this.cancelaFijo;
      if (!c) return null;
      if (c.modo !== 'elegir') return new Date();
      const fecha = new Date(c.cuando + ':00-03:00');
      return Number.isNaN(fecha.getTime()) ? null : fecha;
    },

    async confirmarCancelarFijo() {
      const c = this.cancelaFijo;
      if (!c || c.guardando) return;
      const aviso = this.avisoElegido;
      if (!aviso) {
        c.error = 'Elegí la fecha y la hora en que te avisó.';
        return;
      }
      c.guardando = true;
      c.error = '';
      let resultado;
      try {
        resultado = await Store.cancelarFechaFijo(c.reservaId, c.modo === 'elegir' ? aviso.toISOString() : null);
      } catch (error) {
        c.guardando = false;
        c.error = 'No se pudo guardar: revisá la conexión y probá de nuevo.';
        return;
      }
      c.guardando = false;
      if (!resultado.ok) {
        c.error = resultado.error;
        return;
      }
      const r = resultado.reserva;
      const cancha = this.canchas.find((x) => x.id === r.canchaId) || {};
      this.cancelaFijo = null;
      this.detalle = null;
      await this.recargar({ silencioso: true });
      this.mostrarAviso({
        tipo: 'cancelada',
        titulo: (r.nombre || 'El fijo').trim().split(' ')[0] + ' no viene — ' + (cancha.tipo || '') + ', ' + r.hora + ' hs',
        texto: this.textoAnticipacion(r, new Date(resultado.cancelacion.avisoEn)) + ' · el turno quedó libre',
        accion: this.sePuedePromocionar(r)
          ? { texto: '¿Lo ponés en promo?', hacer: () => this.abrirPromo(cancha, r.fecha, r.hora) }
          : null,
        duracion: 15000,
      });
    },

    // Fechas canceladas que todavía no pasaron, para mostrarlas (y poder deshacerlas) en la lista de fijos
    cancelacionesProximas(fijo) {
      return (fijo.cancelaciones || []).filter((c) => c.fecha >= this.hoy).sort((a, b) => a.fecha.localeCompare(b.fecha));
    },

    async restaurarFecha(fijo, fecha) {
      let resultado;
      try {
        resultado = await Store.restaurarFechaFijo(fijo.id, fecha);
      } catch (error) {
        return this.avisarError('No se pudo deshacer');
      }
      if (!resultado.ok) return this.mostrarAviso({ tipo: 'error', titulo: 'No se pudo deshacer', texto: resultado.error });
      await this.recargar({ silencioso: true });
      this.mostrarAviso({ tipo: 'ok', titulo: 'Listo, el fijo vuelve a ese día', texto: fijo.responsable + ' · ' + Fmt.dia(fecha) });
    },

    moverDia(n) {
      this.irA(sumarDias(this.fecha, n));
    },

    irA(fecha) {
      this.fecha = fecha;
      this.recargar();
      this.$nextTick(() => {
        const chip = document.querySelector('[data-dia-activo]');
        if (chip) chip.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
      });
    },

    // Deslizar la agenda a los costados cambia de día (en el celular).
    // La tira de días tiene su propio scroll horizontal, así que ahí no cuenta.
    tocarInicio(e) {
      if (e.target.closest('[data-sin-deslizar]')) {
        this.toque = null;
        return;
      }
      const t = e.changedTouches[0];
      this.toque = { x: t.clientX, y: t.clientY };
    },

    tocarFin(e) {
      if (!this.toque || this.vista !== 'agenda') return;
      const t = e.changedTouches[0];
      const dx = t.clientX - this.toque.x;
      const dy = t.clientY - this.toque.y;
      this.toque = null;
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) this.moverDia(dx < 0 ? 1 : -1);
    },

    // --- Ayudas de presentación ---

    get logo() {
      // Las rutas de datos.js ya son absolutas (/assets/...)
      return this.complejo.logo || '';
    },

    get iniciales() {
      return (this.complejo.nombre || 'Complejo').slice(0, 2).toUpperCase();
    },

    get primerNombre() {
      return ((this.usuario && this.usuario.nombre) || 'Dueño').split(' ')[0];
    },

    get etiquetaDia() {
      if (this.fecha === this.hoy) return 'Hoy';
      if (this.fecha === sumarDias(this.hoy, 1)) return 'Mañana';
      if (this.fecha === sumarDias(this.hoy, -1)) return 'Ayer';
      return 'Agenda';
    },

    esPasado(horaFin) {
      return this.fecha < this.hoy || (this.fecha === this.hoy && horaFin <= this.horaActual);
    },

    claseHora(h) {
      if (this.fecha === this.hoy && h === this.horaActual) return 'bg-club text-white shadow-sm';
      if (this.esPasado(h + 1)) return 'text-marca-oscuro/25';
      return 'text-marca-oscuro/55';
    },

    iconos() {
      this.$nextTick(() => window.lucide && lucide.createIcons());
    },
  };
}

function estadoSena(r) {
  if (r.senaPagada && r.medioSena === 'efectivo') {
    return { icono: 'banknote', corto: 'Efectivo', largo: 'Seña en efectivo', clase: 'bg-libre text-white' };
  }
  if (r.senaPagada && r.medioSena === 'transferencia') {
    return { icono: 'landmark', corto: 'Transf.', largo: 'Seña por transferencia', clase: 'bg-libre text-white' };
  }
  if (r.senaPagada) {
    return { icono: 'circle-check', corto: 'Seña MP', largo: 'Seña por Mercado Pago', clase: 'bg-libre text-white' };
  }
  if (r.origen === 'fijo') {
    return { icono: 'clock', corto: 'En cancha', largo: 'Paga en la cancha', clase: 'bg-marca-oscuro/10 text-marca-oscuro/75' };
  }
  return { icono: 'clock', corto: 'Pendiente', largo: 'Seña pendiente', clase: 'bg-alerta text-white' };
}

// Suma días a una fecha 'AAAA-MM-DD' sin problemas de zona horaria.
function sumarDias(fecha, n) {
  const d = new Date(fecha + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function horaArgentina() {
  return Number(new Intl.DateTimeFormat('es-AR', {
    hour: 'numeric',
    hourCycle: 'h23',
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date()));
}
