/**
 * RunNear - Anuncios (Google AdSense)
 *
 * Las páginas marcan dónde puede ir un anuncio con <div class="anuncio" data-tipo="...">.
 * Tipos: "horizontal" (entre secciones), "articulo" (dentro del texto de las guías) y
 * "lista" (entre las carreras de la lista del mapa).
 *
 * - CLIENTE: la cuenta de AdSense (la misma que ADSENSE_CUENTA en sitio/generar.py y ads.txt).
 *   Con ella se carga el código de Google, que además muestra el aviso de cookies (configurado
 *   en AdSense → Privacidad y mensajes).
 * - BLOQUES: el número de cada bloque de anuncios creado en AdSense (Anuncios → Por bloque de
 *   anuncios). Un hueco sin bloque no ocupa sitio (los anuncios automáticos, si están activados
 *   en AdSense, los coloca Google por su cuenta).
 * - Los dominios de Google están permitidos en la política de seguridad (CSP en sitio/generar.py,
 *   copiada en mapa.html y legal.html).
 *
 * En el ordenador local (localhost) no se cargan anuncios reales (contarían como visitas no
 * válidas): los huecos se ven como recuadros de prueba. Para probar el código de Google en local,
 * abrir la página con ?anuncios=google.
 */
(function () {
  const CLIENTE = "ca-pub-6802213588582157";
  // horizontal y lista: bloque "RunNear horizontal" (display adaptable); articulo: "RunNear guías"
  const BLOQUES = { horizontal: "4127949208", articulo: "2012087605", lista: "4127949208" };

  const local = ["localhost", "127.0.0.1"].includes(location.hostname);
  const probarEnLocal = local && /[?&]anuncios=google\b/.test(location.search);
  const reales = !!CLIENTE && (!local || probarEnLocal);
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
    if (reales && bloque) {
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
      // El hueco no ocupa sitio ni dice "Publicidad" hasta que Google pone un anuncio de verdad
      // (data-ad-status="filled"); vacío o sin aprobar, no queda ningún espacio en blanco
      new MutationObserver(() => hueco.classList.toggle("lleno", ins.dataset.adStatus === "filled"))
        .observe(ins, { attributes: true, attributeFilter: ["data-ad-status"] });
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } else if (local && !probarEnLocal) {
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

  // Enlaces "Configurar cookies" (data-cookies): vuelven a abrir el aviso de consentimiento de
  // Google para cambiar la elección. Si el aviso aún no está cargado, el enlace lleva a la política.
  document.addEventListener("click", e => {
    const enlace = e.target.closest("[data-cookies]");
    const fc = window.googlefc;
    if (!enlace || !fc || typeof fc.showRevocationMessage !== "function") return;
    e.preventDefault();
    fc.showRevocationMessage();
  });

  // La lista del mapa solo intercala huecos si alguno se va a ver
  const hayBloques = Object.values(BLOQUES).some(Boolean);
  window.RunNearAnuncios = { activar, activos: (reales && hayBloques) || (local && !probarEnLocal) };

  if (reales) cargarScript();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => activar());
  } else {
    activar();
  }
})();
