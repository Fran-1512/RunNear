/**
 * RunNear - Cuentas de usuario (Supabase)
 *
 * - Entrar con Google o con un código de 6 cifras enviado por email (sin contraseñas;
 *   la cuenta se crea sola la primera vez). Se usa código y no enlace porque, con la
 *   app instalada en iPhone, los enlaces del correo se abren en Safari y no en la app.
 * - Con sesión iniciada, favoritas, carreras corridas (con tus tiempos) y ajustes se
 *   guardan también en la cuenta. La copia del dispositivo (localStorage) sigue siendo
 *   la que usa la web; esta capa la copia a la cuenta y la trae de ella.
 * - Sin sesión, la web funciona exactamente igual que antes.
 *
 * La URL y la clave "publishable" son públicas por diseño: lo que protege los datos son
 * las reglas de seguridad de la base de datos (supabase/esquema.sql), que solo dejan a
 * cada usuario leer y cambiar lo suyo. Nunca va aquí la clave secreta (service_role).
 *
 * La librería de Supabase (vendor/supabase, ~220 KB) solo se carga si hay una sesión
 * guardada o cuando el usuario abre "Entrar", para que la web siga siendo igual de rápida.
 */

const SUPABASE = {
  url: "https://fndytkkukhmijrrikjyw.supabase.co",
  clave: "sb_publishable_MKC7ayO7IWHaAqPMtzFOBw_TP0pCSdT",
  libreria: "vendor/supabase/supabase.js?v=2.117.3"
};

let promesaClienteSupabase = null;

/** Carga la librería (una sola vez) y devuelve el cliente de Supabase */
function obtenerSupabase() {
  if (!promesaClienteSupabase) {
    promesaClienteSupabase = new Promise((resolver, rechazar) => {
      const script = document.createElement("script");
      script.src = SUPABASE.libreria;
      script.onload = () => resolver(window.supabase.createClient(SUPABASE.url, SUPABASE.clave, {
        auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      }));
      script.onerror = () => {
        promesaClienteSupabase = null; // se podrá reintentar
        rechazar(new Error("No se pudo cargar la librería de Supabase"));
      };
      document.head.appendChild(script);
    });
  }
  return promesaClienteSupabase;
}

/** Comprueba que la web llega a la base de datos. Devuelve la hora del servidor. */
async function comprobarConexionSupabase() {
  const cliente = await obtenerSupabase();
  const { data, error } = await cliente.rpc("ping");
  if (error) throw new Error(error.message);
  return data;
}

// ==========================================================================
// Estado de la cuenta
// ==========================================================================

const Cuenta = {
  usuario: null,          // { id, email, nombre }
  sincronizado: false,    // ya se juntaron los datos del dispositivo y de la cuenta
  aplicandoRemoto: false, // escribiendo en el dispositivo lo que viene de la cuenta
  emailPendiente: null,   // email al que se ha enviado el código
  pendientes: new Set(),  // tablas con cambios por subir
  temporizador: null
};

function leerLocal(clave) {
  try {
    return JSON.parse(localStorage.getItem("runnear_" + clave));
  } catch (e) {
    return null;
  }
}

function guardarLocal(clave, valor) {
  try {
    if (valor === null) localStorage.removeItem("runnear_" + clave);
    else localStorage.setItem("runnear_" + clave, JSON.stringify(valor));
  } catch (e) {
    // Sin almacenamiento: no pasa nada, la cuenta conserva los datos
  }
}

function haySesionGuardada() {
  try {
    return Object.keys(localStorage).some(k => k.startsWith("sb-") && k.endsWith("-auth-token"));
  } catch (e) {
    return false;
  }
}

/** Vuelta desde Google: la dirección trae ?code=... (o un error) */
function vieneDeEntrar() {
  const p = new URLSearchParams(location.search);
  return p.has("code") || p.has("error_description");
}

function limpiarUrlEntrada() {
  const p = new URLSearchParams(location.search);
  let cambiada = false;
  ["code", "error", "error_code", "error_description", "state"].forEach(k => {
    if (p.has(k)) { p.delete(k); cambiada = true; }
  });
  if (cambiada) {
    const resto = p.toString();
    history.replaceState(null, "", location.pathname + (resto ? "?" + resto : "") + location.hash);
  }
}

/**
 * nombre: el que eligió el usuario en RunNear o, si no, el de su cuenta de Google.
 * nombrePublico: el que se muestra en sus opiniones (el elegido entero, o el de pila de Google).
 */
function datosUsuario(user) {
  const meta = user.user_metadata || {};
  const deGoogle = meta.full_name || meta.name || "";
  return {
    id: user.id,
    email: user.email || "",
    nombre: meta.nombre || deGoogle,
    nombrePublico: meta.nombre || deGoogle.trim().split(/\s+/)[0] || "",
    nombrePreguntado: !!(meta.nombre || meta.nombre_preguntado || deGoogle)
  };
}

async function iniciarCuenta() {
  actualizarBotonCuenta();
  // Sin sesión guardada ni vuelta de Google: no hace falta cargar nada
  if (!haySesionGuardada() && !vieneDeEntrar()) return;
  await conectarCuenta();
}

let cuentaConectada = false;
async function conectarCuenta() {
  const cliente = await obtenerSupabase();
  if (cuentaConectada) return cliente;
  cuentaConectada = true;

  const p = new URLSearchParams(location.search);
  if (p.has("error_description")) {
    mostrarToast(`No se pudo entrar: ${p.get("error_description")}`, 6000);
  }
  cliente.auth.onAuthStateChange((evento, sesion) => {
    // Fuera de la función de aviso, como recomienda Supabase (evita bloqueos)
    setTimeout(() => alCambiarSesion(evento, sesion), 0);
  });
  await cliente.auth.getSession(); // termina de procesar la vuelta de Google
  limpiarUrlEntrada();
  return cliente;
}

function alCambiarSesion(evento, sesion) {
  if (sesion && sesion.user) {
    const antes = Cuenta.usuario && Cuenta.usuario.id;
    Cuenta.usuario = datosUsuario(sesion.user);
    if (antes !== Cuenta.usuario.id) Cuenta.sincronizado = false;
    // Para mostrar tu inicial nada más abrir la web la próxima vez
    guardarLocal("cuenta_ultima", { nombre: Cuenta.usuario.nombre, email: Cuenta.usuario.email });
    actualizarBotonCuenta();
    if (!Cuenta.sincronizado) sincronizarAlEntrar();
  } else {
    guardarLocal("cuenta_ultima", null);
    Cuenta.usuario = null;
    Cuenta.sincronizado = false;
    actualizarBotonCuenta();
  }
  if (cuentaModalAbierta()) pintarCuenta();
}

// ==========================================================================
// Sincronización entre el dispositivo y la cuenta
// ==========================================================================

/**
 * Al entrar:
 * - Primera vez en este dispositivo (o con cambios sin subir): se juntan los datos del
 *   dispositivo y los de la cuenta, sin perder nada, y se sube el resultado.
 * - Si no: manda la cuenta (así lo que borras en el móvil desaparece también aquí).
 */
async function sincronizarAlEntrar() {
  const uid = Cuenta.usuario.id;
  let cliente;
  try {
    cliente = await obtenerSupabase();
  } catch (e) {
    return;
  }
  const [f, c, a] = await Promise.all([
    cliente.from("favoritas").select("carrera_id"),
    cliente.from("corridas").select("carrera_id, datos, marca, guardada"),
    cliente.from("ajustes").select("tema, radio_km, ciudad").maybeSingle()
  ]);
  if (!Cuenta.usuario || Cuenta.usuario.id !== uid) return; // cerró sesión mientras tanto
  if (f.error || c.error || a.error) {
    console.warn("Sincronización:", f.error || c.error || a.error);
    mostrarToast("No se pudieron cargar los datos de tu cuenta. Se reintentará al volver a abrir RunNear.", 6000);
    return;
  }

  const remotoFav = f.data.map(r => r.carrera_id);
  const remotoCorr = c.data.map(r => {
    const g = { ...r.datos, id: r.carrera_id, guardada: r.guardada };
    if (r.marca) g.marca = r.marca;
    return g;
  });

  const primeraVez = leerLocal("cuenta_vinculada") !== uid;
  const conCambiosSinSubir = leerLocal("cuenta_pendiente") === uid;
  const juntar = primeraVez || conCambiosSinSubir;

  let favoritas = remotoFav;
  let corridas = remotoCorr;
  if (juntar) {
    favoritas = [...new Set([...remotoFav, ...idsFavoritas()])];
    const porId = new Map(remotoCorr.map(g => [g.id, g]));
    listaCorridas().forEach(local => {
      const remota = porId.get(local.id);
      // Gana la del dispositivo si es nueva, si trae tiempo y la de la cuenta no,
      // o si había cambios del dispositivo sin subir
      if (!remota || (local.marca && !remota.marca) || conCambiosSinSubir) porId.set(local.id, local);
    });
    corridas = [...porId.values()];
  }

  Cuenta.aplicandoRemoto = true;
  try {
    ALMACEN.guardar("favoritas", favoritas);
    ALMACEN.guardar("corridas", corridas);
    if (a.data && !conCambiosSinSubir) aplicarAjustesDeCuenta(a.data);
  } finally {
    Cuenta.aplicandoRemoto = false;
  }

  Cuenta.sincronizado = true;
  guardarLocal("cuenta_vinculada", uid);

  try {
    if (juntar) await subir(["favoritas", "corridas", "ajustes"]);
    else if (!a.data) await subir(["ajustes"]);
    guardarLocal("cuenta_pendiente", null);
  } catch (e) {
    guardarLocal("cuenta_pendiente", uid);
  }

  refrescarTrasSincronizar();
  if (primeraVez) {
    const n = favoritas.length + corridas.length;
    mostrarToast(n ? "☁️ Tus favoritas y carreras corridas se guardan ahora en tu cuenta" : "☁️ Sesión iniciada. Lo que guardes se quedará en tu cuenta", 5000);
  }
}

function aplicarAjustesDeCuenta(ajustes) {
  if (ajustes.tema === "claro" || ajustes.tema === "oscuro") aplicarTema(ajustes.tema);
  if (Number.isFinite(ajustes.radio_km)) ALMACEN.guardar("radio", ajustes.radio_km);
  if (ajustes.avisos && typeof ajustes.avisos === "object") ALMACEN.guardar("avisos", ajustes.avisos);
  const ciudad = ajustes.ciudad;
  if (ciudad && Number.isFinite(ciudad.lat) && Number.isFinite(ciudad.lng) && ciudad.nombre) {
    const actual = typeof ciudadGuardada === "function" ? ciudadGuardada() : null;
    guardarLocal("ciudad", { lat: ciudad.lat, lng: ciudad.lng, nombre: ciudad.nombre });
    const cambia = !actual || actual.lat !== ciudad.lat || actual.lng !== ciudad.lng;
    if (cambia && !AppState.userLocation.isGps && typeof usarUbicacionPorDefecto === "function") usarUbicacionPorDefecto();
  }
}

function refrescarTrasSincronizar() {
  if (typeof actualizarContadoresMenu === "function") actualizarContadoresMenu();
  if (typeof aplicarFiltrosYRenderizar === "function") aplicarFiltrosYRenderizar();
  if (AppState.carreraAbierta && typeof actualizarAccionesFicha === "function") actualizarAccionesFicha(AppState.carreraAbierta);
  const ficha = document.getElementById("race-detail-modal");
  if (AppState.carreraAbierta && ficha && !ficha.classList.contains("hidden") && typeof mostrarValoraciones === "function") {
    mostrarValoraciones(AppState.carreraAbierta);
  }
  if (cuentaModalAbierta()) pintarCuenta();
}

/** Lo llama menu.js (ALMACEN.guardar) y app.js (ciudad) cada vez que cambia un dato */
function alCambiarDatoLocal(clave) {
  if (!Cuenta.usuario || Cuenta.aplicandoRemoto) return;
  const tabla = clave === "favoritas" || clave === "corridas" ? clave
    : ["tema", "radio", "ciudad", "avisos"].includes(clave) ? "ajustes" : null;
  if (!tabla) return;
  // Cambio mientras aún se están trayendo los datos de la cuenta: se juntarán después
  guardarLocal("cuenta_pendiente", Cuenta.usuario.id);
  if (!Cuenta.sincronizado) return;
  Cuenta.pendientes.add(tabla);
  clearTimeout(Cuenta.temporizador);
  Cuenta.temporizador = setTimeout(subirPendientes, 800);
}

async function subirPendientes() {
  clearTimeout(Cuenta.temporizador);
  if (!Cuenta.usuario || !Cuenta.sincronizado || !Cuenta.pendientes.size) return;
  const tablas = [...Cuenta.pendientes];
  Cuenta.pendientes.clear();
  try {
    await subir(tablas);
    if (!Cuenta.pendientes.size) guardarLocal("cuenta_pendiente", null);
  } catch (e) {
    tablas.forEach(t => Cuenta.pendientes.add(t));
    console.warn("No se pudo guardar en la cuenta:", e);
    mostrarToast("Sin conexión: tus cambios se guardarán en tu cuenta cuando vuelva", 5000);
  }
}

window.addEventListener("online", subirPendientes);

/** Lista para el filtro "in" de la base de datos: ("id1","id2") */
function listaIn(ids) {
  return `(${ids.map(id => `"${String(id).replace(/["\\]/g, "")}"`).join(",")})`;
}

/** Copia a la cuenta el estado actual del dispositivo de las tablas indicadas */
async function subir(tablas) {
  const cliente = await obtenerSupabase();
  const uid = Cuenta.usuario.id;
  const comprobar = ({ error }) => { if (error) throw new Error(error.message); };

  if (tablas.includes("favoritas")) {
    const ids = [...idsFavoritas()];
    if (ids.length) {
      comprobar(await cliente.from("favoritas")
        .upsert(ids.map(id => ({ user_id: uid, carrera_id: id })), { onConflict: "user_id,carrera_id", ignoreDuplicates: true }));
    }
    let borrar = cliente.from("favoritas").delete().eq("user_id", uid);
    if (ids.length) borrar = borrar.not("carrera_id", "in", listaIn(ids));
    comprobar(await borrar);
  }

  if (tablas.includes("corridas")) {
    const lista = listaCorridas();
    if (lista.length) {
      const ahora = new Date().toISOString();
      comprobar(await cliente.from("corridas").upsert(lista.map(g => {
        const { id, marca, guardada, ...datos } = g;
        return { user_id: uid, carrera_id: id, datos, marca: marca || null, guardada: guardada || hoyISO(), actualizada: ahora };
      }), { onConflict: "user_id,carrera_id" }));
    }
    let borrar = cliente.from("corridas").delete().eq("user_id", uid);
    if (lista.length) borrar = borrar.not("carrera_id", "in", listaIn(lista.map(g => g.id)));
    comprobar(await borrar);
  }

  if (tablas.includes("ajustes")) {
    const tema = ALMACEN.leer("tema", null);
    const radio = ALMACEN.leer("radio", null);
    const ciudad = typeof ciudadGuardada === "function" ? ciudadGuardada() : null;
    const fila = {
      user_id: uid,
      tema: tema === "claro" || tema === "oscuro" ? tema : null,
      radio_km: Number.isFinite(radio) && radio >= 5 && radio <= 300 ? radio : null,
      ciudad,
      avisos: preferenciasAvisos(),
      actualizado: new Date().toISOString()
    };
    let resultado = await cliente.from("ajustes").upsert(fila, { onConflict: "user_id" });
    // Base de datos aún sin la columna de avisos: se guardan el resto de ajustes
    if (resultado.error && /avisos/.test(resultado.error.message)) {
      delete fila.avisos;
      resultado = await cliente.from("ajustes").upsert(fila, { onConflict: "user_id" });
    }
    comprobar(resultado);
  }
}

/** Al salir, este dispositivo deja de tener tus datos (siguen en tu cuenta) */
function borrarDatosDeCuentaDelDispositivo() {
  Cuenta.aplicandoRemoto = true;
  try {
    ALMACEN.guardar("favoritas", []);
    ALMACEN.guardar("corridas", []);
  } finally {
    Cuenta.aplicandoRemoto = false;
  }
  guardarLocal("cuenta_vinculada", null);
  guardarLocal("cuenta_pendiente", null);
  guardarLocal("cuenta_ultima", null);
  Cuenta.pendientes.clear();
  refrescarTrasSincronizar();
}

async function cerrarSesion() {
  await subirPendientes();
  // Este dispositivo deja de recibir los avisos de esta cuenta
  await quitarAvisosDeEsteDispositivo(true);
  const cliente = await obtenerSupabase();
  // "local": cierra la sesión solo en este dispositivo
  await cliente.auth.signOut({ scope: "local" });
  Cuenta.usuario = null;
  Cuenta.sincronizado = false;
  borrarDatosDeCuentaDelDispositivo();
  actualizarBotonCuenta();
  cerrarCuentaModal();
  mostrarToast("Has cerrado sesión. Tus datos siguen guardados en tu cuenta.", 5000);
}

async function borrarCuenta() {
  if (!confirm("¿Borrar tu cuenta de RunNear?\n\nSe eliminarán para siempre tu email, tus favoritas, tus carreras corridas, tus tiempos y tus ajustes. No se puede deshacer.")) return;
  const cliente = await obtenerSupabase();
  const { error } = await cliente.rpc("borrar_mi_cuenta");
  if (error) {
    mostrarToast(`No se pudo borrar la cuenta: ${error.message}`, 6000);
    return;
  }
  await quitarAvisosDeEsteDispositivo(false); // en la base de datos ya se han borrado
  try {
    await cliente.auth.signOut({ scope: "local" });
  } catch (e) {
    // La sesión ya no es válida: no importa
  }
  Cuenta.usuario = null;
  Cuenta.sincronizado = false;
  borrarDatosDeCuentaDelDispositivo();
  actualizarBotonCuenta();
  cerrarCuentaModal();
  mostrarToast("Tu cuenta y todos sus datos se han borrado.", 5000);
}

// ==========================================================================
// Botón de la cabecera y ventana "Tu cuenta"
// ==========================================================================

function actualizarBotonCuenta() {
  const boton = document.getElementById("btn-cuenta");
  if (!boton) return;
  const icono = document.getElementById("btn-cuenta-icono");
  const texto = document.getElementById("btn-cuenta-texto");
  const menu = document.getElementById("menu-cuenta-texto");
  // Mientras se comprueba la sesión guardada, se muestra ya la última cuenta usada
  const ultima = !Cuenta.usuario && haySesionGuardada() ? leerLocal("cuenta_ultima") : null;
  const u = Cuenta.usuario || (ultima && ultima.email ? ultima : null);
  boton.classList.toggle("con-sesion", !!u);
  if (u) {
    const nombre = (u.nombre || u.email).trim();
    icono.textContent = nombre.charAt(0).toUpperCase();
    texto.textContent = u.nombre ? u.nombre.split(" ")[0] : "Mi cuenta";
    boton.setAttribute("aria-label", `Tu cuenta (${u.email})`);
    if (menu) menu.textContent = "Mi cuenta";
  } else {
    icono.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>`;
    texto.textContent = "Entrar";
    boton.setAttribute("aria-label", "Entrar o crear cuenta");
    if (menu) menu.textContent = "Entrar o crear cuenta";
  }
}

function cuentaModalAbierta() {
  const m = document.getElementById("cuenta-modal");
  return m && !m.classList.contains("hidden");
}

function cerrarCuentaModal() {
  const m = document.getElementById("cuenta-modal");
  if (m) m.classList.add("hidden");
}

async function abrirCuenta() {
  const modal = document.getElementById("cuenta-modal");
  const cuerpo = document.getElementById("cuenta-cuerpo");
  modal.classList.remove("hidden");
  if (!cuentaConectada) {
    document.getElementById("cuenta-titulo").textContent = "Tu cuenta";
    cuerpo.innerHTML = `<p class="cuenta-texto">Cargando…</p>`;
    try {
      await conectarCuenta();
    } catch (e) {
      cuerpo.innerHTML = `<p class="cuenta-texto">No se ha podido conectar. Comprueba tu conexión a internet e inténtalo de nuevo.</p>`;
      return;
    }
  }
  pintarCuenta();
}

function pintarCuenta() {
  // Primera vez sin nombre (entró con email): se le pregunta cómo llamarle
  if (Cuenta.usuario && !Cuenta.usuario.nombrePreguntado) pintarNombre(true);
  else if (Cuenta.usuario) pintarPerfil();
  else if (Cuenta.emailPendiente) pintarCodigo();
  else pintarEntrar();
}

const LOGO_GOOGLE = `<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;

function pintarEntrar() {
  document.getElementById("cuenta-titulo").textContent = "Entra en RunNear";
  const cuerpo = document.getElementById("cuenta-cuerpo");
  cuerpo.innerHTML = `
    <p class="cuenta-texto">Guarda tus favoritas, las carreras que has corrido y tus tiempos, y tenlos en el móvil y en el ordenador.</p>
    <button class="btn-google" id="cuenta-google">${LOGO_GOOGLE}<span>Continuar con Google</span></button>
    <div class="cuenta-separador"><span>o con tu email</span></div>
    <form class="cuenta-form" id="cuenta-form-email" novalidate>
      <label class="sr-only" for="cuenta-email">Tu email</label>
      <input class="cuenta-input" id="cuenta-email" type="email" inputmode="email" autocomplete="email" placeholder="tu@email.com" required>
      <button class="btn-primary cuenta-enviar" type="submit">Enviarme un código</button>
    </form>
    <p class="cuenta-nota">Sin contraseñas: te enviamos un código y la cuenta se crea sola la primera vez. Para mayores de 14 años. Al entrar aceptas la <a href="legal.html#privacidad">política de privacidad</a>.</p>`;

  cuerpo.querySelector("#cuenta-google").addEventListener("click", entrarConGoogle);
  cuerpo.querySelector("#cuenta-form-email").addEventListener("submit", e => {
    e.preventDefault();
    enviarCodigo(cuerpo.querySelector("#cuenta-email").value.trim(), e.submitter || cuerpo.querySelector(".cuenta-enviar"));
  });
}

function pintarCodigo() {
  document.getElementById("cuenta-titulo").textContent = "Escribe el código";
  const cuerpo = document.getElementById("cuenta-cuerpo");
  cuerpo.innerHTML = `
    <p class="cuenta-texto">Te hemos enviado un correo a <strong>${escapeHtml(Cuenta.emailPendiente)}</strong>. Escribe aquí el código, o pulsa el enlace del correo abriéndolo en este mismo navegador. Si no lo ves en un minuto, mira en «Spam» o «Promociones».</p>
    <form class="cuenta-form" id="cuenta-form-codigo" novalidate>
      <label class="sr-only" for="cuenta-codigo">Código</label>
      <input class="cuenta-input cuenta-codigo" id="cuenta-codigo" type="text" inputmode="numeric" autocomplete="one-time-code"
        pattern="[0-9]*" maxlength="8" placeholder="123456" required>
      <button class="btn-primary cuenta-enviar" type="submit">Entrar</button>
    </form>
    <div class="cuenta-enlaces">
      <button class="cuenta-enlace" id="cuenta-reenviar">Reenviar código</button>
      <button class="cuenta-enlace" id="cuenta-otro-email">Usar otro email</button>
    </div>`;

  const input = cuerpo.querySelector("#cuenta-codigo");
  setTimeout(() => input.focus(), 50);
  cuerpo.querySelector("#cuenta-form-codigo").addEventListener("submit", e => {
    e.preventDefault();
    verificarCodigo(input.value, e.submitter || cuerpo.querySelector(".cuenta-enviar"));
  });
  cuerpo.querySelector("#cuenta-reenviar").addEventListener("click", e => enviarCodigo(Cuenta.emailPendiente, e.currentTarget));
  cuerpo.querySelector("#cuenta-otro-email").addEventListener("click", () => {
    Cuenta.emailPendiente = null;
    pintarEntrar();
  });
}

function pintarPerfil() {
  const u = Cuenta.usuario;
  document.getElementById("cuenta-titulo").textContent = "Tu cuenta";
  const cuerpo = document.getElementById("cuenta-cuerpo");
  const nombre = (u.nombre || u.email).trim();
  const nf = idsFavoritas().size;
  const nc = listaCorridas().length;
  cuerpo.innerHTML = `
    <div class="cuenta-perfil">
      <span class="cuenta-avatar" aria-hidden="true">${escapeHtml(nombre.charAt(0).toUpperCase())}</span>
      <div class="cuenta-quien">
        <p class="cuenta-nombre">${u.nombre ? escapeHtml(u.nombre) : `<span class="cuenta-sin-nombre">Sin nombre</span>`}
          <button class="cuenta-enlace" id="cuenta-cambiar-nombre">${u.nombre ? "Cambiar" : "Ponte un nombre"}</button></p>
        <p class="cuenta-email">${escapeHtml(u.email)}</p>
      </div>
    </div>
    <p class="cuenta-estado">${Cuenta.sincronizado
      ? `☁️ Tus ${nf} favoritas, ${nc} carreras corridas y tus ajustes se guardan en tu cuenta.`
      : "Cargando los datos de tu cuenta…"}</p>
    <div class="cuenta-avisos" id="cuenta-avisos"></div>
    <div class="cuenta-botones">
      <button class="btn-primary" id="cuenta-ver-perfil">📊 Ver mi perfil</button>
      <button class="btn-secondary" id="cuenta-salir">Cerrar sesión</button>
    </div>
    <details class="cuenta-peligro">
      <summary>Borrar mi cuenta</summary>
      <p class="cuenta-nota">Se eliminan para siempre tu email, favoritas, carreras corridas, tiempos y ajustes.</p>
      <button class="btn-borrar-cuenta" id="cuenta-borrar">Borrar mi cuenta definitivamente</button>
    </details>
    <p class="cuenta-nota"><a href="legal.html#privacidad">Cómo tratamos tus datos</a></p>`;

  cuerpo.querySelector("#cuenta-salir").addEventListener("click", cerrarSesion);
  cuerpo.querySelector("#cuenta-cambiar-nombre").addEventListener("click", () => pintarNombre(false));
  cuerpo.querySelector("#cuenta-ver-perfil").addEventListener("click", () => {
    cerrarCuentaModal();
    aplicarVista("perfil");
  });
  cuerpo.querySelector("#cuenta-borrar").addEventListener("click", borrarCuenta);
  pintarAvisos(cuerpo.querySelector("#cuenta-avisos"));
}

// ==========================================================================
// Tu nombre (el que ven los demás en tus opiniones)
// ==========================================================================

function pintarNombre(primeraVez) {
  const u = Cuenta.usuario;
  document.getElementById("cuenta-titulo").textContent = primeraVez ? "¿Cómo te llamamos?" : "Tu nombre";
  const cuerpo = document.getElementById("cuenta-cuerpo");
  cuerpo.innerHTML = `
    ${primeraVez ? `<p class="cuenta-texto">✅ ¡Ya tienes cuenta en RunNear!</p>` : ""}
    <p class="cuenta-texto">Es el nombre que verán los demás en tus opiniones de carreras. Puede ser tu nombre o un apodo.</p>
    <form class="cuenta-form" id="cuenta-form-nombre" novalidate>
      <label class="sr-only" for="cuenta-nombre-input">Tu nombre</label>
      <input class="cuenta-input" id="cuenta-nombre-input" type="text" maxlength="40" autocomplete="nickname"
        placeholder="Por ejemplo: Ana o Ana Trail" value="${escapeHtml(u.nombre || "")}">
      <button class="btn-primary cuenta-enviar" type="submit">Guardar</button>
    </form>
    <button class="cuenta-enlace" id="cuenta-nombre-saltar">${primeraVez ? "Ahora no" : "Cancelar"}</button>
    ${primeraVez ? `<p class="cuenta-nota">Si no pones ninguno, en tus opiniones aparecerás como «Corredor/a». Puedes cambiarlo cuando quieras en «Tu cuenta».</p>` : ""}`;

  const input = cuerpo.querySelector("#cuenta-nombre-input");
  setTimeout(() => input.focus(), 50);
  cuerpo.querySelector("#cuenta-form-nombre").addEventListener("submit", async e => {
    e.preventDefault();
    const nombre = input.value.replace(/\s+/g, " ").trim();
    if (!nombre) {
      mostrarToast("Escribe un nombre o pulsa «" + (primeraVez ? "Ahora no" : "Cancelar") + "»");
      return;
    }
    if (/@|https?:\/\/|www\./i.test(nombre)) {
      mostrarToast("El nombre no puede ser un email ni un enlace");
      return;
    }
    const boton = e.submitter || cuerpo.querySelector("button[type=submit]");
    boton.disabled = true;
    const ok = await guardarNombre(nombre);
    if (!ok) boton.disabled = false;
  });
  cuerpo.querySelector("#cuenta-nombre-saltar").addEventListener("click", async () => {
    // "Ahora no": se apunta para no volver a preguntar
    if (primeraVez) {
      try {
        await actualizarDatosCuenta({ nombre_preguntado: true });
      } catch (e) {
        // Si falla, se volverá a preguntar la próxima vez: no es grave
      }
    }
    pintarPerfil();
  });
}

async function actualizarDatosCuenta(datos) {
  const cliente = await obtenerSupabase();
  const { data, error } = await cliente.auth.updateUser({ data: datos });
  if (error) throw new Error(error.message);
  if (data && data.user) {
    Cuenta.usuario = datosUsuario(data.user);
    actualizarBotonCuenta();
  }
}

async function guardarNombre(nombre) {
  try {
    await actualizarDatosCuenta({ nombre: nombre.slice(0, 40), nombre_preguntado: true });
    // Las opiniones ya publicadas pasan a mostrar el nombre nuevo
    const cliente = await obtenerSupabase();
    await cliente.from("valoraciones").update({ autor: Cuenta.usuario.nombrePublico.slice(0, 40) }).eq("user_id", Cuenta.usuario.id);
    mostrarToast(`👋 ¡Hola, ${Cuenta.usuario.nombre}!`);
    pintarPerfil();
    if (AppState.vista === "perfil" && typeof aplicarFiltrosYRenderizar === "function") aplicarFiltrosYRenderizar();
    return true;
  } catch (e) {
    mostrarToast(`No se ha podido guardar el nombre: ${e.message}`, 6000);
    return false;
  }
}

// ==========================================================================
// Avisos al móvil (notificaciones push)
// ==========================================================================

// Clave pública VAPID (la privada solo está en los secretos de Supabase)
const VAPID_PUBLICA = "BJxR1du2yHVAlvCY2zuE2tvfHvXWQYVlV8UgWcXYkeeS1cr7XxLNhx72eZ65lgJh3YehicjTs0S9KiYjYuuZwdE";
const AVISOS_POR_DEFECTO = { recordatorio: true, corrida: true, nuevas: false };

function preferenciasAvisos() {
  return { ...AVISOS_POR_DEFECTO, ...(ALMACEN.leer("avisos", null) || {}) };
}

function claveDesdeBase64Url(texto) {
  const relleno = "=".repeat((4 - (texto.length % 4)) % 4);
  const binario = atob((texto + relleno).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binario, c => c.charCodeAt(0));
}

async function suscripcionActual() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  const consulta = (async () => {
    const registro = await navigator.serviceWorker.getRegistration();
    return registro && registro.pushManager ? registro.pushManager.getSubscription() : null;
  })();
  // Algunos navegadores no responden nunca: no se bloquea por ello cerrar sesión
  const limite = new Promise(resolver => setTimeout(() => resolver(null), 3000));
  return Promise.race([consulta, limite]);
}

/** "ios-instalar" | "no-soportado" | "bloqueado" | "activo" | "inactivo" */
async function estadoAvisos() {
  if (typeof esDispositivoIOS === "function" && esDispositivoIOS() && !appYaInstalada()) return "ios-instalar";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "no-soportado";
  if (Notification.permission === "denied") return "bloqueado";
  try {
    return (await suscripcionActual()) ? "activo" : "inactivo";
  } catch (e) {
    return "inactivo";
  }
}

async function guardarSuscripcion(cliente, suscripcion) {
  const datos = suscripcion.toJSON();
  return cliente.from("suscripciones_push").upsert({
    endpoint: datos.endpoint,
    user_id: Cuenta.usuario.id,
    p256dh: datos.keys.p256dh,
    auth: datos.keys.auth
  }, { onConflict: "endpoint" });
}

async function activarAvisos() {
  if (!Cuenta.usuario) return;
  const permiso = await Notification.requestPermission();
  if (permiso !== "granted") {
    mostrarToast("Sin permiso no podemos enviarte avisos. Puedes activarlo cuando quieras.", 5000);
    return;
  }
  try {
    const cliente = await obtenerSupabase();
    const registro = await navigator.serviceWorker.ready;
    const opciones = { userVisibleOnly: true, applicationServerKey: claveDesdeBase64Url(VAPID_PUBLICA) };
    let suscripcion = await registro.pushManager.subscribe(opciones);
    let { error } = await guardarSuscripcion(cliente, suscripcion);
    if (error) {
      // Dirección usada antes por otra cuenta en este dispositivo: se pide una nueva
      await suscripcion.unsubscribe();
      suscripcion = await registro.pushManager.subscribe(opciones);
      ({ error } = await guardarSuscripcion(cliente, suscripcion));
    }
    if (error) throw new Error(error.message);
    await registro.showNotification("✅ Avisos activados", {
      body: "Así te llegarán los avisos de RunNear en este dispositivo.",
      icon: "iconos/icono-192.png",
      lang: "es"
    });
  } catch (e) {
    console.warn("Avisos:", e);
    mostrarToast("No se han podido activar los avisos en este dispositivo. Inténtalo de nuevo.", 6000);
  }
}

/** borrarDeLaCuenta: quitar también la suscripción guardada (hace falta la sesión) */
async function quitarAvisosDeEsteDispositivo(borrarDeLaCuenta) {
  try {
    const suscripcion = await suscripcionActual();
    if (!suscripcion) return;
    if (borrarDeLaCuenta && Cuenta.usuario) {
      const cliente = await obtenerSupabase();
      await cliente.from("suscripciones_push").delete().eq("endpoint", suscripcion.endpoint);
    }
    await suscripcion.unsubscribe();
  } catch (e) {
    console.warn("Avisos:", e);
  }
}

async function pintarAvisos(caja) {
  if (!caja) return;
  const estado = await estadoAvisos();
  if (!document.body.contains(caja)) return;
  const prefs = preferenciasAvisos();
  const ciudad = typeof ciudadGuardada === "function" ? ciudadGuardada() : null;
  const radio = typeof radioPorDefecto === "function" ? radioPorDefecto() : 50;

  const estados = {
    "ios-instalar": `<p class="cuenta-nota">En iPhone, los avisos solo funcionan con RunNear instalada en la pantalla de inicio. <button class="cuenta-enlace" id="avisos-instalar">Cómo instalarla</button></p>`,
    "no-soportado": `<p class="cuenta-nota">Este navegador no permite recibir avisos. Prueba con Chrome, Edge, Firefox o Safari actualizados.</p>`,
    "bloqueado": `<p class="cuenta-nota">Has bloqueado los avisos de RunNear en este navegador. Para activarlos, permite las notificaciones en el candado junto a la dirección web (o en los ajustes del móvil) y vuelve aquí.</p>`,
    "inactivo": `<button class="btn-primary avisos-boton" id="avisos-activar">🔔 Activar avisos en este dispositivo</button>`,
    "activo": `<p class="avisos-activos">✅ Activados en este dispositivo <button class="cuenta-enlace" id="avisos-desactivar">Desactivar</button></p>`
  };
  const opcion = (id, texto, marcado, deshabilitado = false) => `
    <label class="avisos-opcion ${deshabilitado ? "deshabilitada" : ""}">
      <input type="checkbox" data-aviso="${id}" ${marcado ? "checked" : ""} ${deshabilitado ? "disabled" : ""}>
      <span>${texto}</span>
    </label>`;

  caja.innerHTML = `
    <p class="avisos-titulo">🔔 Avisos al móvil</p>
    ${estados[estado]}
    <div class="avisos-opciones">
      ${opcion("recordatorio", "Recordatorio el día antes de tus favoritas, con la hora de salida", prefs.recordatorio)}
      ${opcion("corrida", "«¿La corriste?» el día después, para apuntar tu tiempo", prefs.corrida)}
      ${ciudad
        ? opcion("nuevas", `Carreras nuevas a menos de ${radio} km de ${escapeHtml(ciudad.nombre)}`, prefs.nuevas)
        : opcion("nuevas", "Carreras nuevas cerca de tu ciudad (elige tu ciudad arriba, en «Tu ciudad…»)", false, true)}
    </div>
    <p class="cuenta-nota">Los avisos llegan por la mañana. Puedes cambiarlos cuando quieras.</p>`;

  caja.querySelectorAll("[data-aviso]").forEach(casilla => casilla.addEventListener("change", () => {
    ALMACEN.guardar("avisos", { ...preferenciasAvisos(), [casilla.dataset.aviso]: casilla.checked });
  }));
  const activar = caja.querySelector("#avisos-activar");
  if (activar) activar.addEventListener("click", async () => {
    activar.disabled = true;
    await activarAvisos();
    pintarAvisos(caja);
  });
  const desactivar = caja.querySelector("#avisos-desactivar");
  if (desactivar) desactivar.addEventListener("click", async () => {
    await quitarAvisosDeEsteDispositivo(true);
    mostrarToast("Avisos desactivados en este dispositivo");
    pintarAvisos(caja);
  });
  const instalar = caja.querySelector("#avisos-instalar");
  if (instalar) instalar.addEventListener("click", () => {
    cerrarCuentaModal();
    if (typeof lanzarInstalacion === "function") lanzarInstalacion();
  });
}

function traducirErrorCuenta(error) {
  const m = String((error && error.message) || error || "");
  if (/error sending|smtp/i.test(m)) return "No se ha podido enviar el correo con el código. Inténtalo de nuevo en unos minutos.";
  if (/not authorized/i.test(m)) return "Ese email todavía no puede recibir códigos: el envío de correos de RunNear está en pruebas.";
  if (/rate limit|too many|security purposes|only request this after/i.test(m)) return "Has pedido demasiados códigos seguidos. Espera un minuto y vuelve a intentarlo.";
  if (/expired|invalid/i.test(m)) return "El código no es correcto o ha caducado. Revisa el último correo o pide uno nuevo.";
  if (/provider is not enabled|unsupported provider/i.test(m)) return "Entrar con Google todavía no está activado. Usa tu email.";
  if (/valid email|invalid format|email address/i.test(m)) return "Ese email no parece correcto. Revísalo.";
  if (/fetch|network/i.test(m)) return "Sin conexión. Comprueba tu internet e inténtalo de nuevo.";
  return `No se ha podido completar: ${m}`;
}

async function entrarConGoogle() {
  try {
    const cliente = await obtenerSupabase();
    const { error } = await cliente.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: location.origin + location.pathname }
    });
    if (error) mostrarToast(traducirErrorCuenta(error), 6000);
    // Si no hay error, el navegador se va a Google y vuelve aquí con la sesión
  } catch (e) {
    mostrarToast(traducirErrorCuenta(e), 6000);
  }
}

async function enviarCodigo(email, boton) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "")) {
    mostrarToast("Escribe un email válido, por ejemplo nombre@gmail.com");
    return;
  }
  if (boton) boton.disabled = true;
  try {
    const cliente = await obtenerSupabase();
    // El correo trae un código (plantilla de RunNear) y/o un enlace (plantilla de serie de
    // Supabase); el enlace vuelve a esta misma página y también deja la sesión iniciada
    const { error } = await cliente.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true, emailRedirectTo: location.origin + location.pathname }
    });
    if (error) {
      mostrarToast(traducirErrorCuenta(error), 7000);
      return;
    }
    const reenvio = Cuenta.emailPendiente === email;
    Cuenta.emailPendiente = email;
    pintarCodigo();
    if (reenvio) mostrarToast("📧 Código reenviado");
  } catch (e) {
    mostrarToast(traducirErrorCuenta(e), 6000);
  } finally {
    if (boton && document.body.contains(boton)) boton.disabled = false;
  }
}

async function verificarCodigo(codigo, boton) {
  const token = String(codigo || "").replace(/\D/g, "");
  if (token.length < 6) {
    mostrarToast("El código tiene 6 cifras: cópialo del correo");
    return;
  }
  if (boton) boton.disabled = true;
  try {
    const cliente = await obtenerSupabase();
    const { error } = await cliente.auth.verifyOtp({ email: Cuenta.emailPendiente, token, type: "email" });
    if (error) {
      mostrarToast(traducirErrorCuenta(error), 7000);
      return;
    }
    Cuenta.emailPendiente = null;
    // La sesión llega por onAuthStateChange (alCambiarSesion), que pinta el perfil
    mostrarToast("✅ Has entrado en tu cuenta");
  } catch (e) {
    mostrarToast(traducirErrorCuenta(e), 6000);
  } finally {
    if (boton && document.body.contains(boton)) boton.disabled = false;
  }
}

// ==========================================================================
// Arranque
// ==========================================================================

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btn-cuenta").addEventListener("click", abrirCuenta);
  document.getElementById("btn-cerrar-cuenta").addEventListener("click", cerrarCuentaModal);
  document.getElementById("cuenta-modal").addEventListener("click", e => {
    if (e.target.id === "cuenta-modal") cerrarCuentaModal();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") cerrarCuentaModal();
  });
  iniciarCuenta().catch(e => console.warn("Cuenta:", e));
});
