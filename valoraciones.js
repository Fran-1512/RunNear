/**
 * RunNear - Valoraciones de carreras
 *
 * - Cualquiera puede leer las opiniones. Para opinar hay que tener cuenta y haber
 *   marcado la carrera como corrida (lo comprueban las reglas de la base de datos).
 * - Las opiniones se agrupan por "evento" (nombre sin año ni edición + municipio), así
 *   las de la edición pasada aparecen en la de este año.
 * - La lectura usa la API pública de Supabase con fetch, sin cargar la librería, para
 *   que las estrellas de las tarjetas no hagan más lenta la web.
 */

const RESUMENES = new Map(); // evento -> { media, opiniones, recorrido, organizacion, avituallamiento }
const COLUMNAS_PUBLICAS = "carrera_id,fecha,nota,recorrido,organizacion,avituallamiento,comentario,autor,creada";
const ASPECTOS = [
  ["recorrido", "Recorrido"],
  ["organizacion", "Organización"],
  ["avituallamiento", "Avituallamiento"]
];

/** "XXI Carrera Popular de Tomelloso 2026" + "Tomelloso" -> "carrera popular de tomelloso|tomelloso" */
function claveEvento(c) {
  const nombre = normalizarTexto(c.nombre || "")
    .replace(/\b(19|20)\d{2}\b/g, " ")                                         // años
    .replace(/\b(?=[ivxlcdm]+\b)m{0,4}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})\b/g, " ") // XXI, IV...
    .replace(/\b\d+\s*(a|o|ª|º|\.ª|\.º)(?=\s|$)/g, " ")                        // 5ª, 10º
    .replace(/\b(edicion|ed)\b/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${nombre}|${normalizarTexto(c.municipio || "")}`.slice(0, 200);
}

async function consultaPublica(ruta) {
  const respuesta = await fetch(`${SUPABASE.url}/rest/v1/${ruta}`, {
    headers: { apikey: SUPABASE.clave, Authorization: `Bearer ${SUPABASE.clave}` }
  });
  if (!respuesta.ok) throw new Error(`Valoraciones: ${respuesta.status}`);
  return respuesta.json();
}

/** Nota media de todas las carreras valoradas (una sola consulta, pocos datos) */
async function cargarResumenes() {
  try {
    const filas = await consultaPublica("valoraciones_resumen?select=*");
    RESUMENES.clear();
    filas.forEach(f => RESUMENES.set(f.evento, f));
    if (typeof aplicarFiltrosYRenderizar === "function" && AppState.races.length) aplicarFiltrosYRenderizar();
  } catch (e) {
    // Sin conexión o tabla aún sin crear: la web funciona igual, sin estrellas
  }
}

function formatearNota(n) {
  return Number(n).toLocaleString("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function htmlEstrellas(nota) {
  const llenas = Math.round(Number(nota) || 0);
  return `<span class="estrellas" aria-label="${formatearNota(nota)} de 5">${"★".repeat(llenas)}<span class="estrellas-vacias">${"★".repeat(5 - llenas)}</span></span>`;
}

/** Insignia para las tarjetas: "⭐ 4,6 (23)" */
function insigniaValoracion(c) {
  const r = RESUMENES.get(claveEvento(c));
  if (!r) return "";
  return `<span class="card-valoracion" title="${r.opiniones} ${r.opiniones == 1 ? "opinión" : "opiniones"}">⭐ ${formatearNota(r.media)} <small>(${r.opiniones})</small></span>`;
}

// ==========================================================================
// Sección "Opiniones" de la ficha
// ==========================================================================

let opinionEditando = false;
let ultimaFichaValorada = null;

async function mostrarValoraciones(carrera) {
  const caja = document.getElementById("modal-valoraciones");
  if (!caja || !carrera) return;
  if (ultimaFichaValorada !== carrera.id) {
    opinionEditando = false;
    ultimaFichaValorada = carrera.id;
  }
  const evento = claveEvento(carrera);
  const resumen = RESUMENES.get(evento);
  const celebrada = estaCelebrada(carrera);
  const corrida = typeof esCorrida === "function" && esCorrida(carrera.id);

  // En carreras futuras sin opiniones de otros años no hay nada que mostrar
  if (!resumen && !celebrada) {
    caja.classList.add("hidden");
    caja.innerHTML = "";
    return;
  }
  caja.classList.remove("hidden");
  caja.innerHTML = `
    <h3 class="section-title">⭐ Opiniones</h3>
    ${resumen ? htmlResumen(resumen) : `<p class="valoraciones-nota">Aún no hay opiniones de esta carrera.</p>`}
    <div id="valoracion-propia"></div>
    <div class="valoraciones-lista" id="valoraciones-lista"><p class="valoraciones-nota">Cargando opiniones…</p></div>`;

  let opiniones = [];
  try {
    opiniones = await leerOpiniones(evento);
  } catch (e) {
    opiniones = null;
  }
  if (!AppState.carreraAbierta || AppState.carreraAbierta.id !== carrera.id) return; // se abrió otra
  const uid = typeof Cuenta !== "undefined" && Cuenta.usuario ? Cuenta.usuario.id : null;
  const propia = opiniones && uid ? opiniones.find(o => o.user_id === uid && o.carrera_id === carrera.id) : null;

  pintarZonaPropia(caja.querySelector("#valoracion-propia"), carrera, { celebrada, corrida, propia });
  pintarListaOpiniones(caja.querySelector("#valoraciones-lista"), opiniones, carrera, propia);
}

function htmlResumen(r) {
  const aspectos = ASPECTOS.filter(([clave]) => r[clave] != null);
  return `
    <div class="valoraciones-resumen">
      <div class="valoraciones-media">
        <strong>${formatearNota(r.media)}</strong>
        ${htmlEstrellas(r.media)}
        <span>${r.opiniones} ${r.opiniones == 1 ? "opinión" : "opiniones"}</span>
      </div>
      ${aspectos.length ? `<div class="valoraciones-aspectos">
        ${aspectos.map(([clave, texto]) => `
          <div class="valoraciones-aspecto">
            <span>${texto}</span>
            <span class="perfil-barra"><span style="width:${Math.round(r[clave] / 5 * 100)}%"></span></span>
            <span>${formatearNota(r[clave])}</span>
          </div>`).join("")}
      </div>` : ""}
    </div>`;
}

/** Con sesión se incluye quién escribió cada opinión (para editar la tuya y denunciar) */
async function leerOpiniones(evento) {
  if (typeof Cuenta !== "undefined" && Cuenta.usuario) {
    const cliente = await obtenerSupabase();
    const { data, error } = await cliente.from("valoraciones")
      .select(`user_id,${COLUMNAS_PUBLICAS}`)
      .eq("evento", evento).order("creada", { ascending: false }).limit(30);
    if (error) throw new Error(error.message);
    return data;
  }
  return consultaPublica(`valoraciones?select=${COLUMNAS_PUBLICAS}&evento=eq.${encodeURIComponent(evento)}&order=creada.desc&limit=30`);
}

function pintarZonaPropia(zona, carrera, { celebrada, corrida, propia }) {
  if (!zona) return;
  const usuario = typeof Cuenta !== "undefined" ? Cuenta.usuario : null;
  if (!celebrada) {
    zona.innerHTML = "";
  } else if (!corrida) {
    zona.innerHTML = `<p class="valoraciones-nota">¿La corriste? Pulsa <strong>«La he corrido»</strong> y podrás valorarla.</p>`;
  } else if (!usuario) {
    zona.innerHTML = `<p class="valoraciones-nota">Entra en tu cuenta para publicar tu opinión. <button class="cuenta-enlace" id="valorar-entrar">Entrar</button></p>`;
    zona.querySelector("#valorar-entrar").addEventListener("click", () => abrirCuenta());
  } else if (propia && !opinionEditando) {
    zona.innerHTML = `
      <div class="valoracion-tuya">
        <span>Tu opinión: ${htmlEstrellas(propia.nota)}</span>
        <button class="cuenta-enlace" id="valoracion-editar">Editar</button>
        <button class="cuenta-enlace peligro" id="valoracion-borrar">Borrar</button>
      </div>`;
    zona.querySelector("#valoracion-editar").addEventListener("click", () => {
      opinionEditando = true;
      pintarZonaPropia(zona, carrera, { celebrada, corrida, propia });
    });
    zona.querySelector("#valoracion-borrar").addEventListener("click", () => borrarOpinion(carrera));
  } else {
    pintarFormulario(zona, carrera, propia);
  }
}

function pintarFormulario(zona, carrera, propia) {
  const valores = {
    nota: propia ? propia.nota : 0,
    recorrido: propia ? propia.recorrido : null,
    organizacion: propia ? propia.organizacion : null,
    avituallamiento: propia ? propia.avituallamiento : null
  };
  const autor = nombreAutor();
  const filaEstrellas = (campo, texto, grande) => `
    <div class="valorar-fila ${grande ? "principal" : ""}">
      <span class="valorar-etiqueta">${texto}</span>
      <span class="valorar-estrellas" data-campo="${campo}" role="radiogroup" aria-label="${texto}">
        ${[1, 2, 3, 4, 5].map(n => `<button type="button" class="valorar-estrella" data-n="${n}" aria-label="${n} de 5">★</button>`).join("")}
      </span>
    </div>`;

  zona.innerHTML = `
    <form class="valorar-form" id="valorar-form">
      <p class="valorar-titulo">${propia ? "Edita tu opinión" : "Valora esta carrera"}</p>
      ${filaEstrellas("nota", "General", true)}
      <p class="valoraciones-nota">Si quieres, puntúa también (opcional):</p>
      ${ASPECTOS.map(([campo, texto]) => filaEstrellas(campo, texto, false)).join("")}
      <textarea class="cuenta-input valorar-comentario" id="valorar-comentario" maxlength="500" rows="3"
        placeholder="Cuenta qué te pareció (opcional): recorrido, ambiente, bolsa del corredor…">${propia && propia.comentario ? escapeHtml(propia.comentario) : ""}</textarea>
      <p class="valoraciones-nota">Se publicará con el nombre «${escapeHtml(autor)}». Sin enlaces ni datos personales.</p>
      <div class="cuenta-botones">
        <button class="btn-primary" type="submit">Publicar</button>
        ${propia ? `<button class="btn-secondary" type="button" id="valorar-cancelar">Cancelar</button>` : ""}
      </div>
    </form>`;

  const pintarSeleccion = () => zona.querySelectorAll(".valorar-estrellas").forEach(grupo => {
    const v = valores[grupo.dataset.campo] || 0;
    grupo.querySelectorAll(".valorar-estrella").forEach(b => {
      const activa = Number(b.dataset.n) <= v;
      b.classList.toggle("activa", activa);
      b.setAttribute("aria-pressed", String(Number(b.dataset.n) === v));
    });
  });
  zona.querySelectorAll(".valorar-estrellas").forEach(grupo => grupo.addEventListener("click", e => {
    const b = e.target.closest(".valorar-estrella");
    if (!b) return;
    const campo = grupo.dataset.campo;
    const n = Number(b.dataset.n);
    // En los opcionales, pulsar otra vez la misma estrella la quita
    valores[campo] = campo !== "nota" && valores[campo] === n ? null : n;
    pintarSeleccion();
  }));
  pintarSeleccion();

  const cancelar = zona.querySelector("#valorar-cancelar");
  if (cancelar) cancelar.addEventListener("click", () => {
    opinionEditando = false;
    mostrarValoraciones(carrera);
  });
  zona.querySelector("#valorar-form").addEventListener("submit", async e => {
    e.preventDefault();
    if (!valores.nota) {
      mostrarToast("Elige de 1 a 5 estrellas en «General»");
      return;
    }
    const comentario = zona.querySelector("#valorar-comentario").value.trim();
    if (/(https?:\/\/|www\.)/i.test(comentario)) {
      mostrarToast("El comentario no puede llevar enlaces");
      return;
    }
    const boton = e.submitter || zona.querySelector("button[type=submit]");
    boton.disabled = true;
    try {
      await publicarOpinion(carrera, { ...valores, comentario: comentario || null });
      opinionEditando = false;
      mostrarToast("⭐ ¡Gracias por tu opinión!");
      await cargarResumenes();
      mostrarValoraciones(carrera);
    } catch (err) {
      mostrarToast(err.message, 6000);
      boton.disabled = false;
    }
  });
}

function nombreAutor() {
  const u = typeof Cuenta !== "undefined" ? Cuenta.usuario : null;
  return ((u && u.nombrePublico) || "Corredor/a").slice(0, 40);
}

async function publicarOpinion(carrera, valores) {
  // La base de datos exige que la carrera esté en tus corridas de la cuenta
  if (typeof subirPendientes === "function") await subirPendientes();
  const cliente = await obtenerSupabase();
  const { error } = await cliente.from("valoraciones").upsert({
    user_id: Cuenta.usuario.id,
    carrera_id: carrera.id,
    evento: claveEvento(carrera),
    fecha: carrera.fecha,
    nota: valores.nota,
    recorrido: valores.recorrido,
    organizacion: valores.organizacion,
    avituallamiento: valores.avituallamiento,
    comentario: valores.comentario,
    autor: nombreAutor(),
    actualizada: new Date().toISOString()
  }, { onConflict: "user_id,carrera_id" });
  if (error) {
    if (/row-level security|policy/i.test(error.message)) throw new Error("Para opinar, marca antes la carrera como corrida («La he corrido»).");
    if (/check constraint|violates/i.test(error.message)) throw new Error("Revisa tu opinión: el comentario no puede pasar de 500 letras ni llevar enlaces.");
    throw new Error(`No se ha podido publicar: ${error.message}`);
  }
}

async function borrarOpinion(carrera) {
  if (!confirm("¿Borrar tu opinión de esta carrera?")) return;
  const cliente = await obtenerSupabase();
  const { error } = await cliente.from("valoraciones").delete()
    .eq("user_id", Cuenta.usuario.id).eq("carrera_id", carrera.id);
  if (error) {
    mostrarToast(`No se ha podido borrar: ${error.message}`, 6000);
    return;
  }
  mostrarToast("Opinión borrada");
  await cargarResumenes();
  mostrarValoraciones(carrera);
}

function pintarListaOpiniones(lista, opiniones, carrera, propia) {
  if (!lista) return;
  if (opiniones === null) {
    lista.innerHTML = `<p class="valoraciones-nota">No se han podido cargar las opiniones.</p>`;
    return;
  }
  const conTexto = opiniones.filter(o => o.comentario || o === propia);
  if (!conTexto.length) {
    lista.innerHTML = "";
    return;
  }
  const uid = typeof Cuenta !== "undefined" && Cuenta.usuario ? Cuenta.usuario.id : null;
  const ano = c => (c.fecha || "").slice(0, 4);
  lista.innerHTML = conTexto.map((o, i) => `
    <div class="opinion">
      <div class="opinion-cabecera">
        <strong>${escapeHtml(o.autor)}${o === propia ? " (tú)" : ""}</strong>
        ${htmlEstrellas(o.nota)}
        <span class="opinion-fecha">edición ${escapeHtml(ano(o))}</span>
      </div>
      ${o.comentario ? `<p class="opinion-texto">${escapeHtml(o.comentario)}</p>` : ""}
      ${uid && o.user_id && o.user_id !== uid && o.comentario ? `<button class="opinion-denunciar" data-i="${i}">Denunciar</button>` : ""}
    </div>`).join("");
  lista.querySelectorAll(".opinion-denunciar").forEach(b => b.addEventListener("click", () => denunciarOpinion(conTexto[Number(b.dataset.i)], b)));
}

async function denunciarOpinion(opinion, boton) {
  if (!confirm("¿Denunciar este comentario por ofensivo, falso o spam? Lo revisaremos y, si incumple las normas, lo borraremos.")) return;
  boton.disabled = true;
  const cliente = await obtenerSupabase();
  const { error } = await cliente.from("denuncias").insert({
    denunciante: Cuenta.usuario.id,
    autor_id: opinion.user_id,
    carrera_id: opinion.carrera_id,
    comentario: opinion.comentario
  });
  if (error && !/duplicate|unique/i.test(error.message)) {
    mostrarToast(`No se ha podido enviar la denuncia: ${error.message}`, 6000);
    boton.disabled = false;
    return;
  }
  boton.textContent = "Denunciado";
  mostrarToast("Gracias. Revisaremos ese comentario.");
}

document.addEventListener("DOMContentLoaded", () => {
  cargarResumenes();
});
