// Lógica del ingreso con teléfono (componentes/login-telefono.html), usada con x-data="loginTelefono()".
// El ámbito ('jugador' | 'panel') llega en el atributo data-ambito del include.
// data-modo: 'hoja' (por defecto, se puede cerrar) o 'pagina' (tarjeta fija, abierta mientras no haya sesión).
// Se abre con el evento 'pedir-login' { ambito } y al terminar dispara 'sesion-iniciada' { ambito, usuario }.
// Si ya hay sesión en ese ámbito, no se abre: avisa 'sesion-iniciada' directamente.
// Todo lo que pide al Store es async: mientras espera muestra 'Enviando…' / 'Verificando…' / 'Entrando…'.
const LARGO_CODIGO = 6;

function loginTelefono() {
  return {
    ambito: 'jugador',
    modo: 'hoja',
    complejo: {},
    abierta: false,
    paso: 'telefono',      // 'telefono' | 'codigo' | 'nombre' | 'listo'
    telefonoTexto: '',     // lo que escribe, formateado: '11 2345-6789'
    telefono: null,        // normalizado: '1123456789'
    digitos: Array(LARGO_CODIGO).fill(''),
    nombre: '',
    usuario: null,
    error: '',
    temblar: false,
    notificacion: false,   // la notificación que imita a WhatsApp
    codigoEnviado: '',
    temporizadorNotificacion: null,
    enviando: false,       // pidiendo el código
    verificando: false,    // chequeando el código
    entrando: false,       // guardando la sesión
    esperaReenvio: 0,      // segundos que faltan para poder pedir otro código
    temporizadorReenvio: null,

    async init() {
      this.ambito = this.$el.dataset.ambito || 'jugador';
      this.modo = this.$el.dataset.modo === 'pagina' ? 'pagina' : 'hoja';
      try {
        // En Django: el complejo viene del contexto de la vista
        this.complejo = await Store.complejo();
        if (this.modo === 'pagina' && !(await Store.usuarioActual(this.ambito))) this.abrir();
      } catch (error) {
        console.error('login-telefono: no se pudo cargar', error);
        // En modo página igual mostramos la tarjeta: el error aparece cuando intente entrar
        if (this.modo === 'pagina') this.abrir();
      }
    },

    // En modo página no se cierra; en los dos, no se cierra mientras dice "¡Listo!"
    get cerrable() {
      return this.modo !== 'pagina' && this.paso !== 'listo';
    },

    async abrir(detalle = {}) {
      if (detalle.ambito && detalle.ambito !== this.ambito) return;
      let usuario = null;
      try {
        usuario = await Store.usuarioActual(this.ambito);
      } catch (error) { /* si no se pudo leer la sesión, que entre de nuevo */ }
      if (usuario) return this.avisarSesion(usuario);
      this.paso = 'telefono';
      this.error = '';
      this.digitos = Array(LARGO_CODIGO).fill('');
      this.nombre = '';
      this.abierta = true;
      this.$nextTick(() => this.$refs.telefono.focus());
    },

    cerrar() {
      this.abierta = false;
      this.notificacion = false;
    },

    // ---------- Paso 1: celular ----------

    // Mientras escribe: solo números, sin el 0 de larga distancia, con el formato '11 2345-6789'
    formatearTelefono(evento) {
      const digitos = evento.target.value.replace(/\D/g, '').replace(/^0/, '').slice(0, 10);
      const area = digitos.startsWith('11') ? 2 : 3;
      let texto = digitos.slice(0, area);
      if (digitos.length > area) texto += ' ' + digitos.slice(area, 6);
      if (digitos.length > 6) texto += '-' + digitos.slice(6);
      this.telefonoTexto = texto;
      evento.target.value = texto;
      this.error = '';
    },

    get telefonoValido() {
      return Store.normalizarTelefono(this.telefonoTexto) !== null;
    },

    async enviarCodigo() {
      if (this.enviando) return;
      const telefono = Store.normalizarTelefono(this.telefonoTexto);
      if (!telefono) {
        this.error = 'Revisá el número: son 10 dígitos con el código de área, sin 0 ni 15.';
        return;
      }
      this.enviando = true;
      this.error = '';
      try {
        if (this.ambito === 'panel' && !(await Store.esDuenio(telefono))) {
          this.error = `Ese celular no es el del dueño de ${this.complejo.nombre}.`;
          return;
        }
        // En Django: acá el servidor manda el código por WhatsApp y no lo devuelve nunca
        this.codigoEnviado = await Store.enviarCodigo(telefono);
      } catch (error) {
        console.error('login-telefono: no se pudo enviar el código', error);
        this.error = 'No pudimos mandarte el código. Revisá tu conexión y probá de nuevo.';
        return;
      } finally {
        this.enviando = false;
      }
      this.telefono = telefono;
      this.paso = 'codigo';
      this.digitos = Array(LARGO_CODIGO).fill('');
      this.error = '';
      this.arrancarEsperaReenvio();
      this.$nextTick(() => this.enfocarDigito(0));
      // Un ratito de espera, como si llegara el mensaje.
      // Con la API el código llega por WhatsApp de verdad y no hay notificación simulada.
      this.notificacion = false;
      clearTimeout(this.temporizadorNotificacion);
      if (!this.codigoEnviado) return;
      this.temporizadorNotificacion = setTimeout(() => {
        this.notificacion = true;
        this.temporizadorNotificacion = setTimeout(() => { this.notificacion = false; }, 9000);
      }, 900);
    },

    // "Reenviar" queda bloqueado 60 segundos después de cada envío
    arrancarEsperaReenvio() {
      clearInterval(this.temporizadorReenvio);
      this.esperaReenvio = 60;
      this.temporizadorReenvio = setInterval(() => {
        this.esperaReenvio -= 1;
        if (this.esperaReenvio <= 0) clearInterval(this.temporizadorReenvio);
      }, 1000);
    },

    reenviar() {
      if (this.esperaReenvio > 0 || this.enviando) return;
      this.enviarCodigo();
    },

    get telefonoMostrado() {
      return '+54 9 ' + Fmt.telefono(this.telefono);
    },

    cambiarNumero() {
      this.paso = 'telefono';
      this.notificacion = false;
      this.$nextTick(() => this.$refs.telefono.focus());
    },

    // ---------- Paso 2: código ----------

    campos() {
      return this.$root.querySelectorAll('[data-digito]');
    },

    enfocarDigito(indice) {
      const campo = this.campos()[indice];
      if (campo) campo.focus();
    },

    // Acepta un dígito o varios (el autocompletado del celular pega el código entero en una casilla)
    alEscribir(indice, evento) {
      const numeros = evento.target.value.replace(/\D/g, '');
      if (!numeros) {
        this.digitos[indice] = '';
        evento.target.value = '';
        return;
      }
      this.repartir(numeros, indice);
      evento.target.value = this.digitos[indice];
    },

    alBorrar(indice, evento) {
      if (this.digitos[indice] || indice === 0) return; // borra la casilla actual como siempre
      evento.preventDefault();
      this.digitos[indice - 1] = '';
      this.enfocarDigito(indice - 1);
    },

    alPegar(evento) {
      const numeros = (evento.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
      if (numeros) this.repartir(numeros, 0);
    },

    // Reparte los números desde una casilla, salta a la siguiente vacía y verifica al completar las 6
    repartir(numeros, desde) {
      numeros.slice(0, LARGO_CODIGO - desde).split('').forEach((numero, i) => { this.digitos[desde + i] = numero; });
      this.error = '';
      const vacia = this.digitos.findIndex((digito) => !digito);
      if (vacia === -1) {
        this.campos().forEach((campo) => campo.blur());
        this.verificar();
      } else {
        const siguiente = desde + numeros.length;
        this.enfocarDigito(siguiente < LARGO_CODIGO ? siguiente : vacia);
      }
    },

    // Para la demo: tocar la notificación completa el código
    usarCodigoDeNotificacion() {
      this.notificacion = false;
      if (this.paso === 'codigo') this.repartir(this.codigoEnviado, 0);
    },

    async verificar() {
      const codigo = this.digitos.join('');
      if (codigo.length < LARGO_CODIGO || this.verificando) return;
      this.verificando = true;
      let correcto = false;
      let conocido = '';
      try {
        correcto = await Store.verificarCodigo(this.telefono, codigo);
        if (correcto) conocido = await this.nombreConocido();
      } catch (error) {
        console.error('login-telefono: no se pudo verificar', error);
        this.error = 'No pudimos verificar el código. Probá de nuevo.';
        this.verificando = false;
        return;
      }
      this.verificando = false;
      if (!correcto) {
        this.error = 'El código no es correcto. Probá de nuevo.';
        this.temblar = true;
        setTimeout(() => { this.temblar = false; }, 450);
        this.digitos = Array(LARGO_CODIGO).fill('');
        this.$nextTick(() => this.enfocarDigito(0));
        return;
      }
      this.notificacion = false;
      clearInterval(this.temporizadorReenvio);
      this.esperaReenvio = 0;
      if (conocido) return this.entrar(conocido);
      this.paso = 'nombre';
      this.$nextTick(() => this.$refs.nombre.focus());
    },

    // Si ya reservó o ya entró en el otro ámbito, no le volvemos a pedir el nombre.
    // En Django: esto lo resuelve la vista buscando el usuario por teléfono
    async nombreConocido() {
      const sesiones = await Promise.all(['jugador', 'panel'].map((ambito) => Store.usuarioActual(ambito)));
      const sesion = sesiones.find((usuario) => usuario && usuario.telefono === this.telefono && usuario.nombre);
      if (sesion) return sesion.nombre;
      const reserva = (await Store.reservasDeUsuario(this.telefono))[0];
      return reserva ? reserva.nombre : '';
    },

    // ---------- Paso 3: nombre (solo la primera vez) ----------

    guardarNombre() {
      const nombre = this.nombre.trim();
      if (nombre.length < 2) {
        this.error = 'Contanos cómo te llamás.';
        return;
      }
      this.entrar(nombre);
    },

    // ---------- Final ----------

    async entrar(nombre) {
      if (this.entrando) return;
      this.entrando = true;
      try {
        // En Django: esto es el POST de la vista de login, que deja la sesión abierta
        this.usuario = await Store.login(this.telefono, nombre, this.ambito);
      } catch (error) {
        console.error('login-telefono: no se pudo iniciar sesión', error);
        this.error = 'No pudimos terminar de entrar. Probá de nuevo.';
        this.entrando = false;
        if (this.paso !== 'nombre') this.paso = 'nombre';
        this.nombre = this.nombre || nombre;
        return;
      }
      this.entrando = false;
      this.error = '';
      this.paso = 'listo';
      setTimeout(() => {
        this.cerrar();
        this.avisarSesion(this.usuario);
      }, 1100);
    },

    get primerNombre() {
      return this.usuario ? this.usuario.nombre.split(' ')[0] : '';
    },

    avisarSesion(usuario) {
      window.dispatchEvent(new CustomEvent('sesion-iniciada', { detail: { ambito: this.ambito, usuario } }));
    },
  };
}
