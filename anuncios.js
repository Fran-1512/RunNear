/**
 * RunNear - Anuncios (Google AdSense)
 *
 * Las páginas marcan dónde puede ir un anuncio con <div class="anuncio" data-tipo="...">.
 * Tipos: "horizontal" (entre secciones), "articulo" (dentro del texto de las guías) y
 * "lista" (entre las carreras de la lista del mapa).
 *
 * PARA ACTIVARLOS (cuando Google apruebe la web):
 *   1. Poner en CLIENTE el código de editor de AdSense ("ca-pub-...").
 *   2. Opcional: crear en AdSense un bloque de anuncios por tipo y poner su número en BLOQUES.
 *      Sin bloques, AdSense coloca los anuncios automáticamente (Auto ads) y los huecos no se usan.
 *
 * Mientras CLIENTE esté vacío no se carga nada de Google y los huecos no ocupan sitio.
 * En el ordenador local (localhost) se ven como recuadros de prueba para revisar su posición.
 */
(function () {
  const CLIENTE = "";
  const BLOQUES = { horizontal: "", articulo: "", lista: "" };

  const local = ["localhost", "127.0.0.1"].includes(location.hostname);
  let scriptCargado = false;

  function cargarScript() {
    if (scriptCargado) return;
    scriptCargado = true;
    const s = document.createElement("script");
    s.async = true;
    s.crossOrigin = "anonymous";
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${CLIENTE}`;
    document.head.appendChild(s);
  }

  function rellenar(hueco) {
    const tipo = hueco.dataset.tipo || "horizontal";
    const bloque = BLOQUES[tipo];
    if (CLIENTE && bloque) {
      const ins = document.createElement("ins");
      ins.className = "adsbygoogle";
      ins.style.display = "block";
      ins.dataset.adClient = CLIENTE;
      ins.dataset.adSlot = bloque;
      if (tipo === "articulo") {
        ins.style.textAlign = "center";
        ins.dataset.adLayout = "in-article";
        ins.dataset.adFormat = "fluid";
      } else {
        ins.dataset.adFormat = "auto";
        ins.dataset.fullWidthResponsive = "true";
      }
      hueco.appendChild(ins);
      hueco.classList.add("activo");
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } else if (!CLIENTE && local) {
      hueco.classList.add("prueba");
      hueco.textContent = `Anuncio (${tipo}) · solo se ve en tu ordenador`;
    }
  }

  /** Rellena los huecos nuevos (la lista del mapa lo llama cada vez que añade carreras) */
  function activar(raiz) {
    (raiz || document).querySelectorAll(".anuncio:not([data-listo])").forEach(hueco => {
      hueco.dataset.listo = "1";
      rellenar(hueco);
    });
  }

  window.RunNearAnuncios = { activar, activos: !!CLIENTE || local };

  if (CLIENTE) cargarScript();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => activar());
  } else {
    activar();
  }
})();
