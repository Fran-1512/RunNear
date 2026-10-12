/**
 * RunNear - Arranque: conecta los controles de la página y pone todo en marcha al cargar.
 * Primero el mapa, la lista y la ubicación; después el menú.
 */

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
    // Mientras se arrastra solo cambia la cifra; la lista se recalcula al parar un instante
    let esperaRadio = null;
    radiusSlider.addEventListener("input", (e) => {
      const val = parseInt(e.target.value, 10);
      AppState.filters.radiusKm = val >= RADIO_SIN_LIMITE ? 0 : val;
      radiusDisplay.textContent = textoRadio(AppState.filters.radiusKm);
      clearTimeout(esperaRadio);
      esperaRadio = setTimeout(aplicarFiltrosYRenderizar, 150);
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

  // Botones de la lista vacía: "Restablecer filtros" y "Ampliar a N km"
  const lista = document.getElementById("races-list-container");
  if (lista) {
    lista.addEventListener("click", (e) => {
      const boton = e.target.closest("button[data-accion]");
      if (!boton) return;
      if (boton.dataset.accion === "restablecer") resetearFiltros();
      else if (boton.dataset.accion === "ampliar") ampliarRadio(Number(boton.dataset.km));
    });
  }

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

document.addEventListener("DOMContentLoaded", () => {
  if (MODO_DIAGNOSTICO) setTimeout(iniciarDiagnostico, 500);
  registrarServiceWorker();
  configurarInstalacion();
  inicializarMapa();
  configurarEventListeners();
  usarUbicacionPorDefecto();
  solicitarGeolocalizacionNavegador();
  cargarCarreras();
});

document.addEventListener("DOMContentLoaded", () => {
  AppState.vista = "todas";
  // El radio inicial lo pone ubicacion.js según la ubicación de referencia (usarUbicacionPorDefecto)

  document.querySelectorAll(".menu-item[data-vista]").forEach(b => b.addEventListener("click", () => aplicarVista(b.dataset.vista)));
  document.querySelectorAll(".menu-grupo").forEach(b => b.addEventListener("click", () => abrirGrupo(b)));

  const acciones = {
    "ics-favoritas": exportarFavoritasICS,
    cuenta: () => abrirCuenta(),
    proponer: () => abrirPropuesta(),
    instalar: lanzarInstalacion,
    acerca: mostrarAcercaDe,
    ajustes: mostrarAjustes
  };
  document.querySelectorAll(".menu-item[data-accion]").forEach(b => b.addEventListener("click", () => {
    cerrarMenuMovil();
    acciones[b.dataset.accion]();
  }));

  document.getElementById("btn-quitar-vista").addEventListener("click", () => aplicarVista("todas"));
  document.getElementById("btn-menu").addEventListener("click", abrirMenuMovil);
  document.getElementById("btn-cerrar-menu").addEventListener("click", cerrarMenuMovil);
  document.getElementById("menu-fondo").addEventListener("click", cerrarMenuMovil);
  document.getElementById("btn-cerrar-info").addEventListener("click", cerrarInfo);
  document.getElementById("info-modal").addEventListener("click", e => {
    if (e.target.id === "info-modal") cerrarInfo();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      cerrarMenuMovil();
      cerrarInfo();
    }
  });

  // "Instalar la app" no tiene sentido si ya está instalada
  const yaInstalada = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  if (yaInstalada) document.getElementById("menu-instalar").style.display = "none";

  configurarAccionesFicha();
  actualizarContadoresMenu();
});
