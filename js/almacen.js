/**
 * RunNear - Datos guardados en el dispositivo: favoritas, carreras corridas y ajustes
 * (con cuenta, cuenta.js los copia también a la base de datos).
 */

// ==========================================================================
// Almacenamiento en el dispositivo (favoritas, corridas, ajustes)
// ==========================================================================

const ALMACEN = {
  leer(clave, porDefecto) {
    try {
      const valor = localStorage.getItem("runnear_" + clave);
      return valor ? JSON.parse(valor) : porDefecto;
    } catch (e) {
      return porDefecto;
    }
  },
  guardar(clave, valor) {
    try {
      localStorage.setItem("runnear_" + clave, JSON.stringify(valor));
    } catch (e) {
      // Navegación privada o almacenamiento lleno: se sigue funcionando sin guardar
    }
    // Con sesión iniciada, el cambio se copia también a la cuenta (cuenta.js)
    if (typeof alCambiarDatoLocal === "function") alCambiarDatoLocal(clave);
  }
};

function idsFavoritas() {
  return new Set(ALMACEN.leer("favoritas", []));
}

function esFavorita(id) {
  return idsFavoritas().has(id);
}

/** Marca o desmarca una favorita. Devuelve el nuevo estado. */
function alternarFavorita(id) {
  const favs = idsFavoritas();
  const ahora = !favs.has(id);
  if (ahora) favs.add(id); else favs.delete(id);
  ALMACEN.guardar("favoritas", [...favs]);
  actualizarContadoresMenu();
  return ahora;
}

function listaCorridas() {
  return ALMACEN.leer("corridas", []);
}

function esCorrida(id) {
  return listaCorridas().some(c => c.id === id);
}

/**
 * Marca o desmarca una carrera como corrida. Se guarda una copia de sus datos porque,
 * una vez celebrada, la carrera desaparece del calendario.
 */
function alternarCorrida(carrera) {
  let lista = listaCorridas();
  const ahora = !lista.some(c => c.id === carrera.id);
  if (ahora) {
    const { id, nombre, fecha, municipio, provincia, tipo, ubicacion, distancia_km, distancias_km, url_oficial, circuito } = carrera;
    lista.push({ id, nombre, fecha, municipio, provincia, tipo, ubicacion, distancia_km, distancias_km, url_oficial, circuito, guardada: hoyISO() });
  } else {
    lista = lista.filter(c => c.id !== carrera.id);
  }
  ALMACEN.guardar("corridas", lista);
  actualizarContadoresMenu();
  return ahora;
}

function marcaDe(id) {
  const g = listaCorridas().find(c => c.id === id);
  return g ? g.marca || null : null;
}

/** Guarda (o borra, con marca = null) el tiempo hecho en una carrera corrida */
function guardarMarca(id, marca) {
  const lista = listaCorridas();
  const g = lista.find(c => c.id === id);
  if (!g) return;
  if (marca) g.marca = marca; else delete g.marca;
  ALMACEN.guardar("corridas", lista);
}
