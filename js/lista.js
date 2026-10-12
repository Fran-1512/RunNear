/**
 * RunNear - Carreras: carga de carreras.json, búsqueda, filtros y lista de resultados.
 */

// ==========================================================================
// Carga de las carreras (carreras.json, que actualiza GitHub cada día)
// ==========================================================================

async function cargarCarreras() {
  try {
    const respuesta = await fetch("carreras.json");
    if (!respuesta.ok) throw new Error(`carreras.json: ${respuesta.status}`);
    AppState.races = await respuesta.json();
  } catch (err) {
    console.error("No se pudieron cargar las carreras:", err);
    mostrarToast("Error al cargar las carreras");
    AppState.races = [];
  }

  // Actualizar contador total en el header
  const totalBadge = document.getElementById("total-races-count");
  // Solo las próximas: las celebradas en las últimas semanas están para "Resultados"
  if (totalBadge) totalBadge.textContent = AppState.races.filter(c => !estaCelebrada(c)).length;

  aplicarFiltrosYRenderizar();
  // Enlace compartido (?carrera=<id>): abrir su ficha
  if (typeof abrirCarreraCompartida === "function") abrirCarreraCompartida();
  // Carreras propuestas recién aprobadas (no esperan a la actualización diaria)
  if (typeof incorporarPropuestasAprobadas === "function") incorporarPropuestasAprobadas();
}

// ==========================================================================
// Lógica de Filtrado y Búsqueda
// ==========================================================================

// ==========================================================================
// Búsqueda de carreras
// ==========================================================================

/**
 * "Alcázar  de San Juan" -> "alcazar de san juan" (sin tildes, minúsculas, espacios simples)
 */
function normalizarTexto(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function palabrasBusqueda(busqueda) {
  return normalizarTexto(busqueda).split(" ").filter(Boolean);
}

function textoBuscable(c) {
  return normalizarTexto([c.nombre, c.municipio, c.provincia, c.circuito, c.descripcion,
    c.tipo === "trail" ? "trail montaña" : "popular asfalto"].join(" "));
}

/**
 * Lista desplegable bajo el buscador con las primeras coincidencias
 */
function actualizarSugerencias(resultados) {
  const caja = document.getElementById("sugerencias-busqueda");
  const input = document.getElementById("filter-search-input");
  if (!caja || !input) return;

  const hayBusqueda = palabrasBusqueda(AppState.filters.search).length > 0;
  if (!hayBusqueda || document.activeElement !== input) {
    caja.classList.add("hidden");
    return;
  }

  if (resultados.length === 0) {
    caja.innerHTML = `<div class="sugerencia-vacia">No hay carreras con "${escapeHtml(AppState.filters.search.trim())}"</div>`;
  } else {
    const MAX = 6;
    caja.innerHTML = resultados.slice(0, MAX).map(c => `
      <button type="button" class="sugerencia" data-id="${escapeHtml(c.id)}">
        <span class="sugerencia-icono">${c.tipo === "trail" ? "⛰️" : "🏃"}</span>
        <span class="sugerencia-texto">
          <span class="sugerencia-nombre">${escapeHtml(c.nombre)}</span>
          <span class="sugerencia-detalle">${escapeHtml(c.municipio || "")} · ${escapeHtml(formatearFechaLegible(c.fecha))}</span>
        </span>
      </button>
    `).join("") + (resultados.length > MAX
      ? `<div class="sugerencia-mas">y ${resultados.length - MAX} más en la lista</div>` : "");
  }
  caja.classList.remove("hidden");
}

function elegirSugerencia(carreraId) {
  const caja = document.getElementById("sugerencias-busqueda");
  if (caja) caja.classList.add("hidden");
  document.getElementById("filter-search-input").blur();
  abrirModalDetallePorId(carreraId);
  centrarEnCarrera(carreraId);
}

function aplicarFiltrosYRenderizar() {
  const { search, type, distance, fecha, radiusKm, sort } = AppState.filters;
  const userLat = AppState.userLocation.lat;
  const userLng = AppState.userLocation.lng;

  // Sección del menú elegida (vistas.js): puede traer su propia lista, filtro y orden
  const vista = typeof obtenerVista === "function" ? obtenerVista(AppState.vista || "todas") : {};
  const origen = vista.origen ? vista.origen() : AppState.races;

  // 1. Calcular distancia para cada carrera y aplicar filtros
  let resultados = origen.map(c => {
    const distUsuario = (c.ubicacion && c.ubicacion.lat && c.ubicacion.lng)
      ? calcularDistanciaHaversine(userLat, userLng, c.ubicacion.lat, c.ubicacion.lng)
      : null;
    return { ...c, distancia_usuario_km: distUsuario };
  });

  // Ocultar carreras ya celebradas (salvo en "Ya corridas")
  if (!vista.incluirPasadas) {
    resultados = resultados.filter(c => {
      const dias = calcularDiasRestantes(c.fecha);
      return dias === null || dias >= 0;
    });
  }

  // Filtro de la sección del menú
  if (vista.filtro) resultados = resultados.filter(vista.filtro);

  // Filtro por fecha (botones "Este finde", "7 días", "Este mes")
  const rango = typeof rangoFecha === "function" ? rangoFecha(fecha) : null;
  if (rango) resultados = resultados.filter(c => c.fecha && c.fecha >= rango[0] && c.fecha <= rango[1]);

  const buscando = palabrasBusqueda(search).length > 0;

  // Filtro por modalidad (todas, popular, trail)
  if (type !== "todas") {
    resultados = resultados.filter(c => c.tipo === type);
  }

  // Filtro por longitud de prueba: basta con que UNA de sus distancias encaje.
  // Las carreras sin distancia conocida solo aparecen con "Cualquiera".
  if (distance !== "todas") {
    resultados = resultados.filter(c => listaDistancias(c).some(km => {
      if (distance === "corta") return km <= 10;
      if (distance === "media") return km > 10 && km <= 21.5;
      if (distance === "larga") return km > 21.5 && km <= 43;
      if (distance === "ultra") return km > 43;
      return true;
    }));
  }

  // Búsqueda por texto: todas las palabras escritas deben aparecer (en cualquier orden)
  // en el nombre, municipio, provincia, circuito o descripción; sin tildes ni mayúsculas
  if (buscando) {
    const palabras = palabrasBusqueda(search);
    resultados = resultados.filter(c => {
      const texto = textoBuscable(c);
      return palabras.every(p => texto.includes(p));
    });
  }

  // Filtro por radio de proximidad (el último, para saber qué habría fuera del radio).
  // Al buscar por texto se ignora (quien busca una carrera concreta quiere encontrarla
  // esté donde esté), y también en las secciones del menú que abarcan toda la región
  const radioActivo = radiusKm > 0 && !buscando && !vista.ignorarRadio;
  let fueraDelRadio = [];
  if (radioActivo) {
    fueraDelRadio = resultados.filter(c => c.distancia_usuario_km !== null && c.distancia_usuario_km > radiusKm);
    resultados = resultados.filter(c => c.distancia_usuario_km === null || c.distancia_usuario_km <= radiusKm);
  }

  // Ordenación (las secciones del menú pueden imponer la suya)
  if (vista.orden) {
    resultados.sort(vista.orden);
  } else if (sort === "distancia") {
    resultados.sort((a, b) => (a.distancia_usuario_km ?? 99999) - (b.distancia_usuario_km ?? 99999));
  } else if (sort === "fecha") {
    resultados.sort((a, b) => (a.fecha || "9999").localeCompare(b.fecha || "9999"));
  } else if (sort === "km") {
    resultados.sort((a, b) => (a.distancia_km ?? 99999) - (b.distancia_km ?? 99999));
  } else if (sort === "desnivel") {
    resultados.sort((a, b) => parseInt(b.desnivel_positivo_m || 0) - parseInt(a.desnivel_positivo_m || 0));
  }

  AppState.filteredRaces = resultados;

  // Actualizar círculo de radio en el mapa (oculto cuando el radio no se aplica)
  if (AppState.radiusCircle) {
    AppState.radiusCircle.setRadius(radiusKm * 1000);
    AppState.radiusCircle.setStyle({ opacity: radioActivo ? 1 : 0, fillOpacity: radioActivo ? 0.05 : 0 });
  }

  // Subtítulo de la lista: aclarar que la búsqueda es en toda la región
  const subtitulo = document.getElementById("results-sub-text");
  if (subtitulo) {
    const ordenes = { distancia: "por proximidad", fecha: "por fecha", km: "por longitud", desnivel: "por desnivel" };
    const base = buscando ? "Buscando en toda la región"
      : vista.ignorarRadio ? "En toda la región"
      : `Ordenadas ${ordenes[sort] || ""}`;
    // Con un filtro de fecha se indican los días exactos ("sáb, 10 oct – dom, 11 oct")
    subtitulo.textContent = rango ? `${textoRangoFecha(rango)} · ${base.charAt(0).toLowerCase()}${base.slice(1)}` : base;
  }

  // Renderizar componentes
  renderizarListadoCarreras(resultados, vista.vacio, {
    filtrosActivos: type !== "todas" || distance !== "todas" || fecha !== "todas",
    radioActivo,
    // Carrera más cercana que cumple los demás filtros pero queda fuera del radio
    masCercanaKm: fueraDelRadio.length ? Math.min(...fueraDelRadio.map(c => c.distancia_usuario_km)) : null
  });
  actualizarSugerencias(resultados);
  if (typeof alAplicarVista === "function") alAplicarVista(resultados);
  renderizarMarcadoresEnMapa(resultados);
}

// ==========================================================================
// Renderizado del Listado de Carreras (DOM)
// ==========================================================================

/** Marca un botón de fecha ("finde", "7dias", "mes" o "todas") y, si se pide, filtra */
function seleccionarFecha(id, filtrar = true) {
  AppState.filters.fecha = id;
  document.querySelectorAll(".chip-fecha").forEach(b => {
    const activo = b.dataset.fecha === id;
    b.classList.toggle("active", activo);
    b.setAttribute("aria-checked", String(activo));
  });
  if (filtrar) aplicarFiltrosYRenderizar();
}

const RADIO_MAXIMO_KM = RADIO_SIN_LIMITE - 5; // el máximo del deslizador antes de "Sin límite"

function ampliarRadio(km) {
  ponerRadio(km);
  aplicarFiltrosYRenderizar();
}

/** Mensaje y botones cuando no hay ninguna carrera que mostrar */
function htmlListaVacia(mensajeVacio, contexto) {
  const { filtrosActivos, radioActivo, masCercanaKm } = contexto;
  const buscando = palabrasBusqueda(AppState.filters.search).length > 0;
  let titulo, texto;
  const botones = [];

  if (buscando) {
    titulo = "No encontramos esa carrera";
    texto = "Revisa cómo está escrito, prueba con menos palabras (por ejemplo, solo el pueblo) o quita los filtros de modalidad y distancia.";
    botones.push(`<button class="btn-secondary" data-accion="restablecer">Restablecer filtros</button>`);
  } else if (filtrosActivos || radioActivo || !mensajeVacio) {
    titulo = "No hay carreras con estos filtros";
    if (radioActivo && masCercanaKm !== null) {
      const sugerido = Math.ceil(masCercanaKm / 5) * 5;
      texto = `Prueba a ampliar el radio de búsqueda: la carrera más cercana que cumple tus filtros está a ${String(masCercanaKm).replace(".", ",")} km.`;
      if (sugerido <= RADIO_MAXIMO_KM) {
        botones.push(`<button class="btn-primary" data-accion="ampliar" data-km="${sugerido}">Ampliar a ${sugerido} km</button>`);
      }
    } else if (radioActivo) {
      texto = "Ni ampliando el radio hay carreras con estos filtros. Prueba a quitar alguno (fecha, modalidad o distancia).";
    } else {
      texto = "Prueba a quitar algún filtro (fecha, modalidad o distancia).";
    }
    if (filtrosActivos) botones.push(`<button class="btn-secondary" data-accion="restablecer">Quitar filtros</button>`);
  } else {
    titulo = "Nada por aquí todavía";
    texto = mensajeVacio;
  }

  return `
    <div class="empty-state">
      <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" style="color: #64748b;">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="8" y1="12" x2="16" y2="12"></line>
      </svg>
      <h3>${escapeHtml(titulo)}</h3>
      <p>${escapeHtml(texto)}</p>
      ${botones.length ? `<div class="empty-state-botones">${botones.join("")}</div>` : ""}
    </div>`;
}

function renderizarListadoCarreras(carreras, mensajeVacio, contexto = {}) {
  const container = document.getElementById("races-list-container");
  const countBadge = document.getElementById("results-count-number");
  if (!container) return;

  if (countBadge) countBadge.textContent = carreras.length;
  const etiquetaContador = document.getElementById("results-count-label");
  if (etiquetaContador) etiquetaContador.textContent = carreras.length === 1 ? "carrera encontrada" : "carreras encontradas";

  if (carreras.length === 0) {
    container.innerHTML = htmlListaVacia(mensajeVacio, { filtrosActivos: false, radioActivo: false, masCercanaKm: null, ...contexto });
    return;
  }

  container.innerHTML = "";
  // Con miles de carreras, se pintan por tandas al bajar por la lista
  listaPaginada.empezar(container, carreras);
}

const TARJETAS_POR_TANDA = 40;
const ANUNCIO_CADA = 10;

function crearHuecoAnuncio() {
  const hueco = document.createElement("div");
  hueco.className = "anuncio";
  hueco.dataset.tipo = "lista";
  return hueco;
}

const listaPaginada = {
  carreras: [],
  mostradas: 0,
  observador: null,

  empezar(container, carreras) {
    this.container = container;
    this.carreras = carreras;
    this.mostradas = 0;
    this.siguiente();
  },

  siguiente() {
    const { container, carreras } = this;
    const viejo = container.querySelector(".lista-mas");
    if (viejo) viejo.remove();
    const fragmento = document.createDocumentFragment();
    const fin = Math.min(carreras.length, this.mostradas + TARJETAS_POR_TANDA);
    const conAnuncios = window.RunNearAnuncios && window.RunNearAnuncios.activos;
    for (let i = this.mostradas; i < fin; i++) {
      fragmento.appendChild(crearTarjeta(carreras[i]));
      // Un anuncio tras la 5.ª carrera y luego cada 10 (nunca al final de la lista)
      if (conAnuncios && i % ANUNCIO_CADA === 4 && i < carreras.length - 1) fragmento.appendChild(crearHuecoAnuncio());
    }
    this.mostradas = fin;
    container.appendChild(fragmento);
    if (conAnuncios) window.RunNearAnuncios.activar(container);

    const quedan = carreras.length - this.mostradas;
    if (quedan <= 0) return;
    // Botón "Ver más" que además se pulsa solo al llegar a él
    const mas = document.createElement("button");
    mas.className = "btn-secondary lista-mas";
    mas.textContent = `Ver ${Math.min(quedan, TARJETAS_POR_TANDA)} más (quedan ${quedan})`;
    mas.addEventListener("click", () => this.siguiente());
    container.appendChild(mas);
    if ("IntersectionObserver" in window) {
      if (this.observador) this.observador.disconnect();
      this.observador = new IntersectionObserver(entradas => {
        if (entradas.some(e => e.isIntersecting)) {
          this.observador.disconnect();
          this.siguiente();
        }
      }, { rootMargin: "400px" });
      this.observador.observe(mas);
    }
  },

  /** Muestra hasta la carrera indicada (para resaltarla en la lista) */
  mostrarHasta(carreraId) {
    const i = this.carreras.findIndex(c => c.id === carreraId);
    while (i >= this.mostradas && this.mostradas < this.carreras.length) this.siguiente();
  }
};

function crearTarjeta(c) {
    const isTrail = c.tipo === "trail";
    const typeLabel = isTrail ? "⛰️ Trail" : "🏃 Asfalto";
    const typeBadgeClass = isTrail ? "badge-trail" : "badge-popular";
    const cardClass = isTrail ? "type-trail" : "type-popular";
    const distUsuarioStr = c.distancia_usuario_km !== null
      ? `A ${c.distancia_usuario_km} km de ti`
      : "Distancia no disp.";

    const dias = calcularDiasRestantes(c.fecha);
    let diasStr = "";
    if (dias !== null) {
      if (dias > 1) diasStr = `• Faltan ${dias} días`;
      else if (dias === 1) diasStr = `• ¡Mañana!`;
      else if (dias === 0) diasStr = `• ¡Hoy!`;
      else if (dias === -1) diasStr = `• Ayer`;
      else diasStr = `• Hace ${-dias} días`;
    }

    // Carrera ya celebrada: el botón lleva a los resultados en vez de a la inscripción
    const celebrada = dias !== null && dias < 0;
    const resultados = celebrada ? enlacesResultados(c) : null;
    const botonExterno = celebrada
      ? `<a href="${escapeHtml(urlSegura(resultados.enlaces[0].url))}" target="_blank" rel="noopener noreferrer"
           class="card-mini-btn btn-external btn-resultados" title="${escapeHtml(resultados.enlaces[0].texto)}">🏅 Resultados ↗</a>`
      : `<a href="${escapeHtml(urlSegura(c.url_oficial))}" target="_blank" rel="noopener noreferrer"
           class="card-mini-btn btn-external" title="Ir a la web de inscripción oficial">Web Oficial ↗</a>`;

    const card = document.createElement("article");
    card.className = `race-card ${cardClass}`;
    card.id = `card-${c.id}`;
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-label", `${c.nombre}, ${c.municipio}`);

    const favorita = typeof esFavorita === "function" && esFavorita(c.id);
    const tamano = typeof textoTamano === "function" ? textoTamano(c) : "";

    card.innerHTML = `
      <div class="card-header-row">
        <div class="badge-row">
          <span class="badge-tag ${typeBadgeClass}">${typeLabel}</span>
          <span class="badge-distance-km">${escapeHtml(textoDistancias(c))}</span>
        </div>
        <span class="user-proximity-tag">
          📍 ${distUsuarioStr}
        </span>
      </div>

      ${c.estado ? `<div class="aviso-estado">⚠️ Carrera ${escapeHtml(c.estado)} según su web de inscripción</div>` : ""}
      <h3 class="card-title">${escapeHtml(c.nombre)}</h3>
      <div class="card-location">
        <span>📍 ${escapeHtml(c.municipio || "Municipio")}, ${escapeHtml(c.provincia || "Provincia")}</span>
        ${tamano ? `<span class="card-tamano">👥 ${escapeHtml(tamano)}</span>` : ""}
        ${typeof insigniaValoracion === "function" ? insigniaValoracion(c) : ""}
      </div>
      ${c.marca && typeof textoMarca === "function" ? `<div class="card-marca">⏱️ Tu tiempo: ${escapeHtml(textoMarca(c.marca))}</div>` : ""}

      <div class="card-stats-grid">
        <div class="stat-item">
          <span class="stat-label">Distancia</span>
          <span class="stat-val">${escapeHtml(textoDistancias(c))}</span>
        </div>
        ${isTrail ? `
        <div class="stat-item">
          <span class="stat-label">Desnivel +D</span>
          ${c.desnivel_positivo_m != null
            ? `<span class="stat-val elevation">+${escapeHtml(c.desnivel_positivo_m)} m</span>`
            : `<span class="stat-val sin-dato">Sin publicar</span>`}
        </div>` : ""}
        <div class="stat-item">
          <span class="stat-label">Inscripción</span>
          ${c.precio_desde != null
            ? `<span class="stat-val">Desde ${escapeHtml(formatearPrecio(c.precio_desde))}</span>`
            : `<span class="stat-val sin-dato">Consultar</span>`}
        </div>
      </div>

      <div class="card-footer-actions">
        <span class="card-date-badge">
          📅 ${escapeHtml(formatearFechaLegible(c.fecha))} <small style="color:#64748b;">${diasStr}</small>
        </span>
        <div class="card-btn-group">
          <button class="card-mini-btn btn-favorita ${favorita ? "activa" : ""}" aria-pressed="${favorita}"
            title="${favorita ? "Quitar de favoritas" : "Añadir a favoritas"}" aria-label="${favorita ? "Quitar de favoritas" : "Añadir a favoritas"}">
            ${favorita ? "♥" : "♡"}
          </button>
          <button class="card-mini-btn btn-focus-map" data-id="${c.id}" title="Centrar en el mapa">
            📍 Mapa
          </button>
          ${botonExterno}
        </div>
      </div>
    `;

    // Interacciones de la tarjeta
    card.addEventListener("click", (e) => {
      // Si hizo clic directamente en el enlace externo o en favorita, no abrir modal
      if (e.target.closest(".btn-external") || e.target.closest(".btn-favorita")) return;
      abrirModalDetalleCarrera(c);
      centrarEnCarrera(c.id);
    });

    // Hover sincronizado con marcador del mapa
    card.addEventListener("mouseenter", () => resaltarMarcador(c.id, true));
    card.addEventListener("mouseleave", () => resaltarMarcador(c.id, false));

    const btnFav = card.querySelector(".btn-favorita");
    if (btnFav && typeof alternarFavorita === "function") {
      btnFav.addEventListener("click", (e) => {
        e.stopPropagation();
        const ahora = alternarFavorita(c.id);
        btnFav.classList.toggle("activa", ahora);
        btnFav.setAttribute("aria-pressed", String(ahora));
        btnFav.textContent = ahora ? "♥" : "♡";
        mostrarToast(ahora ? "❤️ Añadida a tus favoritas" : "Quitada de tus favoritas");
        // En la sección de favoritas, la que se quita desaparece de la lista
        if (AppState.vista === "favoritas") aplicarFiltrosYRenderizar();
      });
    }

    const btnMap = card.querySelector(".btn-focus-map");
    if (btnMap) {
      btnMap.addEventListener("click", (e) => {
        e.stopPropagation();
        centrarEnCarrera(c.id);
      });
    }

    return card;
}

function resetearFiltros() {
  // Radio por defecto elegido en Ajustes (ventanas.js)
  const radio = typeof radioPorDefecto === "function" ? radioPorDefecto() : 50;
  seleccionarFecha("todas", false);
  AppState.filters = {
    search: "",
    type: "todas",
    distance: "todas",
    fecha: "todas",
    radiusKm: radio,
    sort: "distancia"
  };

  // Actualizar controles UI
  const searchInput = document.getElementById("filter-search-input");
  if (searchInput) searchInput.value = "";
  
  const clearBtn = document.getElementById("btn-clear-search");
  if (clearBtn) clearBtn.classList.add("hidden");

  document.querySelectorAll(".filters-card .segment-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.type === "todas");
  });

  document.querySelectorAll(".chip-btn").forEach(chip => {
    chip.classList.toggle("active", chip.dataset.dist === "todas");
  });

  ponerRadio(radio);

  const sortSelect = document.getElementById("filter-sort-select");
  if (sortSelect) sortSelect.value = "distancia";

  aplicarFiltrosYRenderizar();
  mostrarToast("Filtros restablecidos");
}
