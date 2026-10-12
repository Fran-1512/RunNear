param([string]$Carpeta = "antes")
# Capturas de la web en varios estados, para comprobar que un cambio de código no altera el aspecto.
# Con el servidor local en marcha (py app.py), desde la carpeta del proyecto:
#     powershell -ExecutionPolicy Bypass -File tests\navegador\capturas.ps1 antes
#     ...cambios...
#     powershell -ExecutionPolicy Bypass -File tests\navegador\capturas.ps1 despues
#     py tests\navegador\comparar_capturas.py antes despues
# (las del mapa en ordenador varían un 0,1 % entre tomas por la carga del mapa y el punto animado)
$out = Join-Path $env:TEMP "runnear_pruebas"
$dest = "$out\reg_$Carpeta"
New-Item -ItemType Directory -Force $dest | Out-Null
$chrome = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
$id = (py -c "import json;print(json.load(open('carreras.json',encoding='utf-8'))[100]['id'])")
$casos = @(
  @("mapa_pc_oscuro", "1400,900", "mapa.html", "dark"),
  @("mapa_pc_claro", "1400,900", "mapa.html", "light"),
  @("mapa_movil", "390,844", "mapa.html", "dark"),
  @("ficha_pc", "1400,900", "mapa.html?carrera=$id", "dark"),
  @("ficha_movil_claro", "390,844", "mapa.html?carrera=$id", "light"),
  @("portada", "1200,1400", "", "light"),
  @("guia", "1200,1400", "guias/plan-10k/", "dark"),
  @("legal", "900,1200", "legal.html", "light")
)
foreach ($c in $casos) {
  $esquema = if ($c[3] -eq "light") { 1 } else { 0 }
  $args2 = @("--headless=new", "--disable-gpu", "--hide-scrollbars", "--blink-settings=preferredColorScheme=$esquema",
    "`"--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost`"", "--window-size=$($c[1])",
    "--virtual-time-budget=15000", "--user-data-dir=$out\cpreg_$($c[0])_$Carpeta",
    "--screenshot=$dest\$($c[0]).png", "http://localhost:8000/$($c[2])")
  Start-Process -FilePath $chrome -ArgumentList $args2 -Wait -NoNewWindow -RedirectStandardError "$dest\err.txt" -RedirectStandardOutput "$dest\out.txt"
}
Get-ChildItem "$dest\*.png" | ForEach-Object { "{0}  {1}" -f (Get-FileHash $_.FullName -Algorithm MD5).Hash.Substring(0, 10), $_.Name }
