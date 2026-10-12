/**
 * RunNear - Ubicación de referencia: GPS del dispositivo y buscador de ciudad o pueblo de la cabecera.
 */

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
        <span style="font-size:0.75rem; color:#94a3b8;">${AppState.filters.radiusKm > 0 ? `Buscando carreras en un radio de ${AppState.filters.radiusKm} km` : "Buscando carreras en toda España"}</span>
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

/** km = 0: sin límite de distancia (el deslizador queda al final, en "Sin límite") */
function ponerRadio(km) {
  AppState.filters.radiusKm = km;
  const slider = document.getElementById("filter-radius-slider");
  if (slider) slider.value = km > 0 ? km : RADIO_SIN_LIMITE;
  const radiusDisplay = document.getElementById("radius-display-value");
  if (radiusDisplay) radiusDisplay.textContent = textoRadio(km);
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

// Capitales de provincia y grandes ciudades, de más a menos población: siempre disponibles
// aunque no tengan carreras próximas. Con la casilla vacía se proponen las primeras.
const CIUDADES_PRINCIPALES = [
  ["Madrid", "Madrid", 40.4168, -3.7038], ["Barcelona", "Barcelona", 41.3874, 2.1686],
  ["Valencia", "Valencia", 39.4699, -0.3763], ["Sevilla", "Sevilla", 37.3891, -5.9845],
  ["Zaragoza", "Zaragoza", 41.6488, -0.8891], ["Málaga", "Málaga", 36.7213, -4.4214],
  ["Murcia", "Murcia", 37.9922, -1.1307], ["Palma", "Baleares", 39.5696, 2.6502],
  ["Las Palmas de Gran Canaria", "Las Palmas", 28.1235, -15.4363], ["Bilbao", "Bizkaia", 43.263, -2.935],
  ["Alicante", "Alicante", 38.3452, -0.481], ["Córdoba", "Córdoba", 37.8882, -4.7794],
  ["Valladolid", "Valladolid", 41.6523, -4.7245], ["Vigo", "Pontevedra", 42.2406, -8.7207],
  ["Gijón", "Asturias", 43.5322, -5.6611], ["Vitoria-Gasteiz", "Álava", 42.8467, -2.6716],
  ["A Coruña", "A Coruña", 43.3623, -8.4115], ["Elche", "Alicante", 38.2669, -0.6983],
  ["Granada", "Granada", 37.1773, -3.5986], ["Oviedo", "Asturias", 43.3619, -5.8494],
  ["Santa Cruz de Tenerife", "Santa Cruz de Tenerife", 28.4636, -16.2518], ["Pamplona", "Navarra", 42.8125, -1.6458],
  ["Almería", "Almería", 36.834, -2.4637], ["Jerez de la Frontera", "Cádiz", 36.685, -6.1261],
  ["San Sebastián", "Gipuzkoa", 43.3183, -1.9812], ["Burgos", "Burgos", 42.3439, -3.6969],
  ["Santander", "Cantabria", 43.4623, -3.81], ["Castellón de la Plana", "Castellón", 39.9864, -0.0513],
  ["Albacete", "Albacete", 38.9943, -1.8585], ["Cartagena", "Murcia", 37.6257, -0.9966],
  ["Logroño", "La Rioja", 42.4627, -2.445], ["Badajoz", "Badajoz", 38.8794, -6.9707],
  ["Salamanca", "Salamanca", 40.9701, -5.6635], ["Huelva", "Huelva", 37.2614, -6.9447],
  ["Lleida", "Lleida", 41.6176, 0.62], ["Tarragona", "Tarragona", 41.1189, 1.2445],
  ["León", "León", 42.5987, -5.5671], ["Cádiz", "Cádiz", 36.5271, -6.2886],
  ["Jaén", "Jaén", 37.7796, -3.7849], ["Ourense", "Ourense", 42.3358, -7.8639],
  ["Girona", "Girona", 41.9794, 2.8214], ["Lugo", "Lugo", 43.0097, -7.5568],
  ["Cáceres", "Cáceres", 39.4753, -6.3724], ["Guadalajara", "Guadalajara", 40.6329, -3.1664],
  ["Toledo", "Toledo", 39.8628, -4.0273], ["Melilla", "Melilla", 35.2923, -2.9381],
  ["Ceuta", "Ceuta", 35.8894, -5.3213], ["Pontevedra", "Pontevedra", 42.431, -8.6444],
  ["Palencia", "Palencia", 42.0095, -4.5288], ["Talavera de la Reina", "Toledo", 39.9636, -4.8307],
  ["Ciudad Real", "Ciudad Real", 38.9848, -3.9274], ["Zamora", "Zamora", 41.5034, -5.7467],
  ["Ávila", "Ávila", 40.6565, -4.6818], ["Cuenca", "Cuenca", 40.0704, -2.1374],
  ["Segovia", "Segovia", 40.9429, -4.1088], ["Huesca", "Huesca", 42.1401, -0.4089],
  ["Soria", "Soria", 41.7666, -2.479], ["Teruel", "Teruel", 40.3456, -1.1065]
].map(([nombre, provincia, lat, lng]) => ({ nombre, provincia, lat, lng }));
const CIUDADES_SUGERIDAS = 10;

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
  if (typeof alCambiarDatoLocal === "function") alCambiarDatoLocal("ciudad");
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
      ? CIUDADES_PRINCIPALES.slice(0, CIUDADES_SUGERIDAS)
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
