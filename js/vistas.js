/**
 * RunNear - Secciones del menú ("vistas"): cada una filtra y ordena la lista y el mapa;
 * y el propio menú lateral (grupos, zonas, circuitos, contadores, móvil).
 * lista.js consulta obtenerVista() al filtrar y llama a alAplicarVista() al terminar.
 */

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
    case "com":
      return { titulo: `🗺️ ${valor}`, filtro: c => comunidadDe(c) === valor, orden: porFecha, ignorarRadio: true };
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

/** Lo llama lista.js después de filtrar y dibujar */
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
  construirMenuZonas();
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

// Las carreras ya traen "comunidad"; COMUNIDAD_DE_PROVINCIA (provincias.js) cubre las que no
function comunidadDe(c) {
  return c.comunidad || COMUNIDAD_DE_PROVINCIA[c.provincia] || null;
}

/** Menú "Por zona": comunidades con carreras próximas y, debajo, sus provincias */
let zonasMostradas = "";
function construirMenuZonas() {
  const cont = document.getElementById("menu-zonas");
  if (!cont) return;
  const hoy = hoyISO();
  const conteo = new Map(); // comunidad -> Map(provincia -> n)
  AppState.races.forEach(c => {
    const comunidad = comunidadDe(c);
    if (!comunidad || !c.fecha || c.fecha < hoy) return;
    if (!conteo.has(comunidad)) conteo.set(comunidad, new Map());
    const provincias = conteo.get(comunidad);
    provincias.set(c.provincia, (provincias.get(c.provincia) || 0) + 1);
  });
  const comunidades = [...conteo.keys()].sort((a, b) => a.localeCompare(b, "es"));
  const clave = comunidades.map(c => c + [...conteo.get(c)].join()).join("|");
  if (clave === zonasMostradas) return;
  zonasMostradas = clave;

  cont.innerHTML = comunidades.length ? comunidades.map(comunidad => {
    const provincias = [...conteo.get(comunidad)].sort((a, b) => a[0].localeCompare(b[0], "es"));
    const total = provincias.reduce((s, [, n]) => s + n, 0);
    // En comunidades de una sola provincia no hace falta repetirla
    const lista = provincias.length > 1 ? provincias.map(([p, n]) =>
      `<button class="menu-item menu-provincia" data-vista="prov:${escapeHtml(p)}">${escapeHtml(p)}<span class="menu-num">${n}</span></button>`).join("") : "";
    return `<button class="menu-item menu-comunidad" data-vista="com:${escapeHtml(comunidad)}">${escapeHtml(comunidad)}<span class="menu-num">${total}</span></button>${lista}`;
  }).join("") : `<p class="menu-vacio">Sin carreras próximas</p>`;

  cont.querySelectorAll(".menu-item").forEach(b => {
    b.classList.toggle("activo", b.dataset.vista === AppState.vista);
    b.addEventListener("click", () => aplicarVista(b.dataset.vista));
  });
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
