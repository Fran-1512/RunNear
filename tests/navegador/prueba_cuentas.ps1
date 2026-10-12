# Prueba la sincronización de cuentas (favoritas, corridas, ajustes) con un Supabase simulado en memoria
# Uso (desde la carpeta del proyecto, con Chrome instalado):
#     powershell -ExecutionPolicy Bypass -File tests\navegador\prueba_cuentas.ps1
$proj = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$out = Join-Path $env:TEMP "runnear_pruebas"
New-Item -ItemType Directory -Force $out | Out-Null
$prueba = Join-Path $proj "_prueba_cuenta.html"
$html = [IO.File]::ReadAllText((Join-Path $proj "mapa.html"))
$js = @'
<script>
// ---- Supabase falso: tablas en memoria, filtradas por usuario como haría RLS ----
const BD = { favoritas: [], corridas: [], ajustes: [] };
let usuarioFalso = null, avisoSesion = null;
const espera = ms => new Promise(r => setTimeout(r, ms));
function consulta(tabla) {
  const q = { filtros: [], op: "select", unico: false };
  const propias = () => BD[tabla].filter(r => usuarioFalso && r.user_id === usuarioFalso.id);
  const ejecutar = () => {
    if (!usuarioFalso) return { data: null, error: { message: "permission denied" } };
    if (q.op === "select") {
      const filas = propias().map(r => JSON.parse(JSON.stringify(r)));
      return { data: q.unico ? (filas[0] || null) : filas, error: null };
    }
    if (q.op === "upsert") {
      const claves = q.conflicto.split(",");
      q.filas.forEach(f => {
        if (f.user_id !== usuarioFalso.id) throw new Error("RLS");
        const i = BD[tabla].findIndex(r => claves.every(k => r[k] === f[k]));
        if (i >= 0) { if (!q.ignorar) BD[tabla][i] = { ...BD[tabla][i], ...f }; }
        else BD[tabla].push({ ...f });
      });
      return { data: null, error: null };
    }
    if (q.op === "delete") {
      BD[tabla] = BD[tabla].filter(r => !(r.user_id === usuarioFalso.id && q.filtros.every(fn => fn(r))));
      return { data: null, error: null };
    }
  };
  const b = {
    select() { q.op = "select"; return b; },
    maybeSingle() { q.unico = true; return b; },
    upsert(filas, op) { q.op = "upsert"; q.filas = Array.isArray(filas) ? filas : [filas]; q.conflicto = op.onConflict; q.ignorar = !!op.ignoreDuplicates; return b; },
    delete() { q.op = "delete"; return b; },
    eq(col, v) { q.filtros.push(r => r[col] === v); return b; },
    not(col, opr, lista) {
      const ids = lista.slice(1, -1).split(",").map(s => s.replace(/^"|"$/g, ""));
      q.filtros.push(r => !ids.includes(r[col])); return b;
    },
    then(ok, ko) { return espera(20).then(ejecutar).then(ok, ko); }
  };
  return b;
}
const clienteFalso = {
  from: consulta,
  rpc: async (fn) => {
    if (fn === "borrar_mi_cuenta") { const id = usuarioFalso.id; Object.keys(BD).forEach(t => BD[t] = BD[t].filter(r => r.user_id !== id)); return { error: null }; }
    return { data: new Date().toISOString(), error: null };
  },
  auth: {
    onAuthStateChange(cb) { avisoSesion = cb; },
    async getSession() { return { data: { session: usuarioFalso ? { user: usuarioFalso } : null } }; },
    async signOut() { usuarioFalso = null; avisoSesion && avisoSesion("SIGNED_OUT", null); return { error: null }; }
  }
};
window.obtenerSupabase = async () => clienteFalso;

async function entrar(id, email) {
  usuarioFalso = { id, email, user_metadata: {} };
  if (!avisoSesion) await conectarCuenta();
  avisoSesion("SIGNED_IN", { user: usuarioFalso });
  await espera(600);
}
const remotas = (t, uid) => BD[t].filter(r => r.user_id === uid).map(r => r.carrera_id).sort().join(",");
const locales = () => [...idsFavoritas()].sort().join(",");
const resultados = [];
const comprobar = (nombre, ok, detalle = "") => resultados.push(`${ok ? "OK " : "MAL"}  ${nombre}${detalle ? "  (" + detalle + ")" : ""}`);

window.addEventListener("load", () => setTimeout(async () => {
  try {
    // 1. Sin cuenta: datos en el dispositivo
    localStorage.clear();
    ALMACEN.guardar("favoritas", ["A", "B"]);
    ALMACEN.guardar("corridas", [{ id: "X", nombre: "Carrera X", fecha: "2026-09-01", marca: { tiempo_seg: 2700, distancia_km: 10 }, guardada: "2026-09-02" }]);
    ALMACEN.guardar("apariencia", "claro");

    // 2. Primera vez que entra: se suben al archivador
    await entrar("u1", "ana@prueba.es");
    comprobar("al entrar se suben las favoritas", remotas("favoritas", "u1") === "A,B", remotas("favoritas", "u1"));
    const x = BD.corridas.find(r => r.carrera_id === "X");
    comprobar("al entrar se sube la corrida con su tiempo", !!x && x.marca && x.marca.tiempo_seg === 2700 && x.datos.nombre === "Carrera X");
    comprobar("al entrar se suben los ajustes", BD.ajustes.length === 1 && BD.ajustes[0].tema === "claro");

    // 3. Cambios con sesión: se copian a la cuenta
    alternarFavorita("A");               // quitar A
    alternarFavorita("C");               // añadir C
    guardarMarca("X", { tiempo_seg: 2600, distancia_km: 10 });
    await espera(1400);
    comprobar("quitar y añadir favoritas se refleja en la cuenta", remotas("favoritas", "u1") === "B,C", remotas("favoritas", "u1"));
    comprobar("cambiar el tiempo se refleja en la cuenta", BD.corridas.find(r => r.carrera_id === "X").marca.tiempo_seg === 2600);

    // 4. Cerrar sesión: el dispositivo se vacía, la cuenta conserva todo
    await cerrarSesion();
    await espera(200);
    comprobar("al salir se vacía el dispositivo", locales() === "" && listaCorridas().length === 0);
    comprobar("al salir la cuenta conserva los datos", remotas("favoritas", "u1") === "B,C");

    // 5. Otro dispositivo (sin datos): al entrar recibe lo de la cuenta
    localStorage.clear();
    ALMACEN.guardar("favoritas", ["D"]);   // algo guardado antes de entrar
    await entrar("u1", "ana@prueba.es");
    comprobar("en un dispositivo nuevo se juntan los datos", locales() === "B,C,D", locales());
    comprobar("y lo nuevo se sube a la cuenta", remotas("favoritas", "u1") === "B,C,D");
    comprobar("las corridas llegan con su tiempo", listaCorridas().length === 1 && listaCorridas()[0].marca.tiempo_seg === 2600);
    comprobar("el tema de la cuenta se aplica", document.body.classList.contains("tema-claro"));

    // 6. Otro usuario no ve nada de Ana
    await cerrarSesion();
    await entrar("u2", "luis@prueba.es");
    comprobar("otro usuario empieza vacío", locales() === "" && listaCorridas().length === 0, locales());
    alternarFavorita("Z");
    await espera(1400);
    comprobar("las favoritas de cada uno van a su cajón", remotas("favoritas", "u2") === "Z" && remotas("favoritas", "u1") === "B,C,D");

    // 7. Borrar cuenta
    window.confirm = () => true;
    await borrarCuenta();
    comprobar("borrar cuenta elimina sus datos", BD.favoritas.every(r => r.user_id !== "u2") && remotas("favoritas", "u1") === "B,C,D");
    comprobar("tras borrar no queda sesión", Cuenta.usuario === null && document.getElementById("btn-cuenta-texto").textContent === "Entrar");
  } catch (e) {
    resultados.push("ERROR " + e.stack);
  }
  const pre = document.createElement("pre");
  pre.id = "resultado";
  pre.textContent = resultados.join("\n");
  document.body.appendChild(pre);
}, 2000));
</script>
'@
$html = $html -replace '</body>', ($js + '</body>')
[IO.File]::WriteAllText($prueba, $html, (New-Object Text.UTF8Encoding $false))
$p = Start-Process py -ArgumentList '-m','http.server','8004' -WorkingDirectory $proj -PassThru -WindowStyle Hidden -RedirectStandardOutput "$out\tc.log" -RedirectStandardError "$out\tc.err"
Start-Sleep -Seconds 2
try {
    $chrome = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
    $sal = "$out\tc_dom.html"
    Start-Process $chrome -ArgumentList @("--headless=new","--disable-gpu","`"--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost`"","--window-size=1400,900","--virtual-time-budget=120000","`"--user-data-dir=$out\cptc_$(Get-Date -Format HHmmssfff)`"","--dump-dom","http://localhost:8004/_prueba_cuenta.html") -Wait -RedirectStandardOutput $sal -RedirectStandardError "$out\tc_chrome.err"
    $dom = Get-Content -Raw -Encoding UTF8 $sal
    $m = [regex]::Match($dom, '<pre id="resultado">(.*?)</pre>', 'Singleline')
    if ($m.Success) { [System.Net.WebUtility]::HtmlDecode($m.Groups[1].Value) } else { "sin resultado (dom: $($dom.Length))" }
} finally {
    Get-NetTCPConnection -LocalPort 8004 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $prueba -Confirm:$false
}
