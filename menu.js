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
    // Con sesión iniciada, el cambio se copia también a la cuenta (cuenta.js)
    if (typeof alCambiarDatoLocal === "function") alCambiarDatoLocal(clave);
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

function marcaDe(id) {
  const g = listaCorridas().find(c => c.id === id);
  return g ? g.marca || null : null;
}

/** Guarda (o borra, con marca = null) el tiempo hecho en una carrera corrida */
function guardarMarca(id, marca) {
  const lista = listaCorridas();
  const g = lista.find(c => c.id === id);
  if (!g) return;
  if (marca) g.marca = marca; else delete g.marca;
  ALMACEN.guardar("corridas", lista);
}

// ==========================================================================
// Tiempos y ritmos
// ==========================================================================

function formatearTiempo(seg) {
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  const s = Math.round(seg % 60);
  const mm = String(m).padStart(h ? 2 : 1, "0");
  return `${h ? h + ":" : ""}${mm}:${String(s).padStart(2, "0")}`;
}

function ritmoPorKm(marca) {
  const seg = marca.tiempo_seg / marca.distancia_km;
  return `${Math.floor(seg / 60)}:${String(Math.round(seg % 60)).padStart(2, "0")} /km`;
}

function textoKm(km) {
  return `${String(km).replace(".", ",")} km`;
}

function textoMarca(marca) {
  return `${formatearTiempo(marca.tiempo_seg)} en ${textoKm(marca.distancia_km)} · ${ritmoPorKm(marca)}`;
}

// Para las mejores marcas solo se comparan distancias prácticamente iguales
const DISTANCIAS_MARCA = [
  { titulo: "5K", min: 4.8, max: 5.3 },
  { titulo: "10K", min: 9.6, max: 10.5 },
  { titulo: "Media", min: 20.8, max: 21.5 },
  { titulo: "Maratón", min: 41.8, max: 42.6 }
];

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

// Botones de fecha encima de la lista ("Este finde", "7 días", "Este mes")
const FILTROS_FECHA = {
  finde: () => finDeSemana(),
  "7dias": () => [hoyISO(), sumarDias(hoyISO(), 7)],
  mes: () => [hoyISO(), finDeMes()]
};

/** [inicio, fin] en ISO del filtro de fecha, o null para "todas" */
function rangoFecha(id) {
  return FILTROS_FECHA[id] ? FILTROS_FECHA[id]() : null;
}

function textoRangoFecha([ini, fin]) {
  return ini === fin ? fechaCorta(ini) : `${fechaCorta(ini)} – ${fechaCorta(fin)}`;
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
    case "resultados": {
      const desde = sumarDias(hoy, -14);
      return {
        titulo: "🏅 Resultados de las últimas 2 semanas",
        // Solo ya celebradas (las de hoy aún no tienen resultados)
        filtro: c => c.fecha >= desde && c.fecha < hoy,
        incluirPasadas: true,
        orden: (a, b) => (b.fecha || "").localeCompare(a.fecha || ""),
        ignorarRadio: true,
        vacio: "No hay carreras celebradas en las últimas dos semanas."
      };
    }
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
    case "perfil":
    case "corridas":
      return {
        titulo: tipo === "perfil" ? "📊 Mi perfil" : "✅ Carreras que has corrido",
        // Lista propia: incluye carreras ya celebradas que ya no están en el calendario
        origen: () => listaCorridas().map(g => {
          const enCalendario = AppState.races.find(c => c.id === g.id);
          return enCalendario ? { ...enCalendario, marca: g.marca } : g;
        }),
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
  seleccionarFecha("todas", false);
  const buscador = document.getElementById("filter-search-input");
  if (buscador) buscador.value = "";
  const limpiar = document.getElementById("btn-clear-search");
  if (limpiar) limpiar.classList.add("hidden");
  document.querySelectorAll(".filters-card .segment-btn").forEach(b => b.classList.toggle("active", b.dataset.type === "todas"));
  document.querySelectorAll(".chip-btn").forEach(b => b.classList.toggle("active", b.dataset.dist === "todas"));
}

function aplicarVista(id) {
  // "Próximas" del menú: son los mismos botones de fecha que hay encima de la lista
  if (FILTROS_FECHA[id]) {
    aplicarVista("todas");
    seleccionarFecha(id);
    return;
  }
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

  if (id === "cerca" && !AppState.userLocation.isGps) solicitarGeolocalizacionNavegador(true);

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
  renderizarPanelMarcas();
  renderizarPanelPerfil();
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
    const dia = c.fecha.replace(/-/g, "");
    // Con hora de salida: evento a esa hora (hora local, 2 h de duración orientativa).
    // Sin hora: evento de todo el día
    const hora = /^\d{2}:\d{2}$/.test(c.hora || "") ? c.hora : null;
    let fechas;
    if (hora) {
      const [h, m] = hora.split(":").map(Number);
      const finH = Math.min(h + 2, 23);
      fechas = [`DTSTART:${dia}T${String(h).padStart(2, "0")}${String(m).padStart(2, "0")}00`,
                `DTEND:${dia}T${String(finH).padStart(2, "0")}${String(finH === 23 ? 59 : m).padStart(2, "0")}00`];
    } else {
      fechas = [`DTSTART;VALUE=DATE:${dia}`, `DTEND;VALUE=DATE:${sumarDias(c.fecha, 1).replace(/-/g, "")}`];
    }
    const descripcion = `${hora ? "Salida: " + hora + " · " : ""}${textoDistancias(c)}${c.circuito ? " · " + c.circuito : ""}\nInscripción: ${c.url_oficial || ""}`;
    lineas.push(
      "BEGIN:VEVENT",
      `UID:${c.id}@runnear`,
      `DTSTAMP:${ahora}`,
      ...fechas,
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

  renderizarMarcaFicha(carrera);
}

// ==========================================================================
// Tu tiempo en una carrera corrida (ficha) y tus mejores marcas
// ==========================================================================

function renderizarMarcaFicha(carrera, editando = false) {
  const caja = document.getElementById("modal-marca");
  if (!caja) return;
  if (!esCorrida(carrera.id)) {
    caja.classList.add("hidden");
    caja.innerHTML = "";
    return;
  }
  caja.classList.remove("hidden");
  const marca = marcaDe(carrera.id);

  if (marca && !editando) {
    caja.innerHTML = `
      <div class="marca-resumen">
        <span class="marca-etiqueta">⏱️ Tu tiempo</span>
        <strong class="marca-tiempo">${escapeHtml(formatearTiempo(marca.tiempo_seg))}</strong>
        <span class="marca-detalle">${escapeHtml(textoKm(marca.distancia_km))} · ${escapeHtml(ritmoPorKm(marca))}</span>
      </div>
      <div class="marca-botones">
        <button class="btn-secondary" id="marca-editar">Editar</button>
        <button class="btn-secondary" id="marca-quitar">Quitar</button>
      </div>`;
    caja.querySelector("#marca-editar").addEventListener("click", () => renderizarMarcaFicha(carrera, true));
    caja.querySelector("#marca-quitar").addEventListener("click", () => {
      guardarMarca(carrera.id, null);
      renderizarMarcaFicha(carrera);
      if (esVistaDeCorridas()) aplicarFiltrosYRenderizar();
    });
    return;
  }

  // Formulario: distancia (de las que tiene la carrera) y tiempo en h / min / s
  const distancias = listaDistancias(carrera);
  const elegida = marca ? marca.distancia_km : distancias[0];
  const campoDistancia = distancias.length > 1
    ? `<select id="marca-km" class="sort-select">${distancias.map(km =>
        `<option value="${km}" ${km === elegida ? "selected" : ""}>${escapeHtml(textoKm(km))}</option>`).join("")}</select>`
    : `<input id="marca-km" type="number" inputmode="decimal" min="0.1" step="0.1" value="${elegida ?? ""}" placeholder="km" aria-label="Kilómetros">`;
  const t = marca ? marca.tiempo_seg : null;
  const valor = n => (t != null ? n : "");

  caja.innerHTML = `
    <p class="marca-titulo">⏱️ Apunta tu tiempo</p>
    <div class="marca-form">
      <label class="marca-campo">Distancia ${campoDistancia}</label>
      <div class="marca-campo">Tiempo
        <div class="marca-tiempo-inputs">
          <input id="marca-h" type="number" inputmode="numeric" min="0" max="99" placeholder="h" aria-label="Horas" value="${valor(Math.floor(t / 3600))}">
          <span>:</span>
          <input id="marca-m" type="number" inputmode="numeric" min="0" max="59" placeholder="min" aria-label="Minutos" value="${valor(Math.floor((t % 3600) / 60))}">
          <span>:</span>
          <input id="marca-s" type="number" inputmode="numeric" min="0" max="59" placeholder="s" aria-label="Segundos" value="${valor(t % 60)}">
        </div>
      </div>
      <button class="btn-primary marca-guardar" id="marca-guardar">Guardar</button>
    </div>`;

  caja.querySelector("#marca-guardar").addEventListener("click", () => {
    const km = Number(String(caja.querySelector("#marca-km").value).replace(",", "."));
    const h = Number(caja.querySelector("#marca-h").value || 0);
    const m = Number(caja.querySelector("#marca-m").value || 0);
    const s = Number(caja.querySelector("#marca-s").value || 0);
    const seg = h * 3600 + m * 60 + s;
    if (!(km > 0) || !(seg > 0) || m > 59 || s > 59 || [h, m, s].some(v => v < 0 || !Number.isInteger(v))) {
      mostrarToast("Revisa la distancia y el tiempo (minutos y segundos de 0 a 59)");
      return;
    }
    guardarMarca(carrera.id, { tiempo_seg: seg, distancia_km: km });
    renderizarMarcaFicha(carrera);
    mostrarToast("⏱️ Tiempo guardado");
    if (esVistaDeCorridas()) aplicarFiltrosYRenderizar();
  });
}

/** Secciones que muestran tus carreras corridas (y se refrescan al cambiar un tiempo) */
function esVistaDeCorridas() {
  return AppState.vista === "corridas" || AppState.vista === "perfil";
}

/** Mejor tiempo en cada distancia clásica (5K, 10K, media, maratón) */
function mejoresMarcas() {
  const conMarca = listaCorridas().filter(g => g.marca);
  return DISTANCIAS_MARCA.map(d => {
    const candidatas = conMarca.filter(g => g.marca.distancia_km >= d.min && g.marca.distancia_km <= d.max);
    const mejor = candidatas.sort((a, b) => a.marca.tiempo_seg - b.marca.tiempo_seg)[0];
    return { ...d, mejor };
  }).filter(d => d.mejor);
}

function htmlMejoresMarcas(mejores) {
  if (!mejores.length) {
    return `<p class="marcas-ayuda">Abre una carrera que hayas corrido y apunta tu tiempo: aquí verás tus mejores marcas en 5K, 10K, media y maratón.</p>`;
  }
  return `
    <div class="marcas-rejilla">
      ${mejores.map(d => `
        <button class="marca-pb" data-id="${escapeHtml(d.mejor.id)}" title="${escapeHtml(d.mejor.nombre)}">
          <span class="marca-pb-distancia">${d.titulo}</span>
          <strong class="marca-pb-tiempo">${escapeHtml(formatearTiempo(d.mejor.marca.tiempo_seg))}</strong>
          <span class="marca-pb-ritmo">${escapeHtml(ritmoPorKm(d.mejor.marca))}</span>
          <span class="marca-pb-carrera">${escapeHtml(d.mejor.nombre)}</span>
        </button>`).join("")}
    </div>`;
}

/** Los botones con data-id abren la ficha de esa carrera (del calendario o guardada) */
function enlazarFichas(contenedor) {
  contenedor.querySelectorAll("[data-id]").forEach(b => b.addEventListener("click", () => {
    const id = b.dataset.id;
    const enCalendario = AppState.races.find(c => c.id === id);
    const guardada = listaCorridas().find(c => c.id === id);
    if (enCalendario || guardada) abrirModalDetalleCarrera(enCalendario || guardada);
  }));
}

function renderizarPanelMarcas() {
  const panel = document.getElementById("panel-marcas");
  if (!panel) return;
  if (AppState.vista !== "corridas" || !listaCorridas().length) {
    panel.classList.add("hidden");
    return;
  }
  panel.classList.remove("hidden");
  panel.innerHTML = `<p class="marcas-titulo">🏆 Tus mejores marcas</p>${htmlMejoresMarcas(mejoresMarcas())}`;
  enlazarFichas(panel);
}

// ==========================================================================
// Mi perfil: estadísticas de tus carreras
// ==========================================================================

/** Km de una carrera corrida: los que apuntaste o, si solo tenía una distancia, esa */
function kmDeCorrida(g) {
  if (g.marca && g.marca.distancia_km) return g.marca.distancia_km;
  const lista = listaDistancias(g);
  return lista.length === 1 ? lista[0] : null;
}

function formatearKm(km) {
  return Math.round(km).toLocaleString("es-ES");
}

/** 2h 05m · 45 min */
function formatearDuracion(seg) {
  const h = Math.floor(seg / 3600);
  const m = Math.round((seg % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m} min`;
}

function estadisticasPerfil() {
  const corridas = listaCorridas();
  const conKm = corridas.filter(g => kmDeCorrida(g) !== null);
  const conTiempo = corridas.filter(g => g.marca && g.marca.tiempo_seg);
  const porAno = {};
  corridas.forEach(g => {
    const ano = (g.fecha || "").slice(0, 4) || "—";
    porAno[ano] = porAno[ano] || { carreras: 0, km: 0 };
    porAno[ano].carreras++;
    porAno[ano].km += kmDeCorrida(g) || 0;
  });
  const porProvincia = {};
  corridas.forEach(g => {
    if (g.provincia) porProvincia[g.provincia] = (porProvincia[g.provincia] || 0) + 1;
  });
  return {
    total: corridas.length,
    trail: corridas.filter(g => g.tipo === "trail").length,
    km: conKm.reduce((s, g) => s + kmDeCorrida(g), 0),
    sinKm: corridas.length - conKm.length,
    tiempo: conTiempo.reduce((s, g) => s + g.marca.tiempo_seg, 0),
    pueblos: new Set(corridas.map(g => normalizarTexto(g.municipio || "")).filter(Boolean)).size,
    porAno: Object.entries(porAno).sort((a, b) => b[0].localeCompare(a[0])),
    porProvincia: Object.entries(porProvincia).sort((a, b) => b[1] - a[1])
  };
}

function renderizarPanelPerfil() {
  const panel = document.getElementById("panel-perfil");
  if (!panel) return;
  if (AppState.vista !== "perfil") {
    panel.classList.add("hidden");
    return;
  }
  panel.classList.remove("hidden");

  const usuario = typeof Cuenta !== "undefined" ? Cuenta.usuario : null;
  const nombre = usuario ? (usuario.nombre || usuario.email) : "";
  const e = estadisticasPerfil();
  const maxAno = Math.max(1, ...e.porAno.map(([, v]) => v.carreras));

  const hoy = hoyISO();
  const favs = idsFavoritas();
  const proximas = AppState.races.filter(c => favs.has(c.id) && c.fecha >= hoy).sort(porFecha).slice(0, 3);

  panel.innerHTML = `
    <div class="perfil-cabecera">
      <span class="perfil-avatar" aria-hidden="true">${usuario ? escapeHtml(nombre.charAt(0).toUpperCase()) : "🏃"}</span>
      <div class="perfil-quien">
        <p class="perfil-nombre">${usuario ? escapeHtml(usuario.nombre || "Tu perfil") : "Tu perfil"}</p>
        <p class="perfil-sub">${usuario
          ? escapeHtml(usuario.email)
          : `Sin cuenta: estos datos solo están en este dispositivo. <button class="perfil-enlace" id="perfil-crear-cuenta">Crea una cuenta</button> para no perderlos.`}</p>
      </div>
    </div>

    <div class="perfil-cifras">
      <div class="perfil-cifra"><strong>${e.total}</strong><span>${e.total === 1 ? "carrera" : "carreras"}</span></div>
      <div class="perfil-cifra"><strong>${formatearKm(e.km)}</strong><span>km</span></div>
      <div class="perfil-cifra"><strong>${e.tiempo ? escapeHtml(formatearDuracion(e.tiempo)) : "—"}</strong><span>corriendo</span></div>
      <div class="perfil-cifra"><strong>${e.pueblos}</strong><span>${e.pueblos === 1 ? "pueblo" : "pueblos"}</span></div>
    </div>
    ${e.total ? `<p class="perfil-nota">🏃 ${e.total - e.trail} de asfalto · ⛰️ ${e.trail} de trail${e.sinKm
      ? ` · ${e.sinKm} sin distancia apuntada (no suman km: abre la carrera y apunta tu tiempo y distancia)` : ""}</p>` : ""}

    ${e.porAno.length ? `
    <p class="perfil-titulo">📅 Por año</p>
    <div class="perfil-anos">
      ${e.porAno.map(([ano, v]) => `
        <div class="perfil-ano">
          <span class="perfil-ano-nombre">${escapeHtml(ano)}</span>
          <span class="perfil-barra"><span style="width:${Math.max(6, Math.round(v.carreras / maxAno * 100))}%"></span></span>
          <span class="perfil-ano-dato">${v.carreras} ${v.carreras === 1 ? "carrera" : "carreras"} · ${formatearKm(v.km)} km</span>
        </div>`).join("")}
    </div>` : ""}

    <p class="perfil-titulo">🏆 Mejores marcas</p>
    ${htmlMejoresMarcas(mejoresMarcas())}

    <p class="perfil-titulo">❤️ Tus próximas favoritas</p>
    ${proximas.length ? `
    <div class="perfil-proximas">
      ${proximas.map(c => {
        const dias = calcularDiasRestantes(c.fecha);
        return `<button class="perfil-proxima" data-id="${escapeHtml(c.id)}">
          <span class="perfil-proxima-nombre">${escapeHtml(c.nombre)}</span>
          <span class="perfil-proxima-dato">${escapeHtml(fechaCorta(c.fecha))} · ${dias === 0 ? "¡hoy!" : dias === 1 ? "mañana" : `faltan ${dias} días`}</span>
        </button>`;
      }).join("")}
    </div>` : `<p class="marcas-ayuda">Pulsa ♡ en las carreras que te interesen y aquí verás cuánto falta para cada una.</p>`}

    ${e.porProvincia.length ? `
    <p class="perfil-titulo">📍 Dónde has corrido</p>
    <p class="perfil-provincias">${e.porProvincia.map(([p, n]) => `<span class="perfil-provincia">${escapeHtml(p)} <strong>${n}</strong></span>`).join("")}</p>
    <p class="perfil-nota">En el mapa ves todas tus carreras; abajo, la lista completa.</p>` : ""}`;

  enlazarFichas(panel);
  const crear = panel.querySelector("#perfil-crear-cuenta");
  if (crear) crear.addEventListener("click", () => abrirCuenta());
}

// ==========================================================================
// Compartir una carrera
// ==========================================================================

function enlaceCarrera(c) {
  return `${location.origin}${location.pathname}?carrera=${encodeURIComponent(c.id)}`;
}

async function compartirCarrera(c) {
  // Se comparte la web oficial de la carrera; solo si no tiene, la ficha de RunNear
  const oficial = urlSegura(c.url_oficial);
  const url = oficial !== "#" ? oficial : enlaceCarrera(c);
  const texto = `🏃 ${c.nombre} · ${fechaCorta(c.fecha)} en ${c.municipio}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: c.nombre, text: texto, url });
    } catch (e) {
      // El usuario ha cerrado el menú de compartir: no es un error
    }
    return;
  }
  try {
    await navigator.clipboard.writeText(`${texto}\n${url}`);
    mostrarToast("🔗 Enlace copiado: pégalo donde quieras");
  } catch (e) {
    window.prompt("Copia este enlace:", url);
  }
}

/** Al abrir un enlace compartido (?carrera=<id>) se abre directamente su ficha */
function abrirCarreraCompartida() {
  const parametros = new URLSearchParams(location.search);
  const id = parametros.get("carrera");
  if (!id) return;
  const carrera = AppState.races.find(c => c.id === id);
  if (carrera) {
    abrirModalDetallePorId(id);
  } else {
    mostrarToast("Esa carrera ya no está en el calendario");
  }
  // Quitar el parámetro para que al recargar no se vuelva a abrir
  parametros.delete("carrera");
  const resto = parametros.toString();
  history.replaceState(null, "", location.pathname + (resto ? "?" + resto : "") + location.hash);
}

// ==========================================================================
// Tiempo previsto para el día de la carrera (Open-Meteo, gratuito y sin clave)
// ==========================================================================

const DIAS_PREVISION = 15; // Open-Meteo da previsión hasta 16 días
const PREVISIONES = new Map();

function estadoCielo(codigo) {
  if (codigo === 0) return ["☀️", "Despejado"];
  if (codigo === 1) return ["🌤️", "Casi despejado"];
  if (codigo === 2) return ["⛅", "Intervalos de nubes"];
  if (codigo === 3) return ["☁️", "Nublado"];
  if (codigo === 45 || codigo === 48) return ["🌫️", "Niebla"];
  if (codigo >= 51 && codigo <= 57) return ["🌦️", "Llovizna"];
  if (codigo >= 61 && codigo <= 67) return ["🌧️", "Lluvia"];
  if (codigo >= 71 && codigo <= 77) return ["🌨️", "Nieve"];
  if (codigo >= 80 && codigo <= 82) return ["🌦️", "Chubascos"];
  if (codigo === 85 || codigo === 86) return ["🌨️", "Chubascos de nieve"];
  if (codigo >= 95) return ["⛈️", "Tormenta"];
  return ["🌡️", "—"];
}

async function obtenerPrevision(c) {
  const { lat, lng } = c.ubicacion;
  const clave = `${lat.toFixed(2)},${lng.toFixed(2)},${c.fecha}`;
  if (PREVISIONES.has(clave)) return PREVISIONES.get(clave);
  const parametros = new URLSearchParams({
    latitude: lat.toFixed(3),
    longitude: lng.toFixed(3),
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max",
    hourly: "temperature_2m,weather_code,precipitation_probability",
    timezone: "Europe/Madrid",
    start_date: c.fecha,
    end_date: c.fecha
  });
  const respuesta = await fetch(`https://api.open-meteo.com/v1/forecast?${parametros}`);
  if (!respuesta.ok) throw new Error(`Open-Meteo ${respuesta.status}`);
  const datos = await respuesta.json();
  PREVISIONES.set(clave, datos);
  return datos;
}

async function mostrarTiempoPrevisto(carrera) {
  const caja = document.getElementById("modal-tiempo");
  if (!caja) return;
  caja.classList.add("hidden");
  caja.innerHTML = "";

  const dias = calcularDiasRestantes(carrera.fecha);
  if (dias === null || dias < 0 || dias > DIAS_PREVISION || !carrera.ubicacion) return;

  let datos;
  try {
    datos = await obtenerPrevision(carrera);
  } catch (e) {
    return; // Sin conexión o servicio caído: simplemente no se muestra
  }
  // Mientras llegaba la previsión se pudo abrir otra carrera
  if (!AppState.carreraAbierta || AppState.carreraAbierta.id !== carrera.id) return;

  const d = datos.daily;
  if (!d || !d.time || !d.time.length || d.temperature_2m_max[0] == null) return;
  const [icono, texto] = estadoCielo(d.weather_code[0]);

  // A la hora de salida, si se conoce
  let salida = "";
  if (carrera.hora && datos.hourly) {
    const i = datos.hourly.time.indexOf(`${carrera.fecha}T${carrera.hora.slice(0, 2)}:00`);
    if (i >= 0 && datos.hourly.temperature_2m[i] != null) {
      const [iconoH, textoH] = estadoCielo(datos.hourly.weather_code[i]);
      const lluviaH = datos.hourly.precipitation_probability[i];
      salida = `<p class="tiempo-salida">A la salida (${escapeHtml(carrera.hora)}): <strong>${Math.round(datos.hourly.temperature_2m[i])} °C</strong>
        ${iconoH} ${escapeHtml(textoH)}${lluviaH != null ? ` · lluvia ${lluviaH} %` : ""}</p>`;
    }
  }

  const lluvia = d.precipitation_probability_max[0];
  caja.innerHTML = `
    <h3 class="section-title">🌤️ Tiempo previsto</h3>
    <div class="tiempo-resumen">
      <span class="tiempo-icono">${icono}</span>
      <div>
        <p class="tiempo-texto">${escapeHtml(texto)}</p>
        <p class="tiempo-datos">${Math.round(d.temperature_2m_min[0])}° / ${Math.round(d.temperature_2m_max[0])}°
          ${lluvia != null ? ` · 💧 ${lluvia} %` : ""} · 💨 ${Math.round(d.wind_speed_10m_max[0])} km/h</p>
      </div>
    </div>
    ${salida}
    <p class="tiempo-nota">${dias > 7 ? "Previsión a más de una semana: puede cambiar bastante. " : ""}Datos: <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo.com</a></p>`;
  caja.classList.remove("hidden");
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
    if (marcaDe(c.id) && !confirm("Se borrará también el tiempo que apuntaste. ¿Seguir?")) return;
    const ahora = alternarCorrida(c);
    actualizarAccionesFicha(c);
    mostrarToast(ahora ? "✅ Guardada en «Ya corridas»" : "Quitada de «Ya corridas»");
    if (esVistaDeCorridas()) aplicarFiltrosYRenderizar();
    if (typeof mostrarValoraciones === "function") mostrarValoraciones(c);
  });
  document.getElementById("btn-ficha-compartir").addEventListener("click", () => {
    const c = AppState.carreraAbierta;
    if (c) compartirCarrera(c);
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
        <li>El calendario se actualiza cada día uniendo varias fuentes y quitando las carreras repetidas:
          Carreras CLM, Deportes Dipualba, Circuito de Carreras de Ciudad Real, el calendario de montaña de la FDMCM
          (vía Carreras de Montaña por Mayayo), carreraspopulares.com, Runnea y Running.life.</li>
        <li>Precios, desniveles e inscritos se leen de la web de inscripción de cada carrera. Algunos desniveles de trail salen de las noticias de la FDMCM.</li>
        <li>El tiempo previsto (cuando faltan 15 días o menos) es de Open-Meteo.com: solo se le envía la ubicación de la carrera, nunca la tuya.</li>
        <li>Confirma siempre fecha y detalles en la web oficial antes de inscribirte.</li>
      </ul>
      <h3>Mapa</h3>
      <p>Calles, pueblos y caminos: © colaboradores de OpenStreetMap (licencia ODbL). Mapa general: Natural Earth (dominio público).</p>
      <h3>Privacidad</h3>
      <p>Tu ubicación solo se usa en tu dispositivo para calcular distancias: no se envía ni se guarda en ningún servidor. Tus favoritas, carreras corridas y ajustes se guardan únicamente en este dispositivo.</p>
      <p><a href="legal.html">Política de privacidad y aviso legal</a></p>
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
        ${typeof Cuenta !== "undefined" && Cuenta.usuario
          ? `<p class="ajuste-ayuda">${idsFavoritas().size} favoritas y ${listaCorridas().length} carreras corridas guardadas en tu cuenta (${escapeHtml(Cuenta.usuario.email)}).</p>
             <button class="btn-secondary" id="ajuste-cuenta">Gestionar mi cuenta</button>`
          : `<p class="ajuste-ayuda">${idsFavoritas().size} favoritas y ${listaCorridas().length} carreras corridas guardadas en este dispositivo.</p>
             <button class="btn-secondary" id="ajuste-borrar">Borrar todos mis datos</button>`}
        <p class="ajuste-ayuda"><a href="legal.html#privacidad">Cómo tratamos tus datos</a></p>
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
  const gestionarCuenta = document.getElementById("ajuste-cuenta");
  if (gestionarCuenta) gestionarCuenta.addEventListener("click", () => {
    cerrarInfo();
    abrirCuenta();
  });
  const borrarDatos = document.getElementById("ajuste-borrar");
  if (borrarDatos) borrarDatos.addEventListener("click", () => {
    if (!confirm("¿Borrar de este dispositivo tus favoritas, carreras corridas, tiempos y ajustes?")) return;
    try {
      Object.keys(localStorage).filter(k => k.startsWith("runnear_")).forEach(k => localStorage.removeItem(k));
    } catch (e) {
      // Sin acceso al almacenamiento: no hay nada guardado que borrar
    }
    aplicarTema("oscuro");
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
  // El radio inicial lo pone app.js según la ubicación de referencia (usarUbicacionPorDefecto)

  document.querySelectorAll(".menu-item[data-vista]").forEach(b => b.addEventListener("click", () => aplicarVista(b.dataset.vista)));
  document.querySelectorAll(".menu-grupo").forEach(b => b.addEventListener("click", () => abrirGrupo(b)));

  const acciones = {
    "ics-favoritas": exportarFavoritasICS,
    cuenta: () => abrirCuenta(),
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
