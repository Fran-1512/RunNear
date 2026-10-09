// @ts-nocheck  (JavaScript sin tipos: así la parte de lógica se puede probar en un navegador)
// RunNear - Envío diario de avisos al móvil (Supabase Edge Function "avisos")
//
// La llama cada mañana la actualización automática de GitHub (publicar.yml), enviando en
// el cuerpo el carreras.json recién generado y la cabecera x-avisos-clave.
//
// Avisos (cada uno se envía una sola vez por usuario y carrera):
//   - recordatorio: el día antes de una carrera favorita
//   - corrida: el día después de una favorita que no se ha marcado como corrida
//   - nuevas: carreras que aparecen por primera vez a menos de su radio de su ciudad
//
// Secretos (Edge Functions → Secrets): VAPID_PUBLICA, VAPID_PRIVADA, AVISOS_CLAVE.
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los pone Supabase automáticamente.

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const WEB = "https://fran-1512.github.io/RunNear/";

// ---- LÓGICA (JavaScript puro, sin dependencias: se prueba aparte) ----

function fechaMadrid(desplazamientoDias) {
  const d = new Date(Date.now() + desplazamientoDias * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(d);
}

function distanciaKm(a, b) {
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

const PREFERENCIAS_POR_DEFECTO = { recordatorio: true, corrida: true, nuevas: false };

/**
 * Decide los avisos de un usuario.
 * usuario: { favoritas: [ids], corridas: [ids], avisos: {...}|null, ciudad: {nombre,lat,lng}|null, radio_km }
 * Devuelve [{ clave, titulo, cuerpo, url }]; la clave evita repetir el mismo aviso.
 */
function calcularAvisos(usuario, carreras, nuevasIds, hoy, ayer, manana) {
  const prefs = { ...PREFERENCIAS_POR_DEFECTO, ...(usuario.avisos || {}) };
  const porId = new Map(carreras.map((c) => [c.id, c]));
  const favoritas = new Set(usuario.favoritas);
  const corridas = new Set(usuario.corridas);
  const avisos = [];
  const enlace = (c) => `${WEB}?carrera=${encodeURIComponent(c.id)}`;

  if (prefs.recordatorio) {
    for (const id of favoritas) {
      const c = porId.get(id);
      if (!c || c.fecha !== manana || c.estado) continue;
      avisos.push({
        clave: `recordatorio:${id}`,
        titulo: `🏃 Mañana: ${c.nombre}`,
        cuerpo: c.hora
          ? `Salida a las ${c.hora} en ${c.municipio}. ¡Suerte!`
          : `En ${c.municipio}. Consulta la hora de salida en su web. ¡Suerte!`,
        url: enlace(c),
      });
    }
  }

  if (prefs.corrida) {
    for (const id of favoritas) {
      const c = porId.get(id);
      if (!c || c.fecha !== ayer || corridas.has(id) || c.estado) continue;
      avisos.push({
        clave: `corrida:${id}`,
        titulo: `🏅 ¿Corriste ayer la ${c.nombre}?`,
        cuerpo: "Márcala como corrida y apunta tu tiempo para verlo en tu perfil.",
        url: enlace(c),
      });
    }
  }

  const ciudad = usuario.ciudad;
  if (prefs.nuevas && ciudad && Number.isFinite(ciudad.lat) && Number.isFinite(ciudad.lng)) {
    const radio = Number.isFinite(usuario.radio_km) ? usuario.radio_km : 50;
    const cerca = nuevasIds
      .map((id) => porId.get(id))
      .filter((c) => c && c.ubicacion && c.fecha >= hoy && !c.estado && distanciaKm(ciudad, c.ubicacion) <= radio)
      .sort((a, b) => a.fecha.localeCompare(b.fecha));
    if (cerca.length === 1) {
      const c = cerca[0];
      avisos.push({
        clave: `nuevas:${c.id}`,
        titulo: `🆕 Nueva carrera cerca de ${ciudad.nombre}`,
        cuerpo: `${c.nombre} · ${c.municipio}`,
        url: enlace(c),
      });
    } else if (cerca.length > 1) {
      avisos.push({
        clave: `nuevas:${hoy}`,
        titulo: `🆕 ${cerca.length} carreras nuevas cerca de ${ciudad.nombre}`,
        cuerpo: cerca.slice(0, 3).map((c) => c.nombre).join(" · "),
        url: WEB,
      });
    }
  }
  return avisos;
}

// ---- FIN LÓGICA ----

Deno.serve(async (peticion) => {
  if (peticion.method !== "POST" || peticion.headers.get("x-avisos-clave") !== Deno.env.get("AVISOS_CLAVE")) {
    return new Response("No autorizado", { status: 401 });
  }

  let carreras;
  try {
    carreras = await peticion.json();
    if (!Array.isArray(carreras)) throw new Error("se esperaba una lista de carreras");
  } catch (e) {
    return new Response(`carreras.json no válido: ${e.message}`, { status: 400 });
  }

  const bd = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
  webpush.setVapidDetails("mailto:runnear.app@gmail.com", Deno.env.get("VAPID_PUBLICA"), Deno.env.get("VAPID_PRIVADA"));

  const hoy = fechaMadrid(0);
  const ayer = fechaMadrid(-1);
  const manana = fechaMadrid(1);

  // Carreras nuevas: las que no estaban en ejecuciones anteriores. La primera vez solo se
  // apuntan todas (si no, todo el calendario contaría como "nuevo").
  const { data: vistas, error: errVistas } = await bd.from("carreras_vistas").select("carrera_id");
  if (errVistas) return new Response(errVistas.message, { status: 500 });
  const conocidas = new Set(vistas.map((v) => v.carrera_id));
  const nuevasIds = conocidas.size ? carreras.map((c) => c.id).filter((id) => !conocidas.has(id)) : [];
  const porApuntar = carreras.filter((c) => !conocidas.has(c.id)).map((c) => ({ carrera_id: c.id }));
  if (porApuntar.length) await bd.from("carreras_vistas").upsert(porApuntar, { onConflict: "carrera_id", ignoreDuplicates: true });

  // Solo los usuarios con algún dispositivo suscrito
  const { data: suscripciones, error: errSus } = await bd.from("suscripciones_push").select("endpoint, user_id, p256dh, auth");
  if (errSus) return new Response(errSus.message, { status: 500 });
  const usuarios = [...new Set(suscripciones.map((s) => s.user_id))];

  const resumen = { usuarios: usuarios.length, nuevas: nuevasIds.length, enviados: 0, fallidos: 0, borradas: 0 };

  for (const uid of usuarios) {
    const [fav, corr, aj, env] = await Promise.all([
      bd.from("favoritas").select("carrera_id").eq("user_id", uid),
      bd.from("corridas").select("carrera_id").eq("user_id", uid),
      bd.from("ajustes").select("avisos, ciudad, radio_km").eq("user_id", uid).maybeSingle(),
      bd.from("avisos_enviados").select("clave").eq("user_id", uid),
    ]);
    const usuario = {
      favoritas: (fav.data || []).map((r) => r.carrera_id),
      corridas: (corr.data || []).map((r) => r.carrera_id),
      avisos: aj.data ? aj.data.avisos : null,
      ciudad: aj.data ? aj.data.ciudad : null,
      radio_km: aj.data ? aj.data.radio_km : null,
    };
    const yaEnviados = new Set((env.data || []).map((r) => r.clave));
    const avisos = calcularAvisos(usuario, carreras, nuevasIds, hoy, ayer, manana).filter((a) => !yaEnviados.has(a.clave));

    for (const aviso of avisos) {
      const carga = JSON.stringify({ titulo: aviso.titulo, cuerpo: aviso.cuerpo, url: aviso.url });
      let alguno = false;
      for (const s of suscripciones.filter((x) => x.user_id === uid)) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, carga, { TTL: 86400 });
          alguno = true;
          resumen.enviados++;
        } catch (e) {
          resumen.fallidos++;
          // 404/410: el dispositivo ya no acepta avisos (app borrada, permiso retirado...)
          if (e.statusCode === 404 || e.statusCode === 410) {
            await bd.from("suscripciones_push").delete().eq("endpoint", s.endpoint);
            resumen.borradas++;
          } else {
            console.error("Error enviando aviso:", e.statusCode, e.body || e.message);
          }
        }
      }
      if (alguno) await bd.from("avisos_enviados").upsert({ user_id: uid, clave: aviso.clave }, { onConflict: "user_id,clave" });
    }
  }

  // Limpieza: los avisos enviados hace más de 60 días ya no hacen falta
  await bd.from("avisos_enviados").delete().lt("enviado", new Date(Date.now() - 60 * 86400000).toISOString());

  return new Response(JSON.stringify(resumen), { headers: { "Content-Type": "application/json" } });
});
