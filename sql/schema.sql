-- ============================================================
-- Casas del Parque 7 — Esquema de base de datos (Supabase)
-- ============================================================
--
-- Este archivo contiene TODO lo necesario para configurar el
-- backend de la plataforma. Ejecutalo completo en el SQL Editor
-- de Supabase Dashboard.
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
-- 1) CASAS (142)
-- ============================================================
-- Tabla de referencia para los 142 números de casa del condominio.
-- Se usa como FK en profiles, reclamos y sugerencias.
-- ============================================================
create table if not exists public.casas (
  numero integer primary key
);

-- Poblar con las 142 casas (idempotente: no duplica si ya existen)
insert into public.casas (numero)
select gs from generate_series(1, 142) gs
on conflict (numero) do nothing;

-- ============================================================
-- 2) PERFILES
-- ============================================================
-- Cada usuario de Supabase Auth tiene UN perfil en esta tabla.
--   - Vecinos: tienen numero_casa (max 2 por casa)
--   - Comité/Admin: numero_casa = null
--   - debe_cambiar_pass: flag para forzar cambio de contraseña
-- ============================================================
create table if not exists public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  nombre            text not null check (length(nombre) between 1 and 120),
  numero_casa       integer references public.casas(numero),
  rol               text not null default 'vecino'
                    check (rol in ('vecino','comite','admin')),
  debe_cambiar_pass boolean not null default false,
  created_at        timestamptz not null default now()
);

-- Compatibilidad con esquemas previos: agrega la columna si falta
alter table public.profiles add column if not exists debe_cambiar_pass boolean not null default false;

-- ============================================================
-- 3) RECLAMOS (reportes del condominio)
-- ============================================================
-- Tabla principal de reportes de vecinos sobre cualquier tema
-- del condominio: seguridad, instalaciones, plazas, calles,
-- luminarias, aseo, estacionamientos, etc.
-- Restricciones CHECK garantizan la integridad de datos a nivel DB.
-- Índices para optimizar las consultas más frecuentes.
-- ============================================================
create table if not exists public.reclamos (
  id          uuid primary key default gen_random_uuid(),
  creado_por  uuid references public.profiles(id) on delete set null,
  numero_casa integer not null references public.casas(numero),
  categoria   text not null
              check (categoria in ('seguridad','instalaciones','plazas','calles','luminarias','aseo','estacionamientos','otro')),
  severidad   text
              check (severidad is null or severidad in ('baja','media','alta')),
  titulo      text not null check (length(titulo) between 3 and 200),
  descripcion text not null check (length(descripcion) between 10 and 2000),
  estado      text not null default 'nuevo'
              check (estado in ('nuevo','en_revision','resuelto')),
  respuesta   text,
  atendido_por uuid references public.profiles(id) on delete set null,
  resuelto_en timestamptz,
  created_at  timestamptz not null default now()
);

-- Índices para filtrado y ordenamiento frecuente
create index if not exists reclamos_estado_idx on public.reclamos(estado);
create index if not exists reclamos_casa_idx  on public.reclamos(numero_casa);
create index if not exists reclamos_fecha_idx on public.reclamos(created_at);

-- ============================================================
-- 3bis) MIGRACIÓN DE CATEGORÍAS (versión completa)
-- ============================================================
-- La plataforma dejó de ser solo sobre guardias y ahora cubre
-- todo el condominio. Esta migración:
--   1) Convierte las categorías antiguas a las nuevas
--   2) Actualiza el CHECK para aceptar las nuevas categorías
--
-- Se conservan los valores antiguos en el CHECK temporalmente
-- para no romper el despliegue en producción mientras migra.
-- ============================================================

-- Paso 1: eliminar el CHECK de categorías antiguo (permite migrar)
alter table public.reclamos drop constraint if exists reclamos_categoria_check;

-- Paso 2: reubicar reportes antiguos de guardias en 'seguridad'
update public.reclamos
   set categoria = 'seguridad'
 where categoria in ('acceso','comportamiento','turnos');

-- Paso 3: ampliar el CHECK con las nuevas categorías
-- (mantiene valores antiguos como compatibilidad con producción)
alter table public.reclamos add constraint reclamos_categoria_check
  check (categoria in ('seguridad','instalaciones','plazas','calles','luminarias','aseo','estacionamientos','otro',
                       'acceso','comportamiento','turnos'));

-- Paso 4: severidad pasa a ser OPCIONAL (la versión completa no la usa).
--   - Se quita el NOT NULL y el default para que los nuevos reportes
--     puedan omitirla. Producción (versión antigua) sigue enviándola.
--   - El CHECK permite NULL o los valores válidos.
alter table public.reclamos alter column severidad drop not null;
alter table public.reclamos alter column severidad drop default;
alter table public.reclamos drop constraint if exists reclamos_severidad_check;
alter table public.reclamos add constraint reclamos_severidad_check
  check (severidad is null or severidad in ('baja','media','alta'));

-- ============================================================
-- 4) FUNCIONES DE AYUDA (evitan recursión en RLS)
-- ============================================================
-- Estas funciones SECURITY DEFINER permiten consultar datos
-- del usuario actual sin entrar en recursión con las políticas RLS.
-- Se usan como base en las políticas de inserción/select.
-- ============================================================

-- Retorna el rol del usuario actual ('vecino', 'comite', 'admin')
create or replace function public.mi_rol()
returns text
language sql stable security definer
set search_path = public
as $$
  select rol from public.profiles where id = auth.uid()
$$;

-- Retorna el número de casa del usuario actual
create or replace function public.mi_casa()
returns integer
language sql stable security definer
set search_path = public
as $$
  select numero_casa from public.profiles where id = auth.uid()
$$;

-- ============================================================
-- 5) REGISTRO DE PERFILES
-- ============================================================
-- SECURITY DEFINER: es la ÚNICA puerta para crear perfiles.
-- El INSERT directo está bloqueado por RLS.
--
-- Validaciones en la base de datos (no solo en frontend):
--   - Vecino: exige número de casa y respeta cupo de 2 por casa
--   - Comité/Administración: sin casa, solo si lo pide un admin
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
  -- Verificar que haya sesión activa
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión.';
  end if;

  -- Evitar perfiles duplicados
  if exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'Este usuario ya tiene un perfil registrado.';
  end if;

  -- Validar el rol
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

  -- Verificar que la casa exista
  if not exists (select 1 from public.casas where numero = p_casa) then
    raise exception 'La casa % no existe.', p_casa;
  end if;

  -- Cupo de 2 vecinos por casa (comité/admin no cuentan)
  select count(*) into v_cuenta
  from public.profiles
  where numero_casa = p_casa and rol = 'vecino';
  if v_cuenta >= 2 then
    raise exception 'La casa % ya tiene sus 2 vecinos registrados.', p_casa;
  end if;

  insert into public.profiles (id, nombre, numero_casa, rol)
  values (auth.uid(), p_nombre, p_casa, p_rol)
  returning * into v_perfil;

  return v_perfil;
end;
$$;

-- ============================================================
-- 6) ASIGNACIÓN DE ROLES (solo admin)
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
  -- Solo admin puede cambiar roles
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
-- 7) DETALLE DE RECLAMOS (solo comité/admin)
-- ============================================================
-- Función RPC que retorna todos los reclamos con los nombres
-- del creador y del que respondió. Solo accesible por comité/admin.
-- ============================================================
create or replace function public.reclamos_detalle()
returns table (
  id             uuid,
  titulo         text,
  descripcion    text,
  categoria      text,
  severidad      text,
  estado         text,
  respuesta      text,
  nombre         text,
  numero_casa    integer,
  atendido_nombre text,
  created_at     timestamptz,
  resuelto_en    timestamptz
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
           r.created_at, r.resuelto_en
    from public.reclamos r
    left join public.profiles p  on p.id  = r.creado_por
    left join public.profiles pa on pa.id = r.atendido_por
    order by r.created_at desc;
end;
$$;

-- ============================================================
-- 8) RESPONDER / CAMBIAR ESTADO (solo comité/admin)
-- ============================================================
-- Función para actualizar estado y respuesta de un reclamo.
-- Registra automáticamente quién atendió y cuándo se resolvió.
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
      resuelto_en = case when p_estado = 'resuelto' then now() else resuelto_en end
  where id = p_id;

  if not found then
    raise exception 'Reclamo no encontrado.';
  end if;
end;
$$;

-- ============================================================
-- 9) ESTADÍSTICAS AGREGADAS
-- ============================================================
-- Función que retorna JSONB con todas las métricas agregadas:
--   - Total de reclamos y sugerencias
--   - Por estado, categoría, severidad, mes
--   - Por casa (para ranking)
--
-- Solo retorna conteos, sin detalles individuales.
-- Accesible por todos los usuarios autenticados.
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
    -- Reclamos: totales y desglose
    'total', (select count(*)::int from public.reclamos),
    'por_estado', (
      select coalesce(jsonb_object_agg(estado, n order by
        case estado when 'nuevo' then 1 when 'en_revision' then 2 when 'resuelto' then 3 else 4 end),
        '{}'::jsonb)
      from (select estado, count(*)::int as n from public.reclamos group by estado) t
    ),
    'por_categoria', (
      select coalesce(jsonb_object_agg(categoria, n), '{}'::jsonb)
      from (select categoria, count(*)::int as n from public.reclamos group by categoria) t
    ),
    'por_severidad', (
      select coalesce(jsonb_object_agg(severidad, n), '{}'::jsonb)
      from (select severidad, count(*)::int as n from public.reclamos group by severidad) t
    ),
    'por_mes', (
      select coalesce(jsonb_agg(
        jsonb_build_object('mes', to_char(m, 'YYYY-MM'), 'cantidad', n) order by m), '[]'::jsonb)
      from (
        select date_trunc('month', created_at)::date as m, count(*)::int as n
        from public.reclamos group by 1
      ) t
    ),
    'por_casa', (
      select coalesce(jsonb_agg(
        jsonb_build_object('casa', numero_casa, 'cantidad', n) order by numero_casa), '[]'::jsonb)
      from (
        select numero_casa, count(*)::int as n
        from public.reclamos group by numero_casa
      ) t
    ),
    -- Sugerencias: totales y desglose
    'sug_total', (select count(*)::int from public.sugerencias),
    'sug_por_estado', (
      select coalesce(jsonb_object_agg(estado, n), '{}'::jsonb)
      from (select estado, count(*)::int as n from public.sugerencias group by estado) t
    ),
    'sug_por_mes', (
      select coalesce(jsonb_agg(
        jsonb_build_object('mes', to_char(m, 'YYYY-MM'), 'cantidad', n) order by m), '[]'::jsonb)
      from (
        select date_trunc('month', created_at)::date as m, count(*)::int as n
        from public.sugerencias group by 1
      ) t
    )
  ) into v_json;

  return v_json;
end;
$$;

-- ============================================================
-- 9bis) SUGERENCIAS DE VECINOS
-- ============================================================
-- Similar a reclamos pero sin campo de severidad ni categoría.
-- Los estados usan terminología femenina: nueva, resuelta.
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
  created_at  timestamptz not null default now()
);

create index if not exists sugerencias_casa_idx on public.sugerencias(numero_casa);
create index if not exists sugerencias_fecha_idx on public.sugerencias(created_at);

-- Detalle de sugerencias (solo comité/admin)
create or replace function public.sugerencias_detalle()
returns table (
  id             uuid,
  titulo         text,
  descripcion    text,
  estado         text,
  respuesta      text,
  nombre         text,
  numero_casa    integer,
  atendido_nombre text,
  created_at     timestamptz
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
           s.created_at
    from public.sugerencias s
    left join public.profiles p  on p.id  = s.creado_por
    left join public.profiles pa on pa.id = s.atendido_por
    order by s.created_at desc;
end;
$$;

-- Responder / cambiar estado de sugerencia (solo comité/admin)
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
      atendido_por = auth.uid()
  where id = p_id;

  if not found then
    raise exception 'Sugerencia no encontrada.';
  end if;
end;
$$;

-- ============================================================
-- 10) ROW LEVEL SECURITY (RLS)
-- ============================================================
-- Las políticas RLS son la capa principal de seguridad.
-- Reglas resumidas:
--
--   casas:      todos pueden SELECT (solo lectura)
--   profiles:   cada usuario ve SU perfil; comité/admin ven todos
--   reclamos:   vecino INSERT solo los suyos; SELECT solo los suyos
--               comité/admin SELECT todos via RPC
--   sugerencias: mismo patrón que reclamos
--
-- No hay INSERT/UPDATE directo sobre profiles: registrar_perfil()
-- es la única puerta de entrada. Los cambios de estado/respuesta
-- van por responder_reclamo() / responder_sugerencia().
-- ============================================================

alter table public.casas      enable row level security;
alter table public.profiles   enable row level security;
alter table public.reclamos   enable row level security;
alter table public.sugerencias enable row level security;

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
-- 11) PRIMER ADMINISTRADOR
-- ============================================================
-- Ejecutar en el SQL Editor después de crear la primera cuenta
-- como vecino desde la interfaz web:
--
-- update public.profiles set rol = 'admin'
-- where id = (select id from auth.users where email = 'tu_correo@ejemplo.cl');
