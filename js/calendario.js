/**
 * RunNear - Calendario mensual de carreras y exportar al calendario del móvil (.ics).
 */

// ==========================================================================
// Calendario mensual
// ==========================================================================

function renderizarCalendario() {
  const panel = document.getElementById("calendario-panel");
  if (!panel) return;
  if (AppState.vista !== "calendario") {
    panel.classList.add("hidden");
    return;
  }
  panel.classList.remove("hidden");

  const [y, m] = AppState.calendarioMes.split("-").map(Number);
  const primero = new Date(y, m - 1, 1);
  const diasMes = new Date(y, m, 0).getDate();
  const hueco = (primero.getDay() + 6) % 7; // lunes = 0
  const hoy = hoyISO();

  // Carreras por día (todas las futuras, sin tener en cuenta el radio)
  const porDia = {};
  AppState.races.forEach(c => {
    if (c.fecha && c.fecha >= hoy) porDia[c.fecha] = (porDia[c.fecha] || 0) + 1;
  });

  const nombreMes = primero.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
  let celdas = "";
  for (let i = 0; i < hueco; i++) celdas += `<span class="cal-dia vacio"></span>`;
  for (let d = 1; d <= diasMes; d++) {
    const iso = `${AppState.calendarioMes}-${String(d).padStart(2, "0")}`;
    const n = porDia[iso] || 0;
    const clases = ["cal-dia", n ? "con-carreras" : "", iso === hoy ? "hoy" : "", iso === AppState.calendarioDia ? "elegido" : "", iso < hoy ? "pasado" : ""].join(" ");
    celdas += `<button class="${clases}" data-dia="${iso}" ${n ? "" : "disabled"} aria-label="${d}${n ? `, ${n} carreras` : ""}">
      ${d}${n ? `<span class="cal-punto">${n}</span>` : ""}</button>`;
  }

  panel.innerHTML = `
    <div class="cal-cabecera">
      <button class="cal-nav" data-mes="-1" aria-label="Mes anterior">‹</button>
      <span class="cal-mes">${nombreMes}</span>
      <button class="cal-nav" data-mes="1" aria-label="Mes siguiente">›</button>
    </div>
    <div class="cal-semana"><span>L</span><span>M</span><span>X</span><span>J</span><span>V</span><span>S</span><span>D</span></div>
    <div class="cal-rejilla">${celdas}</div>
    ${AppState.calendarioDia ? `<button class="cal-todo-mes">Ver todo el mes</button>` : ""}
  `;

  panel.querySelectorAll(".cal-nav").forEach(b => b.addEventListener("click", () => {
    const fecha = new Date(y, m - 1 + Number(b.dataset.mes), 1);
    AppState.calendarioMes = aISO(fecha).slice(0, 7);
    AppState.calendarioDia = null;
    aplicarFiltrosYRenderizar();
  }));
  panel.querySelectorAll(".cal-dia[data-dia]").forEach(b => b.addEventListener("click", () => {
    AppState.calendarioDia = AppState.calendarioDia === b.dataset.dia ? null : b.dataset.dia;
    aplicarFiltrosYRenderizar();
  }));
  const todoMes = panel.querySelector(".cal-todo-mes");
  if (todoMes) todoMes.addEventListener("click", () => {
    AppState.calendarioDia = null;
    aplicarFiltrosYRenderizar();
  });
}

// ==========================================================================
// Exportar al calendario del móvil (.ics)
// ==========================================================================

function escaparICS(texto) {
  return String(texto ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function generarICS(carreras) {
  const ahora = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lineas = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//RunNear//Carreras//ES", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  carreras.forEach(c => {
    const dia = c.fecha.replace(/-/g, "");
    // Con hora de salida: evento a esa hora (hora local, 2 h de duración orientativa).
    // Sin hora: evento de todo el día
    const hora = /^\d{2}:\d{2}$/.test(c.hora || "") ? c.hora : null;
    let fechas;
    if (hora) {
      const [h, m] = hora.split(":").map(Number);
      const finH = Math.min(h + 2, 23);
      fechas = [`DTSTART:${dia}T${String(h).padStart(2, "0")}${String(m).padStart(2, "0")}00`,
                `DTEND:${dia}T${String(finH).padStart(2, "0")}${String(finH === 23 ? 59 : m).padStart(2, "0")}00`];
    } else {
      fechas = [`DTSTART;VALUE=DATE:${dia}`, `DTEND;VALUE=DATE:${sumarDias(c.fecha, 1).replace(/-/g, "")}`];
    }
    const descripcion = `${hora ? "Salida: " + hora + " · " : ""}${textoDistancias(c)}${c.circuito ? " · " + c.circuito : ""}\nInscripción: ${c.url_oficial || ""}`;
    lineas.push(
      "BEGIN:VEVENT",
      `UID:${c.id}@runnear`,
      `DTSTAMP:${ahora}`,
      ...fechas,
      `SUMMARY:${escaparICS("🏃 " + c.nombre)}`,
      `LOCATION:${escaparICS([c.municipio, c.provincia].filter(Boolean).join(", "))}`,
      `DESCRIPTION:${escaparICS(descripcion)}`,
      c.url_oficial ? `URL:${c.url_oficial}` : "",
      "BEGIN:VALARM", "TRIGGER:-P2D", "ACTION:DISPLAY", `DESCRIPTION:${escaparICS("Dentro de 2 días: " + c.nombre)}`, "END:VALARM",
      "END:VEVENT"
    );
  });
  lineas.push("END:VCALENDAR");
  return lineas.filter(Boolean).join("\r\n");
}

function descargarICS(nombreArchivo, carreras) {
  const blob = new Blob([generarICS(carreras)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function exportarFavoritasICS() {
  const favs = idsFavoritas();
  const lista = AppState.races.filter(c => favs.has(c.id) && c.fecha >= hoyISO());
  if (!lista.length) {
    mostrarToast("No tienes favoritas próximas. Pulsa ♡ en una carrera para añadirla.");
    return;
  }
  descargarICS("runnear-favoritas.ics", lista);
  mostrarToast(`📲 ${lista.length} carreras listas para añadir a tu calendario`);
}
