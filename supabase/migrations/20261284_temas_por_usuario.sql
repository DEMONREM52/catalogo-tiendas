-- =====================================================================
-- REMHUB · Amethyst Glass: temas y apariencia POR USUARIO
--
--   user_themes          → los temas personalizados de cada persona (sin límite de cantidad).
--   user_appearance      → qué tema usa, vidrio, fondo animado, movimiento… (una fila por persona).
--
--   · Todo es del usuario con sesión (auth.uid()). Nadie ve, cambia ni borra lo de otro:
--     lo garantizan las políticas RLS, no solo la pantalla. El user_id lo pone la base, no el navegador.
--   · El tema NO pertenece a la tienda ni al punto: cambiar de punto o de tienda lo conserva.
--   · La configuración se valida aquí también (colores HEX, números con límites, sin CSS libre)
--     y tiene un tamaño máximo; la cantidad de temas no tiene límite.
--   · Freno técnico contra abuso: máximo 60 temas nuevos por hora por persona.
--   · Versión en las preferencias: un dispositivo con datos viejos no pisa un cambio más nuevo.
--   · Si se borra el tema que estaba en uso, las preferencias vuelven solas a un tema oficial.
--
-- No toca tablas existentes. No borra datos. Es idempotente.
-- Deshacer: drop table public.user_appearance; drop table public.user_themes; (y las funciones erp__theme_*).
-- =====================================================================

-- ---------------------------------------------------------------- validación (misma regla que src/lib/appearance/theme.ts)
create or replace function public.erp__theme_config_valid(c jsonb)
returns boolean language plpgsql immutable set search_path = public as $$
declare k text; v jsonb;
  hex constant text := '^#[0-9a-f]{6}$';
begin
  if c is null or jsonb_typeof(c) <> 'object' then return false; end if;
  if octet_length(c::text) > 6000 then return false; end if;
  for k in select jsonb_object_keys(c) loop
    if k not in ('v', 'base', 'colors', 'background', 'glass', 'layout', 'effects') then return false; end if;
  end loop;
  if coalesce(c ->> 'base', '') not in ('light', 'dark') then return false; end if;
  -- Colores: solo HEX de 6 dígitos y solo los nombres conocidos.
  if jsonb_typeof(c -> 'colors') <> 'object' then return false; end if;
  for k, v in select * from jsonb_each(c -> 'colors') loop
    if k not in ('accent', 'accent2', 'accent3', 'bg', 'surface', 'menu', 'dialog', 'input', 'text', 'muted') then return false; end if;
    if jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ hex then return false; end if;
  end loop;
  if c ? 'background' then
    if jsonb_typeof(c -> 'background') <> 'object' then return false; end if;
    if coalesce(c #>> '{background,kind}', 'solid') not in ('solid', 'gradient', 'glow') then return false; end if;
    if coalesce(c #>> '{background,from}', '#000000') !~ hex or coalesce(c #>> '{background,to}', '#000000') !~ hex then return false; end if;
  end if;
  if c ? 'glass' and coalesce(c #>> '{glass,level}', 'off') not in ('off', 'subtle', 'elegant', 'premium', 'custom') then return false; end if;
  if c ? 'layout' and coalesce(c #>> '{layout,density}', 'normal') not in ('compact', 'normal', 'comfortable') then return false; end if;
  -- Números: deben ser números y estar dentro de sus límites.
  if exists (
    select 1 from (values
      ('{background,angle}'::text[], 0, 360), ('{background,intensity}', 0, 100),
      ('{glass,opacity}', 45, 100), ('{glass,blur}', 0, 32), ('{glass,saturation}', 100, 200), ('{glass,border}', 0, 40), ('{glass,shadow}', 0, 100), ('{glass,sheen}', 0, 100),
      ('{layout,radius}', 0, 28), ('{layout,fontScale}', 90, 115), ('{layout,dividers}', 4, 30), ('{effects,ambient}', 0, 100)
    ) as x(path, lo, hi)
    where c #> x.path is not null
      and (jsonb_typeof(c #> x.path) <> 'number' or (c #>> x.path)::numeric < x.lo or (c #>> x.path)::numeric > x.hi)
  ) then return false; end if;
  return true;
end $$;

create or replace function public.erp__appearance_prefs_valid(p jsonb)
returns boolean language plpgsql immutable set search_path = public as $$
declare k text;
begin
  if p is null or jsonb_typeof(p) <> 'object' or octet_length(p::text) > 2000 then return false; end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('mode', 'themeId', 'systemLight', 'systemDark', 'glass', 'animated', 'reducedMotion', 'intensity', 'tipDismissed') then return false; end if;
  end loop;
  if coalesce(p ->> 'mode', 'system') not in ('system', 'light', 'dark', 'custom') then return false; end if;
  if coalesce(p ->> 'intensity', 'elegant') not in ('subtle', 'elegant', 'premium') then return false; end if;
  -- Referencias a temas: uuid o vacío.
  for k in select unnest(array['themeId', 'systemLight', 'systemDark']) loop
    if p ? k and jsonb_typeof(p -> k) <> 'null' and coalesce(p ->> k, '') !~ '^[0-9a-f-]{36}$' then return false; end if;
  end loop;
  for k in select unnest(array['glass', 'animated', 'reducedMotion', 'tipDismissed']) loop
    if p ? k and jsonb_typeof(p -> k) <> 'boolean' then return false; end if;
  end loop;
  return true;
end $$;

-- ---------------------------------------------------------------- tablas
create table if not exists public.user_themes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60),
  description text check (description is null or length(description) <= 200),
  base_mode text not null check (base_mode in ('light', 'dark')),
  config jsonb not null check (public.erp__theme_config_valid(config)),
  schema_version integer not null default 1,
  favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists user_themes_user on public.user_themes (user_id, updated_at desc);

create table if not exists public.user_appearance (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  prefs jsonb not null default '{}'::jsonb check (public.erp__appearance_prefs_valid(prefs)),
  version integer not null default 1,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- reglas que no dependen de la pantalla
create or replace function public.erp__user_themes_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    -- El dueño es siempre quien tiene la sesión (no se puede crear un tema a nombre de otro).
    if auth.uid() is not null then new.user_id := auth.uid(); end if;
    if (select count(*) from public.user_themes t where t.user_id = new.user_id and t.created_at > now() - interval '1 hour') >= 60 then
      raise exception 'Creaste muchos temas en poco tiempo. Espera un momento y vuelve a intentar.';
    end if;
  else
    new.user_id := old.user_id;      -- no se puede pasar a otra persona
    new.created_at := old.created_at;
  end if;
  new.name := btrim(regexp_replace(new.name, '[<>{}\\]', '', 'g'));
  new.base_mode := coalesce(new.config ->> 'base', new.base_mode);
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists user_themes_guard on public.user_themes;
create trigger user_themes_guard before insert or update on public.user_themes for each row execute function public.erp__user_themes_guard();

create or replace function public.erp__user_appearance_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare k text; v_id text;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.user_id := auth.uid(); end if;
    new.version := 1;
  else
    new.user_id := old.user_id;
    new.version := old.version + 1;   -- cada cambio confirmado sube la versión
  end if;
  -- Solo se pueden elegir temas PROPIOS: una referencia ajena o inexistente se quita.
  foreach k in array array['themeId', 'systemLight', 'systemDark'] loop
    v_id := new.prefs ->> k;
    if v_id is not null and not exists (select 1 from public.user_themes t where t.id = v_id::uuid and t.user_id = new.user_id) then
      new.prefs := new.prefs - k;
      if k = 'themeId' and new.prefs ->> 'mode' = 'custom' then new.prefs := jsonb_set(new.prefs, '{mode}', '"system"'); end if;
    end if;
  end loop;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists user_appearance_guard on public.user_appearance;
create trigger user_appearance_guard before insert or update on public.user_appearance for each row execute function public.erp__user_appearance_guard();

-- Al borrar un tema en uso, la preferencia vuelve al oficial de su mismo tipo (sin referencias rotas).
create or replace function public.erp__user_themes_after_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.user_appearance a
     set prefs = (case when a.prefs ->> 'themeId' = old.id::text
                       then jsonb_set(a.prefs - 'themeId', '{mode}', to_jsonb(old.base_mode))
                       else a.prefs end)
                 - (case when a.prefs ->> 'systemLight' = old.id::text then 'systemLight' else '' end)
                 - (case when a.prefs ->> 'systemDark' = old.id::text then 'systemDark' else '' end)
   where a.user_id = old.user_id
     and old.id::text in (coalesce(a.prefs ->> 'themeId', ''), coalesce(a.prefs ->> 'systemLight', ''), coalesce(a.prefs ->> 'systemDark', ''));
  return null;
end $$;
drop trigger if exists user_themes_after_delete on public.user_themes;
create trigger user_themes_after_delete after delete on public.user_themes for each row execute function public.erp__user_themes_after_delete();

revoke all on function public.erp__user_themes_guard() from public, anon, authenticated;
revoke all on function public.erp__user_appearance_guard() from public, anon, authenticated;
revoke all on function public.erp__user_themes_after_delete() from public, anon, authenticated;

-- ---------------------------------------------------------------- aislamiento por usuario (RLS)
alter table public.user_themes enable row level security;
alter table public.user_appearance enable row level security;

drop policy if exists user_themes_own on public.user_themes;
create policy user_themes_own on public.user_themes for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists user_appearance_own on public.user_appearance;
create policy user_appearance_own on public.user_appearance for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.user_themes from anon, public;
revoke all on public.user_appearance from anon, public;
grant select, insert, update, delete on public.user_themes to authenticated;
grant select, insert, update on public.user_appearance to authenticated;

notify pgrst, 'reload schema';
