-- RunNear: tablas de las cuentas de usuario (Supabase)
-- Se ejecuta una sola vez en Supabase → SQL Editor → Run.
--
-- Seguridad: Row Level Security en todas las tablas. Cada usuario solo puede leer y
-- cambiar sus propias filas (user_id = su id). Los visitantes sin sesión no ven nada.
-- Al borrar una cuenta se borran solas todas sus filas (on delete cascade).

-- Carreras marcadas como favoritas
create table if not exists public.favoritas (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  carrera_id text not null check (char_length(carrera_id) between 1 and 100),
  creada     timestamptz not null default now(),
  primary key (user_id, carrera_id)
);

-- Carreras corridas: se guarda una copia de la carrera (desaparece del calendario
-- cuando pasa) y, si el usuario lo apunta, su tiempo
create table if not exists public.corridas (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  carrera_id  text not null check (char_length(carrera_id) between 1 and 100),
  datos       jsonb not null,                    -- nombre, fecha, municipio, distancias...
  marca       jsonb,                             -- { "tiempo_seg": 2655, "distancia_km": 10 }
  guardada    date not null default current_date,
  actualizada timestamptz not null default now(),
  primary key (user_id, carrera_id),
  check (pg_column_size(datos) < 8000)
);

-- Ajustes de la web (uno por usuario)
create table if not exists public.ajustes (
  user_id     uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  tema        text check (tema in ('oscuro', 'claro')),
  radio_km    integer check (radio_km between 5 and 300),
  ciudad      jsonb,                             -- { "nombre": "Toledo", "lat": 39.86, "lng": -4.03 }
  actualizado timestamptz not null default now()
);

alter table public.favoritas enable row level security;
alter table public.corridas  enable row level security;
alter table public.ajustes   enable row level security;

-- Reglas: solo usuarios con sesión iniciada, y solo sobre sus propias filas
drop policy if exists "favoritas propias" on public.favoritas;
create policy "favoritas propias" on public.favoritas
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "corridas propias" on public.corridas;
create policy "corridas propias" on public.corridas
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "ajustes propios" on public.ajustes;
create policy "ajustes propios" on public.ajustes
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Los visitantes sin sesión no tienen ningún permiso sobre estas tablas
revoke all on public.favoritas, public.corridas, public.ajustes from anon;
grant select, insert, update, delete on public.favoritas, public.corridas, public.ajustes to authenticated;

-- "Toque" diario desde GitHub Actions para que el plan gratuito no pause el proyecto
-- por inactividad. Solo devuelve la hora: no lee ni expone ningún dato.
create or replace function public.ping()
returns timestamptz
language sql
stable
set search_path = ''
as $$ select now() $$;

revoke all on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;

-- "Borrar mi cuenta": el usuario con sesión borra su propia cuenta. Al borrarla se
-- borran solas sus favoritas, corridas y ajustes (on delete cascade).
create or replace function public.borrar_mi_cuenta()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Hay que iniciar sesión';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.borrar_mi_cuenta() from public, anon;
grant execute on function public.borrar_mi_cuenta() to authenticated;

-- ==========================================================================
-- Avisos al móvil (notificaciones push)
-- ==========================================================================

-- Qué avisos quiere cada usuario: { "recordatorio": true, "corrida": true, "nuevas": false }
alter table public.ajustes add column if not exists avisos jsonb;

-- Dispositivos que han activado los avisos (la "dirección" que da el navegador)
create table if not exists public.suscripciones_push (
  endpoint text primary key check (char_length(endpoint) between 10 and 1000),
  user_id  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  p256dh   text not null check (char_length(p256dh) < 200),
  auth     text not null check (char_length(auth) < 100),
  creada   timestamptz not null default now()
);
alter table public.suscripciones_push enable row level security;

drop policy if exists "suscripciones propias" on public.suscripciones_push;
create policy "suscripciones propias" on public.suscripciones_push
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.suscripciones_push from anon;
grant select, insert, update, delete on public.suscripciones_push to authenticated;

-- Uso interno de la función que envía los avisos (nadie más puede leerlas ni tocarlas):
-- avisos ya enviados, para no repetir, y carreras ya conocidas, para detectar las nuevas
create table if not exists public.avisos_enviados (
  user_id uuid not null references auth.users (id) on delete cascade,
  clave   text not null,
  enviado timestamptz not null default now(),
  primary key (user_id, clave)
);
create table if not exists public.carreras_vistas (
  carrera_id text primary key,
  vista      date not null default current_date
);
alter table public.avisos_enviados enable row level security;
alter table public.carreras_vistas enable row level security;
revoke all on public.avisos_enviados, public.carreras_vistas from anon, authenticated;
