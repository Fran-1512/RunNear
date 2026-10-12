/**
 * RunNear - Mapa: inicialización de Leaflet, mapa base propio (Natural Earth) y marcadores de las carreras.
 * El mapa detallado de calles y caminos está en mapa_detalle.js.
 */

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
    chunkedLoading: true, // con miles de carreras, no bloquea la página mientras agrupa
    maxClusterRadius: 45
  }).addTo(AppState.map);

  // Renderizar marcador de usuario y círculo de radio
  actualizarMarcadorUsuarioEnMapa();

  // Permitir hacer clic en el mapa para mover la ubicación de referencia
  // Botón "Ver ficha" de los globos de las carreras (Leaflet no deja pasar sus clics al documento)
  AppState.map.on("popupopen", e => {
    const boton = e.popup.getElement().querySelector(".popup-btn-detail[data-id]");
    if (boton) boton.addEventListener("click", () => abrirModalDetallePorId(boton.dataset.id));
  });

  AppState.map.on("click", (e) => {
    establecerUbicacionUsuario(e.latlng.lat, e.latlng.lng, `Punto personalizado (${e.latlng.lat.toFixed(3)}, ${e.latlng.lng.toFixed(3)})`);
    mostrarToast("📍 Ubicación actualizada según clic en el mapa");
  });
}

async function cargarMapaBase() {
  // Capa detallada (calles, pueblos, caminos) a partir de ZOOM_DETALLE
  let capaDetalle = null;
  try {
    if (!AppState.map.getPane("mapaDetalle")) AppState.map.createPane("mapaDetalle").style.zIndex = 260;
    capaDetalle = await MapaDetalle.crear("mapaDetalle");
  } catch (err) {
    console.error("No se pudo cargar el mapa detallado:", err);
  }

  try {
    (await crearMapaPropio(!!capaDetalle)).addTo(AppState.map);
  } catch (err) {
    console.error("No se pudo cargar el mapa base:", err);
    mostrarToast("No se pudo cargar el mapa base");
  }
  if (capaDetalle) capaDetalle.addTo(AppState.map);
}

// Zoom desde el que el mapa detallado (OpenStreetMap) sustituye a carreteras y pueblos del mapa base
const ZOOM_DETALLE = 8;

// ==========================================================================
// Mapa base propio (vectorial, generado con mapa/generar_mapa.py)
// ==========================================================================

const ESTILO_MAPA = {
  pais:      { color: "#c9c4b8", weight: 0.8, fillColor: "#ebe7df", fillOpacity: 1 },
  provincia: { color: "#8c7a5b", weight: 1.4, fillColor: "#fbf6e6", fillOpacity: 1 },
  rio:       { color: "#7fb3d5", weight: 1.3 },
  autovia:   { color: "#e39b54", weight: 2 },
  carretera: { color: "#d6c7a1", weight: 1 }
};

/**
 * Zoom mínimo al que se muestra el nombre de una población
 */
function zoomMinimoEtiqueta(p) {
  if (p.capital || p.poblacion > 500000) return 5;
  if (p.poblacion > 100000) return 7;
  return 8;
}

/**
 * Países, provincias, ríos, carreteras y poblaciones (Natural Earth).
 * conDetalle: si el mapa detallado se ha cargado, a partir de ZOOM_DETALLE es él quien dibuja
 * carreteras y pueblos; si no, el mapa base los sigue mostrando con cualquier zoom.
 */
async function crearMapaPropio(conDetalle) {
  const resp = await fetch("mapa/mapa_base.json");
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const { capas } = await resp.json();

  // Panel propio por debajo de marcadores y del círculo de radio
  if (!AppState.map.getPane("mapaBase")) {
    AppState.map.createPane("mapaBase").style.zIndex = 250;
    const paneEtiquetas = AppState.map.createPane("mapaEtiquetas");
    paneEtiquetas.style.zIndex = 450;
    paneEtiquetas.style.pointerEvents = "none";
  }
  const renderer = L.canvas({ pane: "mapaBase", padding: 0.5 });
  const opcionesBase = { pane: "mapaBase", renderer, interactive: false };

  // Natural Earth es de dominio público: basta una mención corta
  const grupo = L.layerGroup([], { attribution: "Natural Earth" });

  L.geoJSON(capas.paises, { ...opcionesBase, style: ESTILO_MAPA.pais }).addTo(grupo);
  const provincias = L.geoJSON(capas.provincias, { ...opcionesBase, style: ESTILO_MAPA.provincia }).addTo(grupo);
  // Ríos y carreteras simplificados: solo a poco zoom (con más zoom los dibuja el mapa detallado)
  const lineasSimples = L.layerGroup([
    L.geoJSON(capas.rios, { ...opcionesBase, style: ESTILO_MAPA.rio }),
    L.geoJSON(capas.carreteras, {
      ...opcionesBase,
      style: f => f.properties.tipo === "autovia" ? ESTILO_MAPA.autovia : ESTILO_MAPA.carretera
    })
  ]).addTo(grupo);

  // Nombre de cada provincia en su centro (a zoom intermedio)
  const nombresProvincia = L.layerGroup().addTo(grupo);
  provincias.eachLayer(capa => {
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

  // Poblaciones: se muestran u ocultan según el zoom
  const etiquetas = L.layerGroup().addTo(grupo);
  const poblaciones = capas.poblaciones.features.map(f => ({
    zoomMin: zoomMinimoEtiqueta(f.properties),
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
    const detalle = conDetalle && z >= ZOOM_DETALLE;
    poblaciones.forEach(({ zoomMin, marker }) => {
      if (z >= zoomMin && !detalle) etiquetas.addLayer(marker);
      else etiquetas.removeLayer(marker);
    });
    for (const [capa, visible] of [[lineasSimples, !detalle], [nombresProvincia, z >= 7 && z < 10]]) {
      if (visible) grupo.addLayer(capa);
      else grupo.removeLayer(capa);
    }
  };
  grupo.on("add", () => { AppState.map.on("zoomend", actualizarEtiquetas); actualizarEtiquetas(); });
  grupo.on("remove", () => AppState.map.off("zoomend", actualizarEtiquetas));

  return grupo;
}

// ==========================================================================
// Renderizado de Marcadores en el Mapa Leaflet
// ==========================================================================

function renderizarMarcadoresEnMapa(carreras) {
  if (!AppState.map) return;

  // Limpiar marcadores anteriores
  AppState.clusterGroup.clearLayers();
  AppState.mapMarkers = {};
  const nuevos = [];

  carreras.forEach(c => {
    if (!c.ubicacion || !c.ubicacion.lat || !c.ubicacion.lng) return;

    const isTrail = c.tipo === "trail";
    const pinClass = isTrail ? "pin-trail" : "pin-popular";
    const iconChar = isTrail ? "⛰️" : "🏃";

    const customIcon = L.divIcon({
      className: `custom-race-pin ${pinClass}`,
      html: `
        <div class="pin-bubble" id="pin-bubble-${escapeHtml(c.id)}">
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
    nuevos.push(marker);

    // Contenido del Popup: se prepara al abrirlo (con miles de carreras, hacerlo para todas es lento)
    marker.bindPopup(() => {
    const distStr = c.distancia_usuario_km !== null
      ? `A ${c.distancia_usuario_km} km de ti`
      : "";
    return `
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
          <button class="popup-btn popup-btn-detail" data-id="${escapeHtml(c.id)}">
            Ver Ficha
          </button>
          <a href="${escapeHtml(urlSegura(c.url_oficial))}" target="_blank" rel="noopener noreferrer" class="popup-btn popup-btn-register">
            Inscripción ↗
          </a>
        </div>
      </div>
    `;
    });

    // Evento de clic en marcador: resaltar tarjeta en listado lateral
    marker.on("click", () => {
      resaltarTarjetaEnLista(c.id);
    });

    AppState.mapMarkers[c.id] = marker;
  });
  // Todos de una vez: mucho más rápido que añadirlos uno a uno
  AppState.clusterGroup.addLayers(nuevos);
}

// Misma condición que el CSS de móvil (incluye táctiles en modo "versión para ordenador")
const consultaPantallaPequena = window.matchMedia("(max-width: 960px), (pointer: coarse) and (max-width: 1200px)");

function esPantallaPequena() {
  return consultaPantallaPequena.matches;
}

function centrarEnCarrera(carreraId) {
  const marker = AppState.mapMarkers[carreraId];
  if (!marker || !AppState.map) return;

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
  // La tarjeta puede no estar pintada aún (la lista se pinta por tandas)
  listaPaginada.mostrarHasta(carreraId);
  const card = document.getElementById(`card-${carreraId}`);
  if (!card) return;

  document.querySelectorAll(".race-card").forEach(c => c.classList.remove("card-highlighted"));
  card.classList.add("card-highlighted");
  card.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
