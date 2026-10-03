/**
 * RunNear - Menú lateral
 *
 * Secciones del menú ("vistas"): cada una filtra y ordena la lista y el mapa.
 * También: favoritas y carreras corridas (guardadas en el dispositivo), calendario
 * mensual, exportar al calendario del móvil (.ics), ajustes y ventanas informativas.
 *
 * app.js consulta obtenerVista() al filtrar y llama a alAplicarVista() al terminar.
 */

// ==========================================================================
// Almacenamiento en el dispositivo (favoritas, corridas, ajustes)
// ==========================================================================

const ALMACEN = {
  leer(clave, porDefecto) {
    try {
      const valor = localStorage.getItem("runnear_" + clave);
      return valor ? JSON.parse(valor) : porDefecto;
    } catch (e) {
      return porDefecto;
    }
  },
  guardar(clave, valor) {
    try {
      localStorage.setItem("runnear_" + clave, JSON.stringify(valor));
    } catch (e) {
      // Navegación privada o almacenamiento lleno: se sigue funcionando sin guardar
    }
  }
};

function idsFavoritas() {
  return new Set(ALMACEN.leer("favoritas", []));
}

function esFavorita(id) {
  return idsFavoritas().has(id);
}

/** Marca o desmarca una favorita. Devuelve el nuevo estado. */
function alternarFavorita(id) {
  const favs = idsFavoritas();
  const ahora = !favs.has(id);
  if (ahora) favs.add(id); else favs.delete(id);
  ALMACEN.guardar("favoritas", [...favs]);
  actualizarContadoresMenu();
  return ahora;
}

function listaCorridas() {
  return ALMACEN.leer("corridas", []);
}

function esCorrida(id) {
  return listaCorridas().some(c => c.id === id);
}

/**
 * Marca o desmarca una carrera como corrida. Se guarda una copia de sus datos porque,
 * una vez celebrada, la carrera desaparece del calendario.
 */
function alternarCorrida(carrera) {
  let lista = listaCorridas();
  const ahora = !lista.some(c => c.id === carrera.id);
  if (ahora) {
    const { id, nombre, fecha, municipio, provincia, tipo, ubicacion, distancia_km, distancias_km, url_oficial, circuito } = carrera;
    lista.push({ id, nombre, fecha, municipio, provincia, tipo, ubicacion, distancia_km, distancias_km, url_oficial, circuito, guardada: hoyISO() });
  } else {
    lista = lista.filter(c => c.id !== carrera.id);
  }
  ALMACEN.guardar("corridas", lista);
  actualizarContadoresMenu();
  return ahora;
}

function radioPorDefecto() {
  return ALMACEN.leer("radio", 50);
}

// ==========================================================================
// Fechas
// ==========================================================================

function aISO(fecha) {
  const m = String(fecha.getMonth() + 1).padStart(2, "0");
  const d = String(fecha.getDate()).padStart(2, "0");
  return `${fecha.getFullYear()}-${m}-${d}`;
}

function hoyISO() {
  return aISO(new Date());
}

function sumarDias(iso, dias) {
  const [y, m, d] = iso.split("-").map(Number);
  return aISO(new Date(y, m - 1, d + dias));
}

/** [inicio, fin] del fin de semana actual o el próximo (sábado-domingo) */
function finDeSemana() {
  const hoy = new Date();
  const dia = hoy.getDay(); // 0 domingo ... 6 sábado
  const iso = hoyISO();
  if (dia === 0) return [iso, iso];
  if (dia === 6) return [iso, sumarDias(iso, 1)];
  const sabado = sumarDias(iso, 6 - dia);
  return [sabado, sumarDias(sabado, 1)];
}

function finDeMes() {
  const hoy = new Date();
  return aISO(new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0));
}

function fechaCorta(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });
}

// ==========================================================================
// Tamaño de una carrera (para "Más destacadas")
// ==========================================================================

function tamanoCarrera(c) {
  return Math.max(c.inscritos || 0, c.plazas_max || 0);
}

function textoTamano(c) {
  if (c.inscritos) return `${c.inscritos.toLocaleString("es-ES")} inscritos`;
  if (c.plazas_max) return `hasta ${c.plazas_max.toLocaleString("es-ES")} plazas`;
  return "";
}

// ==========================================================================
// Vistas (secciones del menú)
// ==========================================================================

const TEMAS = {
  nocturnas: { titulo: "Carreras nocturnas", patron: /nocturn/ },
  solidarias: { titulo: "Carreras solidarias", patron: /solidari|benefic|contra el cancer|contra la ela|cruz roja/ },
  silvestre: { titulo: "San Silvestre", patron: /silvestre/ },
  cross: { titulo: "Cross", patron: /\bcross\b/ }
};

const RANGOS_DISTANCIA = {
  "5k": { titulo: "Carreras de 5K", min: 4, max: 6.5 },
  "10k": { titulo: "Carreras de 10K", min: 8, max: 12 },
  media: { titulo: "Medias maratones", min: 20, max: 22.5 },
  maraton: { titulo: "Maratones", min: 41, max: 43.5 },
  ultra: { titulo: "Ultras (más de 42 km)", min: 43.5, max: 10000 }
};

const porFecha = (a, b) => (a.fecha || "").localeCompare(b.fecha || "");

/**
 * Definición de una vista:
 *   titulo, filtro(c), orden(a, b), ignorarRadio, origen() (lista propia),
 *   incluirPasadas, vacio (mensaje si no hay resultados)
 */
function obtenerVista(id) {
  const i = id.indexOf(":");
  const tipo = i >= 0 ? id.slice(0, i) : id;
  const valor = i >= 0 ? id.slice(i + 1) : null;
  const hoy = hoyISO();

  switch (tipo) {
    case "destacadas":
      return {
        titulo: "🔥 Más destacadas (por inscritos o plazas)",
        filtro: c => tamanoCarrera(c) > 0 && !c.estado,
        orden: (a, b) => tamanoCarrera(b) - tamanoCarrera(a),
        ignorarRadio: true,
        vacio: "Ninguna carrera publica todavía sus inscritos o su límite de plazas."
      };
    case "cerca":
      return { titulo: "📍 Cerca de ti", orden: (a, b) => (a.distancia_usuario_km ?? 1e9) - (b.distancia_usuario_km ?? 1e9) };
    case "finde": {
      const [ini, fin] = finDeSemana();
      return {
        titulo: `📆 Este fin de semana (${fechaCorta(ini)}${fin !== ini ? " – " + fechaCorta(fin) : ""})`,
        filtro: c => c.fecha >= ini && c.fecha <= fin, orden: porFecha, ignorarRadio: true,
        vacio: "No hay carreras este fin de semana en la región."
      };
    }
    case "7dias": {
      const fin = sumarDias(hoy, 7);
      return { titulo: "📆 Próximos 7 días", filtro: c => c.fecha <= fin, orden: porFecha, ignorarRadio: true,
        vacio: "No hay carreras en los próximos 7 días." };
    }
    case "mes": {
      const fin = finDeMes();
      return { titulo: "📆 Lo que queda de mes", filtro: c => c.fecha <= fin, orden: porFecha, ignorarRadio: true,
        vacio: "No quedan carreras este mes." };
    }
    case "prov":
      return { titulo: `🗺️ Provincia de ${valor}`, filtro: c => c.provincia === valor, orden: porFecha, ignorarRadio: true };
    case "dist": {
      const r = RANGOS_DISTANCIA[valor];
      return { titulo: `📏 ${r.titulo}`, filtro: c => listaDistancias(c).some(km => km >= r.min && km <= r.max),
        orden: porFecha, ignorarRadio: true };
    }
    case "trail":
      return { titulo: "⛰️ Trail y montaña", filtro: c => c.tipo === "trail", orden: porFecha, ignorarRadio: true };
    case "circ":
      return { titulo: `🏆 ${valor}`, filtro: c => c.circuito === valor, orden: porFecha, ignorarRadio: true };
    case "tema": {
      const t = TEMAS[valor];
      return { titulo: `🎉 ${t.titulo}`, filtro: c => t.patron.test(normalizarTexto(c.nombre)), orden: porFecha, ignorarRadio: true };
    }
    case "baratas":
      return {
        titulo: "💶 Más baratas (precio publicado)",
        filtro: c => c.precio_desde != null, orden: (a, b) => a.precio_desde - b.precio_desde, ignorarRadio: true
      };
    case "calendario": {
      const mes = AppState.calendarioMes;
      const dia = AppState.calendarioDia;
      return {
        titulo: dia ? `🗓️ ${fechaCorta(dia)}` : "🗓️ Calendario",
        filtro: c => dia ? c.fecha === dia : (c.fecha || "").startsWith(mes),
        orden: porFecha, ignorarRadio: true,
        vacio: dia ? "No hay carreras ese día." : "No hay carreras ese mes."
      };
    }
    case "favoritas": {
      const favs = idsFavoritas();
      return {
        titulo: "❤️ Mis favoritas", filtro: c => favs.has(c.id), orden: porFecha, ignorarRadio: true,
        vacio: "Aún no tienes favoritas. Pulsa ♡ en cualquier carrera para guardarla aquí."
      };
    }
    case "corridas":
      return {
        titulo: "✅ Carreras que has corrido",
        // Lista propia: incluye carreras ya celebradas que ya no están en el calendario
        origen: () => listaCorridas().map(g => AppState.races.find(c => c.id === g.id) || g),
        incluirPasadas: true,
        orden: (a, b) => (b.fecha || "").localeCompare(a.fecha || ""),
        ignorarRadio: true,
        vacio: "Aún no has marcado ninguna. Abre una carrera y pulsa «La he corrido»."
      };
    default:
      return { titulo: "Todas las carreras" };
  }
}

function limpiarFiltrosSinAviso() {
  AppState.filters.search = "";
  AppState.filters.type = "todas";
  AppState.filters.distance = "todas";
  const buscador = document.getElementById("filter-search-input");
  if (buscador) buscador.value = "";
  const limpiar = document.getElementById("btn-clear-search");
  if (limpiar) limpiar.classList.add("hidden");
  document.querySelectorAll(".filters-card .segment-btn").forEach(b => b.classList.toggle("active", b.dataset.type === "todas"));
  document.querySelectorAll(".chip-btn").forEach(b => b.classList.toggle("active", b.dataset.dist === "todas"));
}

function aplicarVista(id) {
  AppState.vista = id;
  AppState.encuadrarTrasVista = id !== "todas";
  if (id === "calendario" && !AppState.calendarioMes) {
    AppState.calendarioMes = hoyISO().slice(0, 7);
    AppState.calendarioDia = null;
  }
  limpiarFiltrosSinAviso();

  document.querySelectorAll(".menu-item[data-vista]").forEach(b => b.classList.toggle("activo", b.dataset.vista === id));
  // Abrir el grupo que contiene la opción activa
  const activo = document.querySelector(`.menu-item[data-vista="${CSS.escape(id)}"]`);
  const grupo = activo && activo.closest(".menu-subitems");
  if (grupo) abrirGrupo(grupo.previousElementSibling, true);

  if (id === "cerca" && !AppState.userLocation.isGps) solicitarGeolocalizacionNavegador();

  cerrarMenuMovil();
  aplicarFiltrosYRenderizar();
  document.getElementById("sidebar-panel").scrollTop = 0;
}

/** Lo llama app.js después de filtrar y dibujar */
function alAplicarVista(resultados) {
  const id = AppState.vista || "todas";
  const vista = obtenerVista(id);

  const caja = document.getElementById("vista-activa");
  if (caja) {
    caja.classList.toggle("hidden", id === "todas");
    document.getElementById("vista-activa-titulo").textContent = vista.titulo;
  }

  renderizarCalendario();
  construirMenuCircuitos();
  actualizarContadoresMenu();

  // Encuadrar el mapa en las carreras de la sección recién elegida
  if (AppState.encuadrarTrasVista && AppState.map) {
    AppState.encuadrarTrasVista = false;
    const puntos = resultados.filter(c => c.ubicacion).map(c => [c.ubicacion.lat, c.ubicacion.lng]);
    if (puntos.length) AppState.map.fitBounds(L.latLngBounds(puntos).pad(0.15), { maxZoom: 11, animate: true });
  }
}

// ==========================================================================
// Menú: grupos, circuitos, contadores, apertura en móvil
// ==========================================================================

function abrirGrupo(boton, abrir) {
  if (!boton) return;
  const sub = boton.nextElementSibling;
  const estado = abrir ?? boton.getAttribute("aria-expanded") !== "true";
  boton.setAttribute("aria-expanded", String(estado));
  if (sub) sub.classList.toggle("abierto", estado);
}

let circuitosMostrados = "";
function construirMenuCircuitos() {
  const cont = document.getElementById("menu-circuitos");
  if (!cont) return;
  const hoy = hoyISO();
  const circuitos = [...new Set(AppState.races.filter(c => c.circuito && c.fecha >= hoy).map(c => c.circuito))].sort();
  const clave = circuitos.join("|");
  if (clave === circuitosMostrados) return;
  circuitosMostrados = clave;
  cont.innerHTML = circuitos.length
    ? circuitos.map(n => `<button class="menu-item" data-vista="circ:${escapeHtml(n)}">${escapeHtml(n)}</button>`).join("")
    : `<p class="menu-vacio">Sin circuitos con carreras próximas</p>`;
  cont.querySelectorAll(".menu-item").forEach(b => {
    b.classList.toggle("activo", b.dataset.vista === AppState.vista);
    b.addEventListener("click", () => aplicarVista(b.dataset.vista));
  });
}

function actualizarContadoresMenu() {
  const nf = idsFavoritas().size;
  const nc = listaCorridas().length;
  const ef = document.getElementById("contador-favoritas");
  const ec = document.getElementById("contador-corridas");
  if (ef) ef.textContent = nf ? nf : "";
  if (ec) ec.textContent = nc ? nc : "";
}

function abrirMenuMovil() {
  document.body.classList.add("menu-abierto");
  document.getElementById("btn-menu").setAttribute("aria-expanded", "true");
}

function cerrarMenuMovil() {
  document.body.classList.remove("menu-abierto");
  const b = document.getElementById("btn-menu");
  if (b) b.setAttribute("aria-expanded", "false");
}

// ==========================================================================
// Calendario mensual
// ==========================================================================

function renderizarCalendario() {
  const panel = document.getElementById("calendario-panel");
  if (!panel) return;
  if (AppState.vista !== "calendario") {
    panel.classList.add("hidden");
    return;
  }
  panel.classList.remove("hidden");

  const [y, m] = AppState.calendarioMes.split("-").map(Number);
  const primero = new Date(y, m - 1, 1);
  const diasMes = new Date(y, m, 0).getDate();
  const hueco = (primero.getDay() + 6) % 7; // lunes = 0
  const hoy = hoyISO();

  // Carreras por día (todas las futuras, sin tener en cuenta el radio)
  const porDia = {};
  AppState.races.forEach(c => {
    if (c.fecha && c.fecha >= hoy) porDia[c.fecha] = (porDia[c.fecha] || 0) + 1;
  });

  const nombreMes = primero.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
  let celdas = "";
  for (let i = 0; i < hueco; i++) celdas += `<span class="cal-dia vacio"></span>`;
  for (let d = 1; d <= diasMes; d++) {
    const iso = `${AppState.calendarioMes}-${String(d).padStart(2, "0")}`;
    const n = porDia[iso] || 0;
    const clases = ["cal-dia", n ? "con-carreras" : "", iso === hoy ? "hoy" : "", iso === AppState.calendarioDia ? "elegido" : "", iso < hoy ? "pasado" : ""].join(" ");
    celdas += `<button class="${clases}" data-dia="${iso}" ${n ? "" : "disabled"} aria-label="${d}${n ? `, ${n} carreras` : ""}">
      ${d}${n ? `<span class="cal-punto">${n}</span>` : ""}</button>`;
  }

  panel.innerHTML = `
    <div class="cal-cabecera">
      <button class="cal-nav" data-mes="-1" aria-label="Mes anterior">‹</button>
      <span class="cal-mes">${nombreMes}</span>
      <button class="cal-nav" data-mes="1" aria-label="Mes siguiente">›</button>
    </div>
    <div class="cal-semana"><span>L</span><span>M</span><span>X</span><span>J</span><span>V</span><span>S</span><span>D</span></div>
    <div class="cal-rejilla">${celdas}</div>
    ${AppState.calendarioDia ? `<button class="cal-todo-mes">Ver todo el mes</button>` : ""}
  `;

  panel.querySelectorAll(".cal-nav").forEach(b => b.addEventListener("click", () => {
    const fecha = new Date(y, m - 1 + Number(b.dataset.mes), 1);
    AppState.calendarioMes = aISO(fecha).slice(0, 7);
    AppState.calendarioDia = null;
    aplicarFiltrosYRenderizar();
  }));
  panel.querySelectorAll(".cal-dia[data-dia]").forEach(b => b.addEventListener("click", () => {
    AppState.calendarioDia = AppState.calendarioDia === b.dataset.dia ? null : b.dataset.dia;
    aplicarFiltrosYRenderizar();
  }));
  const todoMes = panel.querySelector(".cal-todo-mes");
  if (todoMes) todoMes.addEventListener("click", () => {
    AppState.calendarioDia = null;
    aplicarFiltrosYRenderizar();
  });
}

// ==========================================================================
// Exportar al calendario del móvil (.ics)
// ==========================================================================

function escaparICS(texto) {
  return String(texto ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function generarICS(carreras) {
  const ahora = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lineas = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//RunNear//Carreras CLM//ES", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  carreras.forEach(c => {
    const inicio = c.fecha.replace(/-/g, "");
    const fin = sumarDias(c.fecha, 1).replace(/-/g, "");
    const descripcion = `${textoDistancias(c)}${c.circuito ? " · " + c.circuito : ""}\nInscripción: ${c.url_oficial || ""}`;
    lineas.push(
      "BEGIN:VEVENT",
      `UID:${c.id}@runnear`,
      `DTSTAMP:${ahora}`,
      `DTSTART;VALUE=DATE:${inicio}`,
      `DTEND;VALUE=DATE:${fin}`,
      `SUMMARY:${escaparICS("🏃 " + c.nombre)}`,
      `LOCATION:${escaparICS([c.municipio, c.provincia].filter(Boolean).join(", "))}`,
      `DESCRIPTION:${escaparICS(descripcion)}`,
      c.url_oficial ? `URL:${c.url_oficial}` : "",
      "BEGIN:VALARM", "TRIGGER:-P2D", "ACTION:DISPLAY", `DESCRIPTION:${escaparICS("Dentro de 2 días: " + c.nombre)}`, "END:VALARM",
      "END:VEVENT"
    );
  });
  lineas.push("END:VCALENDAR");
  return lineas.filter(Boolean).join("\r\n");
}

function descargarICS(nombreArchivo, carreras) {
  const blob = new Blob([generarICS(carreras)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function exportarFavoritasICS() {
  const favs = idsFavoritas();
  const lista = AppState.races.filter(c => favs.has(c.id) && c.fecha >= hoyISO());
  if (!lista.length) {
    mostrarToast("No tienes favoritas próximas. Pulsa ♡ en una carrera para añadirla.");
    return;
  }
  descargarICS("runnear-favoritas.ics", lista);
  mostrarToast(`📲 ${lista.length} carreras listas para añadir a tu calendario`);
}

// ==========================================================================
// Botones de la ficha (favorita, calendario, corrida)
// ==========================================================================

function actualizarAccionesFicha(carrera) {
  const fav = document.getElementById("btn-ficha-favorita");
  const corr = document.getElementById("btn-ficha-corrida");
  if (!fav || !corr) return;
  const esFav = esFavorita(carrera.id);
  fav.classList.toggle("activa", esFav);
  fav.setAttribute("aria-pressed", String(esFav));
  fav.querySelector(".accion-icono").textContent = esFav ? "♥" : "♡";
  fav.querySelector(".accion-texto").textContent = esFav ? "En favoritas" : "Favorita";

  const esCorr = esCorrida(carrera.id);
  corr.classList.toggle("activa", esCorr);
  corr.setAttribute("aria-pressed", String(esCorr));
  corr.querySelector(".accion-icono").textContent = esCorr ? "✅" : "☐";
}

function configurarAccionesFicha() {
  document.getElementById("btn-ficha-favorita").addEventListener("click", () => {
    const c = AppState.carreraAbierta;
    if (!c) return;
    const ahora = alternarFavorita(c.id);
    actualizarAccionesFicha(c);
    mostrarToast(ahora ? "❤️ Añadida a tus favoritas" : "Quitada de tus favoritas");
    aplicarFiltrosYRenderizar();
  });
  document.getElementById("btn-ficha-calendario").addEventListener("click", () => {
    const c = AppState.carreraAbierta;
    if (!c) return;
    descargarICS(`${normalizarTexto(c.nombre).replace(/[^a-z0-9]+/g, "-").slice(0, 50)}.ics`, [c]);
    mostrarToast("📅 Abre el archivo para añadirla a tu calendario (con aviso 2 días antes)");
  });
  document.getElementById("btn-ficha-corrida").addEventListener("click", () => {
    const c = AppState.carreraAbierta;
    if (!c) return;
    const ahora = alternarCorrida(c);
    actualizarAccionesFicha(c);
    mostrarToast(ahora ? "✅ Guardada en «Ya corridas»" : "Quitada de «Ya corridas»");
    if (AppState.vista === "corridas") aplicarFiltrosYRenderizar();
  });
}

// ==========================================================================
// Ventanas informativas: Acerca de, Publicar, Ajustes
// ==========================================================================

function abrirInfo(titulo, html) {
  document.getElementById("info-titulo").textContent = titulo;
  document.getElementById("info-cuerpo").innerHTML = html;
  document.getElementById("info-modal").classList.remove("hidden");
}

function cerrarInfo() {
  document.getElementById("info-modal").classList.add("hidden");
}

function mostrarAcercaDe() {
  abrirInfo("Acerca de RunNear", `
    <div class="info-texto">
      <p><strong>RunNear</strong> reúne las carreras populares y de trail de Castilla-La Mancha en un mapa, para que encuentres las que tienes cerca.</p>
      <h3>¿De dónde salen los datos?</h3>
      <ul>
        <li>El calendario se actualiza cada día a partir de <a href="https://carrerasclm.es" target="_blank" rel="noopener noreferrer">Carreras CLM</a>.</li>
        <li>Precios, desniveles e inscritos se leen de la web de inscripción de cada carrera.</li>
        <li>Confirma siempre fecha y detalles en la web oficial antes de inscribirte.</li>
      </ul>
      <h3>Mapa</h3>
      <p>Calles, pueblos y caminos: © colaboradores de OpenStreetMap (licencia ODbL). Mapa general: Natural Earth (dominio público).</p>
      <h3>Privacidad</h3>
      <p>Tu ubicación solo se usa en tu dispositivo para calcular distancias: no se envía ni se guarda en ningún servidor. Tus favoritas, carreras corridas y ajustes se guardan únicamente en este dispositivo.</p>
    </div>
  `);
}

function mostrarAjustes() {
  const claro = document.body.classList.contains("tema-claro");
  const radio = radioPorDefecto();
  const opcionesRadio = [15, 25, 50, 100, 150, 250]
    .map(r => `<option value="${r}" ${r === radio ? "selected" : ""}>${r} km</option>`).join("");
  abrirInfo("Ajustes", `
    <div class="ajustes">
      <div class="ajuste">
        <span class="ajuste-nombre">Apariencia</span>
        <div class="segmented-control ajuste-tema">
          <button class="segment-btn ${claro ? "" : "active"}" data-tema="oscuro">🌙 Oscuro</button>
          <button class="segment-btn ${claro ? "active" : ""}" data-tema="claro">☀️ Claro</button>
        </div>
      </div>
      <div class="ajuste">
        <label class="ajuste-nombre" for="ajuste-radio">Radio de búsqueda por defecto</label>
        <select id="ajuste-radio" class="sort-select ajuste-select">${opcionesRadio}</select>
      </div>
      <div class="ajuste">
        <span class="ajuste-nombre">Mis datos</span>
        <p class="ajuste-ayuda">${idsFavoritas().size} favoritas y ${listaCorridas().length} carreras corridas guardadas en este dispositivo.</p>
        <button class="btn-secondary" id="ajuste-borrar">Borrar mis favoritas y corridas</button>
      </div>
    </div>
  `);

  document.querySelectorAll(".ajuste-tema .segment-btn").forEach(b => b.addEventListener("click", () => {
    aplicarTema(b.dataset.tema);
    document.querySelectorAll(".ajuste-tema .segment-btn").forEach(x => x.classList.toggle("active", x === b));
  }));
  document.getElementById("ajuste-radio").addEventListener("change", e => {
    const r = Number(e.target.value);
    ALMACEN.guardar("radio", r);
    AppState.filters.radiusKm = r;
    const slider = document.getElementById("filter-radius-slider");
    if (slider) slider.value = r;
    const etiqueta = document.getElementById("radius-display-value");
    if (etiqueta) etiqueta.textContent = `${r} km`;
    aplicarFiltrosYRenderizar();
    mostrarToast(`Radio por defecto: ${r} km`);
  });
  document.getElementById("ajuste-borrar").addEventListener("click", () => {
    if (!confirm("¿Borrar tus favoritas y carreras corridas de este dispositivo?")) return;
    ALMACEN.guardar("favoritas", []);
    ALMACEN.guardar("corridas", []);
    actualizarContadoresMenu();
    aplicarFiltrosYRenderizar();
    mostrarAjustes();
    mostrarToast("Datos borrados");
  });
}

function aplicarTema(tema) {
  const claro = tema === "claro";
  document.body.classList.toggle("tema-claro", claro);
  ALMACEN.guardar("tema", tema);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", claro ? "#ffffff" : "#0c1220");
}

// ==========================================================================
// Arranque
// ==========================================================================

// El tema se aplica cuanto antes para evitar un parpadeo
aplicarTema(ALMACEN.leer("tema", "oscuro"));

document.addEventListener("DOMContentLoaded", () => {
  AppState.vista = "todas";

  // Radio por defecto guardado en ajustes
  const radio = radioPorDefecto();
  AppState.filters.radiusKm = radio;
  const slider = document.getElementById("filter-radius-slider");
  if (slider) slider.value = radio;
  const etiqueta = document.getElementById("radius-display-value");
  if (etiqueta) etiqueta.textContent = `${radio} km`;

  document.querySelectorAll(".menu-item[data-vista]").forEach(b => b.addEventListener("click", () => aplicarVista(b.dataset.vista)));
  document.querySelectorAll(".menu-grupo").forEach(b => b.addEventListener("click", () => abrirGrupo(b)));

  const acciones = {
    "ics-favoritas": exportarFavoritasICS,
    instalar: lanzarInstalacion,
    acerca: mostrarAcercaDe,
    ajustes: mostrarAjustes
  };
  document.querySelectorAll(".menu-item[data-accion]").forEach(b => b.addEventListener("click", () => {
    cerrarMenuMovil();
    acciones[b.dataset.accion]();
  }));

  document.getElementById("btn-quitar-vista").addEventListener("click", () => aplicarVista("todas"));
  document.getElementById("btn-menu").addEventListener("click", abrirMenuMovil);
  document.getElementById("btn-cerrar-menu").addEventListener("click", cerrarMenuMovil);
  document.getElementById("menu-fondo").addEventListener("click", cerrarMenuMovil);
  document.getElementById("btn-cerrar-info").addEventListener("click", cerrarInfo);
  document.getElementById("info-modal").addEventListener("click", e => {
    if (e.target.id === "info-modal") cerrarInfo();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      cerrarMenuMovil();
      cerrarInfo();
    }
  });

  // "Instalar la app" no tiene sentido si ya está instalada
  const yaInstalada = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  if (yaInstalada) document.getElementById("menu-instalar").style.display = "none";

  configurarAccionesFicha();
  actualizarContadoresMenu();
});
