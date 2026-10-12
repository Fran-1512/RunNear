/**
 * RunNear - Tema claro u oscuro: automático según el dispositivo o el que se elija en Ajustes.
 * Se aplica nada más cargar para que la página no parpadee.
 */

/**
 * Apariencia: "auto" (según el modo claro/oscuro del dispositivo, por defecto), "claro" u "oscuro".
 * Las páginas de texto (portada, guías, calendario) leen la misma elección.
 * Versiones anteriores guardaban "tema" y siempre "oscuro" por defecto, así que de aquello solo
 * se conserva "claro", que sí lo eligió la persona.
 */
const MODO_CLARO = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;

function aparienciaGuardada() {
  let apariencia = ALMACEN.leer("apariencia", null);
  if (!apariencia) {
    apariencia = ALMACEN.leer("tema", null) === "claro" ? "claro" : "auto";
    if (apariencia === "claro") ALMACEN.guardar("apariencia", "claro");
    try {
      localStorage.removeItem("runnear_tema");
    } catch (e) {
      // Sin almacenamiento: nada que limpiar
    }
  }
  return apariencia;
}

function aplicarTema(apariencia, guardar = true) {
  const claro = apariencia === "claro" || (apariencia === "auto" && !!MODO_CLARO && MODO_CLARO.matches);
  document.body.classList.toggle("tema-claro", claro);
  if (guardar) ALMACEN.guardar("apariencia", apariencia);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", claro ? "#ffffff" : "#0c1220");
}

// El tema se aplica cuanto antes para evitar un parpadeo; en automático, sigue al dispositivo
aplicarTema(aparienciaGuardada(), false);
if (MODO_CLARO && MODO_CLARO.addEventListener) {
  MODO_CLARO.addEventListener("change", () => {
    if (aparienciaGuardada() === "auto") aplicarTema("auto", false);
  });
}
