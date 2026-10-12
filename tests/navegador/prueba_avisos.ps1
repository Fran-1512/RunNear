# Prueba la lógica de los avisos al móvil (calcularAvisos de supabase/functions/avisos/index.ts)
# Uso (desde la carpeta del proyecto, con Chrome instalado):
#     powershell -ExecutionPolicy Bypass -File tests\navegador\prueba_avisos.ps1
$proj = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$out = Join-Path $env:TEMP "runnear_pruebas"
New-Item -ItemType Directory -Force $out | Out-Null
$ts = [IO.File]::ReadAllText("$proj\supabase\functions\avisos\index.ts")
$a = $ts.IndexOf("// ---- LÓGICA"); $b = $ts.IndexOf("// ---- FIN LÓGICA")
$logica = $ts.Substring($a, $b - $a)
$pruebas = @'
const r = [];
const ok = (n, c, d = "") => r.push(`${c ? "OK " : "MAL"}  ${n}${d ? "  (" + d + ")" : ""}`);
const hoy = "2026-10-10", ayer = "2026-10-09", manana = "2026-10-11";
const carreras = [
  { id: "m1", nombre: "Carrera Mañana", fecha: manana, hora: "10:00", municipio: "Tomelloso", ubicacion: { lat: 39.16, lng: -3.02 } },
  { id: "m2", nombre: "Trail Mañana", fecha: manana, municipio: "Yeste", ubicacion: { lat: 38.37, lng: -2.31 } },
  { id: "a1", nombre: "Carrera Ayer", fecha: ayer, municipio: "Toledo", ubicacion: { lat: 39.86, lng: -4.03 } },
  { id: "a2", nombre: "Carrera Ayer Corrida", fecha: ayer, municipio: "Toledo", ubicacion: { lat: 39.86, lng: -4.03 } },
  { id: "c1", nombre: "Cancelada Mañana", fecha: manana, estado: "cancelada", municipio: "X", ubicacion: { lat: 39.8, lng: -4 } },
  { id: "n1", nombre: "Nueva Cerca", fecha: "2026-11-01", municipio: "Argamasilla", ubicacion: { lat: 39.10, lng: -3.09 } },
  { id: "n2", nombre: "Nueva Lejos", fecha: "2026-11-02", municipio: "Guadalajara", ubicacion: { lat: 40.63, lng: -3.16 } },
  { id: "n3", nombre: "Nueva Cerca 2", fecha: "2026-10-20", municipio: "Socuéllamos", ubicacion: { lat: 39.29, lng: -2.79 } },
];
const tomelloso = { nombre: "Tomelloso", lat: 39.16, lng: -3.02 };

let av = calcularAvisos({ favoritas: ["m1", "m2", "a1", "a2", "c1"], corridas: ["a2"], avisos: null, ciudad: tomelloso, radio_km: 50 }, carreras, ["n1", "n2", "n3"], hoy, ayer, manana);
const claves = av.map(a => a.clave).sort().join(",");
ok("por defecto: recordatorios de mañana (no la cancelada)", claves.includes("recordatorio:m1") && claves.includes("recordatorio:m2") && !claves.includes("c1"), claves);
ok("¿la corriste? solo si no está marcada", claves.includes("corrida:a1") && !claves.includes("corrida:a2"));
ok("carreras nuevas desactivadas por defecto", !claves.includes("nuevas"));
const m1 = av.find(a => a.clave === "recordatorio:m1");
ok("el recordatorio incluye la hora", m1.cuerpo.includes("10:00"), m1.cuerpo);
ok("sin hora, lo indica", av.find(a => a.clave === "recordatorio:m2").cuerpo.includes("Consulta la hora"));
ok("el enlace abre la ficha", m1.url === "https://gorunnear.com/?carrera=m1", m1.url);

av = calcularAvisos({ favoritas: [], corridas: [], avisos: { nuevas: true }, ciudad: tomelloso, radio_km: 50 }, carreras, ["n1", "n2", "n3"], hoy, ayer, manana);
ok("nuevas cerca: agrupa varias en un aviso", av.length === 1 && av[0].titulo.startsWith("🆕 2 carreras nuevas cerca de Tomelloso"), av.map(a => a.titulo).join(" | "));
ok("nuevas: la lejana no cuenta", !av[0].cuerpo.includes("Lejos"), av[0].cuerpo);

av = calcularAvisos({ favoritas: [], corridas: [], avisos: { nuevas: true }, ciudad: tomelloso, radio_km: 15 }, carreras, ["n1", "n2", "n3"], hoy, ayer, manana);
ok("nuevas: con 1 sola, aviso con su nombre", av.length === 1 && av[0].clave === "nuevas:n1" && av[0].cuerpo.includes("Nueva Cerca"), av.map(a => a.clave).join(","));

av = calcularAvisos({ favoritas: [], corridas: [], avisos: { nuevas: true }, ciudad: null, radio_km: 50 }, carreras, ["n1"], hoy, ayer, manana);
ok("nuevas: sin ciudad elegida no se avisa", av.length === 0);

av = calcularAvisos({ favoritas: ["m1", "a1"], corridas: [], avisos: { recordatorio: false, corrida: false }, ciudad: null }, carreras, [], hoy, ayer, manana);
ok("se respetan los avisos desactivados", av.length === 0);

ok("fechaMadrid da AAAA-MM-DD", /^\d{4}-\d{2}-\d{2}$/.test(fechaMadrid(0)), fechaMadrid(0));

document.getElementById("resultado").textContent = r.join("\n");
'@
$html = "<!doctype html><meta charset=utf-8><body><pre id=resultado>ERROR SIN CAPTURAR</pre><script>window.onerror=(m,s,l)=>{document.getElementById('resultado').textContent='ERROR '+m+' linea '+l};`nconst WEB = 'https://gorunnear.com/';`n" + $logica + "`n" + $pruebas + "`n</script>"
$f = "$out\prueba_avisos.html"
[IO.File]::WriteAllText($f, $html, (New-Object Text.UTF8Encoding $false))
$chrome = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
$sal = "$out\avisos_dom.html"
Start-Process $chrome -ArgumentList @("--headless=new","--disable-gpu","--virtual-time-budget=3000","`"--user-data-dir=$out\cpav_$(Get-Date -Format HHmmssfff)`"","--dump-dom","file:///$($f.Replace('\','/'))") -Wait -RedirectStandardOutput $sal -RedirectStandardError "$out\av_chrome.err"
$dom = Get-Content -Raw -Encoding UTF8 $sal
$m = [regex]::Match($dom, '<pre id="?resultado"?>(.*?)</pre>', 'Singleline')
if ($m.Success) { [System.Net.WebUtility]::HtmlDecode($m.Groups[1].Value) } else { "sin resultado"; $dom.Substring(0, [Math]::Min(500, $dom.Length)) }
