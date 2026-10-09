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

-- ==========================================================================
-- Valoraciones de carreras
-- ==========================================================================

-- "evento" agrupa todas las ediciones de una carrera (nombre sin año ni número de
-- edición + municipio), para que las opiniones de 2025 sirvan para la de 2026
create table if not exists public.valoraciones (
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  carrera_id      text not null check (char_length(carrera_id) between 1 and 100),
  evento          text not null check (char_length(evento) between 1 and 200),
  fecha           date not null check (fecha <= current_date),
  nota            smallint not null check (nota between 1 and 5),
  recorrido       smallint check (recorrido between 1 and 5),
  organizacion    smallint check (organizacion between 1 and 5),
  avituallamiento smallint check (avituallamiento between 1 and 5),
  -- Sin enlaces: frena el spam
  comentario      text check (char_length(comentario) <= 500 and comentario !~* '(https?://|www\.)'),
  autor           text not null check (char_length(autor) between 1 and 40),
  creada          timestamptz not null default now(),
  actualizada     timestamptz not null default now(),
  primary key (user_id, carrera_id)
);
create index if not exists valoraciones_evento on public.valoraciones (evento);
alter table public.valoraciones enable row level security;

-- Todo el mundo puede leerlas; solo quien ha marcado la carrera como corrida puede
-- valorarla, y cada uno solo cambia o borra la suya
drop policy if exists "leer valoraciones" on public.valoraciones;
create policy "leer valoraciones" on public.valoraciones
  for select to anon, authenticated using (true);

drop policy if exists "valorar si la has corrido" on public.valoraciones;
create policy "valorar si la has corrido" on public.valoraciones
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.corridas c where c.user_id = (select auth.uid()) and c.carrera_id = valoraciones.carrera_id)
  );

drop policy if exists "cambiar la propia" on public.valoraciones;
create policy "cambiar la propia" on public.valoraciones
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "borrar la propia" on public.valoraciones;
create policy "borrar la propia" on public.valoraciones
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Los visitantes sin cuenta no ven quién (qué cuenta) ha escrito cada opinión
revoke all on public.valoraciones from anon;
grant select (carrera_id, evento, fecha, nota, recorrido, organizacion, avituallamiento, comentario, autor, creada)
  on public.valoraciones to anon;
grant select, insert, update, delete on public.valoraciones to authenticated;

-- Resumen por carrera: nota media y número de opiniones
create or replace view public.valoraciones_resumen with (security_invoker = true) as
  select evento,
         round(avg(nota), 1)            as media,
         count(*)                       as opiniones,
         round(avg(recorrido), 1)       as recorrido,
         round(avg(organizacion), 1)    as organizacion,
         round(avg(avituallamiento), 1) as avituallamiento
  from public.valoraciones
  group by evento;
grant select on public.valoraciones_resumen to anon, authenticated;

-- Denuncias de comentarios (las revisa el administrador en Supabase → Table Editor)
create table if not exists public.denuncias (
  id           bigint generated always as identity primary key,
  denunciante  uuid default auth.uid() references auth.users (id) on delete set null,
  autor_id     uuid not null,
  carrera_id   text not null,
  comentario   text,
  creada       timestamptz not null default now(),
  unique (denunciante, autor_id, carrera_id)
);
alter table public.denuncias enable row level security;
drop policy if exists "denunciar" on public.denuncias;
create policy "denunciar" on public.denuncias
  for insert to authenticated
  with check ((select auth.uid()) = denunciante);
revoke all on public.denuncias from anon;
grant insert on public.denuncias to authenticated;
grant usage on sequence public.denuncias_id_seq to authenticated;
