/**
 * RunNear - Lógica de Descubrimiento de Carreras & Geolocalización Interactiva
 */

// Región piloto: Castilla-La Mancha
const REGION = {
  nombre: "Castilla-La Mancha",
  centro: { lat: 39.5, lng: -3.0 },
  zoomInicial: 7,
  // Radio que cubre toda la región desde su centro (se usa si no hay GPS)
  radioCompletoKm: 250
};

// Estado global de la aplicación
const AppState = {
  userLocation: {
    lat: REGION.centro.lat,
    lng: REGION.centro.lng,
    label: `${REGION.nombre} (centro)`,
    isGps: false
  },
  filters: {
    search: "",
    type: "todas",
    distance: "todas",
    radiusKm: 50,
    sort: "distancia"
  },
  races: [],
  filteredRaces: [],
  map: null,
  clusterGroup: null,
  mapMarkers: {},
  userMarker: null,
  radiusCircle: null
};

// ==========================================================================
// Utilidades Matemáticas y de Formato
// ==========================================================================

/**
 * Cálculo de distancia Haversine en kilómetros entre dos coordenadas
 */
function calcularDistanciaHaversine(lat1, lon1, lat2, lon2) {
  const R = 6371.0; // Radio de la Tierra en km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

/**
 * Escapar texto antes de insertarlo como HTML (los datos vendrán de scraping)
 */
function escapeHtml(valor) {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Devolver la URL solo si es http(s); evita enlaces javascript: u otros esquemas
 */
function urlSegura(url) {
  try {
    const u = new URL(url);
    return (u.protocol === "http:" || u.protocol === "https:") ? u.href : "#";
  } catch (e) {
    return "#";
  }
}

/**
 * Distancias de una carrera como lista de km (puede estar vacía si no se conocen)
 */
function listaDistancias(c) {
  if (Array.isArray(c.distancias_km) && c.distancias_km.length) return c.distancias_km;
  return (c.distancia_km !== null && c.distancia_km !== undefined) ? [Number(c.distancia_km)] : [];
}

/**
 * Texto de distancias: "5 / 10 km", "21.1 km" o "Distancia por confirmar"
 */
function textoDistancias(c) {
  const lista = listaDistancias(c);
  if (!lista.length) return "Distancia por confirmar";
  return `${lista.map(km => Number(km.toFixed(1))).join(" / ")} km`;
}

/**
 * 9 -> "9 €", 17.5 -> "17,50 €"
 */
function formatearPrecio(valor) {
  const n = Number(valor);
  return Number.isInteger(n)
    ? `${n} €`
    : `${n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

/**
 * Formatear fecha legible en español
 */
function formatearFechaLegible(fechaStr) {
  if (!fechaStr) return "Fecha por confirmar";
  try {
    const [y, m, d] = fechaStr.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    const opciones = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' };
    return date.toLocaleDateString('es-ES', opciones);
  } catch (e) {
    return fechaStr;
  }
}

/**
 * Días restantes hasta el evento
 */
function calcularDiasRestantes(fechaStr) {
  if (!fechaStr) return null;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const [y, m, d] = fechaStr.split("-").map(Number);
  const fechaEvento = new Date(y, m - 1, d);
  const diffTime = fechaEvento - hoy;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

// ==========================================================================
// Inicialización del Mapa Leaflet
// ==========================================================================

function inicializarMapa() {
  const mapElement = document.getElementById("interactive-map");
  if (!mapElement) return;

  // Crear instancia de mapa
  AppState.map = L.map("interactive-map", {
    zoomControl: false,
    minZoom: 5,
    maxZoom: 18
  }).setView([REGION.centro.lat, REGION.centro.lng], REGION.zoomInicial);

  // Controles de zoom abajo a la derecha
  L.control.zoom({ position: "bottomright" }).addTo(AppState.map);

  // Si el contenedor cambia de tamaño después de crear el mapa (carga de fuentes, giro del
  // móvil, cambio de diseño...), Leaflet debe recalcularlo; si no, deja bandas sin dibujar
  if (window.ResizeObserver) {
    new ResizeObserver(() => AppState.map.invalidateSize({ animate: false })).observe(mapElement);
  }

  // Mapa base propio: sin servidores de mapas externos
  cargarMapaBase();

  // Grupo de marcadores agrupados (clusters) para las carreras
  AppState.clusterGroup = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 45
  }).addTo(AppState.map);

  // Renderizar marcador de usuario y círculo de radio
  actualizarMarcadorUsuarioEnMapa();

  // Permitir hacer clic en el mapa para mover la ubicación de referencia
  AppState.map.on("click", (e) => {
    establecerUbicacionUsuario(e.latlng.lat, e.latlng.lng, `Punto personalizado (${e.latlng.lat.toFixed(3)}, ${e.latlng.lng.toFixed(3)})`);
    mostrarToast("📍 Ubicación actualizada según clic en el mapa");
  });
}

async function cargarMapaBase() {
  try {
    (await crearMapaPropio()).addTo(AppState.map);
  } catch (err) {
    console.error("No se pudo cargar el mapa base:", err);
    mostrarToast("No se pudo cargar el mapa base");
  }

  // Capa detallada (calles, pueblos, caminos) a partir de ZOOM_DETALLE
  try {
    if (!AppState.map.getPane("mapaDetalle")) AppState.map.createPane("mapaDetalle").style.zIndex = 260;
    (await MapaDetalle.crear("mapaDetalle")).addTo(AppState.map);
  } catch (err) {
    console.error("No se pudo cargar el mapa detallado:", err);
  }
}

// Zoom desde el que se usa el mapa detallado de OpenStreetMap en Castilla-La Mancha
const ZOOM_DETALLE = 8;

/**
 * Punto [lng, lat] dentro de alguna geometría GeoJSON (Polygon / MultiPolygon), por ray casting
 */
function puntoEnGeometria(lng, lat, geom) {
  const poligonos = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  let dentro = false;
  for (const anillos of poligonos) {
    for (const anillo of anillos) {
      for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
        const [xi, yi] = anillo[i], [xj, yj] = anillo[j];
        if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) dentro = !dentro;
      }
    }
  }
  return dentro;
}

// ==========================================================================
// Mapa base propio (vectorial, generado con mapa/generar_mapa.py)
// ==========================================================================

const ESTILO_MAPA = {
  pais:          { color: "#c9c4b8", weight: 0.8, fillColor: "#ebe7df", fillOpacity: 1 },
  provincia:     { color: "#c2bcae", weight: 0.7, fillColor: "#f4f1ea", fillOpacity: 1, dashArray: "3 3" },
  provinciaCLM:  { color: "#8c7a5b", weight: 1.4, fillColor: "#fbf6e6", fillOpacity: 1 },
  rio:           { color: "#7fb3d5", weight: 1.3 },
  autovia:       { color: "#e39b54", weight: 2 },
  carretera:     { color: "#d6c7a1", weight: 1 }
};

/**
 * Zoom mínimo al que se muestra el nombre de una población
 */
function zoomMinimoEtiqueta(p) {
  if (p.capital || p.poblacion > 500000) return 5;
  if (p.poblacion > 100000) return 7;
  return 8;
}

async function crearMapaPropio() {
  const resp = await fetch("mapa/mapa_base.json");
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const { capas, fuente } = await resp.json();

  // Panel propio por debajo de marcadores y del círculo de radio
  if (!AppState.map.getPane("mapaBase")) {
    AppState.map.createPane("mapaBase").style.zIndex = 250;
    const paneEtiquetas = AppState.map.createPane("mapaEtiquetas");
    paneEtiquetas.style.zIndex = 450;
    paneEtiquetas.style.pointerEvents = "none";
  }
  const renderer = L.canvas({ pane: "mapaBase", padding: 0.5 });
  const opcionesBase = { pane: "mapaBase", renderer, interactive: false };

  const grupo = L.layerGroup([], { attribution: `Mapa: ${fuente}` });

  L.geoJSON(capas.paises, { ...opcionesBase, style: ESTILO_MAPA.pais }).addTo(grupo);
  L.geoJSON(capas.provincias, {
    ...opcionesBase,
    // Primero las demás provincias y encima las de la región, para que su borde se vea entero
    filter: f => !f.properties.destacada,
    style: ESTILO_MAPA.provincia
  }).addTo(grupo);
  const provinciasCLM = L.geoJSON(capas.provincias, {
    ...opcionesBase,
    filter: f => f.properties.destacada,
    style: ESTILO_MAPA.provinciaCLM
  }).addTo(grupo);
  // Ríos y carreteras simplificados: solo a poco zoom (con más zoom los dibuja el mapa detallado)
  const lineasSimples = L.layerGroup([
    L.geoJSON(capas.rios, { ...opcionesBase, style: ESTILO_MAPA.rio }),
    L.geoJSON(capas.carreteras, {
      ...opcionesBase,
      style: f => f.properties.tipo === "autovia" ? ESTILO_MAPA.autovia : ESTILO_MAPA.carretera
    })
  ]).addTo(grupo);

  // Nombres de provincia de la región, en el centro de cada una (solo a poco zoom)
  const nombresProvincia = L.layerGroup().addTo(grupo);
  provinciasCLM.eachLayer(capa => {
    L.marker(capa.getBounds().getCenter(), {
      pane: "mapaEtiquetas",
      interactive: false,
      icon: L.divIcon({
        className: "etiqueta-provincia",
        html: escapeHtml(capa.feature.properties.nombre).toUpperCase(),
        iconSize: null
      })
    }).addTo(nombresProvincia);
  });

  // Poblaciones: se muestran u ocultan según el zoom. Las de Castilla-La Mancha las
  // sustituye el mapa detallado a partir de ZOOM_DETALLE.
  const geometriasCLM = capas.provincias.features.filter(f => f.properties.destacada).map(f => f.geometry);
  const etiquetas = L.layerGroup().addTo(grupo);
  const poblaciones = capas.poblaciones.features.map(f => ({
    zoomMin: zoomMinimoEtiqueta(f.properties),
    enCLM: geometriasCLM.some(g => puntoEnGeometria(f.geometry.coordinates[0], f.geometry.coordinates[1], g)),
    marker: L.marker([f.geometry.coordinates[1], f.geometry.coordinates[0]], {
      pane: "mapaEtiquetas",
      interactive: false,
      icon: L.divIcon({
        className: "etiqueta-poblacion",
        html: `<span class="punto"></span>${escapeHtml(f.properties.nombre)}`,
        iconSize: null,
        iconAnchor: [3, 3]
      })
    })
  }));
  const actualizarEtiquetas = () => {
    const z = AppState.map.getZoom();
    const detalle = z >= ZOOM_DETALLE;
    poblaciones.forEach(({ zoomMin, enCLM, marker }) => {
      if (z >= zoomMin && !(enCLM && detalle)) etiquetas.addLayer(marker);
      else etiquetas.removeLayer(marker);
    });
    for (const [capa, visible] of [[lineasSimples, !detalle], [nombresProvincia, z < 10]]) {
      if (visible) grupo.addLayer(capa);
      else grupo.removeLayer(capa);
    }
  };
  grupo.on("add", () => { AppState.map.on("zoomend", actualizarEtiquetas); actualizarEtiquetas(); });
  grupo.on("remove", () => AppState.map.off("zoomend", actualizarEtiquetas));

  return grupo;
}

// ==========================================================================
// Gestión de Ubicación del Usuario
// ==========================================================================

function actualizarMarcadorUsuarioEnMapa() {
  if (!AppState.map) return;

  const lat = AppState.userLocation.lat;
  const lng = AppState.userLocation.lng;

  // 1. Icono animado del usuario
  const userIcon = L.divIcon({
    className: "custom-user-pin",
    html: `
      <div class="user-marker-wrap" title="Tu ubicación de referencia">
        <div class="user-marker-pulse"></div>
        <div class="user-marker-core"></div>
      </div>
    `,
    iconSize: [22, 22],
    iconAnchor: [11, 11]
  });

  if (AppState.userMarker) {
    AppState.userMarker.setLatLng([lat, lng]);
  } else {
    AppState.userMarker = L.marker([lat, lng], {
      icon: userIcon,
      zIndexOffset: 1000
    }).addTo(AppState.map);

    AppState.userMarker.bindPopup(`
      <div class="popup-race-card">
        <div class="popup-title">📍 Tu Ubicación</div>
        <p class="popup-meta">${AppState.userLocation.label}</p>
        <span style="font-size:0.75rem; color:#94a3b8;">Buscando carreras en un radio de ${AppState.filters.radiusKm} km</span>
      </div>
    `);
  }

  // 2. Círculo de radio visual
  if (AppState.radiusCircle) {
    AppState.radiusCircle.setLatLng([lat, lng]);
    AppState.radiusCircle.setRadius(AppState.filters.radiusKm * 1000);
  } else {
    AppState.radiusCircle = L.circle([lat, lng], {
      radius: AppState.filters.radiusKm * 1000,
      color: '#6366f1',
      weight: 1.5,
      dashArray: '6, 6',
      fillColor: '#6366f1',
      fillOpacity: 0.05
    }).addTo(AppState.map);
  }
}

function establecerUbicacionUsuario(lat, lng, label, isGps = false) {
  AppState.userLocation = { lat, lng, label, isGps };
  
  // Actualizar etiqueta del header
  const labelEl = document.getElementById("user-location-label");
  if (labelEl) {
    labelEl.textContent = label;
  }

  actualizarMarcadorUsuarioEnMapa();
  AppState.map.panTo([lat, lng], { animate: true, duration: 0.8 });

  // Recalcular distancias y refrescar UI
  aplicarFiltrosYRenderizar();
}

/**
 * Sin GPS: centro de la región con un radio que la cubre entera
 */
function usarUbicacionPorDefecto() {
  AppState.filters.radiusKm = REGION.radioCompletoKm;
  const slider = document.getElementById("filter-radius-slider");
  if (slider) slider.value = REGION.radioCompletoKm;
  const radiusDisplay = document.getElementById("radius-display-value");
  if (radiusDisplay) radiusDisplay.textContent = `${REGION.radioCompletoKm} km`;

  establecerUbicacionUsuario(REGION.centro.lat, REGION.centro.lng, `${REGION.nombre} (centro)`);
}

function solicitarGeolocalizacionNavegador() {
  const labelEl = document.getElementById("user-location-label");
  if (labelEl) labelEl.textContent = "Obteniendo GPS...";

  if (!navigator.geolocation) {
    mostrarToast("Geolocalización no soportada en este navegador");
    usarUbicacionPorDefecto();
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      establecerUbicacionUsuario(lat, lng, `Tu ubicación GPS (${lat.toFixed(2)}, ${lng.toFixed(2)})`, true);
      mostrarToast("📍 Ubicación GPS obtenida correctamente");
    },
    (error) => {
      console.warn("Error de geolocalización:", error.message);
      // Mensaje según el motivo, para que el usuario sepa cómo arreglarlo
      const motivos = {
        1: "Ubicación bloqueada. Pulsa el icono a la izquierda de la dirección web, permite la ubicación y recarga.",
        2: "No se pudo determinar tu ubicación. Revisa que la ubicación del dispositivo esté activada.",
        3: "La ubicación tardó demasiado. Pulsa ↻ para reintentar."
      };
      mostrarToast(motivos[error.code] || `No se pudo obtener tu ubicación. Mostrando todo ${REGION.nombre}.`, 7000);
      usarUbicacionPorDefecto();
    },
    { timeout: 10000, enableHighAccuracy: true }
  );
}

// ==========================================================================
// Carga de Datos desde Backend o Local
// ==========================================================================

async function cargarCarrerasDesdeServidor() {
  const listContainer = document.getElementById("races-list-container");
  
  try {
    const response = await fetch("/api/carreras");
    if (!response.ok) throw new Error("Error en servidor API");
    const data = await response.json();
    AppState.races = data.carreras || [];
  } catch (err) {
    // Web estática (GitHub Pages): no hay servidor que guarde carreras nuevas
    const btnPublicar = document.getElementById("btn-open-add-race");
    if (btnPublicar) btnPublicar.style.display = "none";
    try {
      const localResp = await fetch("carreras.json");
      AppState.races = await localResp.json();
    } catch (localErr) {
      console.error("No se pudieron cargar los datos de carreras:", localErr);
      mostrarToast("Error al cargar datos de eventos");
      AppState.races = [];
    }
  }

  // Actualizar contador total en el header
  const totalBadge = document.getElementById("total-races-count");
  if (totalBadge) totalBadge.textContent = AppState.races.length;

  aplicarFiltrosYRenderizar();
}

// ==========================================================================
// Lógica de Filtrado y Búsqueda
// ==========================================================================

function aplicarFiltrosYRenderizar() {
  const { search, type, distance, radiusKm, sort } = AppState.filters;
  const userLat = AppState.userLocation.lat;
  const userLng = AppState.userLocation.lng;

  // 1. Calcular distancia para cada carrera y aplicar filtros
  let resultados = AppState.races.map(c => {
    const distUsuario = (c.ubicacion && c.ubicacion.lat && c.ubicacion.lng)
      ? calcularDistanciaHaversine(userLat, userLng, c.ubicacion.lat, c.ubicacion.lng)
      : null;
    return { ...c, distancia_usuario_km: distUsuario };
  });

  // Ocultar carreras ya celebradas
  resultados = resultados.filter(c => {
    const dias = calcularDiasRestantes(c.fecha);
    return dias === null || dias >= 0;
  });

  // Filtro por radio de proximidad
  if (radiusKm > 0) {
    resultados = resultados.filter(c => c.distancia_usuario_km === null || c.distancia_usuario_km <= radiusKm);
  }

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

  // Búsqueda por texto (nombre, municipio, provincia, circuito)
  if (search.trim()) {
    const q = search.trim().toLowerCase();
    resultados = resultados.filter(c => {
      const nombre = (c.nombre || "").toLowerCase();
      const muni = (c.municipio || "").toLowerCase();
      const prov = (c.provincia || "").toLowerCase();
      const desc = (c.descripcion || "").toLowerCase();
      const circuito = (c.circuito || "").toLowerCase();
      return nombre.includes(q) || muni.includes(q) || prov.includes(q) || desc.includes(q) || circuito.includes(q);
    });
  }

  // Ordenación
  if (sort === "distancia") {
    resultados.sort((a, b) => (a.distancia_usuario_km ?? 99999) - (b.distancia_usuario_km ?? 99999));
  } else if (sort === "fecha") {
    resultados.sort((a, b) => (a.fecha || "9999").localeCompare(b.fecha || "9999"));
  } else if (sort === "km") {
    resultados.sort((a, b) => (a.distancia_km ?? 99999) - (b.distancia_km ?? 99999));
  } else if (sort === "desnivel") {
    resultados.sort((a, b) => parseInt(b.desnivel_positivo_m || 0) - parseInt(a.desnivel_positivo_m || 0));
  }

  AppState.filteredRaces = resultados;

  // Actualizar círculo de radio en el mapa
  if (AppState.radiusCircle) {
    AppState.radiusCircle.setRadius(radiusKm * 1000);
  }

  // Renderizar componentes
  renderizarListadoCarreras(resultados);
  renderizarMarcadoresEnMapa(resultados);
}

// ==========================================================================
// Renderizado del Listado de Carreras (DOM)
// ==========================================================================

function renderizarListadoCarreras(carreras) {
  const container = document.getElementById("races-list-container");
  const countBadge = document.getElementById("results-count-number");
  if (!container) return;

  if (countBadge) countBadge.textContent = carreras.length;
  const contadorPestana = document.getElementById("pestana-contador");
  if (contadorPestana) contadorPestana.textContent = `(${carreras.length})`;

  if (carreras.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" style="color: #64748b;">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="8" y1="12" x2="16" y2="12"></line>
        </svg>
        <h3>No hay carreras con estos filtros</h3>
        <p>Prueba a ampliar el radio de búsqueda o seleccionar "Todas" las modalidades.</p>
        <button class="btn-secondary" onclick="resetearFiltros()" style="margin-top: 8px;">
          Restablecer filtros
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = "";

  carreras.forEach(c => {
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
      if (dias > 0) diasStr = `• Faltan ${dias} días`;
      else if (dias === 0) diasStr = `• ¡Hoy!`;
      else diasStr = `• Pasada`;
    }

    const card = document.createElement("article");
    card.className = `race-card ${cardClass}`;
    card.id = `card-${c.id}`;
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-label", `${c.nombre}, ${c.municipio}`);

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

      <h3 class="card-title">${escapeHtml(c.nombre)}</h3>
      <div class="card-location">
        <span>📍 ${escapeHtml(c.municipio || "Municipio")}, ${escapeHtml(c.provincia || "Provincia")}</span>
      </div>

      <div class="card-stats-grid">
        <div class="stat-item">
          <span class="stat-label">Distancia</span>
          <span class="stat-val">${escapeHtml(textoDistancias(c))}</span>
        </div>
        ${isTrail ? `
        <div class="stat-item">
          <span class="stat-label">Desnivel +D</span>
          <span class="stat-val elevation">${c.desnivel_positivo_m != null ? `+${escapeHtml(c.desnivel_positivo_m)} m` : "No publicado"}</span>
        </div>` : ""}
        <div class="stat-item">
          <span class="stat-label">Inscripción</span>
          <span class="stat-val">${c.precio_desde != null ? `Desde ${escapeHtml(formatearPrecio(c.precio_desde))}` : "Consultar"}</span>
        </div>
      </div>

      <div class="card-footer-actions">
        <span class="card-date-badge">
          📅 ${formatearFechaLegible(c.fecha)} <small style="color:#64748b;">${diasStr}</small>
        </span>
        <div class="card-btn-group">
          <button class="card-mini-btn btn-focus-map" data-id="${c.id}" title="Centrar en el mapa">
            📍 Mapa
          </button>
          <a href="${escapeHtml(urlSegura(c.url_oficial))}" target="_blank" rel="noopener noreferrer" class="card-mini-btn btn-external" title="Ir a la web de inscripción oficial">
            Web Oficial ↗
          </a>
        </div>
      </div>
    `;

    // Interacciones de la tarjeta
    card.addEventListener("click", (e) => {
      // Si hizo clic directamente en el enlace externo, no abrir modal
      if (e.target.closest(".btn-external")) return;
      abrirModalDetalleCarrera(c);
      // En móvil no se cambia a la pestaña del mapa por detrás de la ficha
      if (!esPantallaPequena()) centrarEnCarrera(c.id);
    });

    // Hover sincronizado con marcador del mapa
    card.addEventListener("mouseenter", () => resaltarMarcador(c.id, true));
    card.addEventListener("mouseleave", () => resaltarMarcador(c.id, false));

    const btnMap = card.querySelector(".btn-focus-map");
    if (btnMap) {
      btnMap.addEventListener("click", (e) => {
        e.stopPropagation();
        centrarEnCarrera(c.id);
      });
    }

    container.appendChild(card);
  });
}

// ==========================================================================
// Renderizado de Marcadores en el Mapa Leaflet
// ==========================================================================

function renderizarMarcadoresEnMapa(carreras) {
  if (!AppState.map) return;

  // Limpiar marcadores anteriores
  AppState.clusterGroup.clearLayers();
  AppState.mapMarkers = {};

  carreras.forEach(c => {
    if (!c.ubicacion || !c.ubicacion.lat || !c.ubicacion.lng) return;

    const isTrail = c.tipo === "trail";
    const pinClass = isTrail ? "pin-trail" : "pin-popular";
    const iconChar = isTrail ? "⛰️" : "🏃";

    const customIcon = L.divIcon({
      className: `custom-race-pin ${pinClass}`,
      html: `
        <div class="pin-bubble" id="pin-bubble-${c.id}">
          <span class="pin-icon-inner">${iconChar}</span>
        </div>
      `,
      iconSize: [38, 38],
      iconAnchor: [19, 38],
      popupAnchor: [0, -34]
    });

    const marker = L.marker([c.ubicacion.lat, c.ubicacion.lng], {
      icon: customIcon,
      title: c.nombre
    });
    AppState.clusterGroup.addLayer(marker);

    const distStr = c.distancia_usuario_km !== null
      ? `A ${c.distancia_usuario_km} km de ti`
      : "";

    // Contenido del Popup en el Mapa
    const popupContent = `
      <div class="popup-race-card">
        <div class="popup-tag-row">
          <span class="badge-tag ${isTrail ? 'badge-trail' : 'badge-popular'}">
            ${isTrail ? '⛰️ TRAIL' : '🏃 POPULAR'}
          </span>
          <span style="font-size:0.75rem; font-weight:700; color:#38bdf8;">${escapeHtml(textoDistancias(c))}</span>
        </div>
        <div class="popup-title">${escapeHtml(c.nombre)}</div>
        <div class="popup-meta">
          📅 ${escapeHtml(formatearFechaLegible(c.fecha))}<br>
          📍 ${escapeHtml(c.municipio || "")}, ${escapeHtml(c.provincia || "")}<br>
          ${distStr ? `<strong>${distStr}</strong>` : ''}
        </div>
        <div class="popup-actions-row">
          <button class="popup-btn popup-btn-detail" onclick="abrirModalDetallePorId('${escapeHtml(c.id)}')">
            Ver Ficha
          </button>
          <a href="${escapeHtml(urlSegura(c.url_oficial))}" target="_blank" rel="noopener noreferrer" class="popup-btn popup-btn-register">
            Inscripción ↗
          </a>
        </div>
      </div>
    `;

    marker.bindPopup(popupContent);

    // Evento de clic en marcador: resaltar tarjeta en listado lateral
    marker.on("click", () => {
      resaltarTarjetaEnLista(c.id);
    });

    AppState.mapMarkers[c.id] = marker;
  });
}

// ==========================================================================
// Pestañas Lista / Mapa (móvil y tablet)
// ==========================================================================

// Misma condición que el CSS de móvil (incluye táctiles en modo "versión para ordenador")
const consultaPantallaPequena = window.matchMedia("(max-width: 960px), (pointer: coarse) and (max-width: 1200px)");

function esPantallaPequena() {
  return consultaPantallaPequena.matches;
}

function cambiarVista(vista) {
  document.body.classList.toggle("vista-lista", vista === "lista");
  document.body.classList.toggle("vista-mapa", vista === "mapa");
  document.querySelectorAll(".pestana").forEach(boton => {
    const activa = boton.dataset.vista === vista;
    boton.classList.toggle("activa", activa);
    boton.setAttribute("aria-pressed", String(activa));
  });
  // El mapa estaba oculto: Leaflet tiene que recalcular su tamaño antes de usarlo
  // (manteniendo el centro: el mapa pasa de tamaño 0 a pantalla completa)
  if (vista === "mapa" && AppState.map) {
    AppState.map.invalidateSize({ animate: false });
    // Algunos navegadores móviles aplican el cambio de diseño un instante después
    requestAnimationFrame(() => AppState.map.invalidateSize({ animate: false }));
    setTimeout(() => AppState.map.invalidateSize({ animate: false }), 300);
  }
}

function centrarEnCarrera(carreraId) {
  const marker = AppState.mapMarkers[carreraId];
  if (!marker || !AppState.map) return;
  if (esPantallaPequena()) cambiarVista("mapa");

  // Si el marcador está dentro de un cluster, hacer zoom hasta mostrarlo
  AppState.clusterGroup.zoomToShowLayer(marker, () => {
    AppState.map.flyTo(marker.getLatLng(), Math.max(AppState.map.getZoom(), 13), { duration: 1.0 });
    marker.openPopup();
  });
}

function resaltarMarcador(carreraId, resaltar) {
  const marker = AppState.mapMarkers[carreraId];
  if (!marker) return;

  const el = document.getElementById(`pin-bubble-${carreraId}`);
  if (el) {
    if (resaltar) {
      el.parentElement.classList.add("active-pin");
    } else {
      el.parentElement.classList.remove("active-pin");
    }
  }
}

function resaltarTarjetaEnLista(carreraId) {
  const card = document.getElementById(`card-${carreraId}`);
  if (!card) return;

  document.querySelectorAll(".race-card").forEach(c => c.classList.remove("card-highlighted"));
  card.classList.add("card-highlighted");
  card.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ==========================================================================
// Modal: Ficha Detallada de Carrera & Perfil Altimétrico
// ==========================================================================

function abrirModalDetallePorId(carreraId) {
  // Preferir la versión filtrada, que ya trae la distancia al usuario calculada
  const carrera = AppState.filteredRaces.find(c => c.id === carreraId)
    || AppState.races.find(c => c.id === carreraId);
  if (carrera) abrirModalDetalleCarrera(carrera);
}

function abrirModalDetalleCarrera(carrera) {
  const modal = document.getElementById("race-detail-modal");
  if (!modal) return;

  const isTrail = carrera.tipo === "trail";
  
  // Asignar textos
  document.getElementById("modal-race-title").textContent = carrera.nombre;
  document.getElementById("modal-race-location").textContent = `📍 ${carrera.municipio || "Municipio"}, ${carrera.provincia || "Provincia"}`;
  
  const typeBadge = document.getElementById("modal-type-badge");
  typeBadge.textContent = isTrail ? "⛰️ TRAIL RUNNING" : "🏃 CARRERA POPULAR";
  typeBadge.className = `type-pill ${isTrail ? 'badge-trail' : 'badge-popular'}`;
  
  document.getElementById("modal-dist-badge").textContent = textoDistancias(carrera);
  
  const userDistPill = document.getElementById("modal-user-dist-badge");
  if (carrera.distancia_usuario_km != null) {
    userDistPill.textContent = `A ${carrera.distancia_usuario_km} km de ti`;
    userDistPill.style.display = "inline-block";
  } else {
    userDistPill.style.display = "none";
  }

  document.getElementById("modal-race-date").textContent = formatearFechaLegible(carrera.fecha);
  // Los campos que la fuente no aporta se muestran como "por confirmar", nunca inventados
  const tieneDesnivel = carrera.desnivel_positivo_m !== null && carrera.desnivel_positivo_m !== undefined;
  document.getElementById("modal-race-time").textContent = carrera.hora ? `Hora: ${carrera.hora}` : "Hora por confirmar";
  document.getElementById("modal-race-distance").textContent = textoDistancias(carrera);
  document.getElementById("modal-race-surface").textContent = carrera.superficie || (carrera.circuito ? carrera.circuito : "");
  // El desnivel solo se muestra en carreras de trail
  document.getElementById("modal-metric-elevation").style.display = isTrail ? "" : "none";
  document.getElementById("modal-race-elevation").textContent = tieneDesnivel ? `+${carrera.desnivel_positivo_m} m` : "No publicado";
  document.getElementById("modal-elevation-summary").textContent = tieneDesnivel ? `+${carrera.desnivel_positivo_m} m D+` : "";
  document.getElementById("modal-race-price").textContent = carrera.precio_desde != null ? `Desde ${formatearPrecio(carrera.precio_desde)}` : "Consultar";
  document.getElementById("modal-race-slots").textContent = carrera.plazas_restantes
    ? `${carrera.plazas_restantes} dorsales`
    : (carrera.precio_desde != null ? "Según web de inscripción" : "En la web oficial");

  document.getElementById("modal-race-description").textContent = carrera.descripcion
    || (carrera.circuito ? `Prueba incluida en: ${carrera.circuito}. ` : "")
    + "Consulta horarios, recorrido y reglamento en la web oficial.";

  // Aviso de procedencia del dato
  const avisoTexto = document.getElementById("modal-notice-text");
  if (carrera.fuente && carrera.fuente.nombre) {
    avisoTexto.innerHTML = `<strong>Fuente:</strong> datos recopilados de
      <a href="${escapeHtml(urlSegura(carrera.fuente.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(carrera.fuente.nombre)}</a>.
      Confirma fecha y detalles en la web oficial antes de inscribirte.`;
  } else {
    avisoTexto.innerHTML = `<strong>Dato de prueba:</strong> registro ficticio del prototipo.`;
  }

  // Configurar enlace oficial
  const officialLink = document.getElementById("modal-btn-official-web");
  officialLink.href = urlSegura(carrera.url_oficial);

  // Botón "Ver en mapa" desde dentro del modal
  const btnViewOnMap = document.getElementById("btn-modal-view-on-map");
  btnViewOnMap.onclick = () => {
    cerrarModalDetalle();
    centrarEnCarrera(carrera.id);
  };

  // Perfil altimétrico solo si la carrera lo trae (no se inventa uno genérico)
  const seccionPerfil = document.getElementById("modal-elevation-section");
  if (Array.isArray(carrera.perfil_elevacion) && carrera.perfil_elevacion.length > 1) {
    seccionPerfil.style.display = "";
    generarPerfilAltimetricoSVG(carrera);
  } else {
    seccionPerfil.style.display = "none";
  }

  // Mostrar modal
  modal.classList.remove("hidden");
}

function cerrarModalDetalle() {
  const modal = document.getElementById("race-detail-modal");
  if (modal) modal.classList.add("hidden");
}

/**
 * Dibuja un gráfico SVG continuo y suave con el perfil altimétrico del evento
 */
function generarPerfilAltimetricoSVG(carrera) {
  const container = document.getElementById("modal-elevation-chart-container");
  if (!container) return;

  const puntos = carrera.perfil_elevacion || [100, 150, 220, 310, 280, 180, 110];
  const width = 560;
  const height = 120;
  const paddingX = 30;
  const paddingY = 20;

  const minAlt = Math.min(...puntos);
  const maxAlt = Math.max(...puntos);
  const altRange = Math.max(maxAlt - minAlt, 20);

  const getX = (idx) => paddingX + (idx / (puntos.length - 1)) * (width - 2 * paddingX);
  const getY = (val) => height - paddingY - ((val - minAlt) / altRange) * (height - 2 * paddingY);

  // Construir puntos para la curva SVG
  const pathCoords = puntos.map((p, i) => `${getX(i).toFixed(1)},${getY(p).toFixed(1)}`);
  const linePath = `M ${pathCoords.join(" L ")}`;
  const areaPath = `${linePath} L ${getX(puntos.length - 1)},${height - paddingY} L ${getX(0)},${height - paddingY} Z`;

  const isTrail = carrera.tipo === "trail";
  const strokeColor = isTrail ? "#10b981" : "#06b6d4";
  const gradientId = `elev-grad-${carrera.id || 'default'}`;

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${strokeColor}" stop-opacity="0.45" />
          <stop offset="100%" stop-color="${strokeColor}" stop-opacity="0.0" />
        </linearGradient>
      </defs>

      <!-- Línea base horizontal -->
      <line x1="${paddingX}" y1="${height - paddingY}" x2="${width - paddingX}" y2="${height - paddingY}" stroke="rgba(255,255,255,0.1)" stroke-width="1" />

      <!-- Área degradada bajo la curva -->
      <path d="${areaPath}" fill="url(#${gradientId})" />

      <!-- Línea de altitud -->
      <path d="${linePath}" fill="none" stroke="${strokeColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />

      <!-- Marcadores de cota mínima y máxima -->
      <text x="${paddingX}" y="${height - 4}" fill="#64748b" font-size="11" font-weight="600">Salida: ${puntos[0]}m</text>
      <text x="${width - paddingX - 60}" y="${height - 4}" fill="#64748b" font-size="11" font-weight="600">Meta: ${puntos[puntos.length - 1]}m</text>
      <text x="${getX(puntos.indexOf(maxAlt)) - 20}" y="${Math.max(getY(maxAlt) - 6, 12)}" fill="${strokeColor}" font-size="11" font-weight="700">Cota Máx: ${maxAlt}m</text>
    </svg>
  `;
}

// ==========================================================================
// Modal: Publicar Nueva Carrera (Para organizadores)
// ==========================================================================

function abrirModalAñadirCarrera() {
  const modal = document.getElementById("add-race-modal");
  if (!modal) return;

  // Pre-rellenar coordenadas según la posición actual del mapa
  const center = AppState.map ? AppState.map.getCenter() : AppState.userLocation;
  document.getElementById("form-input-lat").value = center.lat.toFixed(4);
  document.getElementById("form-input-lng").value = center.lng.toFixed(4);

  modal.classList.remove("hidden");
}

function cerrarModalAñadirCarrera() {
  const modal = document.getElementById("add-race-modal");
  if (modal) modal.classList.add("hidden");
}

async function manejarEnvioNuevaCarrera(e) {
  e.preventDefault();

  const nuevaCarrera = {
    nombre: document.getElementById("form-input-nombre").value.trim(),
    tipo: document.getElementById("form-select-tipo").value,
    fecha: document.getElementById("form-input-fecha").value,
    distancia_km: parseFloat(document.getElementById("form-input-distancia").value),
    desnivel_positivo_m: parseInt(document.getElementById("form-input-desnivel").value || "0", 10),
    municipio: document.getElementById("form-input-municipio").value.trim(),
    provincia: document.getElementById("form-input-provincia").value.trim(),
    ubicacion: {
      lat: parseFloat(document.getElementById("form-input-lat").value),
      lng: parseFloat(document.getElementById("form-input-lng").value)
    },
    url_oficial: document.getElementById("form-input-url").value.trim(),
    descripcion: document.getElementById("form-input-desc").value.trim(),
  };

  try {
    const res = await fetch("/api/carreras", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nuevaCarrera)
    });

    if (res.ok) {
      const data = await res.json();
      AppState.races.unshift(data.carrera);
      mostrarToast(`✅ Carrera "${nuevaCarrera.nombre}" publicada con éxito`);
    } else {
      // Guardado local de respaldo
      nuevaCarrera.id = `car-${Date.now()}`;
      AppState.races.unshift(nuevaCarrera);
      mostrarToast(`✅ Carrera guardada localmente`);
    }
  } catch (err) {
    nuevaCarrera.id = `car-${Date.now()}`;
    AppState.races.unshift(nuevaCarrera);
    mostrarToast(`✅ Carrera guardada localmente`);
  }

  cerrarModalAñadirCarrera();
  document.getElementById("form-add-race").reset();
  
  // Actualizar mapa y lista
  aplicarFiltrosYRenderizar();
  centrarEnCarrera(nuevaCarrera.id);
}

// ==========================================================================
// Sistema de Notificaciones Toast
// ==========================================================================

function mostrarToast(mensaje, duracionMs = 3200) {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = "toast";
  const texto = document.createElement("span");
  texto.textContent = mensaje;
  toast.appendChild(texto);

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(10px)";
    toast.style.transition = "all 0.3s ease";
    setTimeout(() => toast.remove(), 300);
  }, duracionMs);
}

function resetearFiltros() {
  AppState.filters = {
    search: "",
    type: "todas",
    distance: "todas",
    radiusKm: 50,
    sort: "distancia"
  };

  // Actualizar controles UI
  const searchInput = document.getElementById("filter-search-input");
  if (searchInput) searchInput.value = "";
  
  const clearBtn = document.getElementById("btn-clear-search");
  if (clearBtn) clearBtn.classList.add("hidden");

  document.querySelectorAll(".segment-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.type === "todas");
  });

  document.querySelectorAll(".chip-btn").forEach(chip => {
    chip.classList.toggle("active", chip.dataset.dist === "todas");
  });

  const slider = document.getElementById("filter-radius-slider");
  if (slider) slider.value = 50;

  const radiusDisplay = document.getElementById("radius-display-value");
  if (radiusDisplay) radiusDisplay.textContent = "50 km";

  const sortSelect = document.getElementById("filter-sort-select");
  if (sortSelect) sortSelect.value = "distancia";

  aplicarFiltrosYRenderizar();
  mostrarToast("Filtros restablecidos");
}

// ==========================================================================
// Event Listeners y Arranque de la Aplicación
// ==========================================================================

function configurarEventListeners() {
  // Buscador por texto
  const searchInput = document.getElementById("filter-search-input");
  const clearSearchBtn = document.getElementById("btn-clear-search");
  
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      AppState.filters.search = e.target.value;
      if (clearSearchBtn) {
        clearSearchBtn.classList.toggle("hidden", !e.target.value);
      }
      aplicarFiltrosYRenderizar();
    });
  }

  if (clearSearchBtn) {
    clearSearchBtn.addEventListener("click", () => {
      searchInput.value = "";
      clearSearchBtn.classList.add("hidden");
      AppState.filters.search = "";
      aplicarFiltrosYRenderizar();
    });
  }

  // Pestañas Lista / Mapa
  document.querySelectorAll(".pestana").forEach(boton => {
    boton.addEventListener("click", () => cambiarVista(boton.dataset.vista));
  });

  // Mostrar/ocultar filtros en móvil
  const btnFiltros = document.getElementById("btn-toggle-filtros");
  const filtrosExtra = document.getElementById("filtros-extra");
  if (btnFiltros && filtrosExtra) {
    btnFiltros.addEventListener("click", () => {
      const abierto = filtrosExtra.classList.toggle("abierto");
      btnFiltros.setAttribute("aria-expanded", String(abierto));
      btnFiltros.classList.toggle("activo", abierto);
    });
  }

  // Filtro por Modalidad (Segmented Control)
  document.querySelectorAll(".segment-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".segment-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      AppState.filters.type = btn.dataset.type;
      aplicarFiltrosYRenderizar();
    });
  });

  // Filtro por Distancia (Chips)
  document.querySelectorAll(".chip-btn").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".chip-btn").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      AppState.filters.distance = chip.dataset.dist;
      aplicarFiltrosYRenderizar();
    });
  });

  // Slider de Radio de Proximidad
  const radiusSlider = document.getElementById("filter-radius-slider");
  const radiusDisplay = document.getElementById("radius-display-value");
  if (radiusSlider && radiusDisplay) {
    radiusSlider.addEventListener("input", (e) => {
      const val = parseInt(e.target.value, 10);
      AppState.filters.radiusKm = val;
      radiusDisplay.textContent = `${val} km`;
      aplicarFiltrosYRenderizar();
    });
  }

  // Selector de Ordenación
  const sortSelect = document.getElementById("filter-sort-select");
  if (sortSelect) {
    sortSelect.addEventListener("change", (e) => {
      AppState.filters.sort = e.target.value;
      aplicarFiltrosYRenderizar();
    });
  }

  // Botón Restablecer
  const resetBtn = document.getElementById("btn-reset-filters");
  if (resetBtn) resetBtn.addEventListener("click", resetearFiltros);

  // Selector Rápido de Ciudades
  const citySelect = document.getElementById("select-preset-city");
  if (citySelect) {
    citySelect.addEventListener("change", (e) => {
      const [lat, lng] = e.target.value.split(",").map(Number);
      const text = e.target.options[e.target.selectedIndex].text;
      establecerUbicacionUsuario(lat, lng, text);
      mostrarToast(`📍 Ubicación cambiada a: ${text}`);
    });
  }

  // Botón Refrescar GPS
  const refreshGeoBtn = document.getElementById("btn-refresh-geo");
  if (refreshGeoBtn) refreshGeoBtn.addEventListener("click", solicitarGeolocalizacionNavegador);

  // Botones de Mapa Flotantes
  const btnRecenter = document.getElementById("btn-map-recenter");
  if (btnRecenter) {
    btnRecenter.addEventListener("click", () => {
      AppState.map.flyTo([AppState.userLocation.lat, AppState.userLocation.lng], 11, { duration: 1.0 });
    });
  }

  const btnFitBounds = document.getElementById("btn-map-fit-bounds");
  if (btnFitBounds) {
    btnFitBounds.addEventListener("click", () => {
      if (AppState.clusterGroup.getLayers().length > 0) {
        AppState.map.fitBounds(AppState.clusterGroup.getBounds().pad(0.1));
      }
    });
  }


  // Modales
  const btnCloseModal = document.getElementById("btn-close-modal");
  if (btnCloseModal) btnCloseModal.addEventListener("click", cerrarModalDetalle);

  const detailModal = document.getElementById("race-detail-modal");
  if (detailModal) {
    detailModal.addEventListener("click", (e) => {
      if (e.target === detailModal) cerrarModalDetalle();
    });
  }

  // Modal Añadir Carrera
  const btnOpenAdd = document.getElementById("btn-open-add-race");
  if (btnOpenAdd) btnOpenAdd.addEventListener("click", abrirModalAñadirCarrera);

  const btnCloseAdd = document.getElementById("btn-close-add-modal");
  if (btnCloseAdd) btnCloseAdd.addEventListener("click", cerrarModalAñadirCarrera);

  const btnCancelAdd = document.getElementById("btn-cancel-add");
  if (btnCancelAdd) btnCancelAdd.addEventListener("click", cerrarModalAñadirCarrera);

  const addForm = document.getElementById("form-add-race");
  if (addForm) addForm.addEventListener("submit", manejarEnvioNuevaCarrera);

  // Tecla ESC para cerrar modales
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      cerrarModalDetalle();
      cerrarModalAñadirCarrera();
    }
  });
}

// ==========================================================================
// Arranque
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
  inicializarMapa();
  configurarEventListeners();
  solicitarGeolocalizacionNavegador();
  cargarCarrerasDesdeServidor();
});
