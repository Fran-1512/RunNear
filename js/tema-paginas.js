/**
 * RunNear - Tema de las páginas de texto (portada, guías, calendario, fichas, legal).
 * Aplica el tema elegido en los Ajustes del mapa; si no se eligió ninguno, el CSS sigue el modo
 * claro/oscuro del dispositivo. Se carga en el <head> (sin defer) para que la página no parpadee.
 */
try {
  var apariencia = JSON.parse(localStorage.getItem("runnear_apariencia"));
  if (apariencia === "claro" || apariencia === "oscuro") document.documentElement.dataset.tema = apariencia;
} catch (e) {
  // Sin almacenamiento: se usa el modo del dispositivo
}
