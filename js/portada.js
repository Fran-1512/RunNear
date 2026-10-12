/**
 * RunNear - Portada: los enlaces antiguos a la raíz que en realidad son del mapa (carrera
 * compartida, vuelta del inicio de sesión con Google, avisos al móvil) y la app instalada
 * se llevan directamente al mapa. Se carga en el <head> (sin defer) para hacerlo cuanto antes.
 */
(function () {
  var q = location.search, h = location.hash;
  var instalada = window.matchMedia && matchMedia("(display-mode: standalone)").matches;
  if (/[?&](carrera|code|error|error_description)=/.test(q) || /access_token|error_description/.test(h) || instalada) {
    location.replace("mapa.html" + q + h);
  }
})();
