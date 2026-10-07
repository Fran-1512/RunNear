/**
 * RunNear - Cuentas de usuario (Supabase)
 *
 * La URL y la clave "publishable" son públicas por diseño: lo que protege los datos son
 * las reglas de seguridad de la base de datos (supabase/esquema.sql), que solo dejan a
 * cada usuario leer y cambiar lo suyo. Nunca va aquí la clave secreta (service_role).
 *
 * La librería de Supabase (vendor/supabase, ~220 KB) no se carga al abrir la web,
 * solo cuando hace falta, para que la página siga siendo igual de rápida.
 */

const SUPABASE = {
  url: "https://fndytkkukhmijrrikjyw.supabase.co",
  clave: "sb_publishable_MKC7ayO7IWHaAqPMtzFOBw_TP0pCSdT",
  libreria: "vendor/supabase/supabase.js?v=2.117.3"
};

let promesaClienteSupabase = null;

/** Carga la librería (una sola vez) y devuelve el cliente de Supabase */
function obtenerSupabase() {
  if (!promesaClienteSupabase) {
    promesaClienteSupabase = new Promise((resolver, rechazar) => {
      const script = document.createElement("script");
      script.src = SUPABASE.libreria;
      script.onload = () => resolver(window.supabase.createClient(SUPABASE.url, SUPABASE.clave, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      }));
      script.onerror = () => {
        promesaClienteSupabase = null; // se podrá reintentar
        rechazar(new Error("No se pudo cargar la librería de Supabase"));
      };
      document.head.appendChild(script);
    });
  }
  return promesaClienteSupabase;
}

/** Comprueba que la web llega a la base de datos. Devuelve la hora del servidor. */
async function comprobarConexionSupabase() {
  const cliente = await obtenerSupabase();
  const { data, error } = await cliente.rpc("ping");
  if (error) throw new Error(error.message);
  return data;
}
