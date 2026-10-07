/**
 * RunNear - Lógica de Descubrimiento de Carreras & Geolocalización Interactiva
 */

// ==========================================================================
// Modo diagnóstico (abrir la web con ?diagnostico): muestra datos técnicos en
// pantalla para poder ver qué falla en un móvil concreto con una captura
// ==========================================================================
const MODO_DIAGNOSTICO = /[?&]diagnostico\b/.test(location.search);
const erroresDiagnostico = [];
if (MODO_DIAGNOSTICO) {
  window.addEventListener("error", e => erroresDiagnostico.push(`${e.message} (${(e.filename || "").split("/").pop()}:${e.lineno})`));
  window.addEventListener("unhandledrejection", e => erroresDiagnostico.push(`Promesa: ${e.reason && e.reason.message || e.reason}`));
}

function iniciarDiagnostico() {
  const caja = document.createElement("pre");
  caja.style.cssText = "position:fixed;left:6px;right:6px;top:6px;z-index:100000;margin:0;padding:8px;" +
    "background:rgba(255,255,255,0.95);color:#000;font:11px/1.35 monospace;white-space:pre-wrap;" +
    "word-break:break-all;border-radius:8px;max-height:45vh;overflow:auto;pointer-events:none";
  document.body.appendChild(caja);
  const actualizar = () => {
    const m = AppState.map;
    const mapEl = document.getElementById("interactive-map");
    const r = mapEl ? mapEl.getBoundingClientRect() : null;
    const panel = document.getElementById("map-panel").getBoundingClientRect();
    caja.textContent = [
      `Navegador: ${navigator.userAgent}`,
      `Ventana: ${window.innerWidth}x${window.innerHeight}  dpr=${window.devicePixelRatio}`,
      `Diseño móvil: ${typeof esPantallaPequena === "function" && esPantallaPequena()}  body: ${document.body.className}`,
      `Panel mapa: ${Math.round(panel.width)}x${Math.round(panel.height)}  display=${getComputedStyle(document.getElementById("map-panel")).display}`,
      `Contenedor mapa: ${r ? `${Math.round(r.width)}x${Math.round(r.height)}` : "no existe"}`,
      `Leaflet: ${m ? `size=${m.getSize().x}x${m.getSize().y} zoom=${m.getZoom()} centro=${m.getCenter().lat.toFixed(2)},${m.getCenter().lng.toFixed(2)}` : "sin mapa"}`,
      `Teselas detalle: ${document.querySelectorAll(".tesela-detalle").length}  marcadores: ${Object.keys(AppState.mapMarkers).length}`,
      `Errores (${erroresDiagnostico.length}): ${erroresDiagnostico.slice(-5).join(" | ") || "ninguno"}`
    ].join("\n");
  };
  actualizar();
  setInterval(actualizar, 1000);
}

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
    fecha: "todas",
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
 * Dónde ver los resultados de una carrera ya celebrada:
 * enlace propio de la carrera > página de resultados de la plataforma > web de la carrera
 */
function enlacesResultados(c) {
  if (Array.isArray(c.resultados) && c.resultados.length) {
    return { tipo: "propios", enlaces: c.resultados };
  }
  if (c.resultados_web) {
    return { tipo: "general", enlaces: [{ texto: "Resultados en la web de inscripción", url: c.resultados_web }] };
  }
  return { tipo: "web", enlaces: [{ texto: "Web de la carrera", url: c.url_oficial }] };
}

function estaCelebrada(c) {
  const dias = calcularDiasRestantes(c.fecha);
  return dias !== null && dias < 0;
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

function ponerRadio(km) {
  AppState.filters.radiusKm = km;
  const slider = document.getElementById("filter-radius-slider");
  if (slider) slider.value = km;
  const radiusDisplay = document.getElementById("radius-display-value");
  if (radiusDisplay) radiusDisplay.textContent = `${km} km`;
}

/** Última ciudad elegida en el selector (se recuerda en el dispositivo) */
function ciudadGuardada() {
  try {
    const c = JSON.parse(localStorage.getItem("runnear_ciudad"));
    return c && Number.isFinite(c.lat) && Number.isFinite(c.lng) && c.nombre ? c : null;
  } catch (e) {
    return null;
  }
}

/**
 * Ubicación de referencia sin GPS: la última ciudad elegida o, si no hay, el centro de
 * la región con un radio que la cubre entera. Se pone al arrancar, para que la web
 * funcione mientras el navegador pregunta (o si el usuario dice que no).
 */
function usarUbicacionPorDefecto() {
  const ciudad = ciudadGuardada();
  if (ciudad) {
    ponerRadio(typeof radioPorDefecto === "function" ? radioPorDefecto() : 50);
    const input = document.getElementById("input-ciudad");
    if (input) input.value = ciudad.nombre;
    establecerUbicacionUsuario(ciudad.lat, ciudad.lng, ciudad.nombre);
    return;
  }
  ponerRadio(REGION.radioCompletoKm);
  establecerUbicacionUsuario(REGION.centro.lat, REGION.centro.lng, `${REGION.nombre} (centro)`);
}

// ==========================================================================
// Ciudad o pueblo de referencia (buscador de la cabecera)
// ==========================================================================

// Siempre disponibles, aunque no tengan carreras próximas
const CIUDADES_PRINCIPALES = [
  { nombre: "Albacete", provincia: "Albacete", lat: 38.9943, lng: -1.8585 },
  { nombre: "Ciudad Real", provincia: "Ciudad Real", lat: 38.9848, lng: -3.9274 },
  { nombre: "Cuenca", provincia: "Cuenca", lat: 40.0704, lng: -2.1374 },
  { nombre: "Guadalajara", provincia: "Guadalajara", lat: 40.6329, lng: -3.1664 },
  { nombre: "Toledo", provincia: "Toledo", lat: 39.8628, lng: -4.0273 },
  { nombre: "Talavera de la Reina", provincia: "Toledo", lat: 39.9636, lng: -4.8307 },
  { nombre: "Puertollano", provincia: "Ciudad Real", lat: 38.6871, lng: -4.1073 },
  { nombre: "Hellín", provincia: "Albacete", lat: 38.5100, lng: -1.7010 }
];

/** Ciudades principales + todos los pueblos que tienen alguna carrera (sin repetir) */
function lugaresDisponibles() {
  const vistos = new Set(CIUDADES_PRINCIPALES.map(c => normalizarTexto(c.nombre)));
  const pueblos = [];
  AppState.races.forEach(c => {
    if (!c.municipio || !c.ubicacion || !Number.isFinite(c.ubicacion.lat)) return;
    const clave = normalizarTexto(c.municipio);
    if (vistos.has(clave)) return;
    vistos.add(clave);
    pueblos.push({ nombre: c.municipio, provincia: c.provincia || "", lat: c.ubicacion.lat, lng: c.ubicacion.lng });
  });
  pueblos.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  return [...CIUDADES_PRINCIPALES, ...pueblos];
}

function elegirCiudad(lugar) {
  peticionUbicacion++; // una respuesta tardía del GPS ya no cambia la ciudad elegida
  const ciudad = { lat: lugar.lat, lng: lugar.lng, nombre: lugar.nombre };
  try {
    localStorage.setItem("runnear_ciudad", JSON.stringify(ciudad));
  } catch (err) {
    // Sin almacenamiento: se usa la ciudad solo en esta visita
  }
  const input = document.getElementById("input-ciudad");
  if (input) {
    input.value = lugar.nombre;
    input.blur();
  }
  establecerUbicacionUsuario(lugar.lat, lugar.lng, lugar.nombre);
  mostrarToast(`📍 Ubicación cambiada a: ${lugar.nombre}`);
}

function configurarSelectorCiudad() {
  const input = document.getElementById("input-ciudad");
  const lista = document.getElementById("lista-ciudades");
  if (!input || !lista) return;
  let opciones = [];
  let marcada = -1;

  const cerrar = () => {
    lista.classList.add("hidden");
    input.setAttribute("aria-expanded", "false");
    marcada = -1;
  };

  const marcar = (i) => {
    marcada = i;
    lista.querySelectorAll(".opcion-ciudad").forEach((li, k) => li.classList.toggle("marcada", k === i));
  };

  const mostrar = () => {
    const texto = normalizarTexto(input.value);
    const todos = lugaresDisponibles();
    // Sin texto (o con el nombre ya elegido): las ciudades principales
    const actual = AppState.userLocation && normalizarTexto(AppState.userLocation.label) === texto;
    opciones = !texto || actual
      ? CIUDADES_PRINCIPALES
      : todos.filter(l => normalizarTexto(l.nombre).split(/[\s-]+/).some(p => p.startsWith(texto))
          || normalizarTexto(l.nombre).startsWith(texto)).slice(0, 8);
    if (!opciones.length && texto) {
      opciones = todos.filter(l => normalizarTexto(l.nombre).includes(texto)).slice(0, 8);
    }
    lista.innerHTML = opciones.length
      ? opciones.map((l, i) => `<li class="opcion-ciudad" role="option" data-i="${i}">
          <span class="opcion-nombre">${escapeHtml(l.nombre)}</span>
          <span class="opcion-provincia">${escapeHtml(l.provincia)}</span></li>`).join("")
      : `<li class="opcion-vacia">No hay ningún pueblo con ese nombre. Prueba con otro cercano.</li>`;
    lista.classList.remove("hidden");
    input.setAttribute("aria-expanded", "true");
    marcada = -1;
  };

  input.addEventListener("focus", () => {
    input.select();
    mostrar();
  });
  input.addEventListener("input", mostrar);
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" && opciones.length) {
      e.preventDefault();
      marcar((marcada + 1) % opciones.length);
    } else if (e.key === "ArrowUp" && opciones.length) {
      e.preventDefault();
      marcar((marcada - 1 + opciones.length) % opciones.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const elegida = opciones[marcada >= 0 ? marcada : 0];
      if (elegida && input.value.trim()) {
        cerrar();
        elegirCiudad(elegida);
      }
    } else if (e.key === "Escape") {
      cerrar();
      input.blur();
    }
  });
  // mousedown (antes del blur) para que el toque en una opción llegue siempre
  lista.addEventListener("mousedown", (e) => {
    const li = e.target.closest(".opcion-ciudad");
    if (!li) return;
    e.preventDefault();
    cerrar();
    elegirCiudad(opciones[Number(li.dataset.i)]);
  });
  input.addEventListener("blur", () => {
    setTimeout(() => {
      cerrar();
      // Si se escribió algo sin elegir, se vuelve a mostrar la ciudad actual
      const ciudad = ciudadGuardada();
      input.value = AppState.userLocation.isGps ? "" : (ciudad ? ciudad.nombre : "");
    }, 150);
  });
}

// Cada petición de GPS lleva un número: elegir una ciudad o pedir otra vez el GPS deja
// sin efecto las respuestas que lleguen tarde de peticiones anteriores
let peticionUbicacion = 0;
const ESPERA_MAXIMA_GPS_MS = 12000;

/**
 * Pide la ubicación al navegador. Si se rechaza, falla o no hay respuesta (algunos
 * navegadores no responden nunca si se cierra el aviso sin contestar), se usa la
 * ciudad de referencia y la web funciona igual.
 * manual = el usuario lo ha pedido (botón ↻ o "Cerca de mí"): se explica cómo activarla.
 */
async function solicitarGeolocalizacionNavegador(manual = false) {
  const id = ++peticionUbicacion;
  const vigente = () => id === peticionUbicacion;
  let referenciaPuesta = false;

  // Sin GPS se sigue con la ubicación que ya había (la de referencia o el último GPS)
  const usarReferencia = (motivo) => {
    if (!vigente() || referenciaPuesta) return;
    referenciaPuesta = true;
    const labelEl = document.getElementById("user-location-label");
    if (labelEl) labelEl.textContent = AppState.userLocation.label;
    const desde = AppState.userLocation.isGps ? "tu última ubicación" : AppState.userLocation.label;
    if (motivo) mostrarToast(`${motivo} Mostrando carreras desde ${desde}; puedes elegir tu ciudad arriba.`, manual ? 8000 : 5000);
  };

  if (!navigator.geolocation) {
    usarReferencia("Este navegador no permite obtener la ubicación.");
    return;
  }

  // Permiso ya denegado antes: no se insiste ni se avisa en cada visita
  try {
    if (navigator.permissions) {
      const permiso = await navigator.permissions.query({ name: "geolocation" });
      if (permiso.state === "denied") {
        usarReferencia(manual ? "La ubicación está bloqueada: actívala en el candado junto a la dirección web y pulsa ↻." : "");
        return;
      }
    }
  } catch (e) {
    // Navegadores sin la API de permisos: se pregunta directamente
  }
  if (!vigente()) return;

  const labelEl = document.getElementById("user-location-label");
  if (labelEl) labelEl.textContent = "Obteniendo GPS...";

  // Si el navegador no responde a tiempo, se sigue con la referencia (si luego llega
  // la ubicación, se usa igualmente)
  const vigilante = setTimeout(() => usarReferencia(manual ? "No ha llegado tu ubicación." : ""), ESPERA_MAXIMA_GPS_MS);

  navigator.geolocation.getCurrentPosition(
    (position) => {
      clearTimeout(vigilante);
      if (!vigente()) return;
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      // Con GPS ya no hace falta el radio que cubre toda la región: el de Ajustes
      if (!AppState.userLocation.isGps && AppState.filters.radiusKm === REGION.radioCompletoKm && !ciudadGuardada()) {
        ponerRadio(typeof radioPorDefecto === "function" ? radioPorDefecto() : 50);
      }
      const inputCiudad = document.getElementById("input-ciudad");
      if (inputCiudad && document.activeElement !== inputCiudad) inputCiudad.value = "";
      establecerUbicacionUsuario(lat, lng, `Tu ubicación GPS (${lat.toFixed(2)}, ${lng.toFixed(2)})`, true);
      mostrarToast("📍 Ubicación GPS obtenida correctamente");
    },
    (error) => {
      clearTimeout(vigilante);
      console.warn("Error de geolocalización:", error.message);
      const motivos = {
        1: manual ? "Ubicación bloqueada: actívala en el candado junto a la dirección web y pulsa ↻." : "Sin permiso de ubicación.",
        2: "No se pudo determinar tu ubicación (¿está activada en el dispositivo?).",
        3: "La ubicación tardó demasiado (pulsa ↻ para reintentar)."
      };
      usarReferencia(motivos[error.code] || "No se pudo obtener tu ubicación.");
    },
    { timeout: 10000, enableHighAccuracy: true, maximumAge: 300000 }
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
    // Web estática (GitHub Pages): sin servidor, se lee el archivo publicado
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
  // Solo las próximas: las celebradas en las últimas semanas están para "Resultados"
  if (totalBadge) totalBadge.textContent = AppState.races.filter(c => !estaCelebrada(c)).length;

  aplicarFiltrosYRenderizar();
  // Enlace compartido (?carrera=<id>): abrir su ficha
  if (typeof abrirCarreraCompartida === "function") abrirCarreraCompartida();
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

  // Sección del menú elegida (menu.js): puede traer su propia lista, filtro y orden
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

const RADIO_MAXIMO_KM = 300; // el máximo del deslizador

function ampliarRadio(km) {
  AppState.filters.radiusKm = km;
  const slider = document.getElementById("filter-radius-slider");
  if (slider) slider.value = km;
  const etiqueta = document.getElementById("radius-display-value");
  if (etiqueta) etiqueta.textContent = `${km} km`;
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
    botones.push(`<button class="btn-secondary" onclick="resetearFiltros()">Restablecer filtros</button>`);
  } else if (filtrosActivos || radioActivo || !mensajeVacio) {
    titulo = "No hay carreras con estos filtros";
    if (radioActivo && masCercanaKm !== null) {
      const sugerido = Math.ceil(masCercanaKm / 5) * 5;
      texto = `Prueba a ampliar el radio de búsqueda: la carrera más cercana que cumple tus filtros está a ${String(masCercanaKm).replace(".", ",")} km.`;
      if (sugerido <= RADIO_MAXIMO_KM) {
        botones.push(`<button class="btn-primary" onclick="ampliarRadio(${sugerido})">Ampliar a ${sugerido} km</button>`);
      }
    } else if (radioActivo) {
      texto = "Ni ampliando el radio hay carreras con estos filtros. Prueba a quitar alguno (fecha, modalidad o distancia).";
    } else {
      texto = "Prueba a quitar algún filtro (fecha, modalidad o distancia).";
    }
    if (filtrosActivos) botones.push(`<button class="btn-secondary" onclick="resetearFiltros()">Quitar filtros</button>`);
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
          📅 ${formatearFechaLegible(c.fecha)} <small style="color:#64748b;">${diasStr}</small>
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
  document.getElementById("modal-race-surface").textContent = carrera.circuito || "";
  // El desnivel solo se muestra en carreras de trail; si no se conoce, en gris (no es un error)
  document.getElementById("modal-metric-elevation").style.display = isTrail ? "" : "none";
  const valorDesnivel = document.getElementById("modal-race-elevation");
  valorDesnivel.textContent = tieneDesnivel ? `+${carrera.desnivel_positivo_m} m` : "Sin publicar";
  valorDesnivel.classList.toggle("sin-dato", !tieneDesnivel);
  const valorPrecio = document.getElementById("modal-race-price");
  valorPrecio.textContent = carrera.precio_desde != null ? `Desde ${formatearPrecio(carrera.precio_desde)}` : "Consultar";
  valorPrecio.classList.toggle("sin-dato", carrera.precio_desde == null);
  const tamano = typeof textoTamano === "function" ? textoTamano(carrera) : "";
  document.getElementById("modal-race-slots").textContent = tamano ? `👥 ${tamano}`
    : (carrera.precio_desde != null ? "Según web de inscripción" : "En la web oficial");

  document.getElementById("modal-race-description").textContent =
    (carrera.estado ? `⚠️ Según su web de inscripción, esta carrera está ${carrera.estado}. ` : "")
    + (carrera.descripcion
      || (carrera.circuito ? `Prueba incluida en: ${carrera.circuito}. ` : "")
      + "Consulta horarios, recorrido y reglamento en la web oficial.");

  // Aviso de procedencia del dato
  const avisoTexto = document.getElementById("modal-notice-text");
  if (carrera.fuente && carrera.fuente.nombre) {
    // Si la carrera aparece en varias webs, se nombran todas
    const otras = (carrera.fuentes || []).filter(n => n !== carrera.fuente.nombre);
    avisoTexto.innerHTML = `<strong>Fuente:</strong> datos recopilados de
      <a href="${escapeHtml(urlSegura(carrera.fuente.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(carrera.fuente.nombre)}</a>${otras.length
        ? `, contrastados con ${escapeHtml(otras.join(", "))}` : ""}.
      Confirma fecha y detalles en la web oficial antes de inscribirte.`;
  } else {
    avisoTexto.textContent = "Confirma fecha y detalles en la web oficial antes de inscribirte.";
  }

  // Botón principal: inscripción o, si ya se ha celebrado, resultados
  const officialLink = document.getElementById("modal-btn-official-web");
  const celebrada = estaCelebrada(carrera);
  const bloqueResultados = document.getElementById("modal-resultados");
  const btnCalendario = document.getElementById("btn-ficha-calendario");
  if (btnCalendario) btnCalendario.style.display = celebrada ? "none" : "";
  if (celebrada) {
    const r = enlacesResultados(carrera);
    officialLink.href = urlSegura(r.enlaces[0].url);
    document.getElementById("modal-cta-texto").textContent = "Ver resultados";
    const nota = r.tipo === "propios"
      ? "Clasificaciones publicadas por la organización:"
      : r.tipo === "general"
        ? "Esta carrera no tiene un enlace propio a sus resultados; están en la sección de resultados de su web de inscripción."
        : "Aún no hemos encontrado sus resultados. Suelen publicarse en la web de la carrera unos días después.";
    bloqueResultados.innerHTML = `
      <h3 class="section-title">🏅 Resultados</h3>
      <p class="resultados-nota">${escapeHtml(nota)}</p>
      <div class="resultados-enlaces">
        ${r.enlaces.map(e => `<a class="enlace-resultado" href="${escapeHtml(urlSegura(e.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(e.texto)} ↗</a>`).join("")}
      </div>`;
    bloqueResultados.classList.remove("hidden");
  } else {
    officialLink.href = urlSegura(carrera.url_oficial);
    document.getElementById("modal-cta-texto").textContent = "Inscripción en Web Oficial";
    bloqueResultados.classList.add("hidden");
    bloqueResultados.innerHTML = "";
  }

  // Botón "Ver en mapa" desde dentro del modal
  const btnViewOnMap = document.getElementById("btn-modal-view-on-map");
  btnViewOnMap.onclick = () => {
    cerrarModalDetalle();
    centrarEnCarrera(carrera.id);
  };

  // Botones de favorita / calendario / corrida (menu.js)
  AppState.carreraAbierta = carrera;
  if (typeof actualizarAccionesFicha === "function") actualizarAccionesFicha(carrera);
  if (typeof mostrarTiempoPrevisto === "function") mostrarTiempoPrevisto(carrera);

  // Mostrar modal
  modal.classList.remove("hidden");
}

function cerrarModalDetalle() {
  const modal = document.getElementById("race-detail-modal");
  if (modal) modal.classList.add("hidden");
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
  // Radio por defecto elegido en Ajustes (menu.js)
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

  const slider = document.getElementById("filter-radius-slider");
  if (slider) slider.value = radio;

  const radiusDisplay = document.getElementById("radius-display-value");
  if (radiusDisplay) radiusDisplay.textContent = `${radio} km`;

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
  
  const cajaSugerencias = document.getElementById("sugerencias-busqueda");

  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      AppState.filters.search = e.target.value;
      if (clearSearchBtn) {
        clearSearchBtn.classList.toggle("hidden", !e.target.value);
      }
      aplicarFiltrosYRenderizar();
    });

    // Al volver al buscador con texto, mostrar otra vez las sugerencias
    searchInput.addEventListener("focus", () => actualizarSugerencias(AppState.filteredRaces));

    // Ocultar al salir (con un pequeño margen para que el toque en una sugerencia llegue)
    searchInput.addEventListener("blur", () => {
      setTimeout(() => cajaSugerencias && cajaSugerencias.classList.add("hidden"), 150);
    });

    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const primera = AppState.filteredRaces[0];
        if (primera && palabrasBusqueda(AppState.filters.search).length) elegirSugerencia(primera.id);
      } else if (e.key === "Escape" && cajaSugerencias) {
        cajaSugerencias.classList.add("hidden");
      }
    });
  }

  if (cajaSugerencias) {
    // pointerdown + preventDefault: el buscador no pierde el foco antes de registrar la elección
    cajaSugerencias.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".sugerencia")) e.preventDefault();
    });
    cajaSugerencias.addEventListener("click", (e) => {
      const opcion = e.target.closest(".sugerencia");
      if (opcion) elegirSugerencia(opcion.dataset.id);
    });
  }

  if (clearSearchBtn) {
    clearSearchBtn.addEventListener("click", () => {
      searchInput.value = "";
      clearSearchBtn.classList.add("hidden");
      AppState.filters.search = "";
      if (cajaSugerencias) cajaSugerencias.classList.add("hidden");
      aplicarFiltrosYRenderizar();
    });
  }

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
  document.querySelectorAll(".filters-card .segment-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filters-card .segment-btn").forEach(b => b.classList.remove("active"));
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

  // Botones de fecha: Este finde / 7 días / Este mes / Todas
  document.querySelectorAll(".chip-fecha").forEach(b => b.addEventListener("click", () => seleccionarFecha(b.dataset.fecha)));

  // Botón Restablecer
  const resetBtn = document.getElementById("btn-reset-filters");
  if (resetBtn) resetBtn.addEventListener("click", resetearFiltros);

  // Buscador de ciudad o pueblo de referencia
  configurarSelectorCiudad();

  // Botón Refrescar GPS
  const refreshGeoBtn = document.getElementById("btn-refresh-geo");
  if (refreshGeoBtn) refreshGeoBtn.addEventListener("click", () => solicitarGeolocalizacionNavegador(true));

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

  // Tecla ESC para cerrar la ficha
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") cerrarModalDetalle();
  });
}

// ==========================================================================
// Arranque
// ==========================================================================
// ==========================================================================
// App instalable (PWA): service worker y botón "Instalar app"
// ==========================================================================

function registrarServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  // Ruta relativa: funciona igual en localhost y en GitHub Pages (/RunNear/)
  navigator.serviceWorker.register("sw.js").catch(err => console.warn("Service worker no registrado:", err));
}

// Aviso de instalación que ofrece el navegador (Android, Chrome/Edge de escritorio)
let avisoInstalacion = null;

function appYaInstalada() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function esDispositivoIOS() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/** Botón "Instalar app" de la cabecera y opción del menú */
async function lanzarInstalacion() {
  const boton = document.getElementById("btn-instalar");
  if (appYaInstalada()) {
    mostrarToast("RunNear ya está instalada en este dispositivo");
  } else if (avisoInstalacion) {
    avisoInstalacion.prompt();
    const { outcome } = await avisoInstalacion.userChoice;
    if (outcome === "accepted" && boton) boton.classList.add("hidden");
    avisoInstalacion = null;
  } else if (esDispositivoIOS()) {
    document.getElementById("instalar-modal").classList.remove("hidden");
  } else {
    mostrarToast("Abre el menú del navegador (⋮) y elige «Instalar aplicación» o «Añadir a pantalla de inicio»", 7000);
  }
}

function configurarInstalacion() {
  const boton = document.getElementById("btn-instalar");
  const modal = document.getElementById("instalar-modal");
  if (!boton || !modal) return;

  if (appYaInstalada()) return;

  // iPhone/iPad: no hay instalador automático, se explican los pasos
  if (esDispositivoIOS()) boton.classList.remove("hidden");

  // Android y Chrome/Edge de escritorio: el navegador ofrece su propio instalador
  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault();
    avisoInstalacion = e;
    boton.classList.remove("hidden");
  });

  window.addEventListener("appinstalled", () => {
    boton.classList.add("hidden");
    mostrarToast("✅ RunNear instalada en tu dispositivo");
  });

  boton.addEventListener("click", lanzarInstalacion);

  const cerrar = () => modal.classList.add("hidden");
  document.getElementById("btn-cerrar-instalar").addEventListener("click", cerrar);
  modal.addEventListener("click", e => { if (e.target === modal) cerrar(); });
}

document.addEventListener("DOMContentLoaded", () => {
  if (MODO_DIAGNOSTICO) setTimeout(iniciarDiagnostico, 500);
  registrarServiceWorker();
  configurarInstalacion();
  inicializarMapa();
  configurarEventListeners();
  usarUbicacionPorDefecto();
  solicitarGeolocalizacionNavegador();
  cargarCarrerasDesdeServidor();
});
