/**
 * RunNear - Modo diagnóstico (abrir la web con ?diagnostico): muestra datos técnicos en pantalla
 * para ver qué falla en un móvil concreto con una captura. Va el primero para recoger
 * también los errores de los demás archivos.
 */

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
