/**
 * RunNear - Ventanas informativas: Acerca de, Publicar y Ajustes.
 */

// ==========================================================================
// Ventanas informativas: Acerca de, Publicar, Ajustes
// ==========================================================================

function abrirInfo(titulo, html) {
  document.getElementById("info-titulo").textContent = titulo;
  document.getElementById("info-cuerpo").innerHTML = html;
  document.getElementById("info-modal").classList.remove("hidden");
}

function cerrarInfo() {
  document.getElementById("info-modal").classList.add("hidden");
}

function mostrarAcercaDe() {
  abrirInfo("Acerca de RunNear", `
    <div class="info-texto">
      <p><strong>RunNear</strong> reúne las carreras populares y de trail de toda España en un mapa, para que encuentres las que tienes cerca.</p>
      <h3>¿De dónde salen los datos?</h3>
      <ul>
        <li>El calendario se actualiza cada día uniendo varias fuentes y quitando las carreras repetidas:
          <ul>
            <li><strong>Toda España:</strong> Running.life, carreraspopulares.com y Runnea.</li>
            <li><strong>Castilla-La Mancha:</strong> Carreras CLM, Deportes Dipualba (Diputación de Albacete), Circuito de Carreras
              de Ciudad Real y el calendario de montaña de la FDMCM (vía Carreras de Montaña por Mayayo).</li>
          </ul></li>
        <li>Precios, horarios, desniveles e inscritos se leen de la web de inscripción de cada carrera. Algunos desniveles de trail salen de las noticias de la FDMCM.</li>
        <li>Cada ficha indica de qué web sale la carrera y enlaza a su web oficial.</li>
        <li>El tiempo previsto (cuando faltan 15 días o menos) es de Open-Meteo.com: solo se le envía la ubicación de la carrera, nunca la tuya.</li>
        <li>Confirma siempre fecha y detalles en la web oficial antes de inscribirte.</li>
      </ul>
      <h3>Mapa</h3>
      <p>Calles, pueblos y caminos: © colaboradores de OpenStreetMap (licencia ODbL). Mapa general: Natural Earth (dominio público).</p>
      <h3>Privacidad</h3>
      <p>Tu ubicación solo se usa en tu dispositivo para calcular distancias: no se envía ni se guarda en ningún servidor. Tus favoritas, carreras corridas y ajustes se guardan únicamente en este dispositivo.</p>
      <p><a href="legal.html">Política de privacidad y aviso legal</a></p>
    </div>
  `);
}

function mostrarAjustes() {
  const apariencia = aparienciaGuardada();
  const radio = radioPorDefecto();
  const opcionesRadio = [15, 25, 50, 100, 150, 250]
    .map(r => `<option value="${r}" ${r === radio ? "selected" : ""}>${r} km</option>`).join("");
  abrirInfo("Ajustes", `
    <div class="ajustes">
      <div class="ajuste">
        <span class="ajuste-nombre">Apariencia</span>
        <div class="segmented-control ajuste-tema">
          <button class="segment-btn ${apariencia === "auto" ? "active" : ""}" data-tema="auto" title="Según el modo claro u oscuro de tu dispositivo">📱 Automático</button>
          <button class="segment-btn ${apariencia === "oscuro" ? "active" : ""}" data-tema="oscuro">🌙 Oscuro</button>
          <button class="segment-btn ${apariencia === "claro" ? "active" : ""}" data-tema="claro">☀️ Claro</button>
        </div>
      </div>
      <div class="ajuste">
        <label class="ajuste-nombre" for="ajuste-radio">Radio de búsqueda por defecto</label>
        <select id="ajuste-radio" class="sort-select ajuste-select">${opcionesRadio}</select>
      </div>
      <div class="ajuste">
        <span class="ajuste-nombre">Mis datos</span>
        ${typeof Cuenta !== "undefined" && Cuenta.usuario
          ? `<p class="ajuste-ayuda">${idsFavoritas().size} favoritas y ${listaCorridas().length} carreras corridas guardadas en tu cuenta (${escapeHtml(Cuenta.usuario.email)}).</p>
             <button class="btn-secondary" id="ajuste-cuenta">Gestionar mi cuenta</button>`
          : `<p class="ajuste-ayuda">${idsFavoritas().size} favoritas y ${listaCorridas().length} carreras corridas guardadas en este dispositivo.</p>
             <button class="btn-secondary" id="ajuste-borrar">Borrar todos mis datos</button>`}
        <p class="ajuste-ayuda"><a href="legal.html#privacidad">Cómo tratamos tus datos</a></p>
      </div>
    </div>
  `);

  document.querySelectorAll(".ajuste-tema .segment-btn").forEach(b => b.addEventListener("click", () => {
    aplicarTema(b.dataset.tema);
    document.querySelectorAll(".ajuste-tema .segment-btn").forEach(x => x.classList.toggle("active", x === b));
  }));
  document.getElementById("ajuste-radio").addEventListener("change", e => {
    const r = Number(e.target.value);
    ALMACEN.guardar("radio", r);
    ponerRadio(r);
    aplicarFiltrosYRenderizar();
    mostrarToast(`Radio por defecto: ${r} km`);
  });
  const gestionarCuenta = document.getElementById("ajuste-cuenta");
  if (gestionarCuenta) gestionarCuenta.addEventListener("click", () => {
    cerrarInfo();
    abrirCuenta();
  });
  const borrarDatos = document.getElementById("ajuste-borrar");
  if (borrarDatos) borrarDatos.addEventListener("click", () => {
    if (!confirm("¿Borrar de este dispositivo tus favoritas, carreras corridas, tiempos y ajustes?")) return;
    try {
      Object.keys(localStorage).filter(k => k.startsWith("runnear_")).forEach(k => localStorage.removeItem(k));
    } catch (e) {
      // Sin acceso al almacenamiento: no hay nada guardado que borrar
    }
    aplicarTema("auto", false);
    actualizarContadoresMenu();
    aplicarFiltrosYRenderizar();
    mostrarAjustes();
    mostrarToast("Datos borrados");
  });
}
