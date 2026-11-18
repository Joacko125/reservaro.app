// Lógica del plano del predio (componentes/plano.html).
// Escucha 'cambio-horario' { fecha, hora } y dispara 'cancha-elegida' { canchaId }.
// Estados: 'cargando' (pide canchas o turnos), 'listo' y 'error' (con Reintentar).
function plano() {
  return {
    estado: 'cargando',
    canchas: [],
    fecha: null,
    hora: null,
    estados: {},   // { f5: 'libre' | 'ocupada' } para la fecha y hora que se están mirando
    elegida: null,
    aviso: '',
    _pedido: 0,    // para descartar respuestas viejas si se cambia de horario rápido

    async init() {
      window.addEventListener('cambio-horario', (evento) => this.mirar(evento.detail));
      // Si entra una reserva (en esta pestaña o en otra) se repinta solo
      Store.alCambiar(() => this.actualizar({ silencioso: true }));
      await this.cargar();
    },

    async cargar() {
      this.estado = 'cargando';
      try {
        // En Django: esto viene de la vista del complejo
        this.canchas = await Store.canchas();
        this.estado = 'listo';
        await this.actualizar();
      } catch (error) {
        console.error('plano: no se pudieron cargar las canchas', error);
        this.estado = 'error';
      }
    },

    mirar({ fecha, hora }) {
      this.fecha = fecha;
      this.hora = hora;
      this.aviso = '';
      this.actualizar();
    },

    async actualizar({ silencioso = false } = {}) {
      if (this.fecha === null || this.hora === null || !this.canchas.length) return;
      const pedido = ++this._pedido;
      if (!silencioso) this.estado = 'cargando';
      try {
        // En Django: esto viene de la vista de turnos del día
        const turnos = await Store.turnosDelDia(this.fecha);
        if (pedido !== this._pedido) return; // llegó tarde: ya se pidió otro horario
        const estados = {};
        turnos
          .filter((turno) => turno.hora === this.hora)
          .forEach((turno) => {
            estados[turno.canchaId] = turno.estado === 'libre' ? 'libre' : 'ocupada';
          });
        this.estados = estados;
        if (this.elegida && estados[this.elegida] !== 'libre') this.elegida = null;
        this.estado = 'listo';
      } catch (error) {
        if (pedido !== this._pedido) return;
        console.error('plano: no se pudieron cargar los turnos', error);
        this.estado = 'error';
      }
    },

    reintentar() {
      return this.canchas.length ? this.actualizar() : this.cargar();
    },

    // 'neutro' hasta que la app avise qué horario se está mirando
    estadoDe(canchaId) {
      if (this.estado !== 'listo') return 'neutro';
      return this.estados[canchaId] || 'neutro';
    },

    nombre(canchaId) {
      const cancha = this.canchas.find((c) => c.id === canchaId);
      return cancha ? cancha.nombre : canchaId;
    },

    rotulo(canchaId) {
      const textos = { neutro: '', libre: ' · LIBRE', ocupada: ' · OCUPADA' };
      return canchaId.toUpperCase() + textos[this.estadoDe(canchaId)];
    },

    etiqueta(canchaId) {
      const textos = { neutro: 'elegí un horario primero', libre: 'libre', ocupada: 'ocupada' };
      return `${this.nombre(canchaId)}, ${textos[this.estadoDe(canchaId)]}`;
    },

    titular() {
      if (this.estado === 'cargando') return 'Cargando el predio…';
      if (this.estado === 'error') return 'No pudimos cargar el predio.';
      if (this.hora === null) return 'Elegí un día y un horario para ver qué cancha está libre.';
      const libres = Object.values(this.estados).filter((e) => e === 'libre').length;
      if (libres === 0) return 'No hay canchas libres en este horario.';
      if (this.elegida) return `Elegiste la ${this.nombre(this.elegida)}.`;
      return libres === 1 ? 'Tocá la cancha libre para elegirla.' : 'Las 2 canchas están libres. Tocá una.';
    },

    tocar(canchaId) {
      const estado = this.estadoDe(canchaId);
      if (this.estado !== 'listo') return;
      if (estado === 'neutro') {
        this.aviso = 'Primero elegí un día y un horario.';
        return;
      }
      if (estado === 'ocupada') {
        this.aviso = `La ${this.nombre(canchaId)} está ocupada a las ${Fmt.hora(this.hora)}.`;
        return;
      }
      this.elegida = canchaId;
      this.aviso = '';
      window.dispatchEvent(new CustomEvent('cancha-elegida', { detail: { canchaId } }));
    },
  };
}
