/**
 * RunNear - Estado global: región, radio de búsqueda, filtros, carreras cargadas y mapa.
 */

// Toda España. Sin GPS ni ciudad elegida no se limita por distancia (radio 0 = sin límite)
const REGION = {
  nombre: "España",
  centro: { lat: 40.2, lng: -3.6 },
  zoomInicial: 6,
  radioCompletoKm: 0
};
// Valor del deslizador de radio que significa "sin límite"
const RADIO_SIN_LIMITE = 500;

function textoRadio(km) {
  return km > 0 ? `${km} km` : "Sin límite";
}

// Estado global de la aplicación
const AppState = {
  userLocation: {
    lat: REGION.centro.lat,
    lng: REGION.centro.lng,
    label: `${REGION.nombre} (centro)`,
    isGps: false
  },
  filters: {
    search: "",
    type: "todas",
    distance: "todas",
    fecha: "todas",
    radiusKm: 50,
    sort: "distancia"
  },
  races: [],
  filteredRaces: [],
  map: null,
  clusterGroup: null,
  mapMarkers: {},
  userMarker: null,
  radiusCircle: null
};
