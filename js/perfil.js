/**
 * RunNear - Mi perfil: estadísticas de tus carreras corridas y mejores marcas.
 */

// ==========================================================================
// Mi perfil: estadísticas de tus carreras
// ==========================================================================

/** Km de una carrera corrida: los que apuntaste o, si solo tenía una distancia, esa */
function kmDeCorrida(g) {
  if (g.marca && g.marca.distancia_km) return g.marca.distancia_km;
  const lista = listaDistancias(g);
  return lista.length === 1 ? lista[0] : null;
}

function formatearKm(km) {
  return Math.round(km).toLocaleString("es-ES");
}

/** 2h 05m · 45 min */
function formatearDuracion(seg) {
  const h = Math.floor(seg / 3600);
  const m = Math.round((seg % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m} min`;
}

function estadisticasPerfil() {
  const corridas = listaCorridas();
  const conKm = corridas.filter(g => kmDeCorrida(g) !== null);
  const conTiempo = corridas.filter(g => g.marca && g.marca.tiempo_seg);
  const porAno = {};
  corridas.forEach(g => {
    const ano = (g.fecha || "").slice(0, 4) || "—";
    porAno[ano] = porAno[ano] || { carreras: 0, km: 0 };
    porAno[ano].carreras++;
    porAno[ano].km += kmDeCorrida(g) || 0;
  });
  const porProvincia = {};
  corridas.forEach(g => {
    if (g.provincia) porProvincia[g.provincia] = (porProvincia[g.provincia] || 0) + 1;
  });
  return {
    total: corridas.length,
    trail: corridas.filter(g => g.tipo === "trail").length,
    km: conKm.reduce((s, g) => s + kmDeCorrida(g), 0),
    sinKm: corridas.length - conKm.length,
    tiempo: conTiempo.reduce((s, g) => s + g.marca.tiempo_seg, 0),
    pueblos: new Set(corridas.map(g => normalizarTexto(g.municipio || "")).filter(Boolean)).size,
    porAno: Object.entries(porAno).sort((a, b) => b[0].localeCompare(a[0])),
    porProvincia: Object.entries(porProvincia).sort((a, b) => b[1] - a[1])
  };
}

function renderizarPanelPerfil() {
  const panel = document.getElementById("panel-perfil");
  if (!panel) return;
  if (AppState.vista !== "perfil") {
    panel.classList.add("hidden");
    return;
  }
  panel.classList.remove("hidden");

  const usuario = typeof Cuenta !== "undefined" ? Cuenta.usuario : null;
  const nombre = usuario ? (usuario.nombre || usuario.email) : "";
  const e = estadisticasPerfil();
  const maxAno = Math.max(1, ...e.porAno.map(([, v]) => v.carreras));

  const hoy = hoyISO();
  const favs = idsFavoritas();
  const proximas = AppState.races.filter(c => favs.has(c.id) && c.fecha >= hoy).sort(porFecha).slice(0, 3);

  panel.innerHTML = `
    <div class="perfil-cabecera">
      <span class="perfil-avatar" aria-hidden="true">${usuario ? escapeHtml(nombre.charAt(0).toUpperCase()) : "🏃"}</span>
      <div class="perfil-quien">
        <p class="perfil-nombre">${usuario ? escapeHtml(usuario.nombre || "Tu perfil") : "Tu perfil"}</p>
        <p class="perfil-sub">${usuario
          ? escapeHtml(usuario.email)
          : `Sin cuenta: estos datos solo están en este dispositivo. <button class="perfil-enlace" id="perfil-crear-cuenta">Crea una cuenta</button> para no perderlos.`}</p>
      </div>
    </div>

    <div class="perfil-cifras">
      <div class="perfil-cifra"><strong>${e.total}</strong><span>${e.total === 1 ? "carrera" : "carreras"}</span></div>
      <div class="perfil-cifra"><strong>${formatearKm(e.km)}</strong><span>km</span></div>
      <div class="perfil-cifra"><strong>${e.tiempo ? escapeHtml(formatearDuracion(e.tiempo)) : "—"}</strong><span>corriendo</span></div>
      <div class="perfil-cifra"><strong>${e.pueblos}</strong><span>${e.pueblos === 1 ? "pueblo" : "pueblos"}</span></div>
    </div>
    ${e.total ? `<p class="perfil-nota">🏃 ${e.total - e.trail} de asfalto · ⛰️ ${e.trail} de trail${e.sinKm
      ? ` · ${e.sinKm} sin distancia apuntada (no suman km: abre la carrera y apunta tu tiempo y distancia)` : ""}</p>` : ""}

    ${e.porAno.length ? `
    <p class="perfil-titulo">📅 Por año</p>
    <div class="perfil-anos">
      ${e.porAno.map(([ano, v]) => `
        <div class="perfil-ano">
          <span class="perfil-ano-nombre">${escapeHtml(ano)}</span>
          <span class="perfil-barra"><span style="width:${Math.max(6, Math.round(v.carreras / maxAno * 100))}%"></span></span>
          <span class="perfil-ano-dato">${v.carreras} ${v.carreras === 1 ? "carrera" : "carreras"} · ${formatearKm(v.km)} km</span>
        </div>`).join("")}
    </div>` : ""}

    <p class="perfil-titulo">🏆 Mejores marcas</p>
    ${htmlMejoresMarcas(mejoresMarcas())}

    <p class="perfil-titulo">❤️ Tus próximas favoritas</p>
    ${proximas.length ? `
    <div class="perfil-proximas">
      ${proximas.map(c => {
        const dias = calcularDiasRestantes(c.fecha);
        return `<button class="perfil-proxima" data-id="${escapeHtml(c.id)}">
          <span class="perfil-proxima-nombre">${escapeHtml(c.nombre)}</span>
          <span class="perfil-proxima-dato">${escapeHtml(fechaCorta(c.fecha))} · ${dias === 0 ? "¡hoy!" : dias === 1 ? "mañana" : `faltan ${dias} días`}</span>
        </button>`;
      }).join("")}
    </div>` : `<p class="marcas-ayuda">Pulsa ♡ en las carreras que te interesen y aquí verás cuánto falta para cada una.</p>`}

    ${e.porProvincia.length ? `
    <p class="perfil-titulo">📍 Dónde has corrido</p>
    <p class="perfil-provincias">${e.porProvincia.map(([p, n]) => `<span class="perfil-provincia">${escapeHtml(p)} <strong>${n}</strong></span>`).join("")}</p>
    <p class="perfil-nota">En el mapa ves todas tus carreras; abajo, la lista completa.</p>` : ""}`;

  enlazarFichas(panel);
  const crear = panel.querySelector("#perfil-crear-cuenta");
  if (crear) crear.addEventListener("click", () => abrirCuenta());
}
