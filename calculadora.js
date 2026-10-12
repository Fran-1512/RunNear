/* Calculadora de ritmo de la guía guias/calculadora-ritmo/ */
(function () {
  const $ = id => document.getElementById(id);
  const formulario = $("calculadora");
  if (!formulario) return;

  const DISTANCIAS = [[5, "5K"], [10, "10K"], [21.0975, "Media maratón"], [42.195, "Maratón"]];

  function num(id) {
    const v = parseFloat(String($(id).value).replace(",", "."));
    return isFinite(v) && v >= 0 ? v : 0;
  }

  function formatoTiempo(segundos) {
    const s = Math.round(segundos);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    const dos = n => String(n).padStart(2, "0");
    return h ? `${h}:${dos(m)}:${dos(r)}` : `${m}:${dos(r)}`;
  }

  function distancia() {
    return $("calc-distancia").value === "otra" ? num("calc-otra") : parseFloat($("calc-distancia").value);
  }

  function calcular() {
    const km = distancia();
    const modoRitmo = formulario.querySelector('input[name="calc-modo"]:checked').value === "ritmo";
    $("calc-otra").hidden = $("calc-distancia").value !== "otra";
    $("calc-con-tiempo").hidden = !modoRitmo;
    $("calc-con-ritmo").hidden = modoRitmo;

    let total, ritmo;
    if (modoRitmo) {
      total = num("calc-h") * 3600 + num("calc-m") * 60 + num("calc-s");
      ritmo = km ? total / km : 0;
    } else {
      ritmo = num("calc-rm") * 60 + num("calc-rs");
      total = ritmo * km;
    }
    if (!km || !total) {
      $("calc-resultado").innerHTML = "<p>Introduce una distancia y un tiempo para calcular.</p>";
      $("calc-parciales").innerHTML = "";
      return;
    }

    const velocidad = km / (total / 3600);
    const estimaciones = DISTANCIAS.filter(([d]) => Math.abs(d - km) > 0.01)
      .map(([d, nombre]) => `<li>${nombre}: <b>${formatoTiempo(total * Math.pow(d / km, 1.06))}</b></li>`).join("");
    $("calc-resultado").innerHTML = `
      <div class="cifras">
        <div><span>Ritmo</span><b>${formatoTiempo(ritmo)} /km</b></div>
        <div><span>Tiempo final</span><b>${formatoTiempo(total)}</b></div>
        <div><span>Velocidad</span><b>${velocidad.toFixed(1).replace(".", ",")} km/h</b></div>
      </div>
      ${estimaciones ? `<p class="estimacion">Estimación con ese nivel en otras distancias:</p><ul class="estimacion">${estimaciones}</ul>` : ""}`;

    const filas = [];
    for (let k = 1; k < km && filas.length < 200; k++) filas.push(`<tr><td>km ${k}</td><td>${formatoTiempo(ritmo * k)}</td></tr>`);
    filas.push(`<tr><td>Meta (${String(+km.toFixed(3)).replace(".", ",")} km)</td><td>${formatoTiempo(total)}</td></tr>`);
    $("calc-parciales").innerHTML = `<table class="tabla"><thead><tr><th>Paso</th><th>Tiempo</th></tr></thead><tbody>${filas.join("")}</tbody></table>`;
  }

  formulario.addEventListener("input", calcular);
  formulario.addEventListener("change", calcular);
  calcular();
})();
