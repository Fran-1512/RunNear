/**
 * RunNear - Mapa detallado propio
 *
 * Dibuja en canvas las teselas vectoriales generadas por mapa/generar_teselas.py
 * (datos de OpenStreetMap, © OpenStreetMap contributors, ODbL). Todo se sirve
 * desde el propio proyecto: no se usa ningún servidor de mapas externo.
 *
 * Formato de cada tesela JSON: { n: [nombres], f: [features] }
 *   línea:    [clase, zoomMin, idxNombre, idxRef, flags(1=túnel,2=puente), coords]
 *   punto:    [clase, máscaraZooms, idxNombre, u, v]
 *   polígono: [clase, zoomMin, [anillo, ...]]
 * Las coordenadas son enteros locales a la tesela, codificados como deltas.
 */
const MapaDetalle = (() => {
  const BASE = "mapa/teselas/";
  const MAX_CACHE = 800;
  const cache = new Map();
  let meta = null;

  // -------------------------------------------------------------------------
  // Estilos
  // -------------------------------------------------------------------------

  // Interpolación lineal de una tabla [[zoom, valor], ...]
  function porZoom(tabla, z) {
    if (z <= tabla[0][0]) return tabla[0][1];
    for (let i = 1; i < tabla.length; i++) {
      const [z1, v1] = tabla[i];
      if (z <= z1) {
        const [z0, v0] = tabla[i - 1];
        return v0 + (v1 - v0) * (z - z0) / (z1 - z0);
      }
    }
    return tabla[tabla.length - 1][1];
  }

  const RELLENOS = {
    agua: "#aad3df", humedal: "#c9e3d8", bosque: "#c5ddb0", matorral: "#dbe7c2",
    urbano: "#e8e0d2", industrial: "#e4d6d9", parque: "#cdeac0", cementerio: "#c7d6bf",
    vinedo: "#e9dcec", frutal: "#e1ebc7", cantera: "#ddd5cc"
  };

  // relleno, borde (casing), anchos por zoom, zoom desde el que lleva borde, discontinuidad
  const LINEAS = {
    limite_provincial: { color: "#8c7a5b", ancho: [[8, 1.2], [14, 2.2]], guiones: [8, 4] },
    limite_municipal:  { color: "#b09a92", ancho: [[11, 0.6], [16, 1.4]], guiones: [4, 3] },
    acequia:     { color: "#9ccbe6", ancho: [[14, 0.6], [18, 1.5]] },
    arroyo:      { color: "#9ccbe6", ancho: [[13, 0.6], [16, 1.6], [18, 2.5]] },
    canal:       { color: "#8cc2e0", ancho: [[11, 0.8], [14, 2], [18, 5]] },
    rio:         { color: "#8cc2e0", ancho: [[9, 1], [12, 2.2], [14, 3.5], [18, 8]] },
    ferrocarril: { color: "#8f8f8f", ancho: [[9, 0.8], [13, 1.8], [18, 3]] },
    escaleras:   { color: "#d0654a", ancho: [[15, 2], [18, 4]], guiones: [1, 1.5] },
    sendero:     { color: "#d0654a", ancho: [[14, 0.8], [16, 1.3], [18, 2]], guiones: [3, 2] },
    pista:       { color: "#9b7b4f", ancho: [[13, 0.8], [16, 1.5], [18, 2.6]], guiones: [5, 2] },
    servicio:    { color: "#ffffff", borde: "#cdc5b6", ancho: [[14, 1], [16, 3], [18, 6]], bordeDesde: 15 },
    peatonal:    { color: "#eeeae2", borde: "#c5bdb0", ancho: [[14, 2], [16, 5], [18, 10]], bordeDesde: 14 },
    calle:       { color: "#ffffff", borde: "#c9c1b1", ancho: [[12, 0.5], [13, 1.2], [14, 2.8], [16, 6.5], [18, 13]], bordeDesde: 13 },
    sin_clasificar: { color: "#ffffff", borde: "#bdb5a6", ancho: [[11, 0.5], [13, 1.8], [14, 3.2], [16, 7], [18, 13]], bordeDesde: 12 },
    terciaria:   { color: "#ffffff", borde: "#b3aa98", ancho: [[10, 0.6], [12, 1.8], [14, 4.5], [16, 8], [18, 15]], bordeDesde: 11 },
    secundaria:  { color: "#fdf1a8", borde: "#b8ac66", ancho: [[9, 0.8], [12, 2.6], [14, 5.5], [16, 9], [18, 17]], bordeDesde: 10 },
    primaria:    { color: "#fcd68a", borde: "#b8984d", ancho: [[8, 1], [10, 1.8], [12, 3.2], [14, 6], [16, 10], [18, 19]], bordeDesde: 9 },
    enlace:      { color: "#f2a07e", borde: "#b3634a", ancho: [[11, 0.8], [14, 3], [16, 5], [18, 9]], bordeDesde: 12 },
    nacional:    { color: "#f6b98a", borde: "#b8764c", ancho: [[8, 1.3], [10, 2.2], [12, 3.6], [14, 6.5], [16, 11], [18, 20]], bordeDesde: 9 },
    autovia:     { color: "#ef9a7e", borde: "#b0573f", ancho: [[8, 1.6], [10, 2.6], [12, 4], [14, 7], [16, 12], [18, 22]], bordeDesde: 9 }
  };

  const FUENTE_ETIQUETA = {
    ciudad: { peso: 700, familia: "Outfit", color: "#2b2620" },
    villa:  { peso: 700, familia: "Outfit", color: "#2f2a24" },
    pueblo: { peso: 600, familia: "Plus Jakarta Sans", color: "#3a342c" },
    barrio: { peso: 500, familia: "Plus Jakarta Sans", color: "#5b5348", cursiva: true },
    aldea:  { peso: 500, familia: "Plus Jakarta Sans", color: "#4a443b" },
    paraje: { peso: 400, familia: "Plus Jakarta Sans", color: "#7a715f", cursiva: true },
    pico:   { peso: 600, familia: "Plus Jakarta Sans", color: "#6b4f2a" }
  };

  // Placas de carretera: colores de la señalización española
  const PLACAS = {
    autovia:    { fondo: "#2c5aa0", texto: "#ffffff", desde: 9 },
    nacional:   { fondo: "#c0392b", texto: "#ffffff", desde: 9 },
    primaria:   { fondo: "#e67e22", texto: "#ffffff", desde: 10 },
    secundaria: { fondo: "#2e8b57", texto: "#ffffff", desde: 11 },
    terciaria:  { fondo: "#f4f1ea", texto: "#3a342c", borde: "#8c8270", desde: 13 }
  };
  const CALLES_CON_NOMBRE = new Set(["calle", "sin_clasificar", "terciaria", "secundaria", "primaria", "peatonal", "servicio"]);

  // -------------------------------------------------------------------------
  // Carga de teselas
  // -------------------------------------------------------------------------

  function cargar(url) {
    if (cache.has(url)) {
      const valor = cache.get(url);
      cache.delete(url);
      cache.set(url, valor); // LRU: marcar como reciente
      return valor;
    }
    const promesa = fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null);
    cache.set(url, promesa);
    if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
    return promesa;
  }

  function nivelPara(niveles, z) {
    let elegido = null;
    for (const nivel of niveles) if (nivel[0] <= z) elegido = nivel;
    return elegido;
  }

  function datosPara(capa, niveles, coords) {
    const nivel = nivelPara(niveles, coords.z);
    if (!nivel) return Promise.resolve(null);
    const [n, , ext] = nivel;
    const k = coords.z - n;
    const dx = coords.x >> k, dy = coords.y >> k;
    const rango = meta.rangos[capa + n];
    if (!rango || dx < rango[0] || dy < rango[1] || dx > rango[2] || dy > rango[3]) return Promise.resolve(null);
    return cargar(`${BASE}${capa}/${n}/${dx}/${dy}.json`).then(d => d && {
      d,
      escala: 256 * 2 ** k / ext,          // píxeles por unidad de tesela
      ox: (coords.x - (dx << k)) * 256,    // desplazamiento del trozo visible dentro de la tesela de datos
      oy: (coords.y - (dy << k)) * 256
    });
  }

  // -------------------------------------------------------------------------
  // Dibujo
  // -------------------------------------------------------------------------

  function trazar(path, c, s, ox, oy, cerrar) {
    let u = c[0], v = c[1];
    path.moveTo(u * s - ox, v * s - oy);
    for (let i = 2; i < c.length; i += 2) {
      u += c[i];
      v += c[i + 1];
      path.lineTo(u * s - ox, v * s - oy);
    }
    if (cerrar) path.closePath();
  }

  function decodificar(c, s, ox, oy) {
    const pts = [];
    let u = c[0], v = c[1];
    pts.push(u * s - ox, v * s - oy);
    for (let i = 2; i < c.length; i += 2) {
      u += c[i];
      v += c[i + 1];
      pts.push(u * s - ox, v * s - oy);
    }
    return pts;
  }

  function dibujarPoligonos(ctx, t, z) {
    if (!t) return;
    const clases = meta.clases_p;
    const caminos = new Map();
    for (const f of t.d.f) {
      if (f[1] > z) continue;
      const nombre = clases[f[0]];
      if (!caminos.has(nombre)) caminos.set(nombre, new Path2D());
      const path = caminos.get(nombre);
      for (const anillo of f[2]) trazar(path, anillo, t.escala, t.ox, t.oy, true);
    }
    for (const nombre of clases) {
      const path = caminos.get(nombre);
      if (!path) continue;
      ctx.fillStyle = RELLENOS[nombre] || "#e0e0e0";
      // "nonzero": los shapefiles orientan exteriores y huecos en sentidos opuestos, así que los
      // huecos se respetan y los solapes entre polígonos distintos de la misma clase no se anulan
      ctx.fill(path, "nonzero");
    }
  }

  function dibujarLineas(ctx, t, z) {
    const clases = meta.clases_l;
    const normales = new Map(), tuneles = new Map();
    for (const f of t.d.f) {
      if (f.length !== 6 || f[1] > z) continue;
      const nombre = clases[f[0]];
      const destino = (f[4] & 1) ? tuneles : normales;
      if (!destino.has(nombre)) destino.set(nombre, new Path2D());
      trazar(destino.get(nombre), f[5], t.escala, t.ox, t.oy, false);
    }

    ctx.lineJoin = "round";
    // 1) Bordes (casing) de todas las vías, para que los cruces se vean limpios
    for (const nombre of clases) {
      const estilo = LINEAS[nombre];
      const path = normales.get(nombre);
      if (!path || !estilo.borde || z < estilo.bordeDesde) continue;
      ctx.setLineDash([]);
      ctx.lineCap = "round";
      ctx.strokeStyle = estilo.borde;
      ctx.lineWidth = porZoom(estilo.ancho, z) + 2;
      ctx.stroke(path);
    }
    // 2) Relleno de cada clase, de menor a mayor importancia
    for (const nombre of clases) {
      const estilo = LINEAS[nombre];
      const ancho = porZoom(estilo.ancho, z);
      for (const [mapa, esTunel] of [[tuneles, true], [normales, false]]) {
        const path = mapa.get(nombre);
        if (!path) continue;
        ctx.globalAlpha = esTunel ? 0.45 : 1;
        ctx.setLineDash(estilo.guiones || (esTunel ? [4, 3] : []));
        ctx.lineCap = estilo.guiones ? "butt" : "round";
        ctx.strokeStyle = estilo.color;
        ctx.lineWidth = ancho;
        ctx.stroke(path);
      }
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    // Ferrocarril: traviesas blancas encima a partir de zoom 12
    const tren = normales.get("ferrocarril");
    if (tren && z >= 12) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = porZoom(LINEAS.ferrocarril.ancho, z) * 0.5;
      ctx.setLineDash([6, 6]);
      ctx.stroke(tren);
      ctx.setLineDash([]);
    }
  }

  function choca(caja, ocupadas) {
    for (const o of ocupadas) {
      if (caja[0] < o[2] && caja[2] > o[0] && caja[1] < o[3] && caja[3] > o[1]) return true;
    }
    return false;
  }

  function dentroTesela(caja) {
    return caja[0] >= 1 && caja[1] >= 1 && caja[2] <= 255 && caja[3] <= 255;
  }

  // Secciones de la línea con todos sus puntos dentro de la tesela: [[x0, y0, x1, y1, ...], ...]
  function seccionesDentro(pts, margen = 2) {
    const secciones = [];
    let actual = [];
    for (let i = 0; i < pts.length; i += 2) {
      const x = pts[i], y = pts[i + 1];
      if (x >= margen && y >= margen && x <= 256 - margen && y <= 256 - margen) {
        actual.push(x, y);
      } else {
        if (actual.length >= 4) secciones.push(actual);
        actual = [];
      }
    }
    if (actual.length >= 4) secciones.push(actual);
    return secciones;
  }

  // Punto y ángulo a una distancia d a lo largo de la polilínea (con longitudes acumuladas)
  function puntoEnDistancia(pts, acum, d) {
    let i = 1;
    while (i < acum.length - 1 && acum[i] < d) i++;
    const tramo = acum[i] - acum[i - 1] || 1;
    const t = (d - acum[i - 1]) / tramo;
    const x0 = pts[2 * i - 2], y0 = pts[2 * i - 1], x1 = pts[2 * i], y1 = pts[2 * i + 1];
    return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, Math.atan2(y1 - y0, x1 - x0)];
  }

  /**
   * Nombre de calle siguiendo la forma de la calle, letra a letra.
   * Devuelve false si no cabe, está demasiado curvada o choca con otra etiqueta.
   */
  function etiquetaSobreCalle(ctx, nombre, pts, tam, ocupadas) {
    const anchos = [...nombre].map(ch => ctx.measureText(ch).width);
    const total = anchos.reduce((a, b) => a + b, 0);

    for (let seccion of seccionesDentro(pts)) {
      // Leer siempre de izquierda a derecha
      if (seccion[seccion.length - 2] < seccion[0]) {
        const inversa = [];
        for (let i = seccion.length - 2; i >= 0; i -= 2) inversa.push(seccion[i], seccion[i + 1]);
        seccion = inversa;
      }
      const acum = [0];
      for (let i = 2; i < seccion.length; i += 2) {
        acum.push(acum[acum.length - 1] + Math.hypot(seccion[i] - seccion[i - 2], seccion[i + 1] - seccion[i - 1]));
      }
      const largo = acum[acum.length - 1];
      if (largo < total + 16) continue;

      // Colocar cada letra centrada en la sección
      let d = (largo - total) / 2;
      const letras = [];
      let anguloPrevio = null, demasiadoCurva = false;
      for (let k = 0; k < anchos.length; k++) {
        const [x, y, angulo] = puntoEnDistancia(seccion, acum, d + anchos[k] / 2);
        if (anguloPrevio !== null) {
          let giro = Math.abs(angulo - anguloPrevio);
          if (giro > Math.PI) giro = 2 * Math.PI - giro;
          if (giro > 0.5) { demasiadoCurva = true; break; }
        }
        anguloPrevio = angulo;
        letras.push([x, y, angulo]);
        d += anchos[k];
      }
      if (demasiadoCurva) continue;

      const r = tam * 0.62;
      const cajas = letras.map(([x, y]) => [x - r, y - r, x + r, y + r]);
      if (cajas.some(c => choca(c, ocupadas))) continue;
      ocupadas.push(...cajas);

      const chars = [...nombre];
      for (const pasada of ["halo", "texto"]) {
        letras.forEach(([x, y, angulo], k) => {
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(angulo);
          if (pasada === "halo") {
            ctx.lineJoin = "round";
            ctx.lineWidth = 3;
            ctx.strokeStyle = "rgba(255,255,255,0.92)";
            ctx.strokeText(chars[k], 0, 0);
          } else {
            ctx.fillStyle = "#4a4337";
            ctx.fillText(chars[k], 0, 0);
          }
          ctx.restore();
        });
      }
      return true;
    }
    return false;
  }

  // Tramo recto más largo de una línea que cae entero dentro de la tesela
  function tramoMasLargo(pts) {
    let mejor = null, maxLong = 0;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const x0 = pts[i], y0 = pts[i + 1], x1 = pts[i + 2], y1 = pts[i + 3];
      if (Math.min(x0, x1) < 0 || Math.min(y0, y1) < 0 || Math.max(x0, x1) > 256 || Math.max(y0, y1) > 256) continue;
      const largo = Math.hypot(x1 - x0, y1 - y0);
      if (largo > maxLong) { maxLong = largo; mejor = [x0, y0, x1, y1, largo]; }
    }
    return mejor;
  }

  function textoConHalo(ctx, texto, x, y, color, halo = "rgba(255,255,255,0.92)", grosor = 3) {
    ctx.lineJoin = "round";
    ctx.lineWidth = grosor;
    ctx.strokeStyle = halo;
    ctx.strokeText(texto, x, y);
    ctx.fillStyle = color;
    ctx.fillText(texto, x, y);
  }

  function prepararEtiquetasLugares(ctx, t, z) {
    const bit = 1 << z;
    const etiquetas = [];
    for (const f of t.d.f) {
      if (f.length !== 5 || !(f[1] & bit)) continue;
      const clase = meta.clases_t[f[0]];
      const tam = meta.fuente_t[clase];
      const estilo = FUENTE_ETIQUETA[clase];
      const texto = t.d.n[f[2]];
      const x = f[3] * t.escala - t.ox, y = f[4] * t.escala - t.oy;
      ctx.font = `${estilo.cursiva ? "italic " : ""}${estilo.peso} ${tam}px "${estilo.familia}", sans-serif`;
      const ancho = ctx.measureText(texto).width;
      const caja = clase === "pico"
        ? [x - ancho / 2 - 3, y - 6, x + ancho / 2 + 3, y + tam + 8]
        : [x - ancho / 2 - 3, y - tam / 2 - 3, x + ancho / 2 + 3, y + tam / 2 + 3];
      etiquetas.push({ clase, tam, estilo, texto, x, y, caja });
    }
    return etiquetas;
  }

  function dibujarEtiquetasLugares(ctx, etiquetas) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const e of etiquetas) {
      ctx.font = `${e.estilo.cursiva ? "italic " : ""}${e.estilo.peso} ${e.tam}px "${e.estilo.familia}", sans-serif`;
      if (e.clase === "pico") {
        ctx.fillStyle = "#8b5a2b";
        ctx.beginPath();
        ctx.moveTo(e.x, e.y - 5);
        ctx.lineTo(e.x - 4.5, e.y + 3);
        ctx.lineTo(e.x + 4.5, e.y + 3);
        ctx.closePath();
        ctx.fill();
        textoConHalo(ctx, e.texto, e.x, e.y + 4 + e.tam / 2 + 2, e.estilo.color);
      } else {
        textoConHalo(ctx, e.texto, e.x, e.y, e.estilo.color, "rgba(255,255,255,0.95)", e.clase === "ciudad" ? 4 : 3);
      }
    }
  }

  /**
   * Une en polilíneas continuas los tramos que comparten extremo.
   * (En OSM una calle suele estar partida en un tramo por cruce.)
   */
  function unirTramos(lista) {
    const cerca = (ax, ay, bx, by) => Math.abs(ax - bx) < 0.5 && Math.abs(ay - by) < 0.5;
    const invertir = p => {
      const r = [];
      for (let i = p.length - 2; i >= 0; i -= 2) r.push(p[i], p[i + 1]);
      return r;
    };
    const tramos = lista.map(p => p.slice());
    let unido = true;
    while (unido && tramos.length > 1) {
      unido = false;
      for (let i = 0; i < tramos.length && !unido; i++) {
        for (let j = i + 1; j < tramos.length && !unido; j++) {
          let a = tramos[i], b = tramos[j];
          const aFin = [a[a.length - 2], a[a.length - 1]], aIni = [a[0], a[1]];
          const bFin = [b[b.length - 2], b[b.length - 1]], bIni = [b[0], b[1]];
          let nuevo = null;
          if (cerca(...aFin, ...bIni)) nuevo = a.concat(b.slice(2));
          else if (cerca(...aFin, ...bFin)) nuevo = a.concat(invertir(b).slice(2));
          else if (cerca(...aIni, ...bFin)) nuevo = b.concat(a.slice(2));
          else if (cerca(...aIni, ...bIni)) nuevo = invertir(a).concat(b.slice(2));
          if (nuevo) {
            tramos[i] = nuevo;
            tramos.splice(j, 1);
            unido = true;
          }
        }
      }
    }
    // Las más largas primero: más sitio para el rótulo
    const largo = p => { let s = 0; for (let i = 2; i < p.length; i += 2) s += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); return s; };
    return tramos.sort((a, b) => largo(b) - largo(a));
  }

  function dibujarPlacasYCalles(ctx, t, z, ocupadas) {
    const clases = meta.clases_l;
    const nombres = new Map(); // nombre -> { importancia, tramos[] }
    const refs = new Map();    // ref -> { clase, importancia, tramos[] }

    for (const f of t.d.f) {
      if (f.length !== 6 || f[1] > z || (f[2] < 0 && f[3] < 0)) continue;
      const clase = clases[f[0]];
      if (f[2] >= 0 && z >= 15 && CALLES_CON_NOMBRE.has(clase)) {
        const nombre = t.d.n[f[2]];
        if (!nombres.has(nombre)) nombres.set(nombre, { importancia: f[0], tramos: [] });
        const e = nombres.get(nombre);
        e.importancia = Math.max(e.importancia, f[0]);
        e.tramos.push(decodificar(f[5], t.escala, t.ox, t.oy));
      }
      const placa = PLACAS[clase];
      if (f[3] >= 0 && placa && z >= placa.desde && z <= 16) {
        const ref = t.d.n[f[3]];
        if (!refs.has(ref) || refs.get(ref).importancia < f[0]) refs.set(ref, { clase, importancia: f[0], tramos: [] });
        refs.get(ref).tramos.push(decodificar(f[5], t.escala, t.ox, t.oy));
      }
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Placas de carretera (una por referencia y tesela), de la vía más importante a la menos
    for (const [ref, e] of [...refs].sort((a, b) => b[1].importancia - a[1].importancia)) {
      const placa = PLACAS[e.clase];
      ctx.font = `700 10px "Plus Jakarta Sans", sans-serif`;
      const w = ctx.measureText(ref).width + 8, h = 14;
      for (const pts of e.tramos) {
        const tramo = tramoMasLargo(pts);
        if (!tramo) continue;
        const cx = (tramo[0] + tramo[2]) / 2, cy = (tramo[1] + tramo[3]) / 2;
        const caja = [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
        if (!dentroTesela(caja) || choca(caja, ocupadas)) continue;
        ocupadas.push(caja);
        ctx.fillStyle = placa.fondo;
        ctx.beginPath();
        ctx.roundRect(caja[0], caja[1], w, h, 3);
        ctx.fill();
        if (placa.borde) { ctx.strokeStyle = placa.borde; ctx.lineWidth = 1; ctx.stroke(); }
        ctx.fillStyle = placa.texto;
        ctx.fillText(ref, cx, cy + 0.5);
        break;
      }
    }

    // Nombres de calles (uno por nombre y tesela), de las vías más importantes a las menos
    const tam = z >= 17 ? 12 : 11;
    ctx.font = `500 ${tam}px "Plus Jakarta Sans", sans-serif`;
    for (const [nombre, e] of [...nombres].sort((a, b) => b[1].importancia - a[1].importancia)) {
      for (const pts of unirTramos(e.tramos)) {
        if (etiquetaSobreCalle(ctx, nombre, pts, tam, ocupadas)) break;
      }
    }
  }

  async function dibujarTesela(canvas, coords, dpr) {
    const z = coords.z;
    const [tl, tp] = await Promise.all([
      datosPara("l", meta.niveles_l, coords),
      datosPara("p", meta.niveles_p, coords)
    ]);
    if (!tl && !tp) return;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    dibujarPoligonos(ctx, tp, z);
    if (!tl) return;
    dibujarLineas(ctx, tl, z);

    // Etiquetas: las de pueblos reservan su espacio primero y se dibujan al final, encima de todo
    const lugares = prepararEtiquetasLugares(ctx, tl, z);
    const ocupadas = lugares.map(e => e.caja);
    dibujarPlacasYCalles(ctx, tl, z, ocupadas);
    dibujarEtiquetasLugares(ctx, lugares);
  }

  // -------------------------------------------------------------------------
  // Capa Leaflet
  // -------------------------------------------------------------------------

  function limitesTeselas(rango, n) {
    const lon = x => x / 2 ** n * 360 - 180;
    const lat = y => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 2 ** n))) * 180 / Math.PI;
    return L.latLngBounds([lat(rango[3] + 1), lon(rango[0])], [lat(rango[1]), lon(rango[2] + 1)]);
  }

  const CapaDetalle = L.GridLayer.extend({
    createTile(coords, done) {
      const canvas = L.DomUtil.create("canvas", "tesela-detalle");
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.height = 256 * dpr;
      dibujarTesela(canvas, coords, dpr)
        .then(() => done(null, canvas))
        .catch(err => { console.warn("Error dibujando tesela", coords, err); done(null, canvas); });
      return canvas;
    }
  });

  async function crear(pane) {
    const resp = await fetch(BASE + "meta.json");
    if (!resp.ok) throw new Error(`meta.json: HTTP ${resp.status}`);
    meta = await resp.json();
    const [n] = meta.niveles_l[0];
    return new CapaDetalle({
      pane,
      minZoom: n,
      maxZoom: 18,
      bounds: limitesTeselas(meta.rangos["l" + n], n),
      updateWhenZooming: false,
      keepBuffer: 3,
      // Obligatorio por la licencia ODbL de OpenStreetMap
      attribution: meta.atribucion
    });
  }

  return { crear };
})();
