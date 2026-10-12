/**
 * RunNear - App instalable (PWA): service worker y botón "Instalar app".
 */

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
