-- 20261314 · Primeros pasos guiados y tienda de demostración
-- (Necesita 20261312: erp_store_features / vm__on.)
--
--   · Primeros pasos (saas_onboarding): ahora con «catálogo de verdad» y «primera venta confirmada», y respeta el
--     interruptor «Primeros pasos guiados» de Funciones opcionales (encendido por defecto, como antes).
--   · Tienda demo (solo el administrador de RemHub): se escoge UNA tienda de prueba, se toma una «foto» de sus datos
--     y cada N minutos (15 min a 7 días, la escoge el admin) vuelve sola a esa foto: borra lo creado después y
--     devuelve lo que cambiaron. Los visitantes entran con un usuario de demo (miembro de esa tienda, no dueño).
--     Candados: hay que escribir el nombre de la tienda para confirmarla, no puede tener pagos aprobados de RemHub,
--     nunca toca auditoría, cobros de RemHub ni otras tiendas, y solo corre sobre la tienda confirmada.
-- No borra datos al correrla. Se puede correr varias veces.

-- ------------------------------------------------------------------ primeros pasos
create or replace function public.saas_onboarding(p_store uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  st public.stores;
  v_products integer;
  v_catalogs integer := 0;
  v_orders integer := 0;
  v_sales integer := 0;
  v_team integer;
  v_images integer;
begin
  select * into st from public.stores where id = p_store;
  if not found or not (st.owner_id = auth.uid()
                       or exists (select 1 from public.store_users su where su.store_id = p_store and su.user_id = auth.uid() and su.active and su.role = 'store_admin')) then
    return jsonb_build_object('ok', false);
  end if;
  if to_regprocedure('public.vm__on(uuid,text)') is not null and not public.vm__on(p_store, 'arranque') then
    return jsonb_build_object('ok', true, 'on', false, 'steps', '[]'::jsonb);
  end if;
  select count(*), count(*) filter (where coalesce(p.image_url, '') <> '') into v_products, v_images from public.products p where p.store_id = p_store;
  if to_regclass('public.store_catalogs') is not null then execute 'select count(*) from public.store_catalogs where store_id = $1' into v_catalogs using p_store; end if;
  execute 'select count(*), count(*) filter (where status in (''confirmed'', ''completed'')) from public.orders where store_id = $1' into v_orders, v_sales using p_store;
  select count(*) into v_team from public.store_users su where su.store_id = p_store and su.active;
  return jsonb_build_object('ok', true, 'on', true, 'created_at', st.created_at, 'steps', jsonb_build_array(
    jsonb_build_object('key', 'logo', 'done', coalesce(st.logo_url, '') <> ''),
    jsonb_build_object('key', 'product', 'done', v_products >= 1),
    jsonb_build_object('key', 'products5', 'done', v_products >= 5 and v_images >= 3),
    jsonb_build_object('key', 'catalog', 'done', v_catalogs >= 1),
    jsonb_build_object('key', 'share', 'done', v_orders >= 1),
    jsonb_build_object('key', 'sale', 'done', v_sales >= 1),
    jsonb_build_object('key', 'team', 'done', v_team >= 1)));
end $$;
revoke all on function public.saas_onboarding(uuid) from public, anon;
grant execute on function public.saas_onboarding(uuid) to authenticated;

-- ------------------------------------------------------------------ tienda demo
create table if not exists public.erp_demo_config (
  id boolean primary key default true check (id),
  store_id uuid references public.stores(id) on delete set null,
  user_id uuid,
  confirmed_slug text,
  reset_minutes integer not null default 60 check (reset_minutes between 15 and 10080),
  enabled boolean not null default false,
  snapshot_at timestamptz,
  last_reset_at timestamptz,
  last_report jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.erp_demo_config enable row level security;
revoke all on public.erp_demo_config from anon, authenticated;

create table if not exists public.erp_demo_snapshot (
  table_name text primary key,
  rows jsonb not null default '[]'::jsonb,
  taken_at timestamptz not null default now()
);
alter table public.erp_demo_snapshot enable row level security;
revoke all on public.erp_demo_snapshot from anon, authenticated;

-- Tablas que nunca se tocan: auditoría, cobros de RemHub, perfiles, avisos enviados y la propia demo.
create or replace function public.demo__skip(p_table text)
returns boolean language sql immutable as $$
  select p_table like 'erp_demo_%' or p_table like 'saas_%' or p_table like '%audit%' or p_table in ('stores', 'user_profiles', 'erp_push_log')
$$;

-- Tablas de la tienda (con store_id) y tablas hijas sin store_id que apuntan a una de ellas (ej. order_items → orders).
create or replace function public.demo__tables()
returns table (tbl text, mode text, fk_col text, parent text, parent_col text, pk text[], cols text[])
language sql stable security definer set search_path = public as $$
  with base as (
    select c.oid, c.relname::text as name,
           exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'store_id' and not a.attisdropped) as has_store
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not public.demo__skip(c.relname::text)
  ), pks as (
    select i.indrelid, array_agg(a.attname::text order by k.ord) as pk
    from pg_index i cross join lateral unnest(i.indkey) with ordinality k(attnum, ord)
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
    where i.indisprimary group by i.indrelid
  ), colz as (
    select a.attrelid, array_agg(a.attname::text order by a.attnum) as cols
    from pg_attribute a where a.attnum > 0 and not a.attisdropped and a.attgenerated = '' group by a.attrelid
  )
  select b.name, 'store', null::text, null::text, null::text, p.pk, cz.cols
  from base b left join pks p on p.indrelid = b.oid join colz cz on cz.attrelid = b.oid
  where b.has_store
  union all
  select distinct on (b.name) b.name, 'child', ca.attname::text, pb.name, pa.attname::text, p.pk, cz.cols
  from base b
  join pg_constraint f on f.conrelid = b.oid and f.contype = 'f' and cardinality(f.conkey) = 1
  join base pb on pb.oid = f.confrelid and pb.has_store
  join pg_attribute ca on ca.attrelid = b.oid and ca.attnum = f.conkey[1]
  join pg_attribute pa on pa.attrelid = f.confrelid and pa.attnum = f.confkey[1]
  left join pks p on p.indrelid = b.oid join colz cz on cz.attrelid = b.oid
  where not b.has_store
$$;
revoke all on function public.demo__skip(text) from public, anon, authenticated;
revoke all on function public.demo__tables() from public, anon, authenticated;

create or replace function public.demo__where(p_mode text, p_fk text, p_parent text, p_parent_col text, p_store uuid)
returns text language sql immutable as $$
  select case when p_mode = 'store' then format('store_id = %L', p_store)
              else format('%I in (select %I from public.%I where store_id = %L)', p_fk, p_parent_col, p_parent, p_store) end
$$;
revoke all on function public.demo__where(text, text, text, text, uuid) from public, anon, authenticated;

-- Foto de los datos de la tienda demo (reemplaza la anterior).
create or replace function public.demo__snapshot(p_store uuid)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare t record; v_rows jsonb; n integer := 0;
begin
  delete from public.erp_demo_snapshot where true;
  for t in select * from public.demo__tables() loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x where %s', t.tbl, public.demo__where(t.mode, t.fk_col, t.parent, t.parent_col, p_store)) into v_rows;
    insert into public.erp_demo_snapshot (table_name, rows) values (t.tbl, v_rows);
    n := n + jsonb_array_length(v_rows);
  end loop;
  insert into public.erp_demo_snapshot (table_name, rows) select 'stores', jsonb_build_array(to_jsonb(s)) from public.stores s where s.id = p_store;
  return n;
end;
$$;
revoke all on function public.demo__snapshot(uuid) from public, anon, authenticated;

-- Vuelve la tienda demo a la foto. Con «replica» (sin disparadores ni llaves) cuando el servidor lo permite;
-- si no, en orden (hijas primero) y con varias pasadas. Devuelve un reporte.
create or replace function public.demo__restore(p_store uuid, p_replica boolean default true)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  t record;
  v_snap jsonb;
  v_match text;
  v_set text;
  v_cols text;
  v_deleted integer := 0;
  v_restored integer := 0;
  n integer;
  v_errors jsonb := '[]'::jsonb;
  v_mode text := 'ordered';
  pass integer;
  v_pending integer;
begin
  if p_replica then
    begin
      set local session_replication_role = replica;
      v_mode := 'replica';
    exception when others then v_mode := 'ordered';
    end;
  end if;

  -- 1. Borrar lo que no estaba en la foto (hijas primero; varias pasadas por si una llave lo impide).
  for pass in 1 .. case when v_mode = 'replica' then 1 else 4 end loop
    v_pending := 0;
    for t in select * from public.demo__tables() order by (mode = 'store'), tbl loop
      select s.rows into v_snap from public.erp_demo_snapshot s where s.table_name = t.tbl;
      v_snap := coalesce(v_snap, '[]'::jsonb);
      begin
        if t.pk is null then
          execute format('delete from public.%I where %s', t.tbl, public.demo__where(t.mode, t.fk_col, t.parent, t.parent_col, p_store));
        else
          select string_agg(format('(r ->> %L) is not distinct from (to_jsonb(x) ->> %L)', c, c), ' and ') into v_match from unnest(t.pk) c;
          execute format('delete from public.%I x where %s and not exists (select 1 from jsonb_array_elements($1) r where %s)',
                         t.tbl, public.demo__where(t.mode, t.fk_col, t.parent, t.parent_col, p_store), v_match) using v_snap;
        end if;
        get diagnostics n = row_count;
        v_deleted := v_deleted + n;
      exception when others then
        v_pending := v_pending + 1;
        if pass = 4 or v_mode = 'replica' then v_errors := v_errors || jsonb_build_array(jsonb_build_object('table', t.tbl, 'step', 'delete', 'error', left(sqlerrm, 200))); end if;
      end;
    end loop;
    exit when v_pending = 0;
  end loop;

  -- 2. Devolver lo que estaba (primero las de la tienda, luego las hijas).
  for t in select * from public.demo__tables() order by (mode = 'child'), tbl loop
    select s.rows into v_snap from public.erp_demo_snapshot s where s.table_name = t.tbl;
    continue when v_snap is null or jsonb_array_length(v_snap) = 0;
    select string_agg(format('%I', c), ', ') into v_cols from unnest(t.cols) c;
    begin
      if t.pk is null then
        execute format('insert into public.%I (%s) overriding system value select %s from jsonb_populate_recordset(null::public.%I, $1)',
                       t.tbl, v_cols, v_cols, t.tbl) using v_snap;
      else
        select string_agg(format('%I = excluded.%I', c, c), ', ') into v_set from unnest(t.cols) c where not (c = any (t.pk));
        execute format('insert into public.%I (%s) overriding system value select %s from jsonb_populate_recordset(null::public.%I, $1) on conflict (%s) do %s',
                       t.tbl, v_cols, v_cols, t.tbl, (select string_agg(format('%I', c), ', ') from unnest(t.pk) c),
                       case when v_set is null then 'nothing' else 'update set ' || v_set end) using v_snap;
      end if;
      get diagnostics n = row_count;
      v_restored := v_restored + n;
    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('table', t.tbl, 'step', 'restore', 'error', left(sqlerrm, 200)));
    end;
  end loop;

  -- 3. La tienda (nombre, logo, colores…). Nunca cambia su dueño, su enlace ni si está activa.
  select s.rows -> 0 into v_snap from public.erp_demo_snapshot s where s.table_name = 'stores';
  if v_snap is not null then
    begin
      select string_agg(format('%I = r.%I', a.attname, a.attname), ', ') into v_set
      from pg_attribute a where a.attrelid = 'public.stores'::regclass and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
        and a.attname not in ('id', 'owner_id', 'slug', 'active', 'active_until', 'created_at');
      if v_set is not null then
        execute format('update public.stores s set %s from jsonb_populate_record(null::public.stores, $1) r where s.id = $2', v_set) using v_snap, p_store;
      end if;
    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('table', 'stores', 'step', 'restore', 'error', left(sqlerrm, 200)));
    end;
  end if;

  return jsonb_build_object('ok', jsonb_array_length(v_errors) = 0, 'mode', v_mode, 'deleted', v_deleted, 'restored', v_restored, 'errors', v_errors, 'at', now());
end;
$$;
revoke all on function public.demo__restore(uuid, boolean) from public, anon, authenticated;

-- ¿Sigue siendo segura la tienda escogida? (la misma que se confirmó y sin pagos de RemHub)
create or replace function public.demo__safe(c public.erp_demo_config)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_slug text; v_paid integer := 0;
begin
  if c.store_id is null then return 'Escoge la tienda demo.'; end if;
  select s.slug into v_slug from public.stores s where s.id = c.store_id;
  if v_slug is null or v_slug is distinct from c.confirmed_slug then return 'La tienda demo cambió de nombre: vuelve a confirmarla.'; end if;
  if to_regclass('public.saas_payments') is not null then
    execute 'select count(*) from public.saas_payments where store_id = $1 and status = ''approved''' into v_paid using c.store_id;
  end if;
  if v_paid > 0 then return 'Esa tienda tiene pagos aprobados de RemHub: no puede ser la demo.'; end if;
  return null;
end;
$$;
revoke all on function public.demo__safe(public.erp_demo_config) from public, anon, authenticated;

create or replace function public.saas_admin_demo_get()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c public.erp_demo_config;
begin
  if not public.erp_is_platform_admin() then return jsonb_build_object('ok', false, 'message', 'Solo el administrador de RemHub.'); end if;
  select * into c from public.erp_demo_config where id;
  return jsonb_build_object('ok', true,
    'config', case when c.id is null then null else jsonb_build_object(
      'store_id', c.store_id, 'confirmed_slug', c.confirmed_slug, 'reset_minutes', c.reset_minutes, 'enabled', c.enabled,
      'snapshot_at', c.snapshot_at, 'last_reset_at', c.last_reset_at, 'last_report', c.last_report,
      'next_reset_at', case when c.enabled and c.snapshot_at is not null then coalesce(c.last_reset_at, c.snapshot_at) + make_interval(mins => c.reset_minutes) end,
      'store_name', (select s.name from public.stores s where s.id = c.store_id),
      'user_email', (select u.email from auth.users u where u.id = c.user_id),
      'problem', public.demo__safe(c),
      'snapshot_rows', (select coalesce(sum(jsonb_array_length(s.rows)), 0) from public.erp_demo_snapshot s)) end);
end;
$$;

create or replace function public.saas_admin_demo_save(p_store_slug text, p_user_email text, p_reset_minutes integer, p_enabled boolean, p_confirm_slug text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_store uuid;
  v_slug text := lower(btrim(coalesce(p_store_slug, '')));
  v_user uuid;
  v_owner uuid;
  c public.erp_demo_config;
  v_problem text;
begin
  if not public.erp_is_platform_admin() then return jsonb_build_object('ok', false, 'message', 'Solo el administrador de RemHub.'); end if;
  select s.id, s.owner_id into v_store, v_owner from public.stores s where s.slug = v_slug;
  if v_store is null then return jsonb_build_object('ok', false, 'message', 'No encontré una tienda con ese enlace.'); end if;
  if lower(btrim(coalesce(p_confirm_slug, ''))) <> v_slug then
    return jsonb_build_object('ok', false, 'message', 'Para confirmar escribe exactamente el enlace de la tienda demo.');
  end if;
  if coalesce(p_reset_minutes, 60) not between 15 and 10080 then return jsonb_build_object('ok', false, 'message', 'El reinicio va de 15 minutos a 7 días.'); end if;
  select u.id into v_user from auth.users u where lower(u.email) = lower(btrim(coalesce(p_user_email, '')));
  if v_user is null then return jsonb_build_object('ok', false, 'message', 'No existe un usuario con ese correo.'); end if;
  if v_user = v_owner then return jsonb_build_object('ok', false, 'message', 'El usuario de la demo no puede ser el dueño: crea un usuario del equipo con los permisos que quieras mostrar.'); end if;
  if not exists (select 1 from public.store_users su where su.store_id = v_store and su.user_id = v_user and su.active) then
    return jsonb_build_object('ok', false, 'message', 'Ese usuario no es parte del equipo de esa tienda.');
  end if;
  if exists (select 1 from public.user_profiles up where up.user_id = v_user and up.role = 'admin') then
    return jsonb_build_object('ok', false, 'message', 'El usuario de la demo no puede ser administrador de RemHub.');
  end if;
  if exists (select 1 from public.store_users su where su.user_id = v_user and su.store_id <> v_store) or exists (select 1 from public.stores s where s.owner_id = v_user) then
    return jsonb_build_object('ok', false, 'message', 'Ese usuario también entra a otra tienda: usa uno que sea solo de la demo.');
  end if;
  c.store_id := v_store; c.confirmed_slug := v_slug;
  v_problem := public.demo__safe(c);
  if v_problem is not null then return jsonb_build_object('ok', false, 'message', v_problem); end if;

  select * into c from public.erp_demo_config where id;
  insert into public.erp_demo_config (id, store_id, user_id, confirmed_slug, reset_minutes, enabled, updated_at, updated_by)
  values (true, v_store, v_user, v_slug, coalesce(p_reset_minutes, 60), coalesce(p_enabled, false), now(), auth.uid())
  on conflict (id) do update set store_id = excluded.store_id, user_id = excluded.user_id, confirmed_slug = excluded.confirmed_slug,
    reset_minutes = excluded.reset_minutes, enabled = excluded.enabled, updated_at = excluded.updated_at, updated_by = excluded.updated_by,
    -- Otra tienda: la foto anterior no sirve.
    snapshot_at = case when public.erp_demo_config.store_id is distinct from excluded.store_id then null else public.erp_demo_config.snapshot_at end;
  if c.store_id is distinct from v_store then delete from public.erp_demo_snapshot where true; end if;
  return public.saas_admin_demo_get();
end;
$$;

create or replace function public.saas_admin_demo_snapshot()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare c public.erp_demo_config; v_problem text; n integer;
begin
  if not public.erp_is_platform_admin() then return jsonb_build_object('ok', false, 'message', 'Solo el administrador de RemHub.'); end if;
  select * into c from public.erp_demo_config where id;
  if c.id is null then return jsonb_build_object('ok', false, 'message', 'Primero escoge la tienda demo.'); end if;
  v_problem := public.demo__safe(c);
  if v_problem is not null then return jsonb_build_object('ok', false, 'message', v_problem); end if;
  n := public.demo__snapshot(c.store_id);
  update public.erp_demo_config set snapshot_at = now(), last_reset_at = now(), updated_at = now() where id;
  return public.saas_admin_demo_get() || jsonb_build_object('rows', n);
end;
$$;

-- Reinicio: el cron (service_role) cada pocos minutos; solo actúa si ya pasó el tiempo. El admin puede forzarlo.
create or replace function public.erp_demo_reset(p_force boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare c public.erp_demo_config; v_problem text; r jsonb;
begin
  if not (coalesce(auth.role(), '') = 'service_role' or public.erp_is_platform_admin()) then
    return jsonb_build_object('ok', false, 'message', 'No autorizado.');
  end if;
  select * into c from public.erp_demo_config where id for update;
  if c.id is null or not c.enabled or c.snapshot_at is null then return jsonb_build_object('ok', true, 'skipped', 'off'); end if;
  if not coalesce(p_force, false) and now() < coalesce(c.last_reset_at, c.snapshot_at) + make_interval(mins => c.reset_minutes) then
    return jsonb_build_object('ok', true, 'skipped', 'not_due');
  end if;
  v_problem := public.demo__safe(c);
  if v_problem is not null then
    update public.erp_demo_config set enabled = false, last_report = jsonb_build_object('ok', false, 'errors', jsonb_build_array(v_problem), 'at', now()) where id;
    return jsonb_build_object('ok', false, 'message', v_problem);
  end if;
  r := public.demo__restore(c.store_id, true);
  update public.erp_demo_config set last_reset_at = now(), last_report = r where id;
  return r;
end;
$$;

-- Para la página pública /demo (sin datos privados).
create or replace function public.demo_public_info()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_build_object('enabled', true, 'store_name', s.name, 'slug', s.slug, 'reset_minutes', c.reset_minutes, 'logo_url', s.logo_url)
                   from public.erp_demo_config c join public.stores s on s.id = c.store_id
                   where c.id and c.enabled and c.snapshot_at is not null and s.slug = c.confirmed_slug), jsonb_build_object('enabled', false))
$$;

-- Para el servidor que hace entrar al visitante (solo service_role): a quién y a qué tienda.
create or replace function public.demo_entry()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c public.erp_demo_config;
begin
  if coalesce(auth.role(), '') <> 'service_role' then return jsonb_build_object('ok', false); end if;
  select * into c from public.erp_demo_config where id;
  if c.id is null or not c.enabled or c.snapshot_at is null or public.demo__safe(c) is not null then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true, 'user_id', c.user_id, 'slug', c.confirmed_slug);
end;
$$;

-- Para el aviso «estás en la demo» dentro del panel.
create or replace function public.demo_status(p_store uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_build_object('demo', true, 'reset_minutes', c.reset_minutes,
                     'next_reset_at', coalesce(c.last_reset_at, c.snapshot_at) + make_interval(mins => c.reset_minutes))
                   from public.erp_demo_config c where c.id and c.enabled and c.store_id = p_store and c.snapshot_at is not null
                     and auth.uid() is not null), jsonb_build_object('demo', false))
$$;

revoke all on function public.saas_admin_demo_get() from public, anon;
revoke all on function public.saas_admin_demo_save(text, text, integer, boolean, text) from public, anon;
revoke all on function public.saas_admin_demo_snapshot() from public, anon;
revoke all on function public.erp_demo_reset(boolean) from public, anon;
revoke all on function public.demo_public_info() from public;
revoke all on function public.demo_entry() from public, anon, authenticated;
revoke all on function public.demo_status(uuid) from public, anon;
grant execute on function public.saas_admin_demo_get() to authenticated;
grant execute on function public.saas_admin_demo_save(text, text, integer, boolean, text) to authenticated;
grant execute on function public.saas_admin_demo_snapshot() to authenticated;
grant execute on function public.erp_demo_reset(boolean) to authenticated, service_role;
grant execute on function public.demo_public_info() to anon, authenticated;
grant execute on function public.demo_entry() to service_role;
grant execute on function public.demo_status(uuid) to authenticated;

notify pgrst, 'reload schema';
