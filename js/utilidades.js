/**
 * RunNear - Utilidades: distancias, formato de textos, fechas, tiempos y ritmos, y avisos en pantalla.
 */

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
