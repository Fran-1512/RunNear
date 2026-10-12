/**
 * RunNear - "Añadir una carrera": organizadores y corredores proponen carreras que faltan.
 *
 * - Hace falta cuenta (así se frena el spam).
 * - La propuesta queda "pendiente" en Supabase (tabla propuestas) hasta que el
 *   administrador la aprueba en Table Editor; la actualización diaria publica las aprobadas.
 * - Quien propone ve el estado de sus propuestas.
 */

const PROVINCIAS_ORDENADAS = Object.keys(COMUNIDAD_DE_PROVINCIA).sort((a, b) => a.localeCompare(b, "es"));

function abrirPropuesta() {
  const modal = document.getElementById("propuesta-modal");
  modal.classList.remove("hidden");
  pintarPropuesta();
}

function cerrarPropuesta() {
  document.getElementById("propuesta-modal").classList.add("hidden");
}

async function pintarPropuesta() {
  const cuerpo = document.getElementById("propuesta-cuerpo");
  if (typeof Cuenta === "undefined" || !Cuenta.usuario) {
    // Puede que haya sesión guardada y aún no se haya comprobado
    if (typeof haySesionGuardada === "function" && haySesionGuardada() && !cuentaConectada) {
      cuerpo.innerHTML = `<p class="cuenta-texto">Cargando…</p>`;
      try {
        await conectarCuenta();
        await new Promise(r => setTimeout(r, 300));
      } catch (e) { /* sin conexión */ }
      if (Cuenta.usuario) return pintarPropuesta();
    }
    cuerpo.innerHTML = `
      <p class="cuenta-texto">¿Falta alguna carrera? Si eres organizador o conoces una que no está, proponla y la añadiremos tras revisarla.</p>
      <p class="cuenta-texto">Para proponer carreras necesitas una cuenta (es gratis y sin contraseñas).</p>
      <button class="btn-primary cuenta-enviar" id="propuesta-entrar">Entrar o crear cuenta</button>`;
    cuerpo.querySelector("#propuesta-entrar").addEventListener("click", () => {
      cerrarPropuesta();
      abrirCuenta();
    });
    return;
  }

  const hoy = hoyISO();
  const opcionesProvincia = PROVINCIAS_ORDENADAS.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("");
  cuerpo.innerHTML = `
    <p class="cuenta-texto">Rellena los datos de la carrera. La revisaremos antes de publicarla; si se aprueba, aparecerá en RunNear al día siguiente.</p>
    <form class="propuesta-form" id="propuesta-form" novalidate>
      <label class="propuesta-campo">Nombre de la carrera *
        <input class="cuenta-input" name="nombre" required maxlength="150" placeholder="Ej.: X Carrera Popular de Villanueva">
      </label>
      <div class="propuesta-fila">
        <label class="propuesta-campo">Fecha *
          <input class="cuenta-input" name="fecha" type="date" required min="${hoy}">
        </label>
        <label class="propuesta-campo">Hora de salida
          <input class="cuenta-input" name="hora" type="time">
        </label>
      </div>
      <div class="propuesta-fila">
        <label class="propuesta-campo">Pueblo o ciudad *
          <input class="cuenta-input" name="municipio" required maxlength="80" placeholder="Ej.: Tomelloso">
        </label>
        <label class="propuesta-campo">Provincia *
          <select class="cuenta-input" name="provincia" required><option value="">Elige…</option>${opcionesProvincia}</select>
        </label>
      </div>
      <div class="propuesta-campo">Tipo *
        <div class="segmented-control propuesta-tipo" role="radiogroup">
          <button type="button" class="segment-btn active" data-tipo="popular" role="radio" aria-checked="true">🏃 Asfalto</button>
          <button type="button" class="segment-btn" data-tipo="trail" role="radio" aria-checked="false">⛰️ Trail</button>
        </div>
      </div>
      <label class="propuesta-campo">Distancias en km *
        <input class="cuenta-input" name="distancias" required placeholder="Ej.: 5, 10, 21,1">
      </label>
      <label class="propuesta-campo">Web oficial o de inscripción *
        <input class="cuenta-input" name="url" type="url" required placeholder="https://…">
      </label>
      <label class="propuesta-campo">Precio desde (€)
        <input class="cuenta-input" name="precio" type="number" inputmode="decimal" min="0" max="1000" step="0.5" placeholder="Ej.: 10">
      </label>
      <label class="propuesta-campo">Descripción breve
        <textarea class="cuenta-input" name="descripcion" maxlength="600" rows="3" placeholder="Recorrido, categorías, bolsa del corredor…"></textarea>
      </label>
      <label class="avisos-opcion"><input type="checkbox" name="organizador"><span>Soy de la organización de esta carrera</span></label>
      <button class="btn-primary cuenta-enviar" type="submit">Enviar propuesta</button>
      <p class="cuenta-nota">Al enviarla confirmas que los datos son correctos y que pueden publicarse en RunNear.</p>
    </form>
    <div class="propuestas-mias" id="propuestas-mias"></div>`;

  let tipo = "popular";
  cuerpo.querySelectorAll(".propuesta-tipo .segment-btn").forEach(b => b.addEventListener("click", () => {
    tipo = b.dataset.tipo;
    cuerpo.querySelectorAll(".propuesta-tipo .segment-btn").forEach(x => {
      x.classList.toggle("active", x === b);
      x.setAttribute("aria-checked", String(x === b));
    });
  }));
  cuerpo.querySelector("#propuesta-form").addEventListener("submit", e => {
    e.preventDefault();
    enviarPropuesta(e.target, tipo, e.submitter);
  });
  pintarMisPropuestas(cuerpo.querySelector("#propuestas-mias"));
}

function leerDistancias(texto) {
  return [...new Set(String(texto || "").split(/[;\s]+|,(?!\d)|,\s+/)
    .map(v => parseFloat(v.replace(",", ".")))
    .filter(v => v > 0 && v < 400)
    .map(v => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
}

/** ¿Hay ya en RunNear una carrera ese día en ese pueblo? */
function carreraParecida(nombre, fecha, municipio) {
  const pueblo = normalizarTexto(municipio);
  return AppState.races.find(c => c.fecha === fecha && normalizarTexto(c.municipio) === pueblo) || null;
}

async function enviarPropuesta(form, tipo, boton) {
  const datos = Object.fromEntries(new FormData(form));
  const nombre = (datos.nombre || "").trim();
  const municipio = (datos.municipio || "").trim();
  const distancias = leerDistancias(datos.distancias);
  const url = (datos.url || "").trim();
  const errores = [];
  if (nombre.length < 3) errores.push("el nombre");
  if (!datos.fecha || datos.fecha < hoyISO()) errores.push("la fecha (de hoy en adelante)");
  if (municipio.length < 2) errores.push("el pueblo");
  if (!datos.provincia) errores.push("la provincia");
  if (!distancias.length) errores.push("las distancias");
  if (!/^https?:\/\/\S{4,}$/i.test(url)) errores.push("la web (debe empezar por https://)");
  if (errores.length) {
    mostrarToast(`Revisa ${errores.join(", ")}`, 6000);
    return;
  }

  const parecida = carreraParecida(nombre, datos.fecha, municipio);
  if (parecida && !confirm(`Ese día en ${municipio} ya tenemos «${parecida.nombre}».\n\n¿Es otra carrera distinta? Pulsa Aceptar para enviarla igualmente.`)) return;

  if (boton) boton.disabled = true;
  // Ubicación del pueblo (para que salga en el mapa nada más aprobarla)
  const ubicacion = await buscarPueblo(municipio, datos.provincia);
  if (!ubicacion && !confirm(`No encontramos «${municipio}» en ${datos.provincia}. Revisa cómo está escrito.\n\n¿Enviarla igualmente?`)) {
    if (boton) boton.disabled = false;
    return;
  }
  try {
    const cliente = await obtenerSupabase();
    const { error } = await cliente.from("propuestas").insert({
      lat: ubicacion ? ubicacion.lat : null,
      lng: ubicacion ? ubicacion.lng : null,
      user_id: Cuenta.usuario.id,
      nombre,
      fecha: datos.fecha,
      hora: datos.hora || null,
      municipio,
      provincia: datos.provincia,
      tipo,
      distancias_km: distancias,
      url_oficial: url,
      precio_desde: datos.precio !== "" && datos.precio != null ? Number(datos.precio) : null,
      descripcion: (datos.descripcion || "").trim() || null,
      organizador: datos.organizador === "on"
    });
    if (error) throw new Error(error.message);
    mostrarToast("✅ ¡Gracias! Revisaremos tu propuesta y te avisaremos aquí del resultado.", 6000);
    pintarPropuesta();
  } catch (e) {
    mostrarToast(`No se ha podido enviar: ${e.message}`, 7000);
    if (boton) boton.disabled = false;
  }
}

/** Centro del pueblo según OpenStreetMap (Nominatim), o null si no se encuentra */
async function buscarPueblo(municipio, provincia) {
  // Primero entre los pueblos que ya conocemos (sin consultar fuera)
  const conocido = (typeof lugaresDisponibles === "function" ? lugaresDisponibles() : [])
    .find(l => normalizarTexto(l.nombre) === normalizarTexto(municipio) && l.provincia === provincia);
  if (conocido) return { lat: conocido.lat, lng: conocido.lng };
  try {
    const parametros = new URLSearchParams({
      city: municipio, county: provincia, country: "España", format: "json", limit: "1"
    });
    const r = await fetch(`https://nominatim.openstreetmap.org/search?${parametros}`, { headers: { "Accept-Language": "es" } });
    const lista = r.ok ? await r.json() : [];
    if (!lista.length) return null;
    const lat = Math.round(Number(lista[0].lat) * 1e5) / 1e5;
    const lng = Math.round(Number(lista[0].lon) * 1e5) / 1e5;
    // Solo dentro de España (Península, Baleares, Canarias, Ceuta y Melilla)
    return lat >= 27 && lat <= 44.5 && lng >= -18.5 && lng <= 4.6 ? { lat, lng } : null;
  } catch (e) {
    return null;
  }
}

/**
 * Publicación inmediata: las propuestas aprobadas aparecen en cuanto se aprueban (sin esperar
 * a la actualización diaria) y las borradas o rechazadas desaparecen.
 */
async function incorporarPropuestasAprobadas() {
  let filas;
  try {
    const r = await fetch(`${SUPABASE.url}/rest/v1/propuestas_aprobadas?select=*`, {
      headers: { apikey: SUPABASE.clave, Authorization: `Bearer ${SUPABASE.clave}` }
    });
    if (!r.ok) return;
    filas = await r.json();
  } catch (e) {
    return; // sin conexión: se queda lo que traía el calendario
  }
  const aprobadas = new Set(filas.map(p => `rn-${p.id}`));
  const antes = AppState.races.length;
  // Quitar las que ya no están aprobadas (borradas o rechazadas después)
  AppState.races = AppState.races.filter(c => !c.id.startsWith("rn-") || aprobadas.has(c.id));
  let cambios = antes !== AppState.races.length;

  const ids = new Set(AppState.races.map(c => c.id));
  filas.forEach(p => {
    const id = `rn-${p.id}`;
    if (ids.has(id) || p.lat == null || p.lng == null) return;
    // Si el calendario ya la tiene con otro nombre (mismo día y pueblo), no se repite
    if (AppState.races.some(c => c.fecha === p.fecha && normalizarTexto(c.municipio) === normalizarTexto(p.municipio)
        && normalizarTexto(c.nombre) === normalizarTexto(p.nombre))) return;
    const distancias = (p.distancias_km || []).map(Number).filter(d => d > 0).sort((a, b) => a - b);
    AppState.races.push({
      id,
      nombre: p.nombre,
      tipo: p.tipo,
      fecha: p.fecha,
      hora: p.hora || undefined,
      municipio: p.municipio,
      provincia: p.provincia,
      distancia_km: distancias.length ? distancias[distancias.length - 1] : null,
      distancias_km: distancias,
      url_oficial: p.url_oficial,
      precio_desde: p.precio_desde != null ? Number(p.precio_desde) : null,
      descripcion: p.descripcion || undefined,
      verificada_organizador: !!p.organizador,
      ubicacion: { lat: Number(p.lat), lng: Number(p.lng) },
      fuente: { nombre: "Propuestas de usuarios de RunNear", url: "https://gorunnear.com/" }
    });
    cambios = true;
  });
  if (cambios) {
    const total = document.getElementById("total-races-count");
    if (total) total.textContent = AppState.races.filter(c => !estaCelebrada(c)).length;
    aplicarFiltrosYRenderizar();
  }
}

async function pintarMisPropuestas(caja) {
  if (!caja) return;
  try {
    const cliente = await obtenerSupabase();
    const { data, error } = await cliente.from("propuestas")
      .select("id, nombre, fecha, estado, motivo").order("creada", { ascending: false }).limit(20);
    if (error || !data || !data.length) return;
    const estados = { pendiente: "⏳ Pendiente de revisión", aprobada: "✅ Aprobada", rechazada: "❌ No aprobada" };
    caja.innerHTML = `
      <p class="avisos-titulo">Tus propuestas</p>
      ${data.map(p => `
        <div class="propuesta-mia">
          <strong>${escapeHtml(p.nombre)}</strong>
          <span>${escapeHtml(fechaCorta(p.fecha))} · ${estados[p.estado] || escapeHtml(p.estado)}</span>
          ${p.estado === "rechazada" && p.motivo ? `<span class="cuenta-nota">Motivo: ${escapeHtml(p.motivo)}</span>` : ""}
        </div>`).join("")}`;
  } catch (e) {
    // Sin conexión: no se muestra la lista
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btn-cerrar-propuesta").addEventListener("click", cerrarPropuesta);
  document.getElementById("propuesta-modal").addEventListener("click", e => {
    if (e.target.id === "propuesta-modal") cerrarPropuesta();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") cerrarPropuesta();
  });
});
