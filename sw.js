/**
 * RunNear - Service worker (app instalable / funcionamiento sin conexión)
 *
 * Estrategias:
 *  - Páginas y datos (mapa.html, carreras.json, meta del mapa): primero red, si no hay
 *    conexión se usa la última copia guardada.
 *  - Teselas del mapa detallado: primero caché (no cambian); las zonas ya vistas
 *    funcionan sin conexión. Se guardan como mucho MAX_TESELAS.
 *  - Resto (CSS, JS, fuentes, librerías, mapa base): se sirve la copia guardada al
 *    instante y se actualiza en segundo plano.
 */

const VERSION = "runnear-v2";
const CACHE_APP = `${VERSION}-app`;
const CACHE_TESELAS = "runnear-teselas";
const MAX_TESELAS = 3000;

// Lo imprescindible para abrir la app sin conexión
const PRECARGA = [
  "mapa.html",
  "carreras.json",
  "manifest.webmanifest",
  "mapa/mapa_base.json",
  "mapa/teselas/meta.json",
  "vendor/leaflet/leaflet.js",
  "vendor/leaflet/leaflet.css",
  "vendor/markercluster/leaflet.markercluster.js",
  "vendor/markercluster/MarkerCluster.css",
  "vendor/markercluster/MarkerCluster.Default.css",
  "vendor/fonts/fonts.css",
  "iconos/icono-192.png"
];

self.addEventListener("install", evento => {
  evento.waitUntil(
    caches.open(CACHE_APP)
      .then(cache => cache.addAll(PRECARGA))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", evento => {
  // Borrar cachés de versiones anteriores (las teselas se conservan)
  evento.waitUntil(
    caches.keys()
      .then(nombres => Promise.all(
        nombres.filter(n => n !== CACHE_APP && n !== CACHE_TESELAS).map(n => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

async function primeroRed(peticion) {
  const cache = await caches.open(CACHE_APP);
  try {
    const respuesta = await fetch(peticion);
    if (respuesta.ok) cache.put(peticion, respuesta.clone());
    return respuesta;
  } catch (err) {
    const guardada = await cache.match(peticion, { ignoreSearch: peticion.mode === "navigate" });
    if (guardada) return guardada;
    // Sin conexión y sin copia de esa página: se abre el mapa (lo que funciona sin red)
    if (peticion.mode === "navigate") return cache.match("mapa.html");
    throw err;
  }
}

async function primeroCacheTesela(peticion) {
  const cache = await caches.open(CACHE_TESELAS);
  const guardada = await cache.match(peticion);
  if (guardada) return guardada;
  const respuesta = await fetch(peticion);
  if (respuesta.ok) {
    await cache.put(peticion, respuesta.clone());
    recortarTeselas(cache);
  }
  return respuesta;
}

let recortando = false;
async function recortarTeselas(cache) {
  if (recortando) return;
  recortando = true;
  try {
    const claves = await cache.keys();
    // Las más antiguas primero (orden de inserción)
    for (let i = 0; i < claves.length - MAX_TESELAS; i++) await cache.delete(claves[i]);
  } finally {
    recortando = false;
  }
}

async function cacheYActualizar(peticion) {
  const cache = await caches.open(CACHE_APP);
  const guardada = await cache.match(peticion);
  const deRed = fetch(peticion)
    .then(respuesta => {
      if (respuesta.ok) cache.put(peticion, respuesta.clone());
      return respuesta;
    })
    .catch(() => guardada);
  return guardada || deRed;
}

// ==========================================================================
// Avisos al móvil: los envía cada mañana la función "avisos" de Supabase
// ==========================================================================

self.addEventListener("push", evento => {
  let aviso = { titulo: "RunNear", cuerpo: "", url: "mapa.html" };
  try {
    aviso = { ...aviso, ...evento.data.json() };
  } catch (e) {
    if (evento.data) aviso.cuerpo = evento.data.text();
  }
  evento.waitUntil(self.registration.showNotification(aviso.titulo, {
    body: aviso.cuerpo,
    icon: "iconos/icono-192.png",
    badge: "iconos/icono-192.png",
    data: { url: aviso.url },
    lang: "es"
  }));
});

// Al tocar el aviso: se abre RunNear (o se reutiliza la ventana abierta) en esa carrera
self.addEventListener("notificationclick", evento => {
  evento.notification.close();
  const url = new URL((evento.notification.data && evento.notification.data.url) || "mapa.html", self.registration.scope).href;
  evento.waitUntil((async () => {
    const ventanas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const abierta = ventanas.find(v => v.url.startsWith(self.registration.scope));
    if (abierta) {
      await abierta.navigate(url);
      return abierta.focus();
    }
    return self.clients.openWindow(url);
  })());
});

self.addEventListener("fetch", evento => {
  const peticion = evento.request;
  if (peticion.method !== "GET") return;

  const url = new URL(peticion.url);
  // Webs externas (inscripciones, cuentas, tiempo...): sin intervenir
  if (url.origin !== self.location.origin) return;

  if (url.pathname.includes("/mapa/teselas/") && !url.pathname.endsWith("meta.json")) {
    evento.respondWith(primeroCacheTesela(peticion));
  } else if (peticion.mode === "navigate" || url.pathname.endsWith("carreras.json") || url.pathname.endsWith("meta.json")) {
    evento.respondWith(primeroRed(peticion));
  } else {
    evento.respondWith(cacheYActualizar(peticion));
  }
});
