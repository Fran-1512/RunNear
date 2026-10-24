# Prueba los botones que se conectan desde el código (sin onclick en el HTML): "Ver ficha" del globo
# del mapa, "Restablecer filtros" de la lista vacía y la exportación al calendario.
# Uso (desde la carpeta del proyecto, con Chrome instalado):
#     powershell -ExecutionPolicy Bypass -File tests\navegador\prueba_botones.ps1
$proj = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$out = Join-Path $env:TEMP "runnear_pruebas"
New-Item -ItemType Directory -Force $out | Out-Null
$prueba = Join-Path $proj "_prueba_botones.html"
$html = [IO.File]::ReadAllText((Join-Path $proj "mapa.html"))
$js = @'
<script>
const resultados = [];
const comprobar = (nombre, ok, detalle = "") => resultados.push(`${ok ? "OK " : "MAL"}  ${nombre}${detalle ? "  (" + detalle + ")" : ""}`);
const espera = ms => new Promise(r => setTimeout(r, ms));
window.addEventListener("load", () => setTimeout(async () => {
  try {
    // 1. Globo de una carrera en el mapa -> botón "Ver ficha"
    const c = AppState.races.find(x => x.ubicacion && x.ubicacion.lat && AppState.mapMarkers[x.id] &&
                                   AppState.clusterGroup.hasLayer(AppState.mapMarkers[x.id]));
    const marcador = AppState.mapMarkers[c.id];
    // Sin animaciones (en Chrome sin ventana no siempre terminan): acercar del todo y abrir el globo
    AppState.map.setView(marcador.getLatLng(), AppState.map.getMaxZoom(), { animate: false });
    await espera(500);
    AppState.clusterGroup.zoomToShowLayer(marcador, () => marcador.openPopup());
    let boton = null;
    for (let i = 0; i < 25 && !boton; i++) {
      await espera(200);
      if (i === 10) marcador.openPopup();
      boton = document.querySelector(".leaflet-popup .popup-btn-detail");
    }
    comprobar("el globo tiene el botón Ver ficha sin onclick", !!boton && !boton.hasAttribute("onclick"),
              boton ? "" : `globos abiertos: ${document.querySelectorAll(".leaflet-popup").length}, carrera ${c.id}, en el mapa: ${AppState.map.hasLayer(marcador)}`);
    boton.click();
    await espera(300);
    const modal = document.getElementById("race-detail-modal");
    comprobar("Ver ficha abre la ficha de esa carrera", !modal.classList.contains("hidden") &&
      document.getElementById("modal-race-title").textContent === c.nombre, c.nombre);
    cerrarModalDetalle();

    // 2. Búsqueda sin resultados -> "Restablecer filtros"
    const buscador = document.getElementById("filter-search-input");
    buscador.value = "zzzz-ninguna-carrera";
    buscador.dispatchEvent(new Event("input"));
    await espera(300);
    const restablecer = document.querySelector('#races-list-container button[data-accion="restablecer"]');
    comprobar("la lista vacía ofrece Restablecer filtros", !!restablecer);
    restablecer.click();
    await espera(300);
    comprobar("Restablecer filtros vuelve a mostrar carreras",
      buscador.value === "" && document.querySelectorAll("#races-list-container .race-card").length > 0);

    // 3. Ningún onclick escrito en el HTML de la página
    comprobar("sin atributos onclick en la página", document.querySelectorAll("[onclick]").length === 0,
      document.querySelectorAll("[onclick]").length + " encontrados");
  } catch (e) {
    resultados.push("ERROR " + e.stack);
  }
  const pre = document.createElement("pre");
  pre.id = "resultado";
  pre.textContent = resultados.join("\n");
  document.body.appendChild(pre);
}, 3000));
</script>
'@
# La copia de prueba lleva su propio código en línea: sin la política de seguridad (CSP), que lo bloquearía
$html = $html -replace '<meta http-equiv="Content-Security-Policy"[^>]*>', ''
$html = $html -replace '</body>', ($js + '</body>')
[IO.File]::WriteAllText($prueba, $html, (New-Object Text.UTF8Encoding $false))
$p = Start-Process py -ArgumentList '-m','http.server','8005' -WorkingDirectory $proj -PassThru -WindowStyle Hidden -RedirectStandardOutput "$out\tb.log" -RedirectStandardError "$out\tb.err"
Start-Sleep -Seconds 2
try {
    $chrome = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
    $sal = "$out\tb_dom.html"
    Start-Process $chrome -ArgumentList @("--headless=new","--disable-gpu","`"--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost`"","--window-size=1400,900","--virtual-time-budget=60000","`"--user-data-dir=$out\cptb_$(Get-Date -Format HHmmssfff)`"","--dump-dom","http://localhost:8005/_prueba_botones.html") -Wait -RedirectStandardOutput $sal -RedirectStandardError "$out\tb_chrome.err"
    $dom = Get-Content -Raw -Encoding UTF8 $sal
    $m = [regex]::Match($dom, '<pre id="resultado">(.*?)</pre>', 'Singleline')
    if ($m.Success) { [System.Net.WebUtility]::HtmlDecode($m.Groups[1].Value) } else { "sin resultado (dom: $($dom.Length))" }
} finally {
    Get-NetTCPConnection -LocalPort 8005 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $prueba -Confirm:$false
}
