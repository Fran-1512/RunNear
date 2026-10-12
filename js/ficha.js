/**
 * RunNear - Ficha de una carrera: ventana de detalle, botones (favorita, calendario, corrida),
 * tu tiempo, compartir y tiempo previsto (Open-Meteo).
 */

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
  if (carrera.verificada_organizador) {
    avisoTexto.insertAdjacentHTML("afterbegin", `<strong>✅ Datos facilitados por la organización.</strong> `);
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

  // Botones de favorita / calendario / corrida (más abajo)
  AppState.carreraAbierta = carrera;
  if (typeof actualizarAccionesFicha === "function") actualizarAccionesFicha(carrera);
  if (typeof mostrarTiempoPrevisto === "function") mostrarTiempoPrevisto(carrera);
  if (typeof mostrarValoraciones === "function") mostrarValoraciones(carrera);

  // Mostrar modal
  modal.classList.remove("hidden");
}

function cerrarModalDetalle() {
  const modal = document.getElementById("race-detail-modal");
  if (modal) modal.classList.add("hidden");
}

// ==========================================================================
// Botones de la ficha (favorita, calendario, corrida)
// ==========================================================================

function actualizarAccionesFicha(carrera) {
  const fav = document.getElementById("btn-ficha-favorita");
  const corr = document.getElementById("btn-ficha-corrida");
  if (!fav || !corr) return;
  const esFav = esFavorita(carrera.id);
  fav.classList.toggle("activa", esFav);
  fav.setAttribute("aria-pressed", String(esFav));
  fav.querySelector(".accion-icono").textContent = esFav ? "♥" : "♡";
  fav.querySelector(".accion-texto").textContent = esFav ? "En favoritas" : "Favorita";

  const esCorr = esCorrida(carrera.id);
  corr.classList.toggle("activa", esCorr);
  corr.setAttribute("aria-pressed", String(esCorr));
  corr.querySelector(".accion-icono").textContent = esCorr ? "✅" : "☐";

  renderizarMarcaFicha(carrera);
}

// ==========================================================================
// Tu tiempo en una carrera corrida (ficha) y tus mejores marcas
// ==========================================================================

function renderizarMarcaFicha(carrera, editando = false) {
  const caja = document.getElementById("modal-marca");
  if (!caja) return;
  if (!esCorrida(carrera.id)) {
    caja.classList.add("hidden");
    caja.innerHTML = "";
    return;
  }
  caja.classList.remove("hidden");
  const marca = marcaDe(carrera.id);

  if (marca && !editando) {
    caja.innerHTML = `
      <div class="marca-resumen">
        <span class="marca-etiqueta">⏱️ Tu tiempo</span>
        <strong class="marca-tiempo">${escapeHtml(formatearTiempo(marca.tiempo_seg))}</strong>
        <span class="marca-detalle">${escapeHtml(textoKm(marca.distancia_km))} · ${escapeHtml(ritmoPorKm(marca))}</span>
      </div>
      <div class="marca-botones">
        <button class="btn-secondary" id="marca-editar">Editar</button>
        <button class="btn-secondary" id="marca-quitar">Quitar</button>
      </div>`;
    caja.querySelector("#marca-editar").addEventListener("click", () => renderizarMarcaFicha(carrera, true));
    caja.querySelector("#marca-quitar").addEventListener("click", () => {
      guardarMarca(carrera.id, null);
      renderizarMarcaFicha(carrera);
      if (esVistaDeCorridas()) aplicarFiltrosYRenderizar();
    });
    return;
  }

  // Formulario: distancia (de las que tiene la carrera) y tiempo en h / min / s
  const distancias = listaDistancias(carrera);
  const elegida = marca ? marca.distancia_km : distancias[0];
  const campoDistancia = distancias.length > 1
    ? `<select id="marca-km" class="sort-select">${distancias.map(km =>
        `<option value="${km}" ${km === elegida ? "selected" : ""}>${escapeHtml(textoKm(km))}</option>`).join("")}</select>`
    : `<input id="marca-km" type="number" inputmode="decimal" min="0.1" step="0.1" value="${elegida ?? ""}" placeholder="km" aria-label="Kilómetros">`;
  const t = marca ? marca.tiempo_seg : null;
  const valor = n => (t != null ? n : "");

  caja.innerHTML = `
    <p class="marca-titulo">⏱️ Apunta tu tiempo</p>
    <div class="marca-form">
      <label class="marca-campo">Distancia ${campoDistancia}</label>
      <div class="marca-campo">Tiempo
        <div class="marca-tiempo-inputs">
          <input id="marca-h" type="number" inputmode="numeric" min="0" max="99" placeholder="h" aria-label="Horas" value="${valor(Math.floor(t / 3600))}">
          <span>:</span>
          <input id="marca-m" type="number" inputmode="numeric" min="0" max="59" placeholder="min" aria-label="Minutos" value="${valor(Math.floor((t % 3600) / 60))}">
          <span>:</span>
          <input id="marca-s" type="number" inputmode="numeric" min="0" max="59" placeholder="s" aria-label="Segundos" value="${valor(t % 60)}">
        </div>
      </div>
      <button class="btn-primary marca-guardar" id="marca-guardar">Guardar</button>
    </div>`;

  caja.querySelector("#marca-guardar").addEventListener("click", () => {
    const km = Number(String(caja.querySelector("#marca-km").value).replace(",", "."));
    const h = Number(caja.querySelector("#marca-h").value || 0);
    const m = Number(caja.querySelector("#marca-m").value || 0);
    const s = Number(caja.querySelector("#marca-s").value || 0);
    const seg = h * 3600 + m * 60 + s;
    if (!(km > 0) || !(seg > 0) || m > 59 || s > 59 || [h, m, s].some(v => v < 0 || !Number.isInteger(v))) {
      mostrarToast("Revisa la distancia y el tiempo (minutos y segundos de 0 a 59)");
      return;
    }
    guardarMarca(carrera.id, { tiempo_seg: seg, distancia_km: km });
    renderizarMarcaFicha(carrera);
    mostrarToast("⏱️ Tiempo guardado");
    if (esVistaDeCorridas()) aplicarFiltrosYRenderizar();
  });
}

/** Secciones que muestran tus carreras corridas (y se refrescan al cambiar un tiempo) */
function esVistaDeCorridas() {
  return AppState.vista === "corridas" || AppState.vista === "perfil";
}

/** Mejor tiempo en cada distancia clásica (5K, 10K, media, maratón) */
function mejoresMarcas() {
  const conMarca = listaCorridas().filter(g => g.marca);
  return DISTANCIAS_MARCA.map(d => {
    const candidatas = conMarca.filter(g => g.marca.distancia_km >= d.min && g.marca.distancia_km <= d.max);
    const mejor = candidatas.sort((a, b) => a.marca.tiempo_seg - b.marca.tiempo_seg)[0];
    return { ...d, mejor };
  }).filter(d => d.mejor);
}

function htmlMejoresMarcas(mejores) {
  if (!mejores.length) {
    return `<p class="marcas-ayuda">Abre una carrera que hayas corrido y apunta tu tiempo: aquí verás tus mejores marcas en 5K, 10K, media y maratón.</p>`;
  }
  return `
    <div class="marcas-rejilla">
      ${mejores.map(d => `
        <button class="marca-pb" data-id="${escapeHtml(d.mejor.id)}" title="${escapeHtml(d.mejor.nombre)}">
          <span class="marca-pb-distancia">${d.titulo}</span>
          <strong class="marca-pb-tiempo">${escapeHtml(formatearTiempo(d.mejor.marca.tiempo_seg))}</strong>
          <span class="marca-pb-ritmo">${escapeHtml(ritmoPorKm(d.mejor.marca))}</span>
          <span class="marca-pb-carrera">${escapeHtml(d.mejor.nombre)}</span>
        </button>`).join("")}
    </div>`;
}

/** Los botones con data-id abren la ficha de esa carrera (del calendario o guardada) */
function enlazarFichas(contenedor) {
  contenedor.querySelectorAll("[data-id]").forEach(b => b.addEventListener("click", () => {
    const id = b.dataset.id;
    const enCalendario = AppState.races.find(c => c.id === id);
    const guardada = listaCorridas().find(c => c.id === id);
    if (enCalendario || guardada) abrirModalDetalleCarrera(enCalendario || guardada);
  }));
}

function renderizarPanelMarcas() {
  const panel = document.getElementById("panel-marcas");
  if (!panel) return;
  if (AppState.vista !== "corridas" || !listaCorridas().length) {
    panel.classList.add("hidden");
    return;
  }
  panel.classList.remove("hidden");
  panel.innerHTML = `<p class="marcas-titulo">🏆 Tus mejores marcas</p>${htmlMejoresMarcas(mejoresMarcas())}`;
  enlazarFichas(panel);
}

// ==========================================================================
// Compartir una carrera
// ==========================================================================

function enlaceCarrera(c) {
  return `${location.origin}${location.pathname}?carrera=${encodeURIComponent(c.id)}`;
}

async function compartirCarrera(c) {
  // Se comparte la web oficial de la carrera; solo si no tiene, la ficha de RunNear
  const oficial = urlSegura(c.url_oficial);
  const url = oficial !== "#" ? oficial : enlaceCarrera(c);
  const texto = `🏃 ${c.nombre} · ${fechaCorta(c.fecha)} en ${c.municipio}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: c.nombre, text: texto, url });
    } catch (e) {
      // El usuario ha cerrado el menú de compartir: no es un error
    }
    return;
  }
  try {
    await navigator.clipboard.writeText(`${texto}\n${url}`);
    mostrarToast("🔗 Enlace copiado: pégalo donde quieras");
  } catch (e) {
    window.prompt("Copia este enlace:", url);
  }
}

/** Al abrir un enlace compartido (?carrera=<id>) se abre directamente su ficha */
function abrirCarreraCompartida() {
  const parametros = new URLSearchParams(location.search);
  const id = parametros.get("carrera");
  if (!id) return;
  const carrera = AppState.races.find(c => c.id === id);
  if (carrera) {
    abrirModalDetallePorId(id);
  } else {
    mostrarToast("Esa carrera ya no está en el calendario");
  }
  // Quitar el parámetro para que al recargar no se vuelva a abrir
  parametros.delete("carrera");
  const resto = parametros.toString();
  history.replaceState(null, "", location.pathname + (resto ? "?" + resto : "") + location.hash);
}

// ==========================================================================
// Tiempo previsto para el día de la carrera (Open-Meteo, gratuito y sin clave)
// ==========================================================================

const DIAS_PREVISION = 15; // Open-Meteo da previsión hasta 16 días
const PREVISIONES = new Map();

function estadoCielo(codigo) {
  if (codigo === 0) return ["☀️", "Despejado"];
  if (codigo === 1) return ["🌤️", "Casi despejado"];
  if (codigo === 2) return ["⛅", "Intervalos de nubes"];
  if (codigo === 3) return ["☁️", "Nublado"];
  if (codigo === 45 || codigo === 48) return ["🌫️", "Niebla"];
  if (codigo >= 51 && codigo <= 57) return ["🌦️", "Llovizna"];
  if (codigo >= 61 && codigo <= 67) return ["🌧️", "Lluvia"];
  if (codigo >= 71 && codigo <= 77) return ["🌨️", "Nieve"];
  if (codigo >= 80 && codigo <= 82) return ["🌦️", "Chubascos"];
  if (codigo === 85 || codigo === 86) return ["🌨️", "Chubascos de nieve"];
  if (codigo >= 95) return ["⛈️", "Tormenta"];
  return ["🌡️", "—"];
}

async function obtenerPrevision(c) {
  const { lat, lng } = c.ubicacion;
  const clave = `${lat.toFixed(2)},${lng.toFixed(2)},${c.fecha}`;
  if (PREVISIONES.has(clave)) return PREVISIONES.get(clave);
  const parametros = new URLSearchParams({
    latitude: lat.toFixed(3),
    longitude: lng.toFixed(3),
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max",
    hourly: "temperature_2m,weather_code,precipitation_probability",
    timezone: "Europe/Madrid",
    start_date: c.fecha,
    end_date: c.fecha
  });
  const respuesta = await fetch(`https://api.open-meteo.com/v1/forecast?${parametros}`);
  if (!respuesta.ok) throw new Error(`Open-Meteo ${respuesta.status}`);
  const datos = await respuesta.json();
  PREVISIONES.set(clave, datos);
  return datos;
}

async function mostrarTiempoPrevisto(carrera) {
  const caja = document.getElementById("modal-tiempo");
  if (!caja) return;
  caja.classList.add("hidden");
  caja.innerHTML = "";

  const dias = calcularDiasRestantes(carrera.fecha);
  if (dias === null || dias < 0 || dias > DIAS_PREVISION || !carrera.ubicacion) return;

  let datos;
  try {
    datos = await obtenerPrevision(carrera);
  } catch (e) {
    return; // Sin conexión o servicio caído: simplemente no se muestra
  }
  // Mientras llegaba la previsión se pudo abrir otra carrera
  if (!AppState.carreraAbierta || AppState.carreraAbierta.id !== carrera.id) return;

  const d = datos.daily;
  if (!d || !d.time || !d.time.length || d.temperature_2m_max[0] == null) return;
  const [icono, texto] = estadoCielo(d.weather_code[0]);

  // A la hora de salida, si se conoce
  let salida = "";
  if (carrera.hora && datos.hourly) {
    const i = datos.hourly.time.indexOf(`${carrera.fecha}T${carrera.hora.slice(0, 2)}:00`);
    if (i >= 0 && datos.hourly.temperature_2m[i] != null) {
      const [iconoH, textoH] = estadoCielo(datos.hourly.weather_code[i]);
      const lluviaH = datos.hourly.precipitation_probability[i];
      salida = `<p class="tiempo-salida">A la salida (${escapeHtml(carrera.hora)}): <strong>${Math.round(datos.hourly.temperature_2m[i])} °C</strong>
        ${iconoH} ${escapeHtml(textoH)}${lluviaH != null ? ` · lluvia ${lluviaH} %` : ""}</p>`;
    }
  }

  const lluvia = d.precipitation_probability_max[0];
  caja.innerHTML = `
    <h3 class="section-title">🌤️ Tiempo previsto</h3>
    <div class="tiempo-resumen">
      <span class="tiempo-icono">${icono}</span>
      <div>
        <p class="tiempo-texto">${escapeHtml(texto)}</p>
        <p class="tiempo-datos">${Math.round(d.temperature_2m_min[0])}° / ${Math.round(d.temperature_2m_max[0])}°
          ${lluvia != null ? ` · 💧 ${lluvia} %` : ""} · 💨 ${Math.round(d.wind_speed_10m_max[0])} km/h</p>
      </div>
    </div>
    ${salida}
    <p class="tiempo-nota">${dias > 7 ? "Previsión a más de una semana: puede cambiar bastante. " : ""}Datos: <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo.com</a></p>`;
  caja.classList.remove("hidden");
}

function configurarAccionesFicha() {
  document.getElementById("btn-ficha-favorita").addEventListener("click", () => {
    const c = AppState.carreraAbierta;
    if (!c) return;
    const ahora = alternarFavorita(c.id);
    actualizarAccionesFicha(c);
    mostrarToast(ahora ? "❤️ Añadida a tus favoritas" : "Quitada de tus favoritas");
    aplicarFiltrosYRenderizar();
  });
  document.getElementById("btn-ficha-calendario").addEventListener("click", () => {
    const c = AppState.carreraAbierta;
    if (!c) return;
    descargarICS(`${normalizarTexto(c.nombre).replace(/[^a-z0-9]+/g, "-").slice(0, 50)}.ics`, [c]);
    mostrarToast("📅 Abre el archivo para añadirla a tu calendario (con aviso 2 días antes)");
  });
  document.getElementById("btn-ficha-corrida").addEventListener("click", () => {
    const c = AppState.carreraAbierta;
    if (!c) return;
    if (marcaDe(c.id) && !confirm("Se borrará también el tiempo que apuntaste. ¿Seguir?")) return;
    const ahora = alternarCorrida(c);
    actualizarAccionesFicha(c);
    mostrarToast(ahora ? "✅ Guardada en «Ya corridas»" : "Quitada de «Ya corridas»");
    if (esVistaDeCorridas()) aplicarFiltrosYRenderizar();
    if (typeof mostrarValoraciones === "function") mostrarValoraciones(c);
  });
  document.getElementById("btn-ficha-compartir").addEventListener("click", () => {
    const c = AppState.carreraAbierta;
    if (c) compartirCarrera(c);
  });
}
