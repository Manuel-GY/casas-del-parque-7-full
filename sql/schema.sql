-- ============================================================
-- Casas del Parque 7 — Esquema de base de datos (Supabase) v2
-- ============================================================
--
-- Este archivo contiene TODO lo necesario para configurar el
-- backend de la plataforma desde CERO. Ejecutalo completo en el
-- SQL Editor de Supabase Dashboard.
--
-- Es IDEMPOTENTE: puedes ejecutarlo las veces que quieras sin
-- romper datos existentes (create if not exists + add column if
-- not exists + drop policy if exists).
--
-- Novedades de la v2:
--   - 146 casas (antes 142)
--   - Cupo de 2 vecinos/casa ahora ATOMICO via advisory lock
--   - Límite anti-spam de registros por correo (10/hora)
--   - Registro abierto: cualquiera con el link se puede registrar
--   - Avisos dentro de la app (campana de novedades)
--   - Fotos adjuntas en reportes y sugerencias (bucket privado)
--   - Archivar (soft delete) y borrar definitivo (solo admin)
--   - updated_at en reclamos/sugerencias
--
-- Arquitectura de seguridad:
--   - Row Level Security (RLS) habilitado en todas las tablas
--   - Funciones SECURITY DEFINER para evitar recursión en RLS
--   - Vecinos solo ven sus propios datos (creado_por = auth.uid())
--   - Comité/Admin acceden via funciones RPC que validan el rol
--
-- Cómo usar: Supabase Dashboard > SQL Editor > New query > Run
-- ============================================================

-- Extensión para generación de UUIDs
create extension if not exists "pgcrypto";

-- ============================================================
-- 0) TABLA ANTI-SPAM DE REGISTRO
-- ============================================================
-- Registra cada intento de registro por correo. Un disparador en
-- auth.users la usa para limitar a 10 intentos por hora por correo.
-- El registro sigue siendo ABIERTO (cualquiera con el link puede
-- registrarse); esto solo frena fuerza-bruta y spam automatizado.
-- ============================================================
create table if not exists public.intentos_registro (
  email     text not null,
  creado_en timestamptz not null default now()
);

create index if not exists intentos_registro_email_idx
  on public.intentos_registro (email, creado_en);

-- ============================================================
-- 1) CASAS (146)
-- ============================================================
create table if not exists public.casas (
  numero integer primary key
);

-- Poblar con las 146 casas (idempotente)
insert into public.casas (numero)
select gs from generate_series(1, 146) gs
on conflict (numero) do nothing;

-- ============================================================
-- 2) PERFILES
-- ============================================================
create table if not exists public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  nombre            text not null check (length(nombre) between 1 and 120),
  numero_casa       integer references public.casas(numero),
  rol               text not null default 'vecino'
                    check (rol in ('vecino','comite','admin')),
  debe_cambiar_pass boolean not null default false,
  ultimo_acceso     timestamptz,
  created_at        timestamptz not null default now()
);

-- Compatibilidad con esquemas previos (idempotente)
alter table public.profiles add column if not exists debe_cambiar_pass boolean not null default false;
alter table public.profiles add column if not exists ultimo_acceso timestamptz;

-- ============================================================
-- 3) RECLAMOS (reportes del condominio)
-- ============================================================
create table if not exists public.reclamos (
  id            uuid primary key default gen_random_uuid(),
  creado_por    uuid references public.profiles(id) on delete set null,
  numero_casa   integer not null references public.casas(numero),
  categoria     text not null
                check (categoria in ('seguridad','instalaciones','plazas','calles','luminarias','aseo','estacionamientos','otro')),
  severidad     text
                check (severidad is null or severidad in ('baja','media','alta')),
  titulo        text not null check (length(titulo) between 3 and 200),
  descripcion   text not null check (length(descripcion) between 10 and 2000),
  estado        text not null default 'nuevo'
                check (estado in ('nuevo','en_revision','resuelto')),
  respuesta     text,
  atendido_por  uuid references public.profiles(id) on delete set null,
  resuelto_en   timestamptz,
  fotos         text[] not null default '{}',
  updated_at    timestamptz not null default now(),
  eliminado     boolean not null default false,
  eliminado_en  timestamptz,
  eliminado_por uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

-- Índices para filtrado y ordenamiento frecuente
create index if not exists reclamos_estado_idx on public.reclamos(estado);
create index if not exists reclamos_casa_idx  on public.reclamos(numero_casa);
create index if not exists reclamos_fecha_idx on public.reclamos(created_at);
create index if not exists reclamos_creado_idx on public.reclamos(creado_por);

-- Compatibilidad con esquemas previos (idempotente)
alter table public.reclamos add column if not exists fotos text[] not null default '{}';
alter table public.reclamos add column if not exists updated_at timestamptz not null default now();
alter table public.reclamos add column if not exists eliminado boolean not null default false;
alter table public.reclamos add column if not exists eliminado_en timestamptz;
alter table public.reclamos add column if not exists eliminado_por uuid;

-- ============================================================
-- 4) SUGERENCIAS
-- ============================================================
create table if not exists public.sugerencias (
  id          uuid primary key default gen_random_uuid(),
  creado_por  uuid references public.profiles(id) on delete set null,
  numero_casa integer not null references public.casas(numero),
  titulo      text not null check (length(titulo) between 3 and 200),
  descripcion text not null check (length(descripcion) between 10 and 2000),
  estado      text not null default 'nueva'
              check (estado in ('nueva','en_revision','resuelta')),
  respuesta   text,
  atendido_por uuid references public.profiles(id) on delete set null,
  fotos       text[] not null default '{}',
  updated_at  timestamptz not null default now(),
  eliminado   boolean not null default false,
  eliminado_en timestamptz,
  eliminado_por uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists sugerencias_casa_idx on public.sugerencias(numero_casa);
create index if not exists sugerencias_fecha_idx on public.sugerencias(created_at);
create index if not exists sugerencias_creado_idx on public.sugerencias(creado_por);

alter table public.sugerencias add column if not exists fotos text[] not null default '{}';
alter table public.sugerencias add column if not exists updated_at timestamptz not null default now();
alter table public.sugerencias add column if not exists eliminado boolean not null default false;
alter table public.sugerencias add column if not exists eliminado_en timestamptz;
alter table public.sugerencias add column if not exists eliminado_por uuid;

-- ============================================================
-- 5) FUNCIONES DE AYUDA (evitan recursión en RLS)
-- ============================================================
create or replace function public.mi_rol()
returns text
language sql stable security definer
set search_path = public
as $$
  select rol from public.profiles where id = auth.uid()
$$;

create or replace function public.mi_casa()
returns integer
language sql stable security definer
set search_path = public
as $$
  select numero_casa from public.profiles where id = auth.uid()
$$;

-- ============================================================
-- 6) REGISTRO DE PERFILES (con cupo de 2/casa ATOMICO)
-- ============================================================
create or replace function public.registrar_perfil(
  p_nombre text,
  p_casa   integer,
  p_rol    text default 'vecino'
)
returns public.profiles
language plpgsql security definer
set search_path = public
as $$
declare
  v_cuenta integer;
  v_perfil public.profiles;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión.';
  end if;

  if exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'Este usuario ya tiene un perfil registrado.';
  end if;

  if p_rol not in ('vecino','comite','admin') then
    raise exception 'Rol inválido.';
  end if;

  -- Comité/Admin: solo si lo solicita un admin existente
  if p_rol <> 'vecino' then
    if coalesce(public.mi_rol(),'') <> 'admin' then
      raise exception 'Solo la administración puede crear cuentas de comité/admin.';
    end if;

    insert into public.profiles (id, nombre, numero_casa, rol)
    values (auth.uid(), p_nombre, null, p_rol)
    returning * into v_perfil;

    return v_perfil;
  end if;

  -- Vecino: debe indicar casa
  if p_casa is null then
    raise exception 'Los vecinos deben indicar su número de casa.';
  end if;

  if not exists (select 1 from public.casas where numero = p_casa) then
    raise exception 'La casa % no existe.', p_casa;
  end if;

  -- CUPO ATÓMICO: bloqueo de asesoramiento a nivel de transacción.
  -- Serializa los registros simultáneos para la MISMA casa, evitando
  -- que dos peticiones concurrentes pasen el conteo a la vez.
  perform pg_advisory_xact_lock(hashtext('public.profiles:cupo'), p_casa);

  select count(*) into v_cuenta
  from public.profiles
  where numero_casa = p_casa and rol = 'vecino';
  if v_cuenta >= 2 then
    raise exception 'La casa % ya tiene sus 2 vecinos registrados.', p_casa;
  end if;

  insert into public.profiles (id, nombre, numero_casa, rol, ultimo_acceso)
  values (auth.uid(), p_nombre, p_casa, p_rol, now())
  returning * into v_perfil;

  return v_perfil;
end;
$$;

-- ============================================================
-- 7) ASIGNACIÓN DE ROLES (solo admin)
-- ============================================================
create or replace function public.asignar_rol(
  p_usuario uuid,
  p_rol     text
)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if coalesce(public.mi_rol(),'') <> 'admin' then
    raise exception 'Solo un administrador puede asignar roles.';
  end if;

  if p_rol not in ('vecino','comite','admin') then
    raise exception 'Rol inválido.';
  end if;

  update public.profiles set rol = p_rol where id = p_usuario;
  if not found then
    raise exception 'Usuario no encontrado.';
  end if;
end;
$$;

-- Marca el flag debe_cambiar_pass como false tras cambio exitoso
create or replace function public.marcar_clave_cambiada()
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  update public.profiles set debe_cambiar_pass = false where id = auth.uid();
end;
$$;

-- ============================================================
-- 8) AVISOS DENTRO DE LA APP (campana de novedades)
-- ============================================================
-- Novedades = reportes/sugerencias del propio usuario que fueron
-- MODIFICADOS después de su creación (respuesta o cambio de estado)
-- y después del último acceso registrado.
-- ============================================================
create or replace function public.mis_novedades(p_desde timestamptz default null)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_desde timestamptz := coalesce(p_desde, now() - interval '365 days');
  v_json  jsonb;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión.';
  end if;

  select jsonb_build_object(
    'contador', (
      select count(*)::int from (
        select id from public.reclamos
          where creado_por = auth.uid() and not eliminado
            and updated_at > v_desde and updated_at > created_at
        union all
        select id from public.sugerencias
          where creado_por = auth.uid() and not eliminado
            and updated_at > v_desde and updated_at > created_at
      ) t
    ),
    'novedades', coalesce((
      select jsonb_agg(it) from (
        select it, ts from (
          select jsonb_build_object(
            'tipo','reclamo',
            'id', r.id,
            'titulo', r.titulo,
            'descripcion', r.descripcion,
            'categoria', r.categoria,
            'estado', r.estado,
            'respuesta', r.respuesta,
            'fotos', coalesce(r.fotos, '{}'::text[]),
            'created_at', r.created_at,
            'updated_at', r.updated_at
          ) it, r.updated_at as ts
          from public.reclamos r
          where r.creado_por = auth.uid() and not r.eliminado
            and r.updated_at > v_desde and r.updated_at > r.created_at

          union all

          select jsonb_build_object(
            'tipo','sugerencia',
            'id', s.id,
            'titulo', s.titulo,
            'descripcion', s.descripcion,
            'categoria', null,
            'estado', s.estado,
            'respuesta', s.respuesta,
            'fotos', coalesce(s.fotos, '{}'::text[]),
            'created_at', s.created_at,
            'updated_at', s.updated_at
          ), s.updated_at
          from public.sugerencias s
          where s.creado_por = auth.uid() and not s.eliminado
            and s.updated_at > v_desde and s.updated_at > s.created_at
        ) u
        order by ts desc
        limit 30
      ) agg
    ), '[]'::jsonb)
  ) into v_json;

  return v_json;
end;
$$;

-- Marca el último acceso del usuario (llamada al abrir la app)
create or replace function public.marcar_acceso()
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  update public.profiles set ultimo_acceso = now() where id = auth.uid();
end;
$$;

-- ============================================================
-- 9) DETALLE DE RECLAMOS (solo comité/admin)
-- ============================================================
-- Al re-ejecutar, se elimina la versión previa para permitir cambiar el
-- tipo de retorno (evita el error 42P13 "cannot change return type").
drop function if exists public.reclamos_detalle();
create or replace function public.reclamos_detalle()
returns table (
  id              uuid,
  titulo          text,
  descripcion     text,
  categoria       text,
  severidad       text,
  estado          text,
  respuesta       text,
  nombre          text,
  numero_casa     integer,
  atendido_nombre text,
  fotos           text[],
  created_at      timestamptz,
  updated_at      timestamptz,
  resuelto_en     timestamptz
)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if coalesce(public.mi_rol(),'') not in ('comite','admin') then
    raise exception 'Sin permisos para ver el detalle de reclamos.';
  end if;

  return query
    select r.id, r.titulo, r.descripcion, r.categoria, r.severidad,
           r.estado, r.respuesta,
           p.nombre, r.numero_casa,
           pa.nombre as atendido_nombre,
           coalesce(r.fotos, '{}'::text[]),
           r.created_at, r.updated_at, r.resuelto_en
    from public.reclamos r
    left join public.profiles p  on p.id  = r.creado_por
    left join public.profiles pa on pa.id = r.atendido_por
    where not r.eliminado
    order by r.created_at desc;
end;
$$;

-- ============================================================
-- 10) RESPONDER / CAMBIAR ESTADO (solo comité/admin)
-- ============================================================
create or replace function public.responder_reclamo(
  p_id        uuid,
  p_estado    text,
  p_respuesta text default null
)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if coalesce(public.mi_rol(),'') not in ('comite','admin') then
    raise exception 'Sin permisos.';
  end if;

  if p_estado not in ('nuevo','en_revision','resuelto') then
    raise exception 'Estado inválido.';
  end if;

  update public.reclamos
  set estado      = p_estado,
      respuesta   = coalesce(p_respuesta, respuesta),
      atendido_por = auth.uid(),
      resuelto_en = case when p_estado = 'resuelto' then now() else resuelto_en end,
      fotos       = case when p_estado = 'resuelto' then '{}'::text[] else fotos end,
      updated_at  = now()
  where id = p_id;

  if not found then
    raise exception 'Reclamo no encontrado.';
  end if;
end;
$$;

create or replace function public.responder_sugerencia(
  p_id        uuid,
  p_estado    text,
  p_respuesta text default null
)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if coalesce(public.mi_rol(),'') not in ('comite','admin') then
    raise exception 'Sin permisos.';
  end if;

  if p_estado not in ('nueva','en_revision','resuelta') then
    raise exception 'Estado inválido.';
  end if;

  update public.sugerencias
  set estado       = p_estado,
      respuesta    = coalesce(p_respuesta, respuesta),
      atendido_por = auth.uid(),
      fotos        = case when p_estado = 'resuelta' then '{}'::text[] else fotos end,
      updated_at   = now()
  where id = p_id;

  if not found then
    raise exception 'Sugerencia no encontrada.';
  end if;
end;
$$;

-- ============================================================
-- 11) ARCHIVAR (soft delete) y BORRAR DEFINITIVO
-- ============================================================
-- Archivar: comité/admin. Borrar definitivo: solo admin.
-- ============================================================
create or replace function public.archivar_reclamo(
  p_id       uuid,
  p_archivar boolean default true
)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if coalesce(public.mi_rol(),'') not in ('comite','admin') then
    raise exception 'Sin permisos.';
  end if;

  update public.reclamos
  set eliminado     = p_archivar,
      eliminado_en  = case when p_archivar then now() else null end,
      eliminado_por = case when p_archivar then auth.uid() else null end,
      updated_at    = now()
  where id = p_id;

  if not found then
    raise exception 'Reclamo no encontrado.';
  end if;
end;
$$;

create or replace function public.archivar_sugerencia(
  p_id       uuid,
  p_archivar boolean default true
)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if coalesce(public.mi_rol(),'') not in ('comite','admin') then
    raise exception 'Sin permisos.';
  end if;

  update public.sugerencias
  set eliminado     = p_archivar,
      eliminado_en  = case when p_archivar then now() else null end,
      eliminado_por = case when p_archivar then auth.uid() else null end,
      updated_at    = now()
  where id = p_id;

  if not found then
    raise exception 'Sugerencia no encontrada.';
  end if;
end;
$$;

create or replace function public.borrar_reclamo(p_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if coalesce(public.mi_rol(),'') <> 'admin' then
    raise exception 'Solo un administrador puede borrar reportes.';
  end if;

  delete from public.reclamos where id = p_id;
  if not found then
    raise exception 'Reclamo no encontrado.';
  end if;
end;
$$;

create or replace function public.borrar_sugerencia(p_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if coalesce(public.mi_rol(),'') <> 'admin' then
    raise exception 'Solo un administrador puede borrar sugerencias.';
  end if;

  delete from public.sugerencias where id = p_id;
  if not found then
    raise exception 'Sugerencia no encontrada.';
  end if;
end;
$$;

-- ============================================================
-- 12) DETALLE DE SUGERENCIAS (solo comité/admin)
-- ============================================================
drop function if exists public.sugerencias_detalle();
create or replace function public.sugerencias_detalle()
returns table (
  id              uuid,
  titulo          text,
  descripcion     text,
  estado          text,
  respuesta       text,
  nombre          text,
  numero_casa     integer,
  atendido_nombre text,
  fotos           text[],
  created_at      timestamptz,
  updated_at      timestamptz
)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if coalesce(public.mi_rol(),'') not in ('comite','admin') then
    raise exception 'Sin permisos para ver el detalle de sugerencias.';
  end if;

  return query
    select s.id, s.titulo, s.descripcion, s.estado, s.respuesta,
           p.nombre, s.numero_casa,
           pa.nombre as atendido_nombre,
           coalesce(s.fotos, '{}'::text[]),
           s.created_at, s.updated_at
    from public.sugerencias s
    left join public.profiles p  on p.id  = s.creado_por
    left join public.profiles pa on pa.id = s.atendido_por
    where not s.eliminado
    order by s.created_at desc;
end;
$$;

-- ============================================================
-- 13) ESTADÍSTICAS AGREGADAS (excluye eliminados)
-- ============================================================
create or replace function public.estadisticas()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_json jsonb;
begin
  select jsonb_build_object(
    'total', (select count(*)::int from public.reclamos where not eliminado),
    'por_estado', (
      select coalesce(jsonb_object_agg(estado, n order by
        case estado when 'nuevo' then 1 when 'en_revision' then 2 when 'resuelto' then 3 else 4 end),
        '{}'::jsonb)
      from (select estado, count(*)::int as n from public.reclamos where not eliminado group by estado) t
    ),
    'por_categoria', (
      select coalesce(jsonb_object_agg(categoria, n), '{}'::jsonb)
      from (select categoria, count(*)::int as n from public.reclamos where not eliminado group by categoria) t
    ),
    'por_severidad', (
      select coalesce(jsonb_object_agg(coalesce(severidad, 'sin_especificar'), n), '{}'::jsonb)
      from (select severidad, count(*)::int as n from public.reclamos where not eliminado group by severidad) t
    ),
    'por_mes', (
      select coalesce(jsonb_agg(
        jsonb_build_object('mes', to_char(m, 'YYYY-MM'), 'cantidad', n) order by m), '[]'::jsonb)
      from (
        select date_trunc('month', created_at)::date as m, count(*)::int as n
        from public.reclamos where not eliminado group by 1
      ) t
    ),
    'por_casa', (
      select coalesce(jsonb_agg(
        jsonb_build_object('casa', numero_casa, 'cantidad', n) order by numero_casa), '[]'::jsonb)
      from (
        select numero_casa, count(*)::int as n
        from public.reclamos where not eliminado group by numero_casa
      ) t
    ),
    'sug_total', (select count(*)::int from public.sugerencias where not eliminado),
    'sug_por_estado', (
      select coalesce(jsonb_object_agg(estado, n), '{}'::jsonb)
      from (select estado, count(*)::int as n from public.sugerencias where not eliminado group by estado) t
    ),
    'sug_por_mes', (
      select coalesce(jsonb_agg(
        jsonb_build_object('mes', to_char(m, 'YYYY-MM'), 'cantidad', n) order by m), '[]'::jsonb)
      from (
        select date_trunc('month', created_at)::date as m, count(*)::int as n
        from public.sugerencias where not eliminado group by 1
      ) t
    )
  ) into v_json;

  return v_json;
end;
$$;

-- ============================================================
-- 14) LÍMITE ANTI-SPAM EN EL REGISTRO (auth.users)
-- ============================================================
-- Máximo 10 intentos de registro por hora y por correo.
-- El registro sigue abierto; esto solo frena abuso automatizado.
--
-- NOTA: crear objetos en el schema auth exige permisos elevados.
-- Si el rol del SQL Editor no los tiene (ERROR 42501), este bloque lo
-- omite con un aviso y el resto del script continúa (el trigger ya
-- existente de un despliegue anterior se conserva igual). Si la
-- ejecución la haces con el rol `postgres`, se crea normalmente.
do $bloquea_auth$
begin
  create or replace function auth.restringir_registro()
  returns trigger
  language plpgsql volatile
  set search_path = public, auth
  as $$
  declare
    v_intentos integer;
  begin
    delete from public.intentos_registro where creado_en < now() - interval '1 hour';

    select count(*) into v_intentos
    from public.intentos_registro
    where email = lower(new.email);

    if v_intentos >= 10 then
      raise exception 'Demasiados intentos de registro con este correo. Espera una hora e inténtalo de nuevo.';
    end if;

    insert into public.intentos_registro (email, creado_en)
    values (lower(new.email), now());

    return new;
  end;
  $$;

  drop trigger if exists "restringir_registro_trg" on auth.users;
  create trigger "restringir_registro_trg"
    before insert on auth.users
    for each row execute function auth.restringir_registro();
exception
  when insufficient_privilege then
    raise notice 'Omitido: sin permiso en schema auth (42501). El límite anti-spam de registro no se creó/actualizó.';
end;
$bloquea_auth$;

-- ============================================================
-- 15) ROW LEVEL SECURITY (RLS)
-- ============================================================
alter table public.casas             enable row level security;
alter table public.profiles          enable row level security;
alter table public.reclamos          enable row level security;
alter table public.sugerencias       enable row level security;
alter table public.intentos_registro enable row level security;

-- CASAS: lectura libre para todos los autenticados
drop policy if exists "casas_lectura" on public.casas;
create policy "casas_lectura" on public.casas
  for select using (true);

-- PROFILES: cada usuario solo ve su propio perfil
drop policy if exists "profiles_mi_miembro" on public.profiles;
create policy "profiles_mi_miembro" on public.profiles
  for select using (auth.uid() = id);

-- PROFILES: comité/admin pueden ver todos los perfiles
drop policy if exists "profiles_comite_admin" on public.profiles;
create policy "profiles_comite_admin" on public.profiles
  for select using (coalesce(public.mi_rol(),'') in ('comite','admin'));

-- INTENTOS_REGISTRO: nadie puede leer ni escribir directamente
-- (solo la función SECURITY DEFINER auth.restringir_registro).
drop policy if exists "intentos_registro_cerrado" on public.intentos_registro;
create policy "intentos_registro_cerrado" on public.intentos_registro
  for select using (false);

-- RECLAMOS INSERT: vecino crea reclamos solo a su nombre y casa
drop policy if exists "reclamos_insert" on public.reclamos;
create policy "reclamos_insert" on public.reclamos
  for insert to authenticated
  with check (
    exists (select 1 from public.profiles where id = auth.uid())
    and creado_por = auth.uid()
    and numero_casa = public.mi_casa()
    and estado = 'nuevo'
    and respuesta is null
  );

-- RECLAMOS SELECT (vecino): solo ve sus propios reclamos
drop policy if exists "reclamos_select_mios" on public.reclamos;
create policy "reclamos_select_mios" on public.reclamos
  for select to authenticated
  using (creado_por = auth.uid());

-- RECLAMOS SELECT (comité/admin): ven todos via la función RPC
drop policy if exists "reclamos_select_comite" on public.reclamos;
create policy "reclamos_select_comite" on public.reclamos
  for select to authenticated
  using (coalesce(public.mi_rol(),'') in ('comite','admin'));

-- SUGERENCIAS INSERT: vecino crea sugerencias solo a su nombre y casa
drop policy if exists "sugerencias_insert" on public.sugerencias;
create policy "sugerencias_insert" on public.sugerencias
  for insert to authenticated
  with check (
    exists (select 1 from public.profiles where id = auth.uid())
    and creado_por = auth.uid()
    and numero_casa = public.mi_casa()
    and estado = 'nueva'
    and respuesta is null
  );

-- SUGERENCIAS SELECT (vecino): solo ve sus propias sugerencias
drop policy if exists "sugerencias_select_mias" on public.sugerencias;
create policy "sugerencias_select_mias" on public.sugerencias
  for select to authenticated
  using (creado_por = auth.uid());

-- SUGERENCIAS SELECT (comité/admin): ven todas via la función RPC
drop policy if exists "sugerencias_select_comite" on public.sugerencias;
create policy "sugerencias_select_comite" on public.sugerencias
  for select to authenticated
  using (coalesce(public.mi_rol(),'') in ('comite','admin'));

-- ============================================================
-- 16) STORAGE — BUCKET PRIVADO "reportes" (fotos adjuntas)
-- ============================================================
-- Cada foto se sube a:  reportes/{user_id}/{uuid}.jpg
-- Vecino: sube y lee SOLO en su propia carpeta.
-- Comité/Admin: leen todo (para revisar los reportes).
-- ============================================================
insert into storage.buckets (id, name, public)
values ('reportes', 'reportes', false)
on conflict (id) do nothing;

drop policy if exists "reportes_upload_owner" on storage.objects;
create policy "reportes_upload_owner" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'reportes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "reportes_lectura_owner" on storage.objects;
create policy "reportes_lectura_owner" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'reportes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "reportes_lectura_comite" on storage.objects;
create policy "reportes_lectura_comite" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'reportes'
    and coalesce(public.mi_rol(),'') in ('comite','admin')
  );

drop policy if exists "reportes_delete_owner" on storage.objects;
create policy "reportes_delete_owner" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'reportes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "reportes_delete_comite" on storage.objects;
create policy "reportes_delete_comite" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'reportes'
    and coalesce(public.mi_rol(),'') in ('comite','admin')
  );

-- ============================================================
-- 17) PRIMER ADMINISTRADOR
-- ============================================================
-- Ejecutar en el SQL Editor después de crear la primera cuenta
-- como vecino desde la interfaz web:
--
-- update public.profiles set rol = 'admin'
-- where id = (select id from auth.users where email = 'tu_correo@ejemplo.cl');