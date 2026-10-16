-- =====================================================================
-- REMHUB · Administración multipunto + Facturación electrónica
-- Archivo: 20261027_fiscal_multipunto.sql
--
-- Qué hace (todo idempotente, NO borra datos):
--   1. Alcance de permisos: punto principal + puntos adicionales de consulta.
--   2. Auditoría completa e inmutable (antes/después, IP, navegador, motivo).
--   3. Aislamiento por punto en ventas, kardex, clientes y cartera (RLS).
--   4. Configuración de la tienda madre (clientes compartidos, reglas fiscales).
--   5. Puntos con estados (borrador, activo, suspendido, inactivo) y responsable.
--   6. Núcleo fiscal: contribuyentes, establecimientos, proveedor tecnológico,
--      numeración autorizada con consecutivos sin duplicados, documentos
--      electrónicos, eventos, webhooks, contingencias y certificados.
--   7. Funciones del centro fiscal, expediente del punto y panel super admin.
--
-- Ejecuta TODO el archivo en Supabase → SQL Editor (corre como una sola
-- transacción: si algo falla, no queda nada a medias).
-- Requiere las migraciones anteriores (erp_core, erp_ops, erp_points y 16–26).
--
-- IMPORTANTE (reglas fiscales): este archivo NO decide reglas tributarias.
-- Todo lo marcado con «REQUIERE VALIDACIÓN CONTABLE» es configurable y debe
-- confirmarlo la contadora o el proveedor tecnológico.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Utilidades de acceso
-- ---------------------------------------------------------------------

-- Super administrador de la plataforma (por encima de las tiendas madre).
create or replace function public.erp_is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1 from public.user_profiles up where up.user_id = auth.uid() and up.role = 'admin'
  );
$$;
grant execute on function public.erp_is_platform_admin() to authenticated;

-- ¿Tiene el usuario alguno de estos permisos en la tienda? (una sola consulta)
create or replace function public.erp_can_any(p_store uuid, p_perms text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (
    exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
    or exists (select 1 from public.user_profiles up where up.user_id = auth.uid() and up.role = 'admin')
    or exists (
      select 1 from public.store_users su
      where su.store_id = p_store and su.user_id = auth.uid() and su.active
        and (su.role = 'store_admin' or su.permissions && p_perms)
    )
  );
$$;
grant execute on function public.erp_can_any(uuid, text[]) to authenticated;

-- ¿Pertenece el usuario a la tienda (dueño, admin o usuario activo)?
create or replace function public.erp__is_member(p_store uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (
    exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
    or exists (select 1 from public.user_profiles up where up.user_id = auth.uid() and up.role = 'admin')
    or exists (select 1 from public.store_users su where su.store_id = p_store and su.user_id = auth.uid() and su.active)
  );
$$;
grant execute on function public.erp__is_member(uuid) to authenticated;

-- Puntos adicionales que un usuario de punto puede consultar (además de su punto principal).
alter table public.store_users add column if not exists point_ids uuid[] not null default '{}';

-- Puntos visibles para el usuario. NULL = sin restricción (dueño, administradores
-- y usuarios sin punto asignado). Un usuario de punto opera solo en su punto principal.
create or replace function public.erp_my_points(p_store uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select case
           when su.point_id is null then null
           else array(select distinct x from unnest(array_prepend(su.point_id, coalesce(su.point_ids, '{}'::uuid[]))) as x where x is not null)
         end
  from public.store_users su
  where su.store_id = p_store and su.user_id = auth.uid() and su.active
    and su.role <> 'store_admin'
    and not exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
    and not exists (select 1 from public.user_profiles up where up.user_id = auth.uid() and up.role = 'admin')
  limit 1;
$$;
grant execute on function public.erp_my_points(uuid) to authenticated;

-- ¿Puede el usuario ver/operar este punto? (no revisa permisos: se combina con erp_can).
create or replace function public.erp_point_allowed(p_store uuid, p_point uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare v uuid[] := public.erp_my_points(p_store);
begin
  if v is null then return true; end if;
  return p_point is not null and p_point = any (v);
end;
$$;
grant execute on function public.erp_point_allowed(uuid, uuid) to authenticated;

-- Alcance del usuario actual en la tienda (para la interfaz; la base valida siempre).
create or replace function public.erp_my_scope(p_store uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owner boolean;
  v_admin boolean := public.erp_is_platform_admin();
  su public.store_users;
  v_points uuid[] := public.erp_my_points(p_store);
begin
  select exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid()) into v_owner;
  select * into su from public.store_users x where x.store_id = p_store and x.user_id = auth.uid() and x.active limit 1;
  return jsonb_build_object(
    'is_platform_admin', v_admin,
    'is_owner', v_owner,
    'role', case when v_owner then 'owner' when v_admin then 'platform_admin' else su.role end,
    'permissions', case when v_owner or v_admin or su.role = 'store_admin' then to_jsonb(public.erp__known_permissions())
                        else to_jsonb(coalesce(su.permissions, '{}'::text[])) end,
    'point_id', case when v_points is null then null else su.point_id end,
    'point_ids', to_jsonb(v_points),
    'scope', case when v_admin then 'global' when v_points is null then 'organization'
                  when cardinality(v_points) > 1 then 'points' else 'point' end
  );
end;
$$;

-- Lista de permisos conocidos (mantener igual que src/lib/store-user-auth.ts).
create or replace function public.erp__known_permissions()
returns text[]
language sql
immutable
as $$
  select array[
    'store', 'billing', 'pos', 'clients', 'clients_delete', 'credit', 'receivables', 'users', 'products', 'categories',
    'orders', 'inventory', 'inventory_adjust', 'transfers', 'stock_requests', 'stock_requests_manage', 'purchases',
    'suppliers', 'payables', 'audit', 'points', 'fiscal', 'fiscal_send', 'fiscal_notes', 'fiscal_download',
    'fiscal_config', 'fiscal_numbering', 'fiscal_provider', 'fiscal_audit'
  ]::text[];
$$;
grant execute on function public.erp_my_scope(uuid) to authenticated;

-- Respuesta de error estándar de las funciones (no lanza excepción, así el
-- registro de seguridad queda guardado).
create or replace function public.fiscal__err(p_code text, p_message text, p_extra jsonb default '{}'::jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('ok', false, 'code', p_code, 'message', p_message) || coalesce(p_extra, '{}'::jsonb);
$$;

-- ---------------------------------------------------------------------
-- 1. Auditoría completa e inmutable
-- ---------------------------------------------------------------------

-- Datos de la petición (IP, navegador, id de solicitud). Lo envía PostgREST;
-- las rutas del servidor de RemHub reenvían los datos reales del usuario.
create or replace function public.erp__request_meta()
returns jsonb
language plpgsql
stable
as $$
declare h jsonb;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    h := null;
  end;
  if h is null then return '{}'::jsonb; end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'ip', nullif(trim(split_part(coalesce(h ->> 'x-remhub-client-ip', h ->> 'x-forwarded-for', h ->> 'x-real-ip', ''), ',', 1)), ''),
    'user_agent', left(coalesce(h ->> 'x-remhub-user-agent', h ->> 'user-agent'), 400),
    'request_id', left(coalesce(h ->> 'x-remhub-request-id', h ->> 'x-request-id'), 120)
  ));
end;
$$;

-- Cuando una ruta del servidor usa la llave de servicio, informa quién hizo la acción.
-- Solo se acepta si la petición viene con rol service_role (el navegador no lo tiene).
create or replace function public.erp__service_actor()
returns jsonb
language plpgsql
stable
as $$
declare h jsonb; c jsonb;
begin
  begin
    c := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then
    c := null;
  end;
  if coalesce(c ->> 'role', '') <> 'service_role' then return null; end if;
  begin
    h := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    h := null;
  end;
  if h is null or nullif(h ->> 'x-remhub-actor', '') is null then return null; end if;
  return jsonb_build_object('id', h ->> 'x-remhub-actor', 'name', left(h ->> 'x-remhub-actor-name', 120));
end;
$$;

create or replace function public.erp__user_label(p_store uuid, p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select coalesce(nullif(trim(su.display_name), ''), su.username) from public.store_users su
      where su.store_id = p_store and su.user_id = p_user limit 1),
    (select u.email::text from auth.users u where u.id = p_user),
    'Sistema'
  );
$$;

-- Usuario que actúa (sesión normal o el que informa el servidor).
create or replace function public.erp__actor_id()
returns uuid
language plpgsql
stable
as $$
declare sa jsonb;
begin
  if auth.uid() is not null then return auth.uid(); end if;
  sa := public.erp__service_actor();
  if sa is null then return null; end if;
  begin
    return (sa ->> 'id')::uuid;
  exception when others then
    return null;
  end;
end;
$$;

alter table public.erp_audit_logs alter column store_id drop not null;
alter table public.erp_audit_logs add column if not exists point_id uuid;
alter table public.erp_audit_logs add column if not exists category text not null default 'ops';
alter table public.erp_audit_logs add column if not exists severity text not null default 'info';
alter table public.erp_audit_logs add column if not exists before jsonb;
alter table public.erp_audit_logs add column if not exists after jsonb;
alter table public.erp_audit_logs add column if not exists reason text;
alter table public.erp_audit_logs add column if not exists ip text;
alter table public.erp_audit_logs add column if not exists user_agent text;
alter table public.erp_audit_logs add column if not exists request_id text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'erp_audit_logs_category_check') then
    alter table public.erp_audit_logs add constraint erp_audit_logs_category_check
      check (category in ('ops', 'fiscal', 'security', 'auth', 'users', 'config', 'export'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'erp_audit_logs_severity_check') then
    alter table public.erp_audit_logs add constraint erp_audit_logs_severity_check
      check (severity in ('info', 'warning', 'critical'));
  end if;
end $$;

create index if not exists erp_audit_logs_store_cat_date on public.erp_audit_logs (store_id, category, created_at desc);
create index if not exists erp_audit_logs_point_date on public.erp_audit_logs (point_id, created_at desc) where point_id is not null;
create index if not exists erp_audit_logs_entity on public.erp_audit_logs (entity, entity_id);
create index if not exists erp_audit_logs_user_date on public.erp_audit_logs (user_id, created_at desc);
create index if not exists erp_audit_logs_security on public.erp_audit_logs (created_at desc) where category = 'security';

-- Inserta un registro de auditoría con todos los datos (uso interno).
create or replace function public.erp__audit_insert(
  p_store uuid, p_point uuid, p_category text, p_severity text, p_action text,
  p_entity text, p_entity_id uuid, p_before jsonb, p_after jsonb, p_reason text, p_detail jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m jsonb := public.erp__request_meta();
  sa jsonb := public.erp__service_actor();
  v_uid uuid := public.erp__actor_id();
  v_name text;
begin
  if auth.uid() is null and sa is not null then v_name := nullif(sa ->> 'name', ''); end if;
  if v_name is null then
    v_name := case when v_uid is null then 'Sistema' else public.erp__user_label(p_store, v_uid) end;
  end if;
  insert into public.erp_audit_logs
    (store_id, point_id, user_id, user_name, category, severity, action, entity, entity_id,
     before, after, reason, detail, ip, user_agent, request_id)
  values
    (p_store, p_point, v_uid, v_name, coalesce(p_category, 'ops'), coalesce(p_severity, 'info'), p_action,
     coalesce(nullif(p_entity, ''), 'system'), p_entity_id, p_before, p_after,
     nullif(trim(coalesce(p_reason, current_setting('remhub.audit_reason', true), '')), ''),
     coalesce(p_detail, '{}'::jsonb), m ->> 'ip', m ->> 'user_agent', m ->> 'request_id');
end;
$$;
revoke all on function public.erp__audit_insert(uuid, uuid, text, text, text, text, uuid, jsonb, jsonb, text, jsonb) from public, anon, authenticated;

-- La función de auditoría que ya usaban los módulos ahora guarda también IP y navegador.
create or replace function public.erp_audit(p_store uuid, p_action text, p_entity text, p_entity_id uuid, p_detail jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.erp__audit_insert(p_store, null,
    case when p_action like 'fiscal.%' then 'fiscal' else 'ops' end, 'info',
    p_action, p_entity, p_entity_id, null, null, null, p_detail);
end;
$$;
revoke all on function public.erp_audit(uuid, text, text, uuid, jsonb) from public, anon, authenticated;

-- Evento de seguridad (intentos sospechosos). Se guarda aunque la acción se rechace.
create or replace function public.erp__security_event(p_store uuid, p_point uuid, p_action text, p_detail jsonb, p_severity text default 'warning')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.erp__audit_insert(p_store, p_point, 'security', coalesce(p_severity, 'warning'), p_action,
    'security', null, null, null, null, p_detail);
end;
$$;
revoke all on function public.erp__security_event(uuid, uuid, text, jsonb, text) from public, anon, authenticated;

-- Registro desde la interfaz (inicio/cierre de sesión, exportaciones, descargas).
-- Solo acciones permitidas y siempre a nombre del usuario actual.
create or replace function public.erp_audit_client_event(p_store uuid, p_action text, p_detail jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_cat text;
begin
  if auth.uid() is null then return; end if;
  -- Si no se indica la tienda, se usa la del usuario (dueño o integrante).
  p_store := coalesce(p_store,
    (select s.id from public.stores s where s.owner_id = auth.uid() order by s.created_at limit 1),
    (select su.store_id from public.store_users su where su.user_id = auth.uid() and su.active order by su.created_at limit 1));
  v_cat := case
    when p_action in ('auth.login', 'auth.logout') then 'auth'
    when p_action like 'export.%' then 'export'
    when p_action like 'fiscal.%' then 'fiscal'
    else null end;
  if v_cat is null then raise exception 'Acción de auditoría no permitida.'; end if;
  if p_store is not null and not public.erp__is_member(p_store) then
    perform public.erp__security_event(p_store, null, 'security.foreign_store_event', jsonb_build_object('action', p_action));
    return;
  end if;
  perform public.erp__audit_insert(p_store, null, v_cat, 'info', p_action, 'session', null, null, null, null,
    coalesce(p_detail, '{}'::jsonb) - 'password' - 'token');
end;
$$;
grant execute on function public.erp_audit_client_event(uuid, text, jsonb) to authenticated;

-- Nadie modifica ni borra la auditoría (solo mantenimiento explícito del dueño de la base).
create or replace function public.erp__audit_immutable()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('remhub.audit_maintenance', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  -- Al eliminar una tienda completa (super admin) se permite el borrado en cascada.
  if tg_op = 'DELETE' and old.store_id is not null
     and not exists (select 1 from public.stores s where s.id = old.store_id) then
    return old;
  end if;
  raise exception 'La auditoría no se puede modificar ni borrar.' using errcode = '42501';
end;
$$;
drop trigger if exists erp_audit_logs_immutable on public.erp_audit_logs;
create trigger erp_audit_logs_immutable before update or delete on public.erp_audit_logs
  for each row execute function public.erp__audit_immutable();

-- Auditoría genérica de cambios de configuración (antes → después, solo lo que cambió).
-- Argumentos: categoría, entidad, columna del punto, columnas ignoradas, columnas sensibles, columna id.
create or replace function public.erp__audit_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cat text := coalesce(nullif(tg_argv[0], ''), 'config');
  v_entity text := coalesce(nullif(tg_argv[1], ''), tg_table_name);
  v_point_key text := nullif(tg_argv[2], '');
  v_skip text[] := string_to_array(coalesce(tg_argv[3], ''), ',');
  v_sensitive text[] := string_to_array(coalesce(tg_argv[4], ''), ',');
  v_id_key text := coalesce(nullif(tg_argv[5], ''), 'id');
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
  v_before jsonb;
  v_after jsonb;
  v_key text;
  v_sev text := 'info';
  v_store uuid;
  v_point uuid;
  v_id uuid;
begin
  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
  v_row := coalesce(v_new, v_old);

  if tg_op = 'UPDATE' then
    v_before := '{}'::jsonb;
    v_after := '{}'::jsonb;
    for v_key in select jsonb_object_keys(v_new) loop
      continue when v_key = any (v_skip);
      if (v_old -> v_key) is distinct from (v_new -> v_key) then
        v_before := v_before || jsonb_build_object(v_key, v_old -> v_key);
        v_after := v_after || jsonb_build_object(v_key, v_new -> v_key);
        if v_key = any (v_sensitive) then v_sev := 'warning'; end if;
      end if;
    end loop;
    if v_after = '{}'::jsonb then return new; end if;
  elsif tg_op = 'INSERT' then
    v_after := v_new - v_skip;
  else
    v_before := v_old - v_skip;
    v_sev := 'warning';
  end if;

  begin v_store := (v_row ->> 'store_id')::uuid; exception when others then v_store := null; end;
  begin v_id := (v_row ->> v_id_key)::uuid; exception when others then v_id := null; end;
  if v_point_key is not null then
    begin v_point := (v_row ->> v_point_key)::uuid; exception when others then v_point := null; end;
  end if;

  perform public.erp__audit_insert(v_store, v_point, v_cat, v_sev, v_entity || '.' || lower(tg_op), v_entity, v_id,
    v_before, v_after, null, '{}'::jsonb);
  return coalesce(new, old);
end;
$$;

-- Puntos/bodegas, proveedores, usuarios, terceros: cambios con antes/después.
drop trigger if exists erp_warehouses_audit on public.erp_warehouses;
create trigger erp_warehouses_audit after insert or update or delete on public.erp_warehouses
  for each row execute function public.erp__audit_row(
    'config', 'punto', 'id', 'updated_at,next_invoice_number,next_remision_number,status_changed_at',
    'name,code,kind,status,active,legal_name,nit,invoice_prefix,remision_prefix,billing_resolution,billing_resolution_from,billing_resolution_to,billing_resolution_valid_to', 'id');

drop trigger if exists erp_suppliers_audit on public.erp_suppliers;
create trigger erp_suppliers_audit after insert or update or delete on public.erp_suppliers
  for each row execute function public.erp__audit_row('ops', 'proveedor', '', 'updated_at', 'name,nit,active', 'id');

drop trigger if exists store_users_audit on public.store_users;
create trigger store_users_audit after insert or update or delete on public.store_users
  for each row execute function public.erp__audit_row('users', 'usuario', 'point_id', 'updated_at',
    'role,permissions,active,point_id,point_ids', 'user_id');

drop trigger if exists billing_customers_audit on public.billing_customers;
create trigger billing_customers_audit after insert or update or delete on public.billing_customers
  for each row execute function public.erp__audit_row('ops', 'tercero', 'point_id',
    'updated_at,credit_updated_at,credit_updated_by_name',
    'document_type,document_number,name,person_type,credit_enabled,credit_limit,credit_days,credit_blocked,active', 'id');

-- Cambios de precio y costo de productos (sin registrar cambios de existencias).
create or replace function public.erp__audit_product_prices()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_key text;
begin
  foreach v_key in array array['price_1', 'price_2', 'price_3', 'price_4', 'price_5', 'price_retail', 'price_wholesale', 'cost_price', 'min_price', 'tax_rate'] loop
    if (v_old -> v_key) is distinct from (v_new -> v_key) then
      v_before := v_before || jsonb_build_object(v_key, v_old -> v_key);
      v_after := v_after || jsonb_build_object(v_key, v_new -> v_key);
    end if;
  end loop;
  if v_after <> '{}'::jsonb then
    perform public.erp__audit_insert(new.store_id, null, 'ops', 'info', 'producto.precio', 'products', new.id,
      v_before, v_after || jsonb_build_object('producto', new.name), null, '{}'::jsonb);
  end if;
  return new;
end;
$$;
drop trigger if exists erp_products_price_audit on public.products;
create trigger erp_products_price_audit after update on public.products
  for each row
  when (old.price_1 is distinct from new.price_1 or old.price_2 is distinct from new.price_2
        or old.price_3 is distinct from new.price_3 or old.price_4 is distinct from new.price_4
        or old.price_5 is distinct from new.price_5 or old.price_retail is distinct from new.price_retail
        or old.price_wholesale is distinct from new.price_wholesale or old.cost_price is distinct from new.cost_price
        or old.min_price is distinct from new.min_price or old.tax_rate is distinct from new.tax_rate)
  execute function public.erp__audit_product_prices();

-- Lectura de auditoría: permiso de auditoría (o auditoría fiscal) y alcance del punto.
drop policy if exists erp_audit_select on public.erp_audit_logs;
create policy erp_audit_select on public.erp_audit_logs for select to authenticated
  using (public.erp_can(store_id, 'audit') or public.erp_can(store_id, 'fiscal_audit'));
drop policy if exists erp_audit_point_scope on public.erp_audit_logs;
create policy erp_audit_point_scope on public.erp_audit_logs as restrictive for select to authenticated
  using (
    public.erp_my_points(store_id) is null
    or user_id = auth.uid()
    or (point_id is not null and category <> 'security' and point_id = any (public.erp_my_points(store_id)))
  );
revoke insert, update, delete on public.erp_audit_logs from anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Configuración de la tienda madre
-- ---------------------------------------------------------------------
create table if not exists public.erp_org_settings (
  store_id uuid primary key references public.stores(id) on delete cascade,
  -- Clientes compartidos entre puntos (si es false, cada punto ve los suyos y los de la tienda).
  shared_customers boolean not null default false,
  -- Interruptor general de la facturación electrónica de toda la tienda.
  fiscal_enabled boolean not null default false,
  -- Remisiones de venta en puntos habilitados: allow (sin control), warn (alerta) o block.
  -- REQUIERE VALIDACIÓN CONTABLE: qué operaciones deben facturarse y en qué plazo.
  remission_policy text not null default 'warn',
  remission_max_days integer not null default 5,
  -- Identificación usada cuando la venta no tiene cliente (REQUIERE VALIDACIÓN CONTABLE).
  final_consumer_doc text not null default '222222222222',
  final_consumer_name text not null default 'CONSUMIDOR FINAL',
  updated_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text,
  constraint erp_org_settings_policy_check check (remission_policy in ('allow', 'warn', 'block')),
  constraint erp_org_settings_days_check check (remission_max_days between 0 and 365)
);

-- Las tiendas que ya existen conservan su comportamiento actual: clientes visibles en todos los puntos.
insert into public.erp_org_settings (store_id, shared_customers)
select s.id, true from public.stores s
on conflict (store_id) do nothing;

create or replace function public.erp__org_settings_default()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.erp_org_settings (store_id) values (new.id) on conflict (store_id) do nothing;
  return new;
end;
$$;
drop trigger if exists erp_stores_org_settings on public.stores;
create trigger erp_stores_org_settings after insert on public.stores
  for each row execute function public.erp__org_settings_default();

alter table public.erp_org_settings enable row level security;
drop policy if exists erp_org_settings_read on public.erp_org_settings;
create policy erp_org_settings_read on public.erp_org_settings for select to authenticated
  using (public.erp__is_member(store_id));
revoke insert, update, delete on public.erp_org_settings from anon, authenticated;
revoke all on public.erp_org_settings from anon;

drop trigger if exists erp_org_settings_audit on public.erp_org_settings;
create trigger erp_org_settings_audit after insert or update on public.erp_org_settings
  for each row execute function public.erp__audit_row('config', 'configuracion_tienda', '', 'updated_at,updated_by,updated_by_name',
    'shared_customers,fiscal_enabled,remission_policy,final_consumer_doc', 'store_id');

create or replace function public.erp_org_settings_save(p_store uuid, p_patch jsonb, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.erp_org_settings;
  v_fiscal_keys text[] := array['fiscal_enabled', 'remission_policy', 'remission_max_days', 'final_consumer_doc', 'final_consumer_name'];
  v_key text;
begin
  if public.erp_my_points(p_store) is not null then
    perform public.erp__security_event(p_store, public.erp_my_point(p_store), 'security.org_settings_denied', p_patch);
    return public.fiscal__err('FORBIDDEN', 'Solo la administración de la tienda madre cambia esta configuración.');
  end if;
  for v_key in select jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) loop
    if v_key = 'shared_customers' then
      if not public.erp_can_any(p_store, array['store', 'users']) then
        return public.fiscal__err('FORBIDDEN', 'Necesitas el permiso «Mi tienda» para cambiar cómo se comparten los clientes.');
      end if;
    elsif v_key = any (v_fiscal_keys) then
      if not public.erp_can(p_store, 'fiscal_config') then
        return public.fiscal__err('FORBIDDEN', 'Necesitas el permiso «Configuración fiscal».');
      end if;
    else
      return public.fiscal__err('INVALID', 'Campo de configuración no reconocido: ' || v_key);
    end if;
  end loop;

  insert into public.erp_org_settings (store_id) values (p_store) on conflict (store_id) do nothing;
  perform set_config('remhub.audit_reason', coalesce(p_reason, ''), true);
  update public.erp_org_settings set
    shared_customers = coalesce((p_patch ->> 'shared_customers')::boolean, shared_customers),
    fiscal_enabled = coalesce((p_patch ->> 'fiscal_enabled')::boolean, fiscal_enabled),
    remission_policy = coalesce(p_patch ->> 'remission_policy', remission_policy),
    remission_max_days = coalesce((p_patch ->> 'remission_max_days')::integer, remission_max_days),
    final_consumer_doc = coalesce(nullif(regexp_replace(coalesce(p_patch ->> 'final_consumer_doc', ''), '\D', '', 'g'), ''), final_consumer_doc),
    final_consumer_name = coalesce(nullif(upper(trim(coalesce(p_patch ->> 'final_consumer_name', ''))), ''), final_consumer_name),
    updated_at = now(),
    updated_by = auth.uid(),
    updated_by_name = public.erp_actor_name(p_store)
  where store_id = p_store
  returning * into s;
  return jsonb_build_object('ok', true, 'settings', to_jsonb(s));
end;
$$;
grant execute on function public.erp_org_settings_save(uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Puntos: estado operativo y responsable
-- ---------------------------------------------------------------------
alter table public.erp_warehouses add column if not exists status text not null default 'active';
alter table public.erp_warehouses add column if not exists description text;
alter table public.erp_warehouses add column if not exists responsible_user_id uuid;
alter table public.erp_warehouses add column if not exists responsible_name text;
alter table public.erp_warehouses add column if not exists responsible_doc text;
alter table public.erp_warehouses add column if not exists responsible_phone text;
alter table public.erp_warehouses add column if not exists responsible_email text;
alter table public.erp_warehouses add column if not exists status_reason text;
alter table public.erp_warehouses add column if not exists status_changed_at timestamptz;

update public.erp_warehouses set status = 'inactive' where not active and status = 'active';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'erp_warehouses_status_check') then
    alter table public.erp_warehouses add constraint erp_warehouses_status_check
      check (status in ('draft', 'active', 'suspended', 'inactive'));
  end if;
end $$;

-- «active» (lo que usan los módulos existentes) siempre refleja el estado.
create or replace function public.erp__point_status_sync()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.active is false and new.status = 'active' then new.status := 'inactive'; end if;
    new.active := (new.status = 'active');
    return new;
  end if;
  if new.status is distinct from old.status then
    new.active := (new.status = 'active');
    new.status_changed_at := now();
  elsif new.active is distinct from old.active then
    new.status := case when new.active then 'active' when old.status = 'active' then 'inactive' else old.status end;
    new.status_changed_at := now();
  end if;
  if new.is_default and new.status <> 'active' then
    raise exception 'La bodega principal no se puede desactivar.';
  end if;
  return new;
end;
$$;
drop trigger if exists erp_warehouses_status_sync on public.erp_warehouses;
create trigger erp_warehouses_status_sync before insert or update on public.erp_warehouses
  for each row execute function public.erp__point_status_sync();

-- ---------------------------------------------------------------------
-- 4. Aislamiento por punto (políticas RESTRICTIVAS: solo reducen acceso,
--    no cambian lo que ya ven el dueño y los administradores).
-- ---------------------------------------------------------------------

-- Venta visible si es del punto del usuario (POS o catálogo del punto).
create or replace function public.erp__order_visible(p_store uuid, p_order uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare v uuid[] := public.erp_my_points(p_store);
begin
  if v is null then return true; end if;
  return exists (select 1 from public.erp_order_meta m where m.order_id = p_order and m.point_id = any (v))
      or exists (select 1 from public.store_catalog_orders co
                 join public.store_catalogs c on c.id = co.catalog_id
                 where co.order_id = p_order and c.point_id = any (v));
end;
$$;
grant execute on function public.erp__order_visible(uuid, uuid) to authenticated;

-- Clientes y cartera: visibles si la tienda los comparte, si son de la tienda (sin punto) o del punto del usuario.
alter table public.billing_customers add column if not exists point_id uuid references public.erp_warehouses(id) on delete set null;
create index if not exists billing_customers_point on public.billing_customers (store_id, point_id);

create or replace function public.erp__customer_visible(p_store uuid, p_point uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare v uuid[];
begin
  if p_point is null then return true; end if;
  v := public.erp_my_points(p_store);
  if v is null or p_point = any (v) then return true; end if;
  return coalesce((select os.shared_customers from public.erp_org_settings os where os.store_id = p_store), true);
end;
$$;
grant execute on function public.erp__customer_visible(uuid, uuid) to authenticated;

-- Un tercero creado por un usuario de punto queda asociado a ese punto.
create or replace function public.erp__customer_point_default()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.point_id is null then
    new.point_id := public.erp_my_point(new.store_id);
  end if;
  return new;
end;
$$;
drop trigger if exists billing_customers_point_default on public.billing_customers;
create trigger billing_customers_point_default before insert on public.billing_customers
  for each row execute function public.erp__customer_point_default();

do $$
declare
  v_rls boolean;
begin
  -- Ventas (orders / order_items)
  select c.relrowsecurity into v_rls from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'orders';
  if coalesce(v_rls, false) then
    execute 'drop policy if exists orders_point_scope_select on public.orders';
    execute 'drop policy if exists orders_point_scope_update on public.orders';
    execute 'drop policy if exists orders_point_scope_delete on public.orders';
    execute 'create policy orders_point_scope_select on public.orders as restrictive for select to authenticated using (public.erp__order_visible(store_id, id))';
    execute 'create policy orders_point_scope_update on public.orders as restrictive for update to authenticated using (public.erp__order_visible(store_id, id))';
    execute 'create policy orders_point_scope_delete on public.orders as restrictive for delete to authenticated using (public.erp__order_visible(store_id, id))';
  else
    raise notice 'orders no tiene RLS activo: no se agregó el filtro por punto (revísalo en Panel Admin → Seguridad).';
  end if;

  select c.relrowsecurity into v_rls from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'order_items';
  if coalesce(v_rls, false) then
    execute 'drop policy if exists order_items_point_scope_select on public.order_items';
    execute 'create policy order_items_point_scope_select on public.order_items as restrictive for select to authenticated using (exists (select 1 from public.orders o where o.id = order_id))';
  else
    raise notice 'order_items no tiene RLS activo: no se agregó el filtro por punto.';
  end if;

  -- Kardex
  select c.relrowsecurity into v_rls from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'inventory_movements';
  if coalesce(v_rls, false) then
    execute 'drop policy if exists inventory_movements_point_scope on public.inventory_movements';
    execute 'create policy inventory_movements_point_scope on public.inventory_movements as restrictive for select to authenticated using (public.erp_point_allowed(store_id, warehouse_id))';
  else
    raise notice 'inventory_movements no tiene RLS activo: no se agregó el filtro por punto.';
  end if;
end $$;

-- Metadatos de documentos POS (número, vendedor, punto).
drop policy if exists erp_order_meta_point_scope on public.erp_order_meta;
create policy erp_order_meta_point_scope on public.erp_order_meta as restrictive for select to authenticated
  using (public.erp_point_allowed(store_id, point_id));

-- Terceros (según «clientes compartidos»).
drop policy if exists billing_customers_point_scope_select on public.billing_customers;
drop policy if exists billing_customers_point_scope_update on public.billing_customers;
drop policy if exists billing_customers_point_scope_delete on public.billing_customers;
drop policy if exists billing_customers_point_scope_insert on public.billing_customers;
create policy billing_customers_point_scope_select on public.billing_customers as restrictive for select to authenticated
  using (public.erp__customer_visible(store_id, point_id));
create policy billing_customers_point_scope_update on public.billing_customers as restrictive for update to authenticated
  using (public.erp__customer_visible(store_id, point_id)) with check (public.erp__customer_visible(store_id, point_id));
create policy billing_customers_point_scope_delete on public.billing_customers as restrictive for delete to authenticated
  using (public.erp__customer_visible(store_id, point_id));
create policy billing_customers_point_scope_insert on public.billing_customers as restrictive for insert to authenticated
  with check (point_id is null or public.erp_point_allowed(store_id, point_id));

-- Cartera (sigue la misma regla que los clientes).
drop policy if exists erp_receivables_point_scope on public.erp_receivables;
create policy erp_receivables_point_scope on public.erp_receivables as restrictive for select to authenticated
  using (public.erp__customer_visible(store_id, point_id));

-- ---------------------------------------------------------------------
-- 5. Roles personalizados de la tienda (plantillas de permisos)
-- ---------------------------------------------------------------------
create table if not exists public.erp_role_templates (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  icon text not null default '🧩',
  description text,
  permissions text[] not null default '{}',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, name)
);
alter table public.erp_role_templates enable row level security;
drop policy if exists erp_role_templates_read on public.erp_role_templates;
create policy erp_role_templates_read on public.erp_role_templates for select to authenticated
  using (public.erp_can(store_id, 'users'));
revoke insert, update, delete on public.erp_role_templates from anon, authenticated;
revoke all on public.erp_role_templates from anon;

drop trigger if exists erp_role_templates_audit on public.erp_role_templates;
create trigger erp_role_templates_audit after insert or update or delete on public.erp_role_templates
  for each row execute function public.erp__audit_row('users', 'rol', '', 'updated_at', 'permissions,name', 'id');

create or replace function public.erp_role_template_save(p_store uuid, p_id uuid, p_name text, p_icon text, p_description text, p_permissions text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_perms text[];
  v_bad text[];
  v_mine text[];
  v_id uuid;
begin
  if not public.erp_can(p_store, 'users') then
    return public.fiscal__err('FORBIDDEN', 'Necesitas el permiso de Usuarios.');
  end if;
  if coalesce(trim(p_name), '') = '' or length(trim(p_name)) > 40 then
    return public.fiscal__err('INVALID', 'Escribe un nombre de rol (máximo 40 caracteres).');
  end if;
  v_perms := array(select distinct x from unnest(coalesce(p_permissions, '{}'::text[])) x where x is not null);
  v_bad := array(select x from unnest(v_perms) x where not (x = any (public.erp__known_permissions())));
  if cardinality(v_bad) > 0 then
    return public.fiscal__err('INVALID', 'Permisos no reconocidos: ' || array_to_string(v_bad, ', '));
  end if;
  -- Nadie crea roles con permisos que no tiene (salvo dueño/administradores).
  v_mine := array(select x from unnest(v_perms) x where not public.erp_can(p_store, x));
  if cardinality(v_mine) > 0 then
    return public.fiscal__err('FORBIDDEN', 'No puedes incluir permisos que tú no tienes: ' || array_to_string(v_mine, ', '));
  end if;
  if p_id is null then
    insert into public.erp_role_templates (store_id, name, icon, description, permissions)
    values (p_store, trim(p_name), coalesce(nullif(trim(p_icon), ''), '🧩'), nullif(trim(p_description), ''), v_perms)
    returning id into v_id;
  else
    update public.erp_role_templates set name = trim(p_name), icon = coalesce(nullif(trim(p_icon), ''), icon),
      description = nullif(trim(p_description), ''), permissions = v_perms, updated_at = now()
    where id = p_id and store_id = p_store
    returning id into v_id;
    if v_id is null then return public.fiscal__err('NOT_FOUND', 'El rol no existe.'); end if;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
exception when unique_violation then
  return public.fiscal__err('DUPLICATE', 'Ya existe un rol con ese nombre.');
end;
$$;
grant execute on function public.erp_role_template_save(uuid, uuid, text, text, text, text[]) to authenticated;

create or replace function public.erp_role_template_delete(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_store uuid;
begin
  select store_id into v_store from public.erp_role_templates where id = p_id;
  if v_store is null then return public.fiscal__err('NOT_FOUND', 'El rol no existe.'); end if;
  if not public.erp_can(v_store, 'users') then return public.fiscal__err('FORBIDDEN', 'Necesitas el permiso de Usuarios.'); end if;
  delete from public.erp_role_templates where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function public.erp_role_template_delete(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 6. Núcleo fiscal: tablas
-- ---------------------------------------------------------------------

-- Dígito de verificación DIAN (módulo 11), igual al de la interfaz.
create or replace function public.fiscal_nit_dv(p_doc text)
returns text
language plpgsql
immutable
as $$
declare
  d text := regexp_replace(split_part(coalesce(p_doc, ''), '-', 1), '\D', '', 'g');
  w integer[] := array[3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  s integer := 0;
  i integer;
  r integer;
begin
  if length(d) < 5 or length(d) > 15 then return null; end if;
  for i in 1..length(d) loop
    s := s + substr(d, length(d) - i + 1, 1)::integer * w[i];
  end loop;
  r := s % 11;
  return case when r > 1 then (11 - r)::text else r::text end;
end;
$$;
grant execute on function public.fiscal_nit_dv(text) to authenticated, anon;

-- Catálogo de proveedores tecnológicos (adaptadores del servidor).
create table if not exists public.fiscal_providers (
  code text primary key,
  name text not null,
  status text not null default 'planned' check (status in ('available', 'planned', 'disabled')),
  supports_production boolean not null default false,
  supports_webhooks boolean not null default false,
  requires_certificate boolean not null default false,
  notes text,
  sort_order integer not null default 0
);
insert into public.fiscal_providers (code, name, status, supports_production, supports_webhooks, requires_certificate, notes, sort_order) values
  ('sandbox', 'Simulador RemHub (pruebas)', 'available', false, true, false,
   'Solo para pruebas internas: no transmite nada a la DIAN y nunca se usa en producción.', 0),
  ('alegra', 'Alegra', 'planned', true, true, false,
   'Adaptador preparado. TODO: completar con la documentación oficial vigente y credenciales del contrato.', 10),
  ('siigo', 'Siigo', 'planned', true, false, false,
   'Existe una integración anterior (/api/siigo/invoice). TODO: migrarla al adaptador.', 20),
  ('thefactoryhka', 'The Factory HKA', 'planned', true, true, false, 'TODO: adaptador pendiente.', 30),
  ('carvajal', 'Carvajal', 'planned', true, true, false, 'TODO: adaptador pendiente.', 40)
on conflict (code) do update set name = excluded.name, notes = excluded.notes, sort_order = excluded.sort_order;
alter table public.fiscal_providers enable row level security;
drop policy if exists fiscal_providers_read on public.fiscal_providers;
create policy fiscal_providers_read on public.fiscal_providers for select to authenticated using (true);
revoke insert, update, delete on public.fiscal_providers from anon, authenticated;

-- Contribuyente / entidad fiscal (NIT o cédula del responsable de las ventas).
create table if not exists public.fiscal_entities (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  person_type text not null default 'juridica' check (person_type in ('natural', 'juridica')),
  legal_name text not null,
  trade_name text,
  document_type text not null default 'NIT' check (document_type in ('NIT', 'CC', 'CE', 'PP', 'PAS', 'NIT_EXT', 'PEP', 'PPT', 'DIE', 'TI', 'RC', 'OTRO')),
  document_number text,
  verification_digit text,
  tax_regime text,
  tax_responsibilities text[] not null default '{}',
  economic_activities text[] not null default '{}',
  fiscal_address text,
  city text,
  city_code text,
  department text,
  department_code text,
  country text not null default 'CO',
  postal_code text,
  phone text,
  email text,
  dian_email text,
  rut_date date,
  -- Los precios del POS ya incluyen impuestos (REQUIERE VALIDACIÓN CONTABLE).
  prices_include_tax boolean not null default true,
  status text not null default 'draft' check (status in ('draft', 'active', 'inactive')),
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create unique index if not exists fiscal_entities_doc_unique
  on public.fiscal_entities (store_id, document_type, document_number) where document_number is not null;
create index if not exists fiscal_entities_store on public.fiscal_entities (store_id, status);

-- Establecimiento (sede física / sucursal registrada).
create table if not exists public.fiscal_establishments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  fiscal_entity_id uuid not null references public.fiscal_entities(id) on delete restrict,
  point_id uuid references public.erp_warehouses(id) on delete set null,
  name text not null,
  code text,
  address text,
  city text,
  city_code text,
  department text,
  department_code text,
  country text not null default 'CO',
  phone text,
  email text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fiscal_establishments_entity on public.fiscal_establishments (fiscal_entity_id);
create index if not exists fiscal_establishments_point on public.fiscal_establishments (point_id);

-- Cuenta del proveedor tecnológico (por contribuyente y ambiente; nunca guarda secretos aquí).
create table if not exists public.fiscal_provider_accounts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  fiscal_entity_id uuid not null references public.fiscal_entities(id) on delete restrict,
  provider text not null references public.fiscal_providers(code),
  environment text not null default 'sandbox' check (environment in ('sandbox', 'production')),
  label text,
  external_account_id text,
  settings jsonb not null default '{}'::jsonb,
  credentials_hint jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'connected', 'error', 'disconnected')),
  last_test_at timestamptz,
  last_test_ok boolean,
  last_error text,
  webhook_token text not null default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  webhook_status text not null default 'unknown' check (webhook_status in ('unknown', 'ok', 'failing', 'disabled')),
  webhook_last_event_at timestamptz,
  webhook_failures integer not null default 0,
  connected_at timestamptz,
  disconnected_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (fiscal_entity_id, provider, environment)
);
create unique index if not exists fiscal_provider_accounts_webhook_token on public.fiscal_provider_accounts (webhook_token);
create index if not exists fiscal_provider_accounts_store on public.fiscal_provider_accounts (store_id);

-- Secretos cifrados en el servidor (AES-256-GCM). Ningún usuario los lee desde el navegador.
create table if not exists public.fiscal_secrets (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  owner_type text not null check (owner_type in ('provider_account', 'numbering_range', 'certificate')),
  owner_id uuid not null,
  name text not null,
  ciphertext text not null,
  key_version integer not null default 1,
  last4 text,
  created_by uuid,
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  unique (owner_type, owner_id, name)
);

-- Configuración fiscal del punto (quién factura, con qué proveedor y ambiente).
create table if not exists public.fiscal_point_configs (
  point_id uuid primary key references public.erp_warehouses(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  fiscal_entity_id uuid references public.fiscal_entities(id) on delete restrict,
  establishment_id uuid references public.fiscal_establishments(id) on delete set null,
  provider_account_id uuid references public.fiscal_provider_accounts(id) on delete set null,
  environment text not null default 'sandbox' check (environment in ('sandbox', 'production')),
  enabled boolean not null default false,
  -- Documento que emite el POS cuando se elige «Factura» (REQUIERE VALIDACIÓN CONTABLE).
  pos_document_type text not null default 'invoice' check (pos_document_type in ('invoice', 'pos_equivalent')),
  pos_electronic_default boolean not null default true,
  production_confirmed_at timestamptz,
  production_confirmed_by uuid,
  notes text,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create index if not exists fiscal_point_configs_entity on public.fiscal_point_configs (fiscal_entity_id);

-- Autorizaciones de numeración (resoluciones / rangos). NO se asume 1 punto = 1 resolución:
-- un rango pertenece a un contribuyente y se autoriza explícitamente para uno o varios puntos.
create table if not exists public.fiscal_numbering_ranges (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  fiscal_entity_id uuid not null references public.fiscal_entities(id) on delete restrict,
  document_type text not null check (document_type in ('invoice', 'pos_equivalent', 'credit_note', 'debit_note',
    'support_document', 'support_adjustment', 'export_invoice', 'contingency_invoice')),
  environment text not null default 'sandbox' check (environment in ('sandbox', 'production')),
  name text,
  resolution_number text,
  resolution_date date,
  valid_from date,
  valid_until date,
  prefix text not null default '',
  range_from bigint not null,
  range_to bigint not null,
  next_number bigint not null,
  point_ids uuid[] not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'active', 'inactive', 'exhausted', 'expired')),
  requires_resolution boolean not null default true,
  alert_percent integer not null default 80 check (alert_percent between 1 and 100),
  alert_days integer not null default 30 check (alert_days between 0 and 365),
  technical_key_hint text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  constraint fiscal_ranges_bounds check (range_from >= 0 and range_to >= range_from and next_number >= range_from and next_number <= range_to + 1),
  constraint fiscal_ranges_dates check (valid_from is null or valid_until is null or valid_from <= valid_until),
  constraint fiscal_ranges_prefix check (prefix ~ '^[A-Z0-9]{0,10}$')
);
create index if not exists fiscal_ranges_entity on public.fiscal_numbering_ranges (fiscal_entity_id, document_type, environment, status);
create index if not exists fiscal_ranges_points on public.fiscal_numbering_ranges using gin (point_ids);

-- Cada número entregado queda registrado una sola vez (garantía contra duplicados).
create table if not exists public.fiscal_number_allocations (
  id uuid primary key default gen_random_uuid(),
  range_id uuid not null references public.fiscal_numbering_ranges(id) on delete restrict,
  store_id uuid not null,
  fiscal_entity_id uuid not null,
  document_type text not null,
  environment text not null,
  prefix text not null,
  number bigint not null,
  document_id uuid,
  status text not null default 'assigned' check (status in ('assigned', 'voided_unsent')),
  allocated_by uuid,
  allocated_at timestamptz not null default now(),
  unique (range_id, number),
  unique (fiscal_entity_id, environment, document_type, prefix, number)
);
create index if not exists fiscal_number_allocations_doc on public.fiscal_number_allocations (document_id);

-- Contingencias (proveedor o DIAN no disponibles). Las reglas exactas de contingencia
-- REQUIEREN VALIDACIÓN con el proveedor tecnológico y la contadora.
create table if not exists public.fiscal_contingencies (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  point_id uuid references public.erp_warehouses(id) on delete set null,
  fiscal_entity_id uuid references public.fiscal_entities(id) on delete set null,
  provider_account_id uuid references public.fiscal_provider_accounts(id) on delete set null,
  kind text not null default 'provider' check (kind in ('provider', 'dian', 'connectivity', 'power', 'other')),
  reason text not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  started_at timestamptz not null default now(),
  started_by uuid,
  started_by_name text,
  ended_at timestamptz,
  ended_by uuid,
  ended_by_name text,
  end_notes text,
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists fiscal_contingencies_open on public.fiscal_contingencies (store_id, status);

-- Documentos fiscales / electrónicos (separados de los documentos operativos).
create table if not exists public.fiscal_documents (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  point_id uuid references public.erp_warehouses(id) on delete restrict,
  fiscal_entity_id uuid not null references public.fiscal_entities(id) on delete restrict,
  establishment_id uuid references public.fiscal_establishments(id) on delete restrict,
  provider_account_id uuid references public.fiscal_provider_accounts(id) on delete restrict,
  range_id uuid references public.fiscal_numbering_ranges(id) on delete restrict,
  document_type text not null check (document_type in ('invoice', 'pos_equivalent', 'credit_note', 'debit_note',
    'support_document', 'support_adjustment', 'export_invoice', 'contingency_invoice')),
  environment text not null check (environment in ('sandbox', 'production')),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'READY', 'QUEUED', 'PROCESSING', 'SENT', 'ACCEPTED',
    'REJECTED', 'ERROR', 'CONTINGENCY', 'CANCEL_PENDING', 'CANCELLED', 'VOID')),
  prefix text,
  number bigint,
  full_number text,
  issue_date timestamptz not null default now(),
  due_date date,
  currency text not null default 'COP',
  payment_form text not null default 'cash' check (payment_form in ('cash', 'credit')),
  payment_method text,
  subtotal numeric(16, 2) not null default 0,
  discount_total numeric(16, 2) not null default 0,
  tax_total numeric(16, 2) not null default 0,
  total numeric(16, 2) not null default 0,
  issuer jsonb not null default '{}'::jsonb,
  customer_id uuid references public.billing_customers(id) on delete restrict,
  customer jsonb not null default '{}'::jsonb,
  customer_name text,
  customer_doc text,
  source_type text not null default 'manual' check (source_type in ('pos_order', 'order', 'manual', 'note')),
  source_id uuid,
  source_number text,
  related_document_id uuid references public.fiscal_documents(id) on delete restrict,
  note_concept text,
  note_reason text,
  provider text,
  provider_document_id text,
  provider_request_id text,
  provider_status text,
  provider_message text,
  dian_status text,
  dian_message text,
  cufe text,
  qr_data text,
  xml_path text,
  pdf_path text,
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  last_error_code text,
  last_error_message text,
  idempotency_key text,
  contingency_id uuid references public.fiscal_contingencies(id) on delete set null,
  sent_at timestamptz,
  accepted_at timestamptz,
  rejected_at timestamptz,
  cancelled_at timestamptz,
  voided_at timestamptz,
  void_reason text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists fiscal_documents_number_unique
  on public.fiscal_documents (fiscal_entity_id, environment, document_type, prefix, number) where number is not null;
create unique index if not exists fiscal_documents_idem_unique
  on public.fiscal_documents (store_id, idempotency_key) where idempotency_key is not null;
-- Una venta tiene a lo sumo una factura vigente (las anuladas o canceladas no cuentan).
create unique index if not exists fiscal_documents_source_unique
  on public.fiscal_documents (source_id)
  where source_id is not null and source_type in ('pos_order', 'order')
    and document_type in ('invoice', 'pos_equivalent', 'export_invoice', 'contingency_invoice')
    and status not in ('VOID', 'CANCELLED');
create index if not exists fiscal_documents_store_date on public.fiscal_documents (store_id, issue_date desc, id desc);
create index if not exists fiscal_documents_point_date on public.fiscal_documents (point_id, issue_date desc);
create index if not exists fiscal_documents_entity_date on public.fiscal_documents (fiscal_entity_id, issue_date desc);
create index if not exists fiscal_documents_status on public.fiscal_documents (store_id, status, issue_date desc);
create index if not exists fiscal_documents_type on public.fiscal_documents (store_id, document_type, issue_date desc);
create index if not exists fiscal_documents_cufe on public.fiscal_documents (cufe) where cufe is not null;
create index if not exists fiscal_documents_provider_doc on public.fiscal_documents (provider_account_id, provider_document_id) where provider_document_id is not null;
create index if not exists fiscal_documents_full_number on public.fiscal_documents (store_id, full_number);
create index if not exists fiscal_documents_created_by on public.fiscal_documents (created_by, created_at desc);
create index if not exists fiscal_documents_retry on public.fiscal_documents (next_attempt_at) where status in ('ERROR', 'QUEUED');
create index if not exists fiscal_documents_related on public.fiscal_documents (related_document_id) where related_document_id is not null;
create index if not exists fiscal_documents_source on public.fiscal_documents (source_id) where source_id is not null;

create table if not exists public.fiscal_document_lines (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.fiscal_documents(id) on delete restrict,
  store_id uuid not null,
  line_no integer not null,
  product_id uuid,
  sku text,
  description text not null,
  -- Código de unidad (REQUIERE VALIDACIÓN con el proveedor: 94 = unidad).
  unit_code text not null default '94',
  qty numeric(16, 4) not null check (qty > 0),
  unit_price numeric(16, 4) not null check (unit_price >= 0),
  discount numeric(16, 2) not null default 0,
  tax_rate numeric(6, 3) not null default 0,
  line_subtotal numeric(16, 2) not null default 0,
  line_tax numeric(16, 2) not null default 0,
  line_total numeric(16, 2) not null default 0,
  ref_line_no integer,
  unique (document_id, line_no)
);

create table if not exists public.fiscal_document_events (
  id bigserial primary key,
  document_id uuid not null references public.fiscal_documents(id) on delete restrict,
  store_id uuid not null,
  event text not null,
  status_from text,
  status_to text,
  message text,
  payload jsonb not null default '{}'::jsonb,
  error_code text,
  actor_id uuid,
  actor_name text,
  source text not null default 'app' check (source in ('app', 'provider', 'webhook', 'system', 'job')),
  ip text,
  user_agent text,
  request_id text,
  created_at timestamptz not null default now()
);
create index if not exists fiscal_document_events_doc on public.fiscal_document_events (document_id, id);
create index if not exists fiscal_document_events_store on public.fiscal_document_events (store_id, created_at desc);

-- Webhooks recibidos (cada evento se guarda una sola vez).
create table if not exists public.fiscal_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_account_id uuid references public.fiscal_provider_accounts(id) on delete set null,
  store_id uuid references public.stores(id) on delete set null,
  external_event_id text,
  event_type text,
  signature_valid boolean not null default false,
  payload jsonb,
  payload_hash text not null,
  headers jsonb not null default '{}'::jsonb,
  status text not null default 'received' check (status in ('received', 'processing', 'processed', 'failed', 'dead', 'rejected', 'ignored')),
  attempts integer not null default 0,
  next_retry_at timestamptz,
  last_error text,
  document_id uuid references public.fiscal_documents(id) on delete set null,
  source_ip text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create unique index if not exists fiscal_webhook_events_external_unique
  on public.fiscal_webhook_events (provider_account_id, external_event_id) where external_event_id is not null;
create unique index if not exists fiscal_webhook_events_hash_unique
  on public.fiscal_webhook_events (provider_account_id, payload_hash) where external_event_id is null;
create index if not exists fiscal_webhook_events_store on public.fiscal_webhook_events (store_id, received_at desc);
create index if not exists fiscal_webhook_events_retry on public.fiscal_webhook_events (next_retry_at) where status in ('failed', 'received');

-- Certificados (cuando el proveedor exige certificado propio del contribuyente).
create table if not exists public.fiscal_certificates (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  fiscal_entity_id uuid not null references public.fiscal_entities(id) on delete cascade,
  provider_account_id uuid references public.fiscal_provider_accounts(id) on delete set null,
  managed_by text not null default 'provider' check (managed_by in ('provider', 'own')),
  subject text,
  issuer text,
  serial_number text,
  valid_from date,
  valid_until date not null,
  status text not null default 'active' check (status in ('active', 'revoked', 'expired', 'replaced')),
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fiscal_certificates_entity on public.fiscal_certificates (fiscal_entity_id, valid_until);


-- ---------------------------------------------------------------------
-- 7. Reglas de integridad fiscal (validaciones e inmutabilidad)
-- ---------------------------------------------------------------------

create or replace function public.fiscal__view_perms()
returns text[]
language sql
immutable
as $$
  select array['fiscal', 'fiscal_send', 'fiscal_notes', 'fiscal_download', 'fiscal_config', 'fiscal_numbering', 'fiscal_provider', 'fiscal_audit']::text[];
$$;

create or replace function public.fiscal__today()
returns date
language sql
stable
as $$
  select (now() at time zone 'America/Bogota')::date;
$$;

-- Datos que faltan para poder facturar con un contribuyente.
create or replace function public.fiscal__entity_missing(e public.fiscal_entities)
returns text[]
language plpgsql
immutable
as $$
declare m text[] := '{}';
begin
  if e.id is null then return array['Contribuyente']; end if;
  if coalesce(trim(e.legal_name), '') = '' then m := array_append(m, 'nombre o razón social'); end if;
  if coalesce(e.document_number, '') = '' then m := array_append(m, 'número de documento'); end if;
  if e.document_type = 'NIT' and coalesce(e.verification_digit, '') = '' then m := array_append(m, 'dígito de verificación'); end if;
  if coalesce(trim(e.tax_regime), '') = '' then m := array_append(m, 'régimen'); end if;
  if cardinality(e.tax_responsibilities) = 0 then m := array_append(m, 'responsabilidades del RUT'); end if;
  if coalesce(trim(e.fiscal_address), '') = '' then m := array_append(m, 'dirección fiscal'); end if;
  if coalesce(trim(e.city), '') = '' then m := array_append(m, 'ciudad'); end if;
  if coalesce(trim(e.department), '') = '' then m := array_append(m, 'departamento'); end if;
  if coalesce(trim(e.email), '') = '' then m := array_append(m, 'correo'); end if;
  return m;
end;
$$;

-- Contribuyente: normaliza documento, calcula/valida el DV y protege el NIT si ya facturó.
create or replace function public.fiscal__entity_normalize()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dv text;
  v_missing text[];
begin
  if new.document_type in ('NIT', 'CC', 'TI', 'CE') then
    new.document_number := nullif(regexp_replace(split_part(coalesce(new.document_number, ''), '-', 1), '\D', '', 'g'), '');
  else
    new.document_number := nullif(regexp_replace(upper(coalesce(new.document_number, '')), '[^A-Z0-9]', '', 'g'), '');
  end if;
  -- Un contribuyente que ya facturó conserva su NIT para siempre.
  if tg_op = 'UPDATE'
     and (new.document_number is distinct from old.document_number or new.document_type is distinct from old.document_type
          or new.store_id is distinct from old.store_id)
     and exists (select 1 from public.fiscal_documents d where d.fiscal_entity_id = old.id and d.number is not null) then
    raise exception 'Este contribuyente ya tiene documentos numerados: su NIT no se cambia. Crea un contribuyente nuevo.';
  end if;
  new.legal_name := upper(trim(coalesce(new.legal_name, '')));
  if new.legal_name = '' then raise exception 'Escribe el nombre o la razón social.'; end if;
  new.trade_name := nullif(upper(trim(coalesce(new.trade_name, ''))), '');
  new.verification_digit := nullif(trim(coalesce(new.verification_digit, '')), '');
  if new.document_type = 'NIT' and new.document_number is not null then
    v_dv := public.fiscal_nit_dv(new.document_number);
    if v_dv is null then
      raise exception 'El NIT % no es válido (debe tener entre 5 y 15 dígitos).', new.document_number;
    end if;
    if new.verification_digit is null then
      new.verification_digit := v_dv;
    elsif new.verification_digit <> v_dv then
      raise exception 'El dígito de verificación no coincide: para el NIT % debe ser %.', new.document_number, v_dv;
    end if;
  elsif new.document_type <> 'NIT' then
    new.verification_digit := null;
  end if;
  if new.person_type = 'juridica' and new.document_type not in ('NIT', 'NIT_EXT') then
    raise exception 'Una persona jurídica se identifica con NIT.';
  end if;
  new.email := nullif(lower(trim(coalesce(new.email, ''))), '');
  new.dian_email := nullif(lower(trim(coalesce(new.dian_email, ''))), '');
  if new.email is not null and new.email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'El correo % no es válido.', new.email;
  end if;
  if new.dian_email is not null and new.dian_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'El correo registrado en el RUT % no es válido.', new.dian_email;
  end if;
  new.tax_responsibilities := array(select distinct upper(trim(x)) from unnest(coalesce(new.tax_responsibilities, '{}'::text[])) as x where trim(x) <> '');
  new.economic_activities := array(select distinct trim(x) from unnest(coalesce(new.economic_activities, '{}'::text[])) as x where trim(x) <> '');
  if exists (select 1 from unnest(new.economic_activities) as x where x !~ '^[0-9]{4}$') then
    raise exception 'Las actividades económicas (CIIU) son códigos de 4 dígitos.';
  end if;
  new.city := nullif(upper(trim(coalesce(new.city, ''))), '');
  new.department := nullif(upper(trim(coalesce(new.department, ''))), '');
  new.country := upper(coalesce(nullif(trim(new.country), ''), 'CO'));
  if new.status = 'active' then
    v_missing := public.fiscal__entity_missing(new);
    if cardinality(v_missing) > 0 then
      raise exception 'Para activar el contribuyente completa: %.', array_to_string(v_missing, ', ');
    end if;
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    new.updated_by := public.erp__actor_id();
  end if;
  return new;
end;
$$;
drop trigger if exists fiscal_entities_normalize on public.fiscal_entities;
create trigger fiscal_entities_normalize before insert or update on public.fiscal_entities
  for each row execute function public.fiscal__entity_normalize();

-- Establecimiento: mismo contribuyente y tienda.
create or replace function public.fiscal__establishment_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.name := upper(trim(coalesce(new.name, '')));
  if new.name = '' then raise exception 'Escribe el nombre del establecimiento.'; end if;
  new.code := nullif(upper(trim(coalesce(new.code, ''))), '');
  new.city := nullif(upper(trim(coalesce(new.city, ''))), '');
  new.department := nullif(upper(trim(coalesce(new.department, ''))), '');
  if not exists (select 1 from public.fiscal_entities e where e.id = new.fiscal_entity_id and e.store_id = new.store_id) then
    raise exception 'El contribuyente no pertenece a esta tienda.';
  end if;
  if new.point_id is not null and not exists (select 1 from public.erp_warehouses w where w.id = new.point_id and w.store_id = new.store_id) then
    raise exception 'El punto no pertenece a esta tienda.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists fiscal_establishments_check on public.fiscal_establishments;
create trigger fiscal_establishments_check before insert or update on public.fiscal_establishments
  for each row execute function public.fiscal__establishment_check();

-- Cuenta del proveedor: mismo contribuyente; el simulador nunca en producción.
create or replace function public.fiscal__provider_account_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare p public.fiscal_providers;
begin
  select * into p from public.fiscal_providers where code = new.provider;
  if p.code is null then raise exception 'Proveedor tecnológico desconocido.'; end if;
  if not exists (select 1 from public.fiscal_entities e where e.id = new.fiscal_entity_id and e.store_id = new.store_id) then
    raise exception 'El contribuyente no pertenece a esta tienda.';
  end if;
  if new.environment = 'production' and not p.supports_production then
    raise exception '% no se puede usar en producción.', p.name;
  end if;
  if new.status = 'connected' and p.status <> 'available' then
    raise exception '% aún no está integrado en RemHub.', p.name;
  end if;
  if tg_op = 'UPDATE' then
    if (new.environment is distinct from old.environment or new.fiscal_entity_id is distinct from old.fiscal_entity_id
        or new.provider is distinct from old.provider)
       and exists (select 1 from public.fiscal_documents d where d.provider_account_id = old.id) then
      raise exception 'Esta cuenta ya emitió documentos: crea otra cuenta en lugar de cambiar su ambiente, proveedor o contribuyente.';
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists fiscal_provider_accounts_check on public.fiscal_provider_accounts;
create trigger fiscal_provider_accounts_check before insert or update on public.fiscal_provider_accounts
  for each row execute function public.fiscal__provider_account_check();

-- Configuración del punto: todo debe pertenecer al mismo contribuyente, tienda y ambiente.
create or replace function public.fiscal__point_config_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_point_store uuid;
  e public.fiscal_entities;
  s public.fiscal_establishments;
  a public.fiscal_provider_accounts;
begin
  select store_id into v_point_store from public.erp_warehouses where id = new.point_id;
  if v_point_store is null or v_point_store <> new.store_id then raise exception 'El punto no pertenece a esta tienda.'; end if;
  if new.fiscal_entity_id is not null then
    select * into e from public.fiscal_entities where id = new.fiscal_entity_id;
    if e.id is null or e.store_id <> new.store_id then raise exception 'El contribuyente no pertenece a esta tienda.'; end if;
  end if;
  if new.establishment_id is not null then
    select * into s from public.fiscal_establishments where id = new.establishment_id;
    if s.id is null or s.fiscal_entity_id is distinct from new.fiscal_entity_id then
      raise exception 'El establecimiento no pertenece al contribuyente elegido.';
    end if;
  end if;
  if new.provider_account_id is not null then
    select * into a from public.fiscal_provider_accounts where id = new.provider_account_id;
    if a.id is null or a.fiscal_entity_id is distinct from new.fiscal_entity_id then
      raise exception 'La cuenta del proveedor no pertenece al contribuyente elegido.';
    end if;
    if a.environment <> new.environment then
      raise exception 'La cuenta del proveedor está en % y el punto en %: no se mezclan ambientes.', a.environment, new.environment;
    end if;
  end if;
  if new.enabled and (new.fiscal_entity_id is null or new.provider_account_id is null) then
    raise exception 'Para activar la facturación del punto elige el contribuyente y el proveedor.';
  end if;
  if new.environment = 'production' and new.production_confirmed_at is null then
    raise exception 'El paso a producción debe confirmarse explícitamente.';
  end if;
  if new.environment = 'sandbox' then
    new.production_confirmed_at := null;
    new.production_confirmed_by := null;
  end if;
  new.updated_at := now();
  new.updated_by := public.erp__actor_id();
  return new;
end;
$$;
drop trigger if exists fiscal_point_configs_check on public.fiscal_point_configs;
create trigger fiscal_point_configs_check before insert or update on public.fiscal_point_configs
  for each row execute function public.fiscal__point_config_check();

-- Numeración: rangos coherentes, sin cruces, y sin tocar lo ya entregado.
create or replace function public.fiscal__range_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max bigint;
  v_min bigint;
  v_bad integer;
  v_clash text;
begin
  new.prefix := upper(trim(coalesce(new.prefix, '')));
  new.resolution_number := nullif(trim(coalesce(new.resolution_number, '')), '');
  new.point_ids := array(select distinct x from unnest(coalesce(new.point_ids, '{}'::uuid[])) as x where x is not null);
  if not exists (select 1 from public.fiscal_entities e where e.id = new.fiscal_entity_id and e.store_id = new.store_id) then
    raise exception 'El contribuyente no pertenece a esta tienda.';
  end if;
  select count(*) into v_bad from unnest(new.point_ids) as x
  where not exists (select 1 from public.erp_warehouses w where w.id = x and w.store_id = new.store_id);
  if v_bad > 0 then raise exception 'Hay puntos que no pertenecen a esta tienda.'; end if;
  if new.next_number is null then new.next_number := new.range_from; end if;

  if new.status = 'active' then
    if new.requires_resolution and (new.resolution_number is null or new.resolution_date is null or new.valid_until is null) then
      raise exception 'Para activar la numeración completa el número, la fecha y la vigencia de la resolución.';
    end if;
    if cardinality(new.point_ids) = 0 then
      raise exception 'Autoriza al menos un punto para usar esta numeración.';
    end if;
  end if;

  -- Sin cruces con otro rango del mismo contribuyente, tipo, ambiente y prefijo.
  perform pg_advisory_xact_lock(hashtext('fiscal_range:' || new.fiscal_entity_id::text || ':' || new.prefix));
  select coalesce(nullif(r.name, ''), coalesce(nullif(r.prefix, ''), 'sin prefijo') || ' ' || r.range_from || '-' || r.range_to) into v_clash
  from public.fiscal_numbering_ranges r
  where r.id <> new.id and r.fiscal_entity_id = new.fiscal_entity_id and r.document_type = new.document_type
    and r.environment = new.environment and r.prefix = new.prefix
    and r.range_from <= new.range_to and new.range_from <= r.range_to
  limit 1;
  if v_clash is not null then
    raise exception 'Ese rango se cruza con la numeración %: dos documentos podrían quedar con el mismo número.', v_clash;
  end if;

  if tg_op = 'UPDATE' then
    select max(a.number), min(a.number) into v_max, v_min from public.fiscal_number_allocations a where a.range_id = old.id;
    if v_max is not null then
      if new.prefix <> old.prefix or new.fiscal_entity_id <> old.fiscal_entity_id or new.document_type <> old.document_type
         or new.environment <> old.environment or new.store_id <> old.store_id then
        raise exception 'Esta numeración ya entregó números: no se cambia su prefijo, tipo, ambiente ni contribuyente.';
      end if;
      if new.range_from > v_min then raise exception 'El inicio del rango no puede pasar del primer número usado (%).', v_min; end if;
      if new.range_to < v_max then raise exception 'El final del rango no puede ser menor al último número usado (%).', v_max; end if;
      if new.next_number <= v_max then raise exception 'El siguiente número debe ser mayor al último usado (%).', v_max; end if;
    end if;
    new.updated_at := now();
    new.updated_by := public.erp__actor_id();
  end if;

  if new.next_number > new.range_to and new.status = 'active' then new.status := 'exhausted'; end if;
  return new;
end;
$$;
drop trigger if exists fiscal_ranges_check on public.fiscal_numbering_ranges;
create trigger fiscal_ranges_check before insert or update on public.fiscal_numbering_ranges
  for each row execute function public.fiscal__range_check();

-- Cambios de estado permitidos del documento fiscal.
create or replace function public.fiscal__transition_ok(p_from text, p_to text)
returns boolean
language sql
immutable
as $$
  select p_from = p_to or case p_from
    when 'DRAFT' then p_to in ('READY', 'QUEUED', 'CONTINGENCY', 'VOID')
    when 'READY' then p_to in ('QUEUED', 'PROCESSING', 'CONTINGENCY', 'VOID')
    when 'QUEUED' then p_to in ('PROCESSING', 'CONTINGENCY', 'ERROR', 'VOID')
    when 'PROCESSING' then p_to in ('SENT', 'ACCEPTED', 'REJECTED', 'ERROR', 'CONTINGENCY', 'QUEUED')
    when 'SENT' then p_to in ('PROCESSING', 'ACCEPTED', 'REJECTED', 'ERROR')
    when 'ERROR' then p_to in ('PROCESSING', 'QUEUED', 'CONTINGENCY', 'SENT', 'ACCEPTED', 'REJECTED', 'VOID')
    when 'REJECTED' then p_to in ('PROCESSING', 'QUEUED', 'VOID')
    when 'CONTINGENCY' then p_to in ('QUEUED', 'PROCESSING', 'ERROR', 'ACCEPTED', 'REJECTED', 'VOID')
    when 'ACCEPTED' then p_to in ('CANCEL_PENDING', 'CANCELLED')
    when 'CANCEL_PENDING' then p_to in ('CANCELLED', 'ACCEPTED')
    else false
  end;
$$;

create or replace function public.fiscal__document_guard()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('remhub.audit_maintenance', true), '') = 'on' then return new; end if;
  if not public.fiscal__transition_ok(old.status, new.status) then
    raise exception 'Cambio de estado no permitido: % → %.', old.status, new.status using errcode = 'P0001';
  end if;
  if old.number is not null and (
       new.number is distinct from old.number or new.prefix is distinct from old.prefix
       or new.full_number is distinct from old.full_number or new.range_id is distinct from old.range_id
       or new.fiscal_entity_id is distinct from old.fiscal_entity_id or new.document_type is distinct from old.document_type
       or new.environment is distinct from old.environment or new.store_id is distinct from old.store_id
       or new.point_id is distinct from old.point_id or new.issuer is distinct from old.issuer
       or new.source_id is distinct from old.source_id or new.related_document_id is distinct from old.related_document_id) then
    raise exception 'La identidad fiscal de un documento numerado no se puede cambiar.' using errcode = 'P0001';
  end if;
  if old.status in ('SENT', 'ACCEPTED', 'CANCEL_PENDING', 'CANCELLED') or (old.sent_at is not null and old.status <> 'REJECTED') then
    if new.total is distinct from old.total or new.subtotal is distinct from old.subtotal
       or new.tax_total is distinct from old.tax_total or new.discount_total is distinct from old.discount_total
       or new.customer is distinct from old.customer or new.customer_id is distinct from old.customer_id
       or new.issue_date is distinct from old.issue_date then
      raise exception 'Un documento transmitido no se modifica: usa una nota crédito o débito.' using errcode = 'P0001';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists fiscal_documents_guard on public.fiscal_documents;
create trigger fiscal_documents_guard before update on public.fiscal_documents
  for each row execute function public.fiscal__document_guard();

-- Nunca se borra físicamente un documento fiscal, sus líneas, eventos ni números entregados.
create or replace function public.fiscal__no_delete()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('remhub.audit_maintenance', true), '') = 'on' then return old; end if;
  raise exception 'Los documentos fiscales y su historial no se borran: usa una nota crédito o la anulación correspondiente.'
    using errcode = '42501';
end;
$$;
drop trigger if exists fiscal_documents_no_delete on public.fiscal_documents;
create trigger fiscal_documents_no_delete before delete on public.fiscal_documents
  for each row execute function public.fiscal__no_delete();
drop trigger if exists fiscal_lines_no_delete on public.fiscal_document_lines;
create trigger fiscal_lines_no_delete before delete on public.fiscal_document_lines
  for each row execute function public.fiscal__no_delete();
drop trigger if exists fiscal_events_no_delete on public.fiscal_document_events;
create trigger fiscal_events_no_delete before delete on public.fiscal_document_events
  for each row execute function public.fiscal__no_delete();
drop trigger if exists fiscal_allocations_no_delete on public.fiscal_number_allocations;
create trigger fiscal_allocations_no_delete before delete on public.fiscal_number_allocations
  for each row execute function public.fiscal__no_delete();

-- Las líneas no cambian; solo se agregan mientras el documento no se ha transmitido.
create or replace function public.fiscal__lines_guard()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('remhub.audit_maintenance', true), '') = 'on' then return new; end if;
  if tg_op = 'UPDATE' then raise exception 'Las líneas de un documento fiscal no se modifican.'; end if;
  if exists (select 1 from public.fiscal_documents d where d.id = new.document_id
             and (d.sent_at is not null or d.status not in ('DRAFT', 'READY', 'QUEUED', 'CONTINGENCY'))) then
    raise exception 'El documento ya fue transmitido: no se le agregan líneas.';
  end if;
  return new;
end;
$$;
drop trigger if exists fiscal_lines_guard on public.fiscal_document_lines;
create trigger fiscal_lines_guard before insert or update on public.fiscal_document_lines
  for each row execute function public.fiscal__lines_guard();

-- Eventos: solo se agregan.
create or replace function public.fiscal__append_only()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('remhub.audit_maintenance', true), '') = 'on' then return new; end if;
  raise exception 'El historial fiscal no se modifica.' using errcode = '42501';
end;
$$;
drop trigger if exists fiscal_events_append_only on public.fiscal_document_events;
create trigger fiscal_events_append_only before update on public.fiscal_document_events
  for each row execute function public.fiscal__append_only();

-- Números entregados: solo puede cambiar su estado (anulado sin transmitir) o el documento asignado.
create or replace function public.fiscal__allocation_guard()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('remhub.audit_maintenance', true), '') = 'on' then return new; end if;
  if new.range_id <> old.range_id or new.number <> old.number or new.prefix <> old.prefix
     or new.fiscal_entity_id <> old.fiscal_entity_id or new.document_type <> old.document_type
     or new.environment <> old.environment
     or (old.document_id is not null and new.document_id is distinct from old.document_id) then
    raise exception 'Un número entregado no se modifica.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists fiscal_allocations_guard on public.fiscal_number_allocations;
create trigger fiscal_allocations_guard before update on public.fiscal_number_allocations
  for each row execute function public.fiscal__allocation_guard();

-- Una venta con documento electrónico ya no se edita (se corrige con notas).
create or replace function public.fiscal__lock_invoiced_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_order uuid;
begin
  if coalesce(current_setting('remhub.audit_maintenance', true), '') = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_table_name = 'orders' then
    v_order := old.id;
  elsif tg_op = 'DELETE' then
    v_order := old.order_id;
  else
    v_order := new.order_id;
  end if;
  if exists (select 1 from public.fiscal_documents d
             where d.source_id = v_order and d.source_type in ('pos_order', 'order')
               and d.document_type in ('invoice', 'pos_equivalent', 'export_invoice', 'contingency_invoice')
               and d.status <> 'VOID') then
    if tg_table_name = 'orders' and tg_op = 'UPDATE' then
      if new.total is not distinct from old.total then return new; end if;
    end if;
    raise exception 'Esta venta ya tiene documento electrónico: corrígela con una nota crédito o débito.' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists fiscal_lock_order_items on public.order_items;
create trigger fiscal_lock_order_items before insert or update or delete on public.order_items
  for each row execute function public.fiscal__lock_invoiced_order();
drop trigger if exists fiscal_lock_orders on public.orders;
create trigger fiscal_lock_orders before update of total or delete on public.orders
  for each row execute function public.fiscal__lock_invoiced_order();

-- En puntos con facturación electrónica activa, la «factura» la emite solo el motor fiscal
-- (así nunca hay dos números para una venta) y se aplica la regla de remisiones de la tienda.
create or replace function public.fiscal__guard_order_meta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled boolean;
  v_org boolean;
  v_policy text;
begin
  if coalesce(current_setting('remhub.fiscal_issue', true), '') = 'on' or new.point_id is null then return new; end if;
  select pc.enabled into v_enabled from public.fiscal_point_configs pc where pc.point_id = new.point_id;
  select os.fiscal_enabled, os.remission_policy into v_org, v_policy from public.erp_org_settings os where os.store_id = new.store_id;
  if coalesce(v_enabled, false) and coalesce(v_org, false) then
    if new.doc_kind = 'factura' then
      raise exception 'En este punto las facturas son electrónicas: elige «Factura electrónica» en el POS.' using errcode = 'P0001';
    end if;
    if new.doc_kind = 'remision' and v_policy = 'block' then
      raise exception 'La tienda configuró que las ventas de este punto se facturen electrónicamente (remisiones de venta bloqueadas).'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists fiscal_guard_order_meta on public.erp_order_meta;
create trigger fiscal_guard_order_meta before insert on public.erp_order_meta
  for each row execute function public.fiscal__guard_order_meta();

-- Auditoría de la configuración fiscal (antes → después, con motivo).
drop trigger if exists fiscal_entities_audit on public.fiscal_entities;
create trigger fiscal_entities_audit after insert or update or delete on public.fiscal_entities
  for each row execute function public.erp__audit_row('fiscal', 'contribuyente', '', 'updated_at,updated_by',
    'document_type,document_number,verification_digit,legal_name,person_type,tax_regime,tax_responsibilities,status', 'id');
drop trigger if exists fiscal_establishments_audit on public.fiscal_establishments;
create trigger fiscal_establishments_audit after insert or update or delete on public.fiscal_establishments
  for each row execute function public.erp__audit_row('fiscal', 'establecimiento', 'point_id', 'updated_at',
    'code,status,fiscal_entity_id,address', 'id');
drop trigger if exists fiscal_ranges_audit on public.fiscal_numbering_ranges;
create trigger fiscal_ranges_audit after insert or update or delete on public.fiscal_numbering_ranges
  for each row execute function public.erp__audit_row('fiscal', 'numeracion', '', 'updated_at,updated_by,next_number',
    'prefix,range_from,range_to,resolution_number,resolution_date,valid_from,valid_until,status,environment,point_ids,fiscal_entity_id,document_type', 'id');
drop trigger if exists fiscal_provider_accounts_audit on public.fiscal_provider_accounts;
create trigger fiscal_provider_accounts_audit after insert or update or delete on public.fiscal_provider_accounts
  for each row execute function public.erp__audit_row('fiscal', 'proveedor_tecnologico', '',
    'updated_at,last_test_at,last_test_ok,last_error,webhook_last_event_at,webhook_failures,webhook_status,webhook_token',
    'provider,environment,status,external_account_id,fiscal_entity_id,credentials_hint', 'id');
drop trigger if exists fiscal_point_configs_audit on public.fiscal_point_configs;
create trigger fiscal_point_configs_audit after insert or update or delete on public.fiscal_point_configs
  for each row execute function public.erp__audit_row('fiscal', 'config_fiscal_punto', 'point_id', 'updated_at,updated_by',
    'fiscal_entity_id,environment,enabled,provider_account_id,pos_document_type,production_confirmed_at', 'point_id');
drop trigger if exists fiscal_certificates_audit on public.fiscal_certificates;
create trigger fiscal_certificates_audit after insert or update or delete on public.fiscal_certificates
  for each row execute function public.erp__audit_row('fiscal', 'certificado', '', 'updated_at', 'valid_until,status', 'id');

-- ---------------------------------------------------------------------
-- 8. Seguridad (RLS) del módulo fiscal. Todas las escrituras pasan por
--    funciones que validan usuario → tienda → punto → permiso → recurso.
-- ---------------------------------------------------------------------

-- Contribuyente visible: tienda madre ve todos; un usuario de punto solo el de sus puntos.
create or replace function public.fiscal__entity_visible(p_store uuid, p_entity uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare v uuid[] := public.erp_my_points(p_store);
begin
  if v is null then return true; end if;
  return exists (select 1 from public.fiscal_point_configs c where c.fiscal_entity_id = p_entity and c.point_id = any (v));
end;
$$;
grant execute on function public.fiscal__entity_visible(uuid, uuid) to authenticated;

alter table public.fiscal_entities enable row level security;
alter table public.fiscal_establishments enable row level security;
alter table public.fiscal_provider_accounts enable row level security;
alter table public.fiscal_secrets enable row level security;
alter table public.fiscal_point_configs enable row level security;
alter table public.fiscal_numbering_ranges enable row level security;
alter table public.fiscal_number_allocations enable row level security;
alter table public.fiscal_contingencies enable row level security;
alter table public.fiscal_documents enable row level security;
alter table public.fiscal_document_lines enable row level security;
alter table public.fiscal_document_events enable row level security;
alter table public.fiscal_webhook_events enable row level security;
alter table public.fiscal_certificates enable row level security;

drop policy if exists fiscal_entities_read on public.fiscal_entities;
create policy fiscal_entities_read on public.fiscal_entities for select to authenticated
  using (public.erp_can_any(store_id, public.fiscal__view_perms() || array['points']::text[])
         and public.fiscal__entity_visible(store_id, id));

drop policy if exists fiscal_establishments_read on public.fiscal_establishments;
create policy fiscal_establishments_read on public.fiscal_establishments for select to authenticated
  using (public.erp_can_any(store_id, public.fiscal__view_perms() || array['points']::text[])
         and (public.erp_my_points(store_id) is null
              or (point_id is not null and point_id = any (public.erp_my_points(store_id)))
              or public.fiscal__entity_visible(store_id, fiscal_entity_id)));

drop policy if exists fiscal_provider_accounts_read on public.fiscal_provider_accounts;
create policy fiscal_provider_accounts_read on public.fiscal_provider_accounts for select to authenticated
  using (public.erp_can_any(store_id, array['fiscal', 'fiscal_provider', 'fiscal_config', 'fiscal_audit']::text[])
         and public.fiscal__entity_visible(store_id, fiscal_entity_id));

drop policy if exists fiscal_point_configs_read on public.fiscal_point_configs;
create policy fiscal_point_configs_read on public.fiscal_point_configs for select to authenticated
  using (public.erp_can_any(store_id, public.fiscal__view_perms() || array['points']::text[])
         and public.erp_point_allowed(store_id, point_id));

drop policy if exists fiscal_ranges_read on public.fiscal_numbering_ranges;
create policy fiscal_ranges_read on public.fiscal_numbering_ranges for select to authenticated
  using (public.erp_can_any(store_id, array['fiscal', 'fiscal_numbering', 'fiscal_config', 'fiscal_audit', 'fiscal_send']::text[])
         and (public.erp_my_points(store_id) is null or point_ids && public.erp_my_points(store_id)));

drop policy if exists fiscal_allocations_read on public.fiscal_number_allocations;
create policy fiscal_allocations_read on public.fiscal_number_allocations for select to authenticated
  using (public.erp_can_any(store_id, array['fiscal_numbering', 'fiscal_audit']::text[])
         and exists (select 1 from public.fiscal_numbering_ranges r where r.id = range_id));

drop policy if exists fiscal_contingencies_read on public.fiscal_contingencies;
create policy fiscal_contingencies_read on public.fiscal_contingencies for select to authenticated
  using (public.erp_can_any(store_id, public.fiscal__view_perms())
         and (public.erp_my_points(store_id) is null or (point_id is not null and public.erp_point_allowed(store_id, point_id))));

drop policy if exists fiscal_documents_read on public.fiscal_documents;
create policy fiscal_documents_read on public.fiscal_documents for select to authenticated
  using (
    (public.erp_can_any(store_id, public.fiscal__view_perms()) and public.erp_point_allowed(store_id, point_id))
    or (public.erp_can(store_id, 'pos') and point_id is not null and point_id = public.erp_my_point(store_id))
  );

drop policy if exists fiscal_lines_read on public.fiscal_document_lines;
create policy fiscal_lines_read on public.fiscal_document_lines for select to authenticated
  using (exists (select 1 from public.fiscal_documents d where d.id = document_id));

drop policy if exists fiscal_events_read on public.fiscal_document_events;
create policy fiscal_events_read on public.fiscal_document_events for select to authenticated
  using (exists (select 1 from public.fiscal_documents d where d.id = document_id));

drop policy if exists fiscal_webhook_events_read on public.fiscal_webhook_events;
create policy fiscal_webhook_events_read on public.fiscal_webhook_events for select to authenticated
  using (store_id is not null and public.erp_can_any(store_id, array['fiscal_provider', 'fiscal_audit']::text[])
         and public.erp_my_points(store_id) is null);

drop policy if exists fiscal_certificates_read on public.fiscal_certificates;
create policy fiscal_certificates_read on public.fiscal_certificates for select to authenticated
  using (public.erp_can_any(store_id, array['fiscal_config', 'fiscal_provider', 'fiscal_audit']::text[])
         and public.fiscal__entity_visible(store_id, fiscal_entity_id));

-- Sin escrituras directas desde el navegador. Los secretos no se leen nunca desde el navegador.
revoke insert, update, delete on public.fiscal_entities, public.fiscal_establishments, public.fiscal_provider_accounts,
  public.fiscal_point_configs, public.fiscal_numbering_ranges, public.fiscal_number_allocations, public.fiscal_contingencies,
  public.fiscal_documents, public.fiscal_document_lines, public.fiscal_document_events, public.fiscal_webhook_events,
  public.fiscal_certificates
  from anon, authenticated;
revoke all on public.fiscal_entities, public.fiscal_establishments, public.fiscal_provider_accounts,
  public.fiscal_point_configs, public.fiscal_numbering_ranges, public.fiscal_number_allocations, public.fiscal_contingencies,
  public.fiscal_documents, public.fiscal_document_lines, public.fiscal_document_events, public.fiscal_webhook_events,
  public.fiscal_certificates, public.fiscal_providers
  from anon;
revoke all on public.fiscal_secrets from anon, authenticated;


-- ---------------------------------------------------------------------
-- 9. Motor fiscal
-- ---------------------------------------------------------------------

create or replace function public.fiscal__check(p_key text, p_label text, p_ok boolean, p_detail text default null, p_na boolean default false)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('key', p_key, 'label', p_label, 'ok', coalesce(p_ok, false) or coalesce(p_na, false),
                            'na', coalesce(p_na, false), 'detail', p_detail);
$$;

create or replace function public.fiscal__range_info(r public.fiscal_numbering_ranges)
returns jsonb
language plpgsql
stable
as $$
declare
  v_total numeric;
  v_used numeric;
  v_days integer;
begin
  if r.id is null then return null; end if;
  v_total := greatest(r.range_to - r.range_from + 1, 1);
  v_used := r.next_number - r.range_from;
  v_days := case when r.valid_until is null then null else r.valid_until - public.fiscal__today() end;
  return jsonb_build_object(
    'id', r.id, 'name', r.name, 'document_type', r.document_type, 'environment', r.environment,
    'prefix', r.prefix, 'resolution_number', r.resolution_number, 'resolution_date', r.resolution_date,
    'valid_from', r.valid_from, 'valid_until', r.valid_until, 'range_from', r.range_from, 'range_to', r.range_to,
    'next_number', r.next_number, 'remaining', greatest(r.range_to - r.next_number + 1, 0),
    'used_pct', round(v_used * 100 / v_total, 1), 'days_left', v_days, 'status', r.status,
    'near_exhaustion', (v_used * 100 / v_total) >= r.alert_percent,
    'near_expiry', v_days is not null and v_days <= r.alert_days,
    'expired', v_days is not null and v_days < 0,
    'point_ids', to_jsonb(r.point_ids), 'requires_resolution', r.requires_resolution,
    'alert_percent', r.alert_percent, 'alert_days', r.alert_days, 'technical_key_hint', r.technical_key_hint);
end;
$$;

-- Numeración vigente que puede usar un punto (rango activo, vigente, con números y autorizado al punto).
create or replace function public.fiscal__pick_range(p_point uuid, p_entity uuid, p_doc_type text, p_env text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select r.id
  from public.fiscal_numbering_ranges r
  where r.fiscal_entity_id = p_entity and r.document_type = p_doc_type and r.environment = p_env
    and r.status = 'active' and p_point = any (r.point_ids)
    and r.next_number <= r.range_to
    and (r.valid_from is null or r.valid_from <= public.fiscal__today())
    and (r.valid_until is null or r.valid_until >= public.fiscal__today())
  order by r.valid_from nulls first, r.created_at
  limit 1;
$$;

-- Lista de verificación «¿está listo para facturar?» de un punto (sin permisos: uso interno).
create or replace function public.fiscal__point_readiness(p_point uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  w public.erp_warehouses;
  cfg public.fiscal_point_configs;
  ent public.fiscal_entities;
  est public.fiscal_establishments;
  acc public.fiscal_provider_accounts;
  prov public.fiscal_providers;
  rng public.fiscal_numbering_ranges;
  v_org boolean;
  v_checks jsonb := '[]'::jsonb;
  v_missing text[] := '{}';
  v_warn text[] := '{}';
  v_doc text;
  v_env text;
  v_tmp text[];
  v_info jsonb;
  v_cont uuid;
  v_ok boolean;
  v_na boolean;
  v_detail text;
begin
  select * into w from public.erp_warehouses where id = p_point;
  if w.id is null then
    return jsonb_build_object('ready', false, 'missing', jsonb_build_array('El punto no existe.'), 'checks', '[]'::jsonb, 'warnings', '[]'::jsonb);
  end if;
  select * into cfg from public.fiscal_point_configs where point_id = p_point;
  select os.fiscal_enabled into v_org from public.erp_org_settings os where os.store_id = w.store_id;
  v_org := coalesce(v_org, false);
  if cfg.fiscal_entity_id is not null then select * into ent from public.fiscal_entities where id = cfg.fiscal_entity_id; end if;
  if cfg.establishment_id is not null then select * into est from public.fiscal_establishments where id = cfg.establishment_id; end if;
  if cfg.provider_account_id is not null then select * into acc from public.fiscal_provider_accounts where id = cfg.provider_account_id; end if;
  if acc.id is not null then select * into prov from public.fiscal_providers where code = acc.provider; end if;
  v_doc := coalesce(cfg.pos_document_type, 'invoice');
  v_env := coalesce(cfg.environment, 'sandbox');
  if ent.id is not null then
    select * into rng from public.fiscal_numbering_ranges where id = public.fiscal__pick_range(p_point, ent.id, v_doc, v_env);
  end if;

  -- 1. Punto
  v_ok := coalesce(w.status = 'active', false);
  v_checks := v_checks || public.fiscal__check('point', 'Punto creado y activo', v_ok,
    case when v_ok then w.name else 'El punto está ' || case w.status when 'draft' then 'en borrador' when 'suspended' then 'suspendido' else 'inactivo' end end);
  if not v_ok then v_missing := array_append(v_missing, 'Activa el punto ' || w.name); end if;

  -- 2. Responsable
  v_ok := coalesce(nullif(trim(coalesce(w.responsible_name, '')), '') is not null or w.responsible_user_id is not null, false);
  v_checks := v_checks || public.fiscal__check('responsible', 'Responsable asignado', v_ok, case when v_ok then w.responsible_name else 'Sin responsable' end);
  if not v_ok then v_missing := array_append(v_missing, 'Asigna el responsable del punto'); end if;

  -- 3. Contribuyente (información fiscal)
  if ent.id is null then
    v_ok := false;
    v_detail := 'Elige o crea el contribuyente (NIT o cédula) que factura en este punto';
  else
    v_tmp := public.fiscal__entity_missing(ent);
    v_ok := ent.status = 'active' and cardinality(v_tmp) = 0;
    v_detail := case
      when cardinality(v_tmp) > 0 then 'Completa en el contribuyente: ' || array_to_string(v_tmp, ', ')
      when ent.status <> 'active' then 'Activa el contribuyente ' || ent.legal_name
      else ent.legal_name || ' · ' || ent.document_type || ' ' || coalesce(ent.document_number, '') || coalesce('-' || ent.verification_digit, '') end;
  end if;
  v_checks := v_checks || public.fiscal__check('entity', 'Información fiscal', v_ok, v_detail);
  if not v_ok then v_missing := array_append(v_missing, v_detail); end if;

  -- 4. Establecimiento
  v_ok := coalesce(est.id is not null and est.status = 'active' and coalesce(trim(est.address), '') <> '' and coalesce(trim(est.city), '') <> '', false);
  v_detail := case when est.id is null then 'Registra el establecimiento del punto'
                   when not v_ok then 'Completa la dirección y la ciudad del establecimiento' else est.name end;
  v_checks := v_checks || public.fiscal__check('establishment', 'Establecimiento', v_ok, v_detail);
  if not v_ok then v_missing := array_append(v_missing, v_detail); end if;

  -- 5. Proveedor tecnológico
  v_ok := coalesce(acc.id is not null and acc.status <> 'disconnected' and prov.status = 'available', false);
  v_detail := case when acc.id is null then 'Conecta el proveedor tecnológico'
                   when prov.status <> 'available' then prov.name || ' aún no está integrado en RemHub (pendiente)'
                   when acc.status = 'disconnected' then 'El proveedor está desconectado'
                   else prov.name end;
  v_checks := v_checks || public.fiscal__check('provider', 'Proveedor tecnológico', v_ok, v_detail);
  if not v_ok then v_missing := array_append(v_missing, v_detail); end if;

  -- 6. Ambiente (nunca se mezclan pruebas y producción)
  v_ok := coalesce(cfg.point_id is not null and acc.id is not null and acc.environment = v_env
          and (v_env = 'sandbox' or (prov.supports_production and cfg.production_confirmed_at is not null)), false);
  v_detail := case when cfg.point_id is null then 'Configura el ambiente del punto'
                   when acc.id is not null and acc.environment <> v_env then 'El proveedor está en ' || acc.environment || ' y el punto en ' || v_env
                   when v_env = 'production' and not coalesce(prov.supports_production, false) then 'Este proveedor no permite producción'
                   when v_env = 'production' and cfg.production_confirmed_at is null then 'Confirma el paso a producción'
                   when acc.id is null then 'Sin proveedor'
                   else case v_env when 'production' then 'Producción' else 'Pruebas (sandbox)' end end;
  v_checks := v_checks || public.fiscal__check('environment', 'Ambiente', v_ok, v_detail);
  if not v_ok then v_missing := array_append(v_missing, v_detail); end if;

  -- 7. Numeración
  v_info := public.fiscal__range_info(rng);
  v_ok := rng.id is not null;
  v_detail := case when v_ok then coalesce(nullif(rng.prefix, ''), '(sin prefijo)') || ' · siguiente ' || rng.next_number || ' de ' || rng.range_to
                   else 'No hay numeración activa y vigente para ' ||
                        case v_doc when 'pos_equivalent' then 'documento equivalente POS' else 'factura electrónica' end || ' en este punto' end;
  v_checks := v_checks || public.fiscal__check('numbering', 'Numeración', v_ok, v_detail);
  if not v_ok then v_missing := array_append(v_missing, v_detail); end if;

  -- 8. Resolución
  v_ok := coalesce(rng.id is not null and (not rng.requires_resolution
          or (rng.resolution_number is not null and rng.resolution_date is not null and rng.valid_until is not null)), false);
  v_detail := case when rng.id is null then 'Sin resolución vigente'
                   when not v_ok then 'Completa el número, la fecha y la vigencia de la resolución'
                   when not rng.requires_resolution then 'No requiere resolución'
                   else 'Resolución ' || rng.resolution_number || coalesce(' · vence ' || to_char(rng.valid_until, 'DD/MM/YYYY'), '') end;
  v_checks := v_checks || public.fiscal__check('resolution', 'Resolución', v_ok, v_detail);
  if not v_ok then v_missing := array_append(v_missing, v_detail); end if;
  if rng.id is not null then
    if (v_info ->> 'near_exhaustion')::boolean then
      v_warn := array_append(v_warn, 'Numeración al ' || (v_info ->> 'used_pct') || '% (quedan ' || (v_info ->> 'remaining') || ')');
    end if;
    if (v_info ->> 'near_expiry')::boolean then
      v_warn := array_append(v_warn, 'La resolución vence en ' || (v_info ->> 'days_left') || ' días');
    end if;
  end if;

  -- 9. Webhook (solo si el proveedor lo usa)
  v_na := acc.id is null or not coalesce(prov.supports_webhooks, false);
  v_ok := coalesce(acc.id is not null and (acc.credentials_hint ? 'webhook_secret') and acc.webhook_status <> 'failing', false);
  v_checks := v_checks || public.fiscal__check('webhook', 'Webhook', v_ok,
    case when acc.id is null then 'Sin proveedor' when v_na then 'No aplica para este proveedor'
         when acc.webhook_status = 'failing' then 'Hay fallas recientes en el webhook'
         when not v_ok then 'Configura el secreto del webhook' else 'Configurado' end, v_na and acc.id is not null);
  if not v_ok and not v_na then v_missing := array_append(v_missing, 'Configura el webhook del proveedor'); end if;

  -- 10. Prueba de conexión
  v_ok := coalesce(acc.last_test_ok, false);
  v_checks := v_checks || public.fiscal__check('connection', 'Prueba de conexión', v_ok,
    case when acc.id is null then 'Sin proveedor' when acc.last_test_at is null then 'Haz la prueba de conexión'
         when not v_ok then coalesce(acc.last_error, 'La última prueba falló')
         else 'OK · ' || to_char(acc.last_test_at at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI') end);
  if not v_ok then v_missing := array_append(v_missing, 'Haz una prueba de conexión exitosa con el proveedor'); end if;

  -- 11. Activación
  v_ok := coalesce(cfg.enabled, false) and v_org;
  v_detail := case when not v_org then 'Activa la facturación electrónica de la tienda (Centro fiscal → Configuración)'
                   when not coalesce(cfg.enabled, false) then 'Activa la facturación electrónica de este punto' else 'Activada' end;
  v_checks := v_checks || public.fiscal__check('enabled', 'Facturación activada', v_ok, v_detail);
  if not v_ok then v_missing := array_append(v_missing, v_detail); end if;

  select c.id into v_cont from public.fiscal_contingencies c
  where c.store_id = w.store_id and c.status = 'open' and (c.point_id is null or c.point_id = p_point)
    and (c.fiscal_entity_id is null or c.fiscal_entity_id = ent.id)
  limit 1;
  if v_cont is not null then
    v_warn := array_append(v_warn, 'Contingencia abierta: los documentos quedan en cola hasta cerrarla');
  end if;

  return jsonb_build_object(
    'point', jsonb_build_object('id', w.id, 'name', w.name, 'code', w.code, 'status', w.status, 'kind', w.kind, 'store_id', w.store_id),
    'ready', cardinality(v_missing) = 0,
    'checks', v_checks,
    'missing', to_jsonb(v_missing),
    'warnings', to_jsonb(v_warn),
    'environment', v_env,
    'document_type', v_doc,
    'enabled', coalesce(cfg.enabled, false),
    'org_enabled', v_org,
    'configured', cfg.point_id is not null,
    'pos_electronic_default', coalesce(cfg.pos_electronic_default, true),
    'entity', case when ent.id is null then null else jsonb_build_object('id', ent.id, 'legal_name', ent.legal_name,
      'document_type', ent.document_type, 'document_number', ent.document_number, 'verification_digit', ent.verification_digit, 'status', ent.status) end,
    'provider', case when acc.id is null then null else jsonb_build_object('account_id', acc.id, 'code', acc.provider, 'name', prov.name,
      'status', acc.status, 'environment', acc.environment, 'provider_status', prov.status) end,
    'range', v_info,
    'contingency_id', v_cont);
end;
$$;

-- Lo mismo, con permisos (para el POS, el asistente y el centro fiscal).
create or replace function public.fiscal_point_readiness(p_point uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_store uuid;
begin
  select store_id into v_store from public.erp_warehouses where id = p_point;
  if v_store is null then return public.fiscal__err('NOT_FOUND', 'El punto no existe.'); end if;
  if not public.erp_can_any(v_store, public.fiscal__view_perms() || array['pos', 'points']::text[])
     or not public.erp_point_allowed(v_store, p_point) then
    return public.fiscal__err('FORBIDDEN', 'No tienes acceso a este punto.');
  end if;
  return jsonb_build_object('ok', true) || public.fiscal__point_readiness(p_point);
end;
$$;
grant execute on function public.fiscal_point_readiness(uuid) to authenticated;

-- Evento en la línea de tiempo del documento (con usuario, IP y navegador).
create or replace function public.fiscal__event(
  p_doc uuid, p_store uuid, p_event text, p_from text, p_to text, p_message text,
  p_payload jsonb default '{}'::jsonb, p_error text default null, p_source text default 'app'
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m jsonb := public.erp__request_meta();
  sa jsonb := public.erp__service_actor();
  v_uid uuid := public.erp__actor_id();
  v_name text;
begin
  if auth.uid() is null and sa is not null then v_name := nullif(sa ->> 'name', ''); end if;
  if v_name is null then v_name := case when v_uid is null then 'Sistema' else public.erp__user_label(p_store, v_uid) end; end if;
  insert into public.fiscal_document_events
    (document_id, store_id, event, status_from, status_to, message, payload, error_code, actor_id, actor_name, source, ip, user_agent, request_id)
  values
    (p_doc, p_store, p_event, p_from, p_to, left(p_message, 2000), coalesce(p_payload, '{}'::jsonb), p_error,
     v_uid, v_name, coalesce(p_source, 'app'), m ->> 'ip', m ->> 'user_agent', m ->> 'request_id');
end;
$$;
revoke all on function public.fiscal__event(uuid, uuid, text, text, text, text, jsonb, text, text) from public, anon, authenticated;

-- Entrega el siguiente número de un rango con bloqueo de fila: dos cajeros al tiempo
-- nunca reciben el mismo número (el segundo espera y toma el siguiente).
create or replace function public.fiscal__allocate_number(
  p_range uuid, p_document uuid, p_point uuid, p_doc_type text, p_env text, p_entity uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.fiscal_numbering_ranges;
  v_num bigint;
  v_today date := public.fiscal__today();
begin
  select * into r from public.fiscal_numbering_ranges where id = p_range for update;
  if r.id is null then
    raise exception 'La numeración no existe.' using errcode = 'P0001', detail = 'FISCAL_RANGE_NOT_FOUND';
  end if;
  if r.fiscal_entity_id <> p_entity then
    raise exception 'La numeración pertenece a otro contribuyente.' using errcode = 'P0001', detail = 'FISCAL_RANGE_FOREIGN_ENTITY';
  end if;
  if not (p_point = any (r.point_ids)) then
    raise exception 'La numeración no está autorizada para este punto.' using errcode = 'P0001', detail = 'FISCAL_RANGE_FOREIGN_POINT';
  end if;
  if r.document_type <> p_doc_type or r.environment <> p_env then
    raise exception 'La numeración es de otro tipo de documento o ambiente.' using errcode = 'P0001', detail = 'FISCAL_RANGE_MISMATCH';
  end if;
  if r.status <> 'active' then
    raise exception 'La numeración no está activa.' using errcode = 'P0001', detail = 'FISCAL_RANGE_INACTIVE';
  end if;
  if r.valid_until is not null and r.valid_until < v_today then
    raise exception 'La resolución de numeración venció el %.', to_char(r.valid_until, 'DD/MM/YYYY') using errcode = 'P0001', detail = 'FISCAL_RANGE_EXPIRED';
  end if;
  if r.valid_from is not null and r.valid_from > v_today then
    raise exception 'La resolución aún no está vigente (desde el %).', to_char(r.valid_from, 'DD/MM/YYYY') using errcode = 'P0001', detail = 'FISCAL_RANGE_NOT_YET';
  end if;
  v_num := r.next_number;
  if v_num > r.range_to then
    raise exception 'El rango autorizado está agotado (último número %).', r.range_to using errcode = 'P0001', detail = 'FISCAL_RANGE_EXHAUSTED';
  end if;
  update public.fiscal_numbering_ranges set next_number = v_num + 1 where id = r.id;
  insert into public.fiscal_number_allocations
    (range_id, store_id, fiscal_entity_id, document_type, environment, prefix, number, document_id, allocated_by)
  values (r.id, r.store_id, r.fiscal_entity_id, r.document_type, r.environment, r.prefix, v_num, p_document, public.erp__actor_id());
  return jsonb_build_object('prefix', r.prefix, 'number', v_num, 'range_id', r.id, 'remaining', r.range_to - v_num,
    'resolution_number', r.resolution_number);
end;
$$;
revoke all on function public.fiscal__allocate_number(uuid, uuid, uuid, text, text, uuid) from public, anon, authenticated;

-- Calcula base, impuesto y total de cada línea (precios con o sin impuesto incluido).
create or replace function public.fiscal__compute_lines(p_lines jsonb, p_include_tax boolean)
returns jsonb
language plpgsql
immutable
as $$
declare
  it jsonb;
  v_out jsonb := '[]'::jsonb;
  v_n integer := 0;
  v_qty numeric;
  v_price numeric;
  v_rate numeric;
  v_disc numeric;
  v_gross numeric;
  v_base numeric;
  v_tax numeric;
  v_sub numeric := 0;
  v_taxt numeric := 0;
  v_tot numeric := 0;
  v_disct numeric := 0;
begin
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'El documento no tiene productos.' using errcode = 'P0001', detail = 'FISCAL_NO_LINES';
  end if;
  for it in select * from jsonb_array_elements(p_lines) loop
    v_n := v_n + 1;
    v_qty := coalesce((it ->> 'qty')::numeric, 0);
    v_price := coalesce((it ->> 'unit_price')::numeric, 0);
    v_rate := coalesce((it ->> 'tax_rate')::numeric, 0);
    v_disc := coalesce((it ->> 'discount')::numeric, 0);
    if v_qty <= 0 then raise exception 'La cantidad de la línea % debe ser mayor a cero.', v_n using errcode = 'P0001'; end if;
    if v_price < 0 then raise exception 'El precio de la línea % no puede ser negativo.', v_n using errcode = 'P0001'; end if;
    if v_rate < 0 or v_rate > 100 then raise exception 'El impuesto de la línea % no es válido.', v_n using errcode = 'P0001'; end if;
    if coalesce(trim(it ->> 'description'), '') = '' then raise exception 'La línea % no tiene descripción.', v_n using errcode = 'P0001'; end if;
    v_gross := round(v_qty * v_price - v_disc, 2);
    if v_gross < 0 then raise exception 'El descuento de la línea % supera su valor.', v_n using errcode = 'P0001'; end if;
    if p_include_tax then
      v_base := round(v_gross / (1 + v_rate / 100), 2);
      v_tax := v_gross - v_base;
    else
      v_base := v_gross;
      v_tax := round(v_base * v_rate / 100, 2);
    end if;
    v_out := v_out || jsonb_build_object(
      'line_no', v_n, 'product_id', it ->> 'product_id', 'sku', it ->> 'sku', 'description', left(trim(it ->> 'description'), 500),
      'unit_code', coalesce(nullif(it ->> 'unit_code', ''), '94'), 'qty', v_qty, 'unit_price', v_price, 'discount', v_disc,
      'tax_rate', v_rate, 'line_subtotal', v_base, 'line_tax', v_tax, 'line_total', v_base + v_tax,
      'ref_line_no', it ->> 'ref_line_no');
    v_sub := v_sub + v_base;
    v_taxt := v_taxt + v_tax;
    v_tot := v_tot + v_base + v_tax;
    v_disct := v_disct + v_disc;
  end loop;
  return jsonb_build_object('lines', v_out, 'subtotal', v_sub, 'tax_total', v_taxt, 'total', v_tot, 'discount_total', v_disct);
end;
$$;

-- Foto del emisor al momento de emitir (el documento conserva estos datos para siempre).
create or replace function public.fiscal__issuer_snapshot(p_entity uuid, p_establishment uuid, p_point uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'entity_id', e.id, 'legal_name', e.legal_name, 'trade_name', e.trade_name, 'person_type', e.person_type,
    'document_type', e.document_type, 'document_number', e.document_number, 'verification_digit', e.verification_digit,
    'tax_regime', e.tax_regime, 'tax_responsibilities', to_jsonb(e.tax_responsibilities),
    'economic_activities', to_jsonb(e.economic_activities), 'fiscal_address', e.fiscal_address, 'city', e.city,
    'city_code', e.city_code, 'department', e.department, 'department_code', e.department_code, 'country', e.country,
    'postal_code', e.postal_code, 'phone', e.phone, 'email', e.email,
    'establishment', (select jsonb_build_object('id', s.id, 'name', s.name, 'code', s.code, 'address', s.address, 'city', s.city,
                        'city_code', s.city_code, 'department', s.department, 'department_code', s.department_code, 'phone', s.phone)
                      from public.fiscal_establishments s where s.id = p_establishment),
    'point', (select jsonb_build_object('id', w.id, 'name', w.name, 'code', w.code) from public.erp_warehouses w where w.id = p_point))
  from public.fiscal_entities e where e.id = p_entity;
$$;

-- Crea un documento fiscal completo: valida, toma el consecutivo y guarda líneas y eventos (uso interno).
create or replace function public.fiscal__create_document(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc uuid := gen_random_uuid();
  v_store uuid := (p ->> 'store_id')::uuid;
  v_point uuid := (p ->> 'point_id')::uuid;
  v_entity uuid := (p ->> 'fiscal_entity_id')::uuid;
  v_type text := p ->> 'document_type';
  v_env text := p ->> 'environment';
  v_range uuid;
  v_alloc jsonb;
  v_calc jsonb;
  v_status text := coalesce(p ->> 'initial_status', 'QUEUED');
  v_include boolean;
  ln jsonb;
  v_full text;
begin
  select e.prices_include_tax into v_include from public.fiscal_entities e where e.id = v_entity;
  v_include := coalesce((p ->> 'prices_include_tax')::boolean, v_include, true);
  v_calc := public.fiscal__compute_lines(p -> 'lines', v_include);
  v_range := public.fiscal__pick_range(v_point, v_entity, v_type, v_env);
  if v_range is null then
    raise exception 'No hay numeración activa y vigente para este documento en este punto.' using errcode = 'P0001', detail = 'FISCAL_NO_RANGE';
  end if;

  insert into public.fiscal_documents (
    id, store_id, point_id, fiscal_entity_id, establishment_id, provider_account_id, range_id, document_type, environment, status,
    due_date, payment_form, payment_method, subtotal, discount_total, tax_total, total, issuer,
    customer_id, customer, customer_name, customer_doc, source_type, source_id, source_number,
    related_document_id, note_concept, note_reason, provider, idempotency_key, contingency_id, notes, metadata,
    created_by, created_by_name)
  values (
    v_doc, v_store, v_point, v_entity, (p ->> 'establishment_id')::uuid, (p ->> 'provider_account_id')::uuid, v_range, v_type, v_env, 'DRAFT',
    (p ->> 'due_date')::date, coalesce(p ->> 'payment_form', 'cash'), p ->> 'payment_method',
    (v_calc ->> 'subtotal')::numeric, (v_calc ->> 'discount_total')::numeric, (v_calc ->> 'tax_total')::numeric, (v_calc ->> 'total')::numeric,
    public.fiscal__issuer_snapshot(v_entity, (p ->> 'establishment_id')::uuid, v_point),
    (p ->> 'customer_id')::uuid, coalesce(p -> 'customer', '{}'::jsonb), p -> 'customer' ->> 'name', p -> 'customer' ->> 'document_number',
    coalesce(p ->> 'source_type', 'manual'), (p ->> 'source_id')::uuid, p ->> 'source_number',
    (p ->> 'related_document_id')::uuid, p ->> 'note_concept', p ->> 'note_reason',
    (select a.provider from public.fiscal_provider_accounts a where a.id = (p ->> 'provider_account_id')::uuid),
    nullif(p ->> 'idempotency_key', ''), (p ->> 'contingency_id')::uuid, p ->> 'notes',
    coalesce(p -> 'metadata', '{}'::jsonb) || jsonb_build_object('prices_include_tax', v_include),
    public.erp__actor_id(), case when public.erp__actor_id() is null then 'Sistema' else public.erp__user_label(v_store, public.erp__actor_id()) end);

  v_alloc := public.fiscal__allocate_number(v_range, v_doc, v_point, v_type, v_env, v_entity);
  v_full := (v_alloc ->> 'prefix') || (v_alloc ->> 'number');
  update public.fiscal_documents
  set prefix = v_alloc ->> 'prefix', number = (v_alloc ->> 'number')::bigint, full_number = v_full, status = v_status
  where id = v_doc;

  for ln in select * from jsonb_array_elements(v_calc -> 'lines') loop
    insert into public.fiscal_document_lines
      (document_id, store_id, line_no, product_id, sku, description, unit_code, qty, unit_price, discount, tax_rate,
       line_subtotal, line_tax, line_total, ref_line_no)
    values
      (v_doc, v_store, (ln ->> 'line_no')::integer, nullif(ln ->> 'product_id', '')::uuid, ln ->> 'sku', ln ->> 'description',
       ln ->> 'unit_code', (ln ->> 'qty')::numeric, (ln ->> 'unit_price')::numeric, (ln ->> 'discount')::numeric,
       (ln ->> 'tax_rate')::numeric, (ln ->> 'line_subtotal')::numeric, (ln ->> 'line_tax')::numeric,
       (ln ->> 'line_total')::numeric, nullif(ln ->> 'ref_line_no', '')::integer);
  end loop;

  perform public.fiscal__event(v_doc, v_store, 'created', null, 'DRAFT', 'Documento creado', jsonb_build_object('source_type', p ->> 'source_type', 'source_number', p ->> 'source_number'));
  perform public.fiscal__event(v_doc, v_store, 'number_assigned', 'DRAFT', v_status,
    'Número ' || v_full || ' tomado de la resolución ' || coalesce(v_alloc ->> 'resolution_number', '(sin resolución)'), v_alloc);
  perform public.erp__audit_insert(v_store, v_point, 'fiscal', 'info', 'fiscal.document_created', 'fiscal_documents', v_doc,
    null, jsonb_build_object('full_number', v_full, 'type', v_type, 'environment', v_env, 'total', v_calc ->> 'total',
      'customer', p -> 'customer' ->> 'name', 'source', p ->> 'source_number'), null, '{}'::jsonb);

  return jsonb_build_object('ok', true, 'document_id', v_doc, 'full_number', v_full, 'prefix', v_alloc ->> 'prefix',
    'number', (v_alloc ->> 'number')::bigint, 'status', v_status, 'environment', v_env, 'document_type', v_type,
    'total', (v_calc ->> 'total')::numeric, 'remaining', (v_alloc ->> 'remaining')::bigint);
end;
$$;
revoke all on function public.fiscal__create_document(jsonb) from public, anon, authenticated;

-- Foto del cliente (tercero registrado o consumidor final).
create or replace function public.fiscal__customer_snapshot(p_store uuid, p_customer uuid, p_name text, p_doc text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.billing_customers;
  os public.erp_org_settings;
  v_doc text;
begin
  select * into os from public.erp_org_settings where store_id = p_store;
  if p_customer is not null then
    select * into c from public.billing_customers where id = p_customer and store_id = p_store;
    if c.id is null then return null; end if;
    v_doc := nullif(regexp_replace(coalesce(c.document_number, c.doc_number, ''), '[^0-9A-Za-z]', '', 'g'), '');
    return jsonb_build_object(
      'id', c.id, 'final_consumer', v_doc is null, 'person_type', c.person_type,
      'document_type', coalesce(nullif(c.document_type, ''), 'CC'), 'document_number', coalesce(v_doc, os.final_consumer_doc, '222222222222'),
      'verification_digit', case when c.document_type = 'NIT' then public.fiscal_nit_dv(v_doc) end,
      'name', upper(coalesce(nullif(trim(c.name), ''), nullif(trim(c.company_name), ''), coalesce(os.final_consumer_name, 'CONSUMIDOR FINAL'))),
      'trade_name', c.trade_name, 'email', c.email, 'phone', coalesce(c.mobile, c.phone), 'address', c.address,
      'city', c.city, 'department', c.department, 'country', coalesce(nullif(c.country, ''), c.country_code, 'CO'),
      'tax_regime', c.tax_regime, 'is_tax_responsible', c.is_tax_responsible);
  end if;
  v_doc := nullif(regexp_replace(coalesce(p_doc, ''), '[^0-9A-Za-z]', '', 'g'), '');
  if v_doc is not null and v_doc in ('CF', coalesce(os.final_consumer_doc, '222222222222')) then v_doc := null; end if;
  return jsonb_build_object(
    'id', null, 'final_consumer', v_doc is null,
    'document_type', case when v_doc is null then 'CC' when length(v_doc) between 9 and 10 and left(v_doc, 1) in ('8', '9') then 'NIT' else 'CC' end,
    'document_number', coalesce(v_doc, os.final_consumer_doc, '222222222222'),
    'name', upper(coalesce(nullif(trim(p_name), ''), os.final_consumer_name, 'CONSUMIDOR FINAL')));
end;
$$;

-- POS / pedidos: emite el documento electrónico de una venta. Todo (NIT, resolución,
-- prefijo, consecutivo, proveedor) se resuelve aquí, nunca en el navegador.
create or replace function public.fiscal_issue_from_order(
  p_store uuid, p_token text, p_point uuid, p_seller uuid, p_customer uuid, p_customer_doc text,
  p_idempotency_key text, p_payment_form text default 'cash', p_due_date date default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  m public.erp_order_meta;
  cfg public.fiscal_point_configs;
  ent public.fiscal_entities;
  v_my uuid := public.erp_my_point(p_store);
  v_point uuid;
  v_existing public.fiscal_documents;
  v_ready jsonb;
  v_customer jsonb;
  v_lines jsonb;
  v_res jsonb;
  v_seller_name text;
  v_contingency uuid;
  v_total numeric;
  v_calc_total numeric;
  v_kind_prev text;
begin
  if auth.uid() is null then return public.fiscal__err('AUTH', 'Inicia sesión para facturar.'); end if;
  if not public.erp_can_any(p_store, array['pos', 'fiscal_send']::text[]) then
    perform public.erp__security_event(p_store, v_my, 'security.fiscal_issue_denied', jsonb_build_object('token', p_token));
    return public.fiscal__err('FORBIDDEN', 'El usuario no tiene permiso para emitir documentos fiscales.');
  end if;

  if nullif(p_idempotency_key, '') is not null then
    select * into v_existing from public.fiscal_documents where store_id = p_store and idempotency_key = p_idempotency_key;
    if v_existing.id is not null then
      return jsonb_build_object('ok', true, 'reused', true, 'document_id', v_existing.id, 'full_number', v_existing.full_number,
        'status', v_existing.status, 'environment', v_existing.environment, 'document_type', v_existing.document_type, 'total', v_existing.total);
    end if;
  end if;

  select * into o from public.orders where token = p_token and store_id = p_store for update;
  if o.id is null then return public.fiscal__err('ORDER_NOT_FOUND', 'No se encontró la venta.'); end if;

  select * into v_existing from public.fiscal_documents d
  where d.source_id = o.id and d.source_type in ('pos_order', 'order')
    and d.document_type in ('invoice', 'pos_equivalent', 'export_invoice', 'contingency_invoice')
    and d.status not in ('VOID', 'CANCELLED')
  limit 1;
  if v_existing.id is not null then
    return jsonb_build_object('ok', true, 'reused', true, 'document_id', v_existing.id, 'full_number', v_existing.full_number,
      'status', v_existing.status, 'environment', v_existing.environment, 'document_type', v_existing.document_type, 'total', v_existing.total);
  end if;

  select * into m from public.erp_order_meta where order_id = o.id;
  v_point := coalesce(m.point_id, v_my, p_point);
  if v_point is null then return public.fiscal__err('POINT_REQUIRED', 'Elige el punto de venta.'); end if;
  if not exists (select 1 from public.erp_warehouses w where w.id = v_point and w.store_id = p_store) then
    perform public.erp__security_event(p_store, v_my, 'security.fiscal_foreign_point', jsonb_build_object('point', v_point, 'token', p_token), 'critical');
    return public.fiscal__err('POINT_FORBIDDEN', 'El punto no pertenece a esta tienda.');
  end if;
  -- Un usuario de punto solo factura en su punto (o en sus puntos adicionales si tiene permiso fiscal).
  if not public.erp_point_allowed(p_store, v_point)
     or (v_my is not null and v_point <> v_my and not public.erp_can(p_store, 'fiscal_send')) then
    perform public.erp__security_event(p_store, v_my, 'security.fiscal_cross_point',
      jsonb_build_object('target_point', v_point, 'token', p_token), 'critical');
    return public.fiscal__err('POINT_FORBIDDEN', 'No puedes facturar ventas de otro punto.');
  end if;

  if m.order_id is not null and m.doc_kind = 'factura' then
    -- ¿Factura interna previa (sin documento electrónico)? Solo se permite si su documento fiscal fue anulado.
    if not exists (select 1 from public.fiscal_documents d where d.source_id = o.id and d.full_number = m.doc_number and d.status = 'VOID') then
      return public.fiscal__err('ALREADY_INTERNAL_INVOICE',
        'Esta venta ya tiene la factura interna ' || coalesce(m.doc_number, '') || '. No se emiten dos facturas para la misma venta.');
    end if;
  end if;

  v_ready := public.fiscal__point_readiness(v_point);
  if not (v_ready ->> 'ready')::boolean then
    return public.fiscal__err('NOT_READY', 'Este punto no está listo para facturar electrónicamente.',
      jsonb_build_object('missing', v_ready -> 'missing', 'checks', v_ready -> 'checks'));
  end if;
  select * into cfg from public.fiscal_point_configs where point_id = v_point;
  select * into ent from public.fiscal_entities where id = cfg.fiscal_entity_id;

  v_customer := public.fiscal__customer_snapshot(p_store, p_customer, o.customer_name, coalesce(nullif(p_customer_doc, ''), m.customer_doc));
  if v_customer is null then return public.fiscal__err('CUSTOMER_INVALID', 'El cliente elegido no pertenece a esta tienda.'); end if;

  select jsonb_agg(jsonb_build_object('product_id', oi.product_id, 'sku', p.sku, 'description', coalesce(p.name, 'Producto'),
           'qty', oi.quantity, 'unit_price', oi.price, 'tax_rate', coalesce(p.tax_rate, 0)) order by p.name, oi.id)
  into v_lines
  from public.order_items oi left join public.products p on p.id = oi.product_id
  where oi.order_id = o.id;
  if v_lines is null then return public.fiscal__err('NO_LINES', 'La venta no tiene productos.'); end if;

  -- Los totales del documento deben cuadrar con lo cobrado.
  select coalesce(sum(round(oi.quantity * oi.price, 2)), 0) into v_calc_total from public.order_items oi where oi.order_id = o.id;
  v_total := coalesce(o.total, 0);
  if ent.prices_include_tax and abs(v_calc_total - v_total) > 1 then
    return public.fiscal__err('TOTALS_MISMATCH', 'Los totales no cuadran: la venta suma ' || v_total || ' y sus productos ' || v_calc_total || '.');
  end if;

  if p_seller is not null then
    select s.name into v_seller_name from public.erp_sellers(p_store) s where s.user_id = p_seller limit 1;
    if v_seller_name is null then return public.fiscal__err('SELLER_INVALID', 'El vendedor elegido no es válido.'); end if;
  end if;

  select c.id into v_contingency from public.fiscal_contingencies c
  where c.store_id = p_store and c.status = 'open' and (c.point_id is null or c.point_id = v_point)
    and (c.fiscal_entity_id is null or c.fiscal_entity_id = cfg.fiscal_entity_id)
  limit 1;

  v_kind_prev := m.doc_kind;
  v_res := public.fiscal__create_document(jsonb_build_object(
    'store_id', p_store, 'point_id', v_point, 'fiscal_entity_id', cfg.fiscal_entity_id, 'establishment_id', cfg.establishment_id,
    'provider_account_id', cfg.provider_account_id, 'document_type', cfg.pos_document_type, 'environment', cfg.environment,
    'initial_status', case when v_contingency is not null then 'CONTINGENCY' else 'QUEUED' end,
    'contingency_id', v_contingency,
    'payment_form', case when p_payment_form = 'credit' then 'credit' else 'cash' end,
    'due_date', p_due_date, 'payment_method', o.payment_method,
    'customer_id', v_customer ->> 'id', 'customer', v_customer,
    'source_type', 'pos_order', 'source_id', o.id,
    'source_number', coalesce(m.doc_number, '#' || coalesce(o.receipt_no::text, left(o.token, 8))),
    'idempotency_key', p_idempotency_key, 'lines', v_lines,
    'metadata', jsonb_build_object('order_token', o.token, 'seller', coalesce(v_seller_name, m.seller_name), 'previous_kind', v_kind_prev)));

  -- El número fiscal es el número de la venta (nunca dos numeraciones para la misma venta).
  perform set_config('remhub.fiscal_issue', 'on', true);
  if m.order_id is null then
    insert into public.erp_order_meta
      (order_id, store_id, point_id, seller_id, seller_name, doc_kind, doc_prefix, doc_seq, doc_number, created_by, created_by_name, customer_doc)
    values
      (o.id, p_store, v_point, coalesce(p_seller, auth.uid()), coalesce(v_seller_name, public.erp_actor_name(p_store)), 'factura',
       v_res ->> 'prefix', (v_res ->> 'number')::bigint, v_res ->> 'full_number', auth.uid(), public.erp_actor_name(p_store),
       nullif(v_customer ->> 'document_number', ''));
  elsif m.doc_kind = 'factura' then
    update public.erp_order_meta set doc_prefix = v_res ->> 'prefix', doc_seq = (v_res ->> 'number')::bigint, doc_number = v_res ->> 'full_number'
    where order_id = o.id;
  end if;
  perform set_config('remhub.fiscal_issue', '', true);

  return v_res || jsonb_build_object('point_name', v_ready -> 'point' ->> 'name', 'warnings', v_ready -> 'warnings',
    'provider', v_ready -> 'provider' ->> 'name', 'contingency', v_contingency is not null);
exception
  when sqlstate 'P0001' then
    return public.fiscal__err('VALIDATION', sqlerrm);
  when unique_violation then
    select * into v_existing from public.fiscal_documents d
    where d.store_id = p_store and (d.idempotency_key = p_idempotency_key
      or (d.source_id = o.id and d.document_type in ('invoice', 'pos_equivalent', 'export_invoice', 'contingency_invoice')
          and d.status not in ('VOID', 'CANCELLED')))
    limit 1;
    if v_existing.id is not null then
      return jsonb_build_object('ok', true, 'reused', true, 'document_id', v_existing.id, 'full_number', v_existing.full_number,
        'status', v_existing.status, 'environment', v_existing.environment, 'document_type', v_existing.document_type, 'total', v_existing.total);
    end if;
    return public.fiscal__err('DUPLICATE', 'El documento ya se está creando. Revisa el Centro fiscal antes de intentarlo otra vez.');
end;
$$;
grant execute on function public.fiscal_issue_from_order(uuid, text, uuid, uuid, uuid, text, text, text, date) to authenticated;

-- ¿Puede el usuario enviar (o reenviar) este documento? Lo usa la ruta del servidor antes de transmitir.
create or replace function public.fiscal_can_send(p_document uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare d public.fiscal_documents;
begin
  select * into d from public.fiscal_documents where id = p_document;
  if d.id is null then return public.fiscal__err('NOT_FOUND', 'El documento no existe.'); end if;
  if public.erp_can(d.store_id, 'fiscal_send') and public.erp_point_allowed(d.store_id, d.point_id) then
    return jsonb_build_object('ok', true, 'store_id', d.store_id, 'mode', 'fiscal_send');
  end if;
  -- El cajero puede hacer el primer envío de lo que él mismo emitió en su punto.
  if public.erp_can(d.store_id, 'pos') and d.point_id = public.erp_my_point(d.store_id)
     and d.created_by = auth.uid() and d.attempts = 0 then
    return jsonb_build_object('ok', true, 'store_id', d.store_id, 'mode', 'pos_first_send');
  end if;
  perform public.erp__security_event(d.store_id, public.erp_my_point(d.store_id), 'security.fiscal_send_denied',
    jsonb_build_object('document', d.id, 'full_number', d.full_number, 'document_point', d.point_id));
  return public.fiscal__err('FORBIDDEN', 'El usuario no tiene permiso para emitir documentos fiscales de este punto.');
end;
$$;
grant execute on function public.fiscal_can_send(uuid) to authenticated;

-- Reserva el documento para transmitirlo (solo el servidor, con la llave de servicio).
create or replace function public.fiscal__claim(p_document uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.fiscal_documents;
  acc public.fiscal_provider_accounts;
  prov public.fiscal_providers;
  rng public.fiscal_numbering_ranges;
  rel public.fiscal_documents;
  v_cont uuid;
  v_mode text;
  v_lines jsonb;
  v_org boolean;
  v_enabled boolean;
begin
  select * into d from public.fiscal_documents where id = p_document for update;
  if d.id is null then return public.fiscal__err('NOT_FOUND', 'El documento no existe.'); end if;
  if d.status in ('ACCEPTED', 'CANCELLED', 'CANCEL_PENDING') then
    return jsonb_build_object('ok', true, 'done', true, 'status', d.status, 'full_number', d.full_number, 'cufe', d.cufe);
  end if;
  if d.status = 'VOID' then return public.fiscal__err('VOID', 'El documento está anulado.'); end if;
  if d.status = 'DRAFT' then return public.fiscal__err('DRAFT', 'El documento está en borrador.'); end if;
  if d.status = 'PROCESSING' and d.updated_at > now() - interval '3 minutes' then
    return public.fiscal__err('BUSY', 'El documento ya fue enviado y está siendo procesado.', jsonb_build_object('status', d.status));
  end if;

  select os.fiscal_enabled into v_org from public.erp_org_settings os where os.store_id = d.store_id;
  if not coalesce(v_org, false) then
    return public.fiscal__err('ORG_DISABLED', 'La facturación electrónica de la tienda está apagada.');
  end if;

  select c.id into v_cont from public.fiscal_contingencies c
  where c.store_id = d.store_id and c.status = 'open'
    and (c.point_id is null or c.point_id = d.point_id)
    and (c.fiscal_entity_id is null or c.fiscal_entity_id = d.fiscal_entity_id)
    and (c.provider_account_id is null or c.provider_account_id = d.provider_account_id)
  limit 1;
  if v_cont is not null then
    if d.status <> 'CONTINGENCY' and public.fiscal__transition_ok(d.status, 'CONTINGENCY') then
      update public.fiscal_documents set status = 'CONTINGENCY', contingency_id = v_cont where id = d.id;
      perform public.fiscal__event(d.id, d.store_id, 'contingency', d.status, 'CONTINGENCY', 'En cola por contingencia abierta', '{}'::jsonb, null, 'system');
    end if;
    return public.fiscal__err('CONTINGENCY', 'Hay una contingencia abierta: el documento queda en cola hasta cerrarla.');
  end if;

  select * into acc from public.fiscal_provider_accounts where id = d.provider_account_id;
  if acc.id is null then return public.fiscal__err('NO_PROVIDER', 'El documento no tiene proveedor tecnológico.'); end if;
  if acc.status = 'disconnected' then return public.fiscal__err('PROVIDER_DISCONNECTED', 'El proveedor tecnológico está desconectado.'); end if;
  if acc.environment <> d.environment then
    return public.fiscal__err('ENV_MISMATCH', 'El ambiente del proveedor no coincide con el del documento: no se mezclan pruebas y producción.');
  end if;
  select * into prov from public.fiscal_providers where code = acc.provider;
  if prov.status <> 'available' then return public.fiscal__err('PROVIDER_PENDING', prov.name || ' aún no está integrado en RemHub.'); end if;
  if d.environment = 'production' and not prov.supports_production then
    return public.fiscal__err('ENV_MISMATCH', prov.name || ' no transmite documentos de producción.');
  end if;
  if d.document_type in ('invoice', 'pos_equivalent') then
    select pc.enabled into v_enabled from public.fiscal_point_configs pc where pc.point_id = d.point_id;
    if not coalesce(v_enabled, false) then
      return public.fiscal__err('POINT_DISABLED', 'La facturación electrónica del punto está apagada.');
    end if;
  end if;

  v_mode := case when d.status = 'SENT' or (d.status = 'ERROR' and d.provider_document_id is not null) then 'status' else 'send' end;
  update public.fiscal_documents set status = 'PROCESSING', attempts = attempts + 1, next_attempt_at = null where id = d.id;
  perform public.fiscal__event(d.id, d.store_id, case when v_mode = 'status' then 'status_check' else 'send_started' end, d.status, 'PROCESSING',
    case when v_mode = 'status' then 'Consultando el estado en el proveedor' else 'Enviando al proveedor (intento ' || (d.attempts + 1) || ')' end,
    '{}'::jsonb, null, 'system');

  select coalesce(jsonb_agg(to_jsonb(l) order by l.line_no), '[]'::jsonb) into v_lines from public.fiscal_document_lines l where l.document_id = d.id;
  select * into rng from public.fiscal_numbering_ranges where id = d.range_id;
  if d.related_document_id is not null then select * into rel from public.fiscal_documents where id = d.related_document_id; end if;
  select * into d from public.fiscal_documents where id = d.id;

  return jsonb_build_object('ok', true, 'mode', v_mode,
    'document', to_jsonb(d), 'lines', v_lines,
    'range', jsonb_build_object('id', rng.id, 'prefix', rng.prefix, 'resolution_number', rng.resolution_number,
      'resolution_date', rng.resolution_date, 'valid_from', rng.valid_from, 'valid_until', rng.valid_until,
      'range_from', rng.range_from, 'range_to', rng.range_to),
    'account', jsonb_build_object('id', acc.id, 'provider', acc.provider, 'environment', acc.environment,
      'external_account_id', acc.external_account_id, 'settings', acc.settings, 'store_id', acc.store_id),
    'related', case when rel.id is null then null else jsonb_build_object('id', rel.id, 'full_number', rel.full_number, 'cufe', rel.cufe,
      'issue_date', rel.issue_date, 'total', rel.total, 'document_type', rel.document_type, 'provider_document_id', rel.provider_document_id) end);
end;
$$;
revoke all on function public.fiscal__claim(uuid) from public, anon, authenticated;

-- Aplica un nuevo estado al documento (respuesta directa del proveedor o webhook).
create or replace function public.fiscal__apply_status(p_document uuid, p_result jsonb, p_source text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.fiscal_documents;
  rel public.fiscal_documents;
  v_to text := upper(coalesce(p_result ->> 'status', ''));
  v_retry boolean := coalesce((p_result ->> 'retryable')::boolean, false);
  v_next timestamptz;
  v_credited numeric;
  v_action text;
begin
  select * into d from public.fiscal_documents where id = p_document for update;
  if d.id is null then return public.fiscal__err('NOT_FOUND', 'El documento no existe.'); end if;
  if v_to not in ('ACCEPTED', 'REJECTED', 'SENT', 'ERROR') then
    return public.fiscal__err('INVALID', 'Estado de respuesta inválido.');
  end if;
  if not public.fiscal__transition_ok(d.status, v_to) then
    perform public.fiscal__event(d.id, d.store_id, 'result_ignored', d.status, d.status,
      'Respuesta ignorada: no se puede pasar de ' || d.status || ' a ' || v_to, coalesce(p_result -> 'payload', '{}'::jsonb), null, p_source);
    return jsonb_build_object('ok', true, 'ignored', true, 'status', d.status);
  end if;

  if d.status = v_to and v_to in ('ACCEPTED', 'REJECTED') then
    update public.fiscal_documents set
      cufe = coalesce(cufe, nullif(p_result ->> 'cufe', '')),
      qr_data = coalesce(qr_data, nullif(p_result ->> 'qr_data', '')),
      xml_path = coalesce(xml_path, nullif(p_result ->> 'xml_path', '')),
      pdf_path = coalesce(pdf_path, nullif(p_result ->> 'pdf_path', '')),
      dian_status = coalesce(nullif(p_result ->> 'dian_status', ''), dian_status)
    where id = d.id;
    perform public.fiscal__event(d.id, d.store_id, 'provider_update', d.status, d.status, 'El proveedor confirmó el estado',
      coalesce(p_result -> 'payload', '{}'::jsonb), null, p_source);
    return jsonb_build_object('ok', true, 'status', d.status, 'repeated', true, 'full_number', d.full_number);
  end if;

  v_next := case
    when (v_to = 'ERROR' and v_retry and d.attempts < 6) or v_to = 'SENT' then now() + case greatest(d.attempts, 1)
      when 1 then interval '1 minute' when 2 then interval '5 minutes' when 3 then interval '15 minutes'
      when 4 then interval '1 hour' else interval '6 hours' end
    else null end;

  update public.fiscal_documents set
    status = v_to,
    provider_document_id = coalesce(nullif(p_result ->> 'provider_document_id', ''), provider_document_id),
    provider_request_id = coalesce(nullif(p_result ->> 'provider_request_id', ''), provider_request_id),
    provider_status = coalesce(nullif(p_result ->> 'provider_status', ''), provider_status),
    provider_message = coalesce(left(p_result ->> 'provider_message', 2000), provider_message),
    dian_status = coalesce(nullif(p_result ->> 'dian_status', ''), dian_status),
    dian_message = coalesce(left(p_result ->> 'dian_message', 2000), dian_message),
    cufe = coalesce(nullif(p_result ->> 'cufe', ''), cufe),
    qr_data = coalesce(nullif(p_result ->> 'qr_data', ''), qr_data),
    xml_path = coalesce(nullif(p_result ->> 'xml_path', ''), xml_path),
    pdf_path = coalesce(nullif(p_result ->> 'pdf_path', ''), pdf_path),
    sent_at = case when v_to in ('SENT', 'ACCEPTED', 'REJECTED') or coalesce((p_result ->> 'transmitted')::boolean, false)
                   then coalesce(sent_at, now()) else sent_at end,
    accepted_at = case when v_to = 'ACCEPTED' then coalesce(accepted_at, now()) else accepted_at end,
    rejected_at = case when v_to = 'REJECTED' then now() else rejected_at end,
    last_error_code = case when v_to in ('ERROR', 'REJECTED') then left(p_result ->> 'error_code', 120) else null end,
    last_error_message = case when v_to in ('ERROR', 'REJECTED') then left(p_result ->> 'error_message', 2000) else null end,
    next_attempt_at = v_next
  where id = d.id;

  perform public.fiscal__event(d.id, d.store_id,
    case v_to when 'ACCEPTED' then 'accepted' when 'REJECTED' then 'rejected' when 'SENT' then 'sent' else 'error' end,
    d.status, v_to,
    coalesce(nullif(p_result ->> 'error_message', ''), nullif(p_result ->> 'dian_message', ''), nullif(p_result ->> 'provider_message', ''),
             case v_to when 'ACCEPTED' then 'Documento aceptado' when 'SENT' then 'Documento recibido por el proveedor' else v_to end),
    coalesce(p_result -> 'payload', '{}'::jsonb), p_result ->> 'error_code', p_source);

  v_action := case v_to when 'ACCEPTED' then 'fiscal.document_accepted' when 'REJECTED' then 'fiscal.document_rejected'
                        when 'SENT' then 'fiscal.document_sent' else 'fiscal.document_error' end;
  perform public.erp__audit_insert(d.store_id, d.point_id, 'fiscal', case when v_to in ('REJECTED', 'ERROR') then 'warning' else 'info' end,
    v_action, 'fiscal_documents', d.id, jsonb_build_object('status', d.status),
    jsonb_build_object('status', v_to, 'full_number', d.full_number, 'cufe', p_result ->> 'cufe', 'error', p_result ->> 'error_message',
      'source', p_source, 'attempt', d.attempts), null, '{}'::jsonb);

  -- Nota crédito aceptada: si cubre todo el valor, el documento original queda cancelado (se conserva).
  if v_to = 'ACCEPTED' and d.document_type = 'credit_note' and d.related_document_id is not null then
    select * into rel from public.fiscal_documents where id = d.related_document_id for update;
    select coalesce(sum(n.total), 0) into v_credited from public.fiscal_documents n
    where n.related_document_id = rel.id and n.document_type = 'credit_note' and n.status = 'ACCEPTED';
    if rel.status = 'ACCEPTED' and v_credited >= rel.total - 0.5 then
      update public.fiscal_documents set status = 'CANCELLED', cancelled_at = now() where id = rel.id;
      perform public.fiscal__event(rel.id, rel.store_id, 'cancelled_by_note', 'ACCEPTED', 'CANCELLED',
        'Anulado por la nota crédito ' || d.full_number, jsonb_build_object('note_id', d.id), null, p_source);
    else
      perform public.fiscal__event(rel.id, rel.store_id, 'credited', rel.status, rel.status,
        'Nota crédito ' || d.full_number || ' por ' || d.total, jsonb_build_object('note_id', d.id, 'credited_total', v_credited), null, p_source);
    end if;
  end if;
  if v_to = 'ACCEPTED' and d.document_type = 'debit_note' and d.related_document_id is not null then
    perform public.fiscal__event(d.related_document_id, d.store_id, 'debited', null, null,
      'Nota débito ' || d.full_number || ' por ' || d.total, jsonb_build_object('note_id', d.id), null, p_source);
  end if;

  return jsonb_build_object('ok', true, 'status', v_to, 'next_attempt_at', v_next, 'full_number', d.full_number);
end;
$$;
revoke all on function public.fiscal__apply_status(uuid, jsonb, text) from public, anon, authenticated;

create or replace function public.fiscal__record_result(p_document uuid, p_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.fiscal__apply_status(p_document, p_result, 'provider');
end;
$$;
revoke all on function public.fiscal__record_result(uuid, jsonb) from public, anon, authenticated;

-- Documentos pendientes para el proceso automático (reintentos con espera creciente).
create or replace function public.fiscal__due_documents(p_limit integer default 20, p_store uuid default null)
returns setof uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_doc record;
begin
  -- Envíos que quedaron a medias (el servidor se detuvo) vuelven a la cola.
  for v_doc in
    update public.fiscal_documents set status = 'QUEUED', next_attempt_at = now()
    where status = 'PROCESSING' and updated_at < now() - interval '10 minutes'
    returning id, store_id
  loop
    perform public.fiscal__event(v_doc.id, v_doc.store_id, 'requeued', 'PROCESSING', 'QUEUED',
      'El envío anterior no terminó: vuelve a la cola', '{}'::jsonb, null, 'job');
  end loop;
  return query
    select d.id from public.fiscal_documents d
    where (p_store is null or d.store_id = p_store)
      and ((d.status in ('ERROR', 'SENT') and d.next_attempt_at is not null and d.next_attempt_at <= now() and d.attempts < 8)
        or (d.status = 'QUEUED' and (d.next_attempt_at <= now() or (d.next_attempt_at is null and d.created_at < now() - interval '2 minutes'))))
    order by d.created_at
    limit least(greatest(coalesce(p_limit, 20), 1), 100);
end;
$$;
revoke all on function public.fiscal__due_documents(integer, uuid) from public, anon, authenticated;

-- Anula un documento que nunca se transmitió (el número queda registrado como no usado).
-- REQUIERE VALIDACIÓN CONTABLE: el manejo de números anulados sin transmitir.
create or replace function public.fiscal_void_unsent(p_document uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare d public.fiscal_documents;
begin
  select * into d from public.fiscal_documents where id = p_document for update;
  if d.id is null then return public.fiscal__err('NOT_FOUND', 'El documento no existe.'); end if;
  if not (public.erp_can(d.store_id, 'fiscal_notes') and public.erp_point_allowed(d.store_id, d.point_id)) then
    perform public.erp__security_event(d.store_id, public.erp_my_point(d.store_id), 'security.fiscal_void_denied',
      jsonb_build_object('document', d.id, 'full_number', d.full_number));
    return public.fiscal__err('FORBIDDEN', 'Necesitas el permiso de notas y anulaciones en este punto.');
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then return public.fiscal__err('REASON_REQUIRED', 'Escribe el motivo de la anulación.'); end if;
  if d.status in ('ACCEPTED', 'CANCELLED', 'CANCEL_PENDING', 'SENT', 'PROCESSING') then
    return public.fiscal__err('TRANSMITTED', 'Este documento ya fue transmitido: corrígelo con una nota crédito.');
  end if;
  if d.status = 'VOID' then return public.fiscal__err('VOID', 'El documento ya está anulado.'); end if;
  if d.status = 'ERROR' and d.sent_at is not null then
    return public.fiscal__err('MAYBE_TRANSMITTED', 'El documento pudo llegar al proveedor: consulta su estado antes de anularlo.');
  end if;
  update public.fiscal_documents set status = 'VOID', voided_at = now(), void_reason = trim(p_reason) where id = d.id;
  update public.fiscal_number_allocations set status = 'voided_unsent' where document_id = d.id;
  perform public.fiscal__event(d.id, d.store_id, 'voided', d.status, 'VOID', 'Anulado sin transmitir: ' || trim(p_reason));
  perform public.erp__audit_insert(d.store_id, d.point_id, 'fiscal', 'warning', 'fiscal.document_voided', 'fiscal_documents', d.id,
    jsonb_build_object('status', d.status), jsonb_build_object('status', 'VOID', 'full_number', d.full_number), trim(p_reason), '{}'::jsonb);
  return jsonb_build_object('ok', true, 'status', 'VOID');
end;
$$;
grant execute on function public.fiscal_void_unsent(uuid, text) to authenticated;

-- Notas crédito / débito sobre un documento aceptado. Los conceptos son configurables
-- (REQUIERE VALIDACIÓN con el proveedor tecnológico y la contadora).
create or replace function public.fiscal_create_note(
  p_document uuid, p_kind text, p_concept text, p_reason text, p_lines jsonb, p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.fiscal_documents;
  v_existing public.fiscal_documents;
  v_lines jsonb := '[]'::jsonb;
  it jsonb;
  l public.fiscal_document_lines;
  v_qty numeric;
  v_left numeric;
  v_res jsonb;
begin
  select * into o from public.fiscal_documents where id = p_document for update;
  if o.id is null then return public.fiscal__err('NOT_FOUND', 'El documento no existe.'); end if;
  if not (public.erp_can(o.store_id, 'fiscal_notes') and public.erp_point_allowed(o.store_id, o.point_id)) then
    perform public.erp__security_event(o.store_id, public.erp_my_point(o.store_id), 'security.fiscal_note_denied',
      jsonb_build_object('document', o.id, 'full_number', o.full_number));
    return public.fiscal__err('FORBIDDEN', 'Necesitas el permiso de notas y anulaciones en este punto.');
  end if;
  if nullif(p_idempotency_key, '') is not null then
    select * into v_existing from public.fiscal_documents where store_id = o.store_id and idempotency_key = p_idempotency_key;
    if v_existing.id is not null then
      return jsonb_build_object('ok', true, 'reused', true, 'document_id', v_existing.id, 'full_number', v_existing.full_number, 'status', v_existing.status);
    end if;
  end if;
  if p_kind not in ('credit_note', 'debit_note') then return public.fiscal__err('INVALID', 'Tipo de nota inválido.'); end if;
  if o.document_type not in ('invoice', 'pos_equivalent', 'export_invoice', 'contingency_invoice') then
    return public.fiscal__err('INVALID', 'Las notas se hacen sobre facturas o documentos equivalentes.');
  end if;
  if o.status <> 'ACCEPTED' then
    return public.fiscal__err('NOT_ACCEPTED', 'Solo se hacen notas sobre documentos aceptados.');
  end if;
  if (p_kind = 'credit_note' and coalesce(p_concept, '') not in ('1', '2', '3', '4', '5', '6'))
     or (p_kind = 'debit_note' and coalesce(p_concept, '') not in ('1', '2', '3', '4')) then
    return public.fiscal__err('INVALID', 'Elige el concepto de la nota.');
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then return public.fiscal__err('REASON_REQUIRED', 'Escribe el motivo de la nota.'); end if;

  if p_kind = 'credit_note' then
    -- Sin líneas = nota por el total pendiente; con líneas = devolución parcial (no más de lo facturado).
    for l in select * from public.fiscal_document_lines where document_id = o.id order by line_no loop
      select coalesce(sum(nl.qty), 0) into v_left from public.fiscal_document_lines nl
      join public.fiscal_documents n on n.id = nl.document_id
      where n.related_document_id = o.id and n.document_type = 'credit_note' and n.status not in ('VOID', 'REJECTED')
        and nl.ref_line_no = l.line_no;
      v_left := l.qty - v_left;
      v_qty := null;
      if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
        v_qty := v_left;
      else
        select (x ->> 'qty')::numeric into v_qty from jsonb_array_elements(p_lines) x where (x ->> 'line_no')::integer = l.line_no limit 1;
      end if;
      if v_qty is not null and v_qty > 0 then
        if v_qty > v_left then
          return public.fiscal__err('QTY_EXCEEDED', 'La línea ' || l.line_no || ' solo tiene ' || v_left || ' unidades por acreditar.');
        end if;
        v_lines := v_lines || jsonb_build_object('product_id', l.product_id, 'sku', l.sku, 'description', l.description,
          'unit_code', l.unit_code, 'qty', v_qty, 'unit_price', l.unit_price, 'tax_rate', l.tax_rate, 'ref_line_no', l.line_no);
      end if;
    end loop;
    if jsonb_array_length(v_lines) = 0 then
      return public.fiscal__err('NOTHING_LEFT', 'No hay valores pendientes por acreditar en este documento.');
    end if;
  else
    if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
      return public.fiscal__err('INVALID', 'Agrega al menos una línea a la nota débito.');
    end if;
    for it in select * from jsonb_array_elements(p_lines) loop
      if coalesce((it ->> 'unit_price')::numeric, 0) <= 0 then
        return public.fiscal__err('INVALID', 'Cada línea de la nota débito necesita un valor mayor a cero.');
      end if;
      v_lines := v_lines || jsonb_build_object('description', it ->> 'description', 'qty', coalesce((it ->> 'qty')::numeric, 1),
        'unit_price', (it ->> 'unit_price')::numeric, 'tax_rate', coalesce((it ->> 'tax_rate')::numeric, 0));
    end loop;
  end if;

  v_res := public.fiscal__create_document(jsonb_build_object(
    'store_id', o.store_id, 'point_id', o.point_id, 'fiscal_entity_id', o.fiscal_entity_id, 'establishment_id', o.establishment_id,
    'provider_account_id', o.provider_account_id, 'document_type', p_kind, 'environment', o.environment, 'initial_status', 'QUEUED',
    'customer_id', o.customer_id, 'customer', o.customer, 'source_type', 'note', 'source_id', o.source_id,
    'source_number', o.full_number, 'related_document_id', o.id, 'note_concept', p_concept, 'note_reason', trim(p_reason),
    'idempotency_key', p_idempotency_key, 'lines', v_lines, 'payment_form', o.payment_form,
    'prices_include_tax', coalesce((o.metadata ->> 'prices_include_tax')::boolean, true),
    'metadata', jsonb_build_object('original_full_number', o.full_number, 'original_cufe', o.cufe)));
  perform public.fiscal__event(o.id, o.store_id, case p_kind when 'credit_note' then 'credit_note_created' else 'debit_note_created' end,
    o.status, o.status, (case p_kind when 'credit_note' then 'Nota crédito ' else 'Nota débito ' end) || (v_res ->> 'full_number') || ': ' || trim(p_reason),
    jsonb_build_object('note_id', v_res ->> 'document_id'));
  return v_res;
exception
  when sqlstate 'P0001' then
    return public.fiscal__err('VALIDATION', sqlerrm);
end;
$$;
grant execute on function public.fiscal_create_note(uuid, text, text, text, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------
-- 10. Contingencias
-- ---------------------------------------------------------------------
create or replace function public.fiscal_contingency_start(p_store uuid, p_point uuid, p_kind text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_entity uuid;
  v_account uuid;
begin
  if not public.erp_can_any(p_store, array['fiscal_send', 'fiscal_config']::text[])
     or (p_point is null and public.erp_my_points(p_store) is not null)
     or (p_point is not null and not public.erp_point_allowed(p_store, p_point)) then
    perform public.erp__security_event(p_store, public.erp_my_point(p_store), 'security.fiscal_contingency_denied', jsonb_build_object('point', p_point));
    return public.fiscal__err('FORBIDDEN', 'No tienes permiso para abrir contingencias aquí.');
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then return public.fiscal__err('REASON_REQUIRED', 'Describe qué está pasando.'); end if;
  if p_point is not null then
    select pc.fiscal_entity_id, pc.provider_account_id into v_entity, v_account from public.fiscal_point_configs pc where pc.point_id = p_point;
  end if;
  insert into public.fiscal_contingencies (store_id, point_id, fiscal_entity_id, provider_account_id, kind, reason, started_by, started_by_name)
  values (p_store, p_point, v_entity, v_account, coalesce(nullif(p_kind, ''), 'provider'), trim(p_reason), auth.uid(), public.erp_actor_name(p_store))
  returning id into v_id;
  perform public.erp__audit_insert(p_store, p_point, 'fiscal', 'warning', 'fiscal.contingency_started', 'fiscal_contingencies', v_id,
    null, jsonb_build_object('kind', p_kind), trim(p_reason), '{}'::jsonb);
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;
grant execute on function public.fiscal_contingency_start(uuid, uuid, text, text) to authenticated;

create or replace function public.fiscal_contingency_end(p_id uuid, p_notes text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.fiscal_contingencies;
  v_count integer;
begin
  select * into c from public.fiscal_contingencies where id = p_id for update;
  if c.id is null then return public.fiscal__err('NOT_FOUND', 'La contingencia no existe.'); end if;
  if not public.erp_can_any(c.store_id, array['fiscal_send', 'fiscal_config']::text[])
     or (c.point_id is null and public.erp_my_points(c.store_id) is not null)
     or (c.point_id is not null and not public.erp_point_allowed(c.store_id, c.point_id)) then
    return public.fiscal__err('FORBIDDEN', 'No tienes permiso para cerrar esta contingencia.');
  end if;
  if c.status = 'closed' then return public.fiscal__err('CLOSED', 'La contingencia ya está cerrada.'); end if;
  update public.fiscal_contingencies set status = 'closed', ended_at = now(), ended_by = auth.uid(),
    ended_by_name = public.erp_actor_name(c.store_id), end_notes = nullif(trim(coalesce(p_notes, '')), '')
  where id = c.id;
  -- Los documentos en contingencia vuelven a la cola para transmitirse.
  with q as (
    update public.fiscal_documents d set status = 'QUEUED', next_attempt_at = now()
    where d.store_id = c.store_id and d.status = 'CONTINGENCY'
      and (d.contingency_id = c.id or ((c.point_id is null or d.point_id = c.point_id)
           and (c.fiscal_entity_id is null or d.fiscal_entity_id = c.fiscal_entity_id)))
    returning d.id
  ) select count(*) into v_count from q;
  perform public.erp__audit_insert(c.store_id, c.point_id, 'fiscal', 'info', 'fiscal.contingency_closed', 'fiscal_contingencies', c.id,
    null, jsonb_build_object('documents_requeued', v_count), p_notes, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'requeued', v_count);
end;
$$;
grant execute on function public.fiscal_contingency_end(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 11. Webhooks del proveedor (los guarda, verifica e idempotencia: cada evento una vez)
-- ---------------------------------------------------------------------
create or replace function public.fiscal__webhook_store(
  p_account uuid, p_provider text, p_external_id text, p_type text, p_payload jsonb, p_hash text,
  p_valid boolean, p_headers jsonb, p_ip text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_store uuid;
begin
  select store_id into v_store from public.fiscal_provider_accounts where id = p_account;
  insert into public.fiscal_webhook_events
    (provider, provider_account_id, store_id, external_event_id, event_type, signature_valid, payload, payload_hash,
     headers, status, source_ip, last_error)
  values
    (p_provider, p_account, v_store,
     case when p_valid then nullif(p_external_id, '') end,
     left(p_type, 120), p_valid,
     case when p_valid then p_payload end,
     -- Un evento rechazado nunca bloquea a uno legítimo idéntico que llegue después.
     case when p_valid then p_hash else 'rejected:' || p_hash || ':' || gen_random_uuid()::text end,
     coalesce(p_headers, '{}'::jsonb),
     case when p_valid then 'received' else 'rejected' end,
     left(p_ip, 80),
     case when p_valid then null else 'Firma inválida o vencida' end)
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    select e.id into v_id from public.fiscal_webhook_events e
    where e.provider_account_id = p_account
      and ((nullif(p_external_id, '') is not null and e.external_event_id = p_external_id)
           or (nullif(p_external_id, '') is null and e.external_event_id is null and e.payload_hash = p_hash))
    limit 1;
    return jsonb_build_object('id', v_id, 'duplicate', true);
  end if;

  if not p_valid then
    perform public.erp__security_event(v_store, null, 'security.webhook_bad_signature',
      jsonb_build_object('provider', p_provider, 'account', p_account, 'ip', p_ip), 'critical');
    update public.fiscal_provider_accounts
    set webhook_failures = webhook_failures + 1,
        webhook_status = case when webhook_failures + 1 >= 3 then 'failing' else webhook_status end
    where id = p_account;
  end if;
  return jsonb_build_object('id', v_id, 'duplicate', false, 'store_id', v_store);
end;
$$;
revoke all on function public.fiscal__webhook_store(uuid, text, text, text, jsonb, text, boolean, jsonb, text) from public, anon, authenticated;

-- Procesa un evento ya verificado. p_parsed lo arma el adaptador del proveedor (nunca se confía
-- en la tienda que diga el mensaje: el documento se busca dentro de la cuenta que recibió el webhook).
create or replace function public.fiscal__webhook_apply(p_event uuid, p_parsed jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.fiscal_webhook_events;
  acc public.fiscal_provider_accounts;
  d public.fiscal_documents;
  v_res jsonb;
begin
  select * into e from public.fiscal_webhook_events where id = p_event for update;
  if e.id is null then return public.fiscal__err('NOT_FOUND', 'Evento no encontrado.'); end if;
  if e.status in ('processed', 'ignored') then return jsonb_build_object('ok', true, 'already', true); end if;
  if not e.signature_valid then return public.fiscal__err('REJECTED', 'El evento no tiene firma válida.'); end if;
  select * into acc from public.fiscal_provider_accounts where id = e.provider_account_id;

  if coalesce(p_parsed ->> 'kind', '') <> 'document_status' then
    update public.fiscal_webhook_events set status = 'ignored', processed_at = now(), attempts = attempts + 1 where id = e.id;
    update public.fiscal_provider_accounts set webhook_status = 'ok', webhook_last_event_at = now(), webhook_failures = 0 where id = acc.id;
    return jsonb_build_object('ok', true, 'ignored', true);
  end if;

  select * into d from public.fiscal_documents x
  where x.provider_account_id = acc.id
    and ((nullif(p_parsed ->> 'provider_document_id', '') is not null and x.provider_document_id = p_parsed ->> 'provider_document_id')
         or (nullif(p_parsed ->> 'cufe', '') is not null and x.cufe = p_parsed ->> 'cufe')
         or (nullif(p_parsed ->> 'full_number', '') is not null and x.full_number = p_parsed ->> 'full_number'))
  order by x.created_at desc
  limit 1;
  if d.id is null then
    perform public.fiscal__webhook_fail(e.id, 'No se encontró el documento en esta cuenta del proveedor.');
    return public.fiscal__err('DOC_NOT_FOUND', 'Documento no encontrado (se reintentará).');
  end if;

  v_res := public.fiscal__apply_status(d.id, p_parsed, 'webhook');
  update public.fiscal_webhook_events set status = 'processed', processed_at = now(), document_id = d.id,
    attempts = attempts + 1, last_error = null, next_retry_at = null
  where id = e.id;
  update public.fiscal_provider_accounts set webhook_status = 'ok', webhook_last_event_at = now(), webhook_failures = 0 where id = acc.id;
  return jsonb_build_object('ok', true, 'document_id', d.id, 'result', v_res);
end;
$$;
revoke all on function public.fiscal__webhook_apply(uuid, jsonb) from public, anon, authenticated;

create or replace function public.fiscal__webhook_fail(p_event uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare e public.fiscal_webhook_events;
begin
  select * into e from public.fiscal_webhook_events where id = p_event for update;
  if e.id is null then return; end if;
  update public.fiscal_webhook_events set
    attempts = attempts + 1,
    status = case when attempts + 1 >= 6 then 'dead' else 'failed' end,
    next_retry_at = case when attempts + 1 >= 6 then null else now() + case attempts + 1
      when 1 then interval '1 minute' when 2 then interval '5 minutes' when 3 then interval '30 minutes'
      when 4 then interval '2 hours' else interval '12 hours' end end,
    last_error = left(p_error, 1000)
  where id = e.id;
  if e.provider_account_id is not null then
    update public.fiscal_provider_accounts
    set webhook_failures = webhook_failures + 1,
        webhook_status = case when webhook_failures + 1 >= 3 then 'failing' else webhook_status end
    where id = e.provider_account_id;
  end if;
end;
$$;
revoke all on function public.fiscal__webhook_fail(uuid, text) from public, anon, authenticated;

create or replace function public.fiscal__due_webhooks(p_limit integer default 20)
returns setof uuid
language sql
security definer
set search_path = public
as $$
  select e.id from public.fiscal_webhook_events e
  where e.signature_valid
    and ((e.status = 'failed' and e.next_retry_at <= now()) or (e.status = 'received' and e.received_at < now() - interval '1 minute'))
  order by e.received_at
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;
revoke all on function public.fiscal__due_webhooks(integer) from public, anon, authenticated;

-- Reintento manual desde el panel (permiso del proveedor tecnológico).
create or replace function public.fiscal_webhook_retry(p_event uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare e public.fiscal_webhook_events;
begin
  select * into e from public.fiscal_webhook_events where id = p_event for update;
  if e.id is null then return public.fiscal__err('NOT_FOUND', 'Evento no encontrado.'); end if;
  if not (public.erp_is_platform_admin() or (public.erp_can(e.store_id, 'fiscal_provider') and public.erp_my_points(e.store_id) is null)) then
    return public.fiscal__err('FORBIDDEN', 'Necesitas el permiso del proveedor tecnológico.');
  end if;
  if not e.signature_valid then return public.fiscal__err('REJECTED', 'Un evento con firma inválida no se reprocesa.'); end if;
  if e.status in ('processed', 'ignored') then return public.fiscal__err('DONE', 'Este evento ya se procesó.'); end if;
  update public.fiscal_webhook_events set status = 'received', next_retry_at = now() where id = e.id;
  perform public.erp__audit_insert(e.store_id, null, 'fiscal', 'info', 'fiscal.webhook_retry', 'fiscal_webhook_events', e.id, null, null, null, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function public.fiscal_webhook_retry(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 12. Configuración fiscal (cada cambio con permiso, alcance, motivo y auditoría)
-- ---------------------------------------------------------------------

-- Contribuyente. Crear: solo la tienda madre. Editar: también el usuario de punto con
-- permiso fiscal, pero solo el contribuyente de su punto. Cambiar NIT/razón social exige motivo.
create or replace function public.fiscal_entity_save(p_store uuid, p_data jsonb, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := nullif(p_data ->> 'id', '')::uuid;
  e public.fiscal_entities;
  v_sensitive boolean := false;
begin
  if not public.erp_can(p_store, 'fiscal_config') then
    perform public.erp__security_event(p_store, public.erp_my_point(p_store), 'security.fiscal_entity_denied',
      jsonb_build_object('entity', v_id, 'document_number', p_data ->> 'document_number'));
    return public.fiscal__err('FORBIDDEN', 'Necesitas el permiso «Configuración fiscal».');
  end if;
  if v_id is null then
    if public.erp_my_points(p_store) is not null then
      return public.fiscal__err('FORBIDDEN', 'Solo la tienda madre crea contribuyentes.');
    end if;
  else
    select * into e from public.fiscal_entities where id = v_id and store_id = p_store;
    if e.id is null then return public.fiscal__err('NOT_FOUND', 'El contribuyente no existe en esta tienda.'); end if;
    if not public.fiscal__entity_visible(p_store, v_id) then
      perform public.erp__security_event(p_store, public.erp_my_point(p_store), 'security.fiscal_foreign_entity',
        jsonb_build_object('entity', v_id, 'legal_name', e.legal_name), 'critical');
      return public.fiscal__err('FORBIDDEN', 'No puedes modificar la información fiscal de otro contribuyente.');
    end if;
    v_sensitive := coalesce(p_data ->> 'document_number', e.document_number) is distinct from e.document_number
      or coalesce(p_data ->> 'document_type', e.document_type) is distinct from e.document_type
      or upper(trim(coalesce(p_data ->> 'legal_name', e.legal_name))) is distinct from e.legal_name
      or coalesce(p_data ->> 'person_type', e.person_type) is distinct from e.person_type
      or (p_data ? 'verification_digit' and nullif(p_data ->> 'verification_digit', '') is distinct from e.verification_digit);
    if v_sensitive and length(trim(coalesce(p_reason, ''))) < 5 then
      return public.fiscal__err('REASON_REQUIRED', 'Cambiar el NIT, el DV, el tipo de persona o la razón social exige escribir el motivo.');
    end if;
  end if;

  perform set_config('remhub.audit_reason', coalesce(p_reason, ''), true);
  if v_id is null then
    insert into public.fiscal_entities (store_id, person_type, legal_name, trade_name, document_type, document_number, verification_digit,
      tax_regime, tax_responsibilities, economic_activities, fiscal_address, city, city_code, department, department_code, country,
      postal_code, phone, email, dian_email, rut_date, prices_include_tax, status, notes)
    values (p_store, coalesce(p_data ->> 'person_type', 'juridica'), coalesce(p_data ->> 'legal_name', ''), p_data ->> 'trade_name',
      coalesce(p_data ->> 'document_type', 'NIT'), p_data ->> 'document_number', p_data ->> 'verification_digit',
      p_data ->> 'tax_regime',
      coalesce(array(select jsonb_array_elements_text(p_data -> 'tax_responsibilities')), '{}'::text[]),
      coalesce(array(select jsonb_array_elements_text(p_data -> 'economic_activities')), '{}'::text[]),
      p_data ->> 'fiscal_address', p_data ->> 'city', p_data ->> 'city_code', p_data ->> 'department', p_data ->> 'department_code',
      coalesce(p_data ->> 'country', 'CO'), p_data ->> 'postal_code', p_data ->> 'phone', p_data ->> 'email', p_data ->> 'dian_email',
      nullif(p_data ->> 'rut_date', '')::date, coalesce((p_data ->> 'prices_include_tax')::boolean, true),
      coalesce(p_data ->> 'status', 'draft'), p_data ->> 'notes')
    returning * into e;
  else
    update public.fiscal_entities set
      person_type = coalesce(p_data ->> 'person_type', person_type),
      legal_name = coalesce(p_data ->> 'legal_name', legal_name),
      trade_name = case when p_data ? 'trade_name' then p_data ->> 'trade_name' else trade_name end,
      document_type = coalesce(p_data ->> 'document_type', document_type),
      document_number = case when p_data ? 'document_number' then p_data ->> 'document_number' else document_number end,
      verification_digit = case when p_data ? 'verification_digit' then p_data ->> 'verification_digit'
                                when p_data ? 'document_number' and p_data ->> 'document_number' is distinct from document_number then null
                                else verification_digit end,
      tax_regime = case when p_data ? 'tax_regime' then p_data ->> 'tax_regime' else tax_regime end,
      tax_responsibilities = case when p_data ? 'tax_responsibilities'
        then coalesce(array(select jsonb_array_elements_text(p_data -> 'tax_responsibilities')), '{}'::text[]) else tax_responsibilities end,
      economic_activities = case when p_data ? 'economic_activities'
        then coalesce(array(select jsonb_array_elements_text(p_data -> 'economic_activities')), '{}'::text[]) else economic_activities end,
      fiscal_address = case when p_data ? 'fiscal_address' then p_data ->> 'fiscal_address' else fiscal_address end,
      city = case when p_data ? 'city' then p_data ->> 'city' else city end,
      city_code = case when p_data ? 'city_code' then p_data ->> 'city_code' else city_code end,
      department = case when p_data ? 'department' then p_data ->> 'department' else department end,
      department_code = case when p_data ? 'department_code' then p_data ->> 'department_code' else department_code end,
      country = coalesce(p_data ->> 'country', country),
      postal_code = case when p_data ? 'postal_code' then p_data ->> 'postal_code' else postal_code end,
      phone = case when p_data ? 'phone' then p_data ->> 'phone' else phone end,
      email = case when p_data ? 'email' then p_data ->> 'email' else email end,
      dian_email = case when p_data ? 'dian_email' then p_data ->> 'dian_email' else dian_email end,
      rut_date = case when p_data ? 'rut_date' then nullif(p_data ->> 'rut_date', '')::date else rut_date end,
      prices_include_tax = coalesce((p_data ->> 'prices_include_tax')::boolean, prices_include_tax),
      status = coalesce(p_data ->> 'status', status),
      notes = case when p_data ? 'notes' then p_data ->> 'notes' else notes end
    where id = v_id
    returning * into e;
  end if;
  return jsonb_build_object('ok', true, 'id', e.id, 'entity', to_jsonb(e), 'missing', to_jsonb(public.fiscal__entity_missing(e)));
exception
  when unique_violation then
    return public.fiscal__err('DUPLICATE', 'Ya existe un contribuyente con ese documento en la tienda.');
  when sqlstate 'P0001' or check_violation or invalid_text_representation or invalid_datetime_format then
    return public.fiscal__err('INVALID', sqlerrm);
end;
$$;
grant execute on function public.fiscal_entity_save(uuid, jsonb, text) to authenticated;

create or replace function public.fiscal_establishment_save(p_store uuid, p_data jsonb, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := nullif(p_data ->> 'id', '')::uuid;
  v_entity uuid := nullif(p_data ->> 'fiscal_entity_id', '')::uuid;
  v_point uuid := nullif(p_data ->> 'point_id', '')::uuid;
  s public.fiscal_establishments;
begin
  if not public.erp_can(p_store, 'fiscal_config') then
    return public.fiscal__err('FORBIDDEN', 'Necesitas el permiso «Configuración fiscal».');
  end if;
  if v_id is not null then
    select * into s from public.fiscal_establishments where id = v_id and store_id = p_store;
    if s.id is null then return public.fiscal__err('NOT_FOUND', 'El establecimiento no existe.'); end if;
    v_entity := coalesce(v_entity, s.fiscal_entity_id);
    v_point := case when p_data ? 'point_id' then v_point else s.point_id end;
  end if;
  if v_entity is null then return public.fiscal__err('INVALID', 'Elige el contribuyente del establecimiento.'); end if;
  if not public.fiscal__entity_visible(p_store, v_entity)
     or (v_point is not null and not public.erp_point_allowed(p_store, v_point))
     or (public.erp_my_points(p_store) is not null and v_point is null) then
    perform public.erp__security_event(p_store, public.erp_my_point(p_store), 'security.fiscal_establishment_denied',
      jsonb_build_object('entity', v_entity, 'point', v_point));
    return public.fiscal__err('FORBIDDEN', 'No puedes configurar establecimientos de otro punto o contribuyente.');
  end if;
  perform set_config('remhub.audit_reason', coalesce(p_reason, ''), true);
  if v_id is null then
    insert into public.fiscal_establishments (store_id, fiscal_entity_id, point_id, name, code, address, city, city_code,
      department, department_code, country, phone, email, status)
    values (p_store, v_entity, v_point, coalesce(p_data ->> 'name', ''), p_data ->> 'code', p_data ->> 'address', p_data ->> 'city',
      p_data ->> 'city_code', p_data ->> 'department', p_data ->> 'department_code', coalesce(p_data ->> 'country', 'CO'),
      p_data ->> 'phone', p_data ->> 'email', coalesce(p_data ->> 'status', 'active'))
    returning * into s;
  else
    update public.fiscal_establishments set
      fiscal_entity_id = v_entity, point_id = v_point,
      name = coalesce(p_data ->> 'name', name),
      code = case when p_data ? 'code' then p_data ->> 'code' else code end,
      address = case when p_data ? 'address' then p_data ->> 'address' else address end,
      city = case when p_data ? 'city' then p_data ->> 'city' else city end,
      city_code = case when p_data ? 'city_code' then p_data ->> 'city_code' else city_code end,
      department = case when p_data ? 'department' then p_data ->> 'department' else department end,
      department_code = case when p_data ? 'department_code' then p_data ->> 'department_code' else department_code end,
      country = coalesce(p_data ->> 'country', country),
      phone = case when p_data ? 'phone' then p_data ->> 'phone' else phone end,
      email = case when p_data ? 'email' then p_data ->> 'email' else email end,
      status = coalesce(p_data ->> 'status', status)
    where id = v_id
    returning * into s;
  end if;
  return jsonb_build_object('ok', true, 'id', s.id, 'establishment', to_jsonb(s));
exception
  when sqlstate 'P0001' or check_violation or invalid_text_representation then
    return public.fiscal__err('INVALID', sqlerrm);
end;
$$;
grant execute on function public.fiscal_establishment_save(uuid, jsonb, text) to authenticated;

-- Resolución / numeración. Cambiar prefijo, rango, vigencia o estado exige motivo.
create or replace function public.fiscal_range_save(p_store uuid, p_data jsonb, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := nullif(p_data ->> 'id', '')::uuid;
  r public.fiscal_numbering_ranges;
  v_entity uuid;
  v_points uuid[];
  v_mine uuid[] := public.erp_my_points(p_store);
  v_type text;
  v_sensitive boolean := false;
begin
  if not public.erp_can(p_store, 'fiscal_numbering') then
    perform public.erp__security_event(p_store, public.erp_my_point(p_store), 'security.fiscal_range_denied',
      jsonb_build_object('range', v_id, 'prefix', p_data ->> 'prefix'));
    return public.fiscal__err('FORBIDDEN', 'El usuario no tiene permiso para modificar resoluciones o numeración.');
  end if;
  if v_id is not null then
    select * into r from public.fiscal_numbering_ranges where id = v_id and store_id = p_store;
    if r.id is null then return public.fiscal__err('NOT_FOUND', 'La numeración no existe.'); end if;
  end if;
  v_entity := coalesce(nullif(p_data ->> 'fiscal_entity_id', '')::uuid, r.fiscal_entity_id);
  v_type := coalesce(p_data ->> 'document_type', r.document_type, 'invoice');
  if p_data ? 'point_ids' then
    v_points := coalesce(array(select (jsonb_array_elements_text(p_data -> 'point_ids'))::uuid), '{}'::uuid[]);
  else
    v_points := coalesce(r.point_ids, '{}'::uuid[]);
  end if;
  if v_entity is null then return public.fiscal__err('INVALID', 'Elige el contribuyente dueño de la numeración.'); end if;
  if not public.fiscal__entity_visible(p_store, v_entity)
     or (v_mine is not null and (cardinality(v_points) = 0 or not (v_points <@ v_mine)))
     or (v_mine is not null and r.id is not null and not (r.point_ids <@ v_mine)) then
    perform public.erp__security_event(p_store, public.erp_my_point(p_store), 'security.fiscal_foreign_range',
      jsonb_build_object('range', v_id, 'entity', v_entity, 'points', to_jsonb(v_points)), 'critical');
    return public.fiscal__err('FORBIDDEN', 'No puedes usar ni modificar la numeración de otro punto o contribuyente.');
  end if;
  if r.id is not null then
    v_sensitive := coalesce(upper(p_data ->> 'prefix'), r.prefix) is distinct from r.prefix
      or coalesce((p_data ->> 'range_from')::bigint, r.range_from) is distinct from r.range_from
      or coalesce((p_data ->> 'range_to')::bigint, r.range_to) is distinct from r.range_to
      or coalesce(p_data ->> 'resolution_number', r.resolution_number) is distinct from r.resolution_number
      or coalesce(nullif(p_data ->> 'valid_until', '')::date, r.valid_until) is distinct from r.valid_until
      or coalesce(p_data ->> 'status', r.status) is distinct from r.status
      or v_points is distinct from r.point_ids;
    if v_sensitive and length(trim(coalesce(p_reason, ''))) < 5 then
      return public.fiscal__err('REASON_REQUIRED', 'Cambiar prefijo, rango, resolución, vigencia, puntos o estado exige escribir el motivo.');
    end if;
  end if;

  perform set_config('remhub.audit_reason', coalesce(p_reason, ''), true);
  if r.id is null then
    insert into public.fiscal_numbering_ranges (store_id, fiscal_entity_id, document_type, environment, name, resolution_number,
      resolution_date, valid_from, valid_until, prefix, range_from, range_to, next_number, point_ids, status,
      requires_resolution, alert_percent, alert_days, metadata)
    values (p_store, v_entity, v_type, coalesce(p_data ->> 'environment', 'sandbox'), nullif(trim(coalesce(p_data ->> 'name', '')), ''),
      p_data ->> 'resolution_number', nullif(p_data ->> 'resolution_date', '')::date, nullif(p_data ->> 'valid_from', '')::date,
      nullif(p_data ->> 'valid_until', '')::date, coalesce(p_data ->> 'prefix', ''), (p_data ->> 'range_from')::bigint,
      (p_data ->> 'range_to')::bigint, coalesce((p_data ->> 'next_number')::bigint, (p_data ->> 'range_from')::bigint), v_points,
      coalesce(p_data ->> 'status', 'draft'),
      coalesce((p_data ->> 'requires_resolution')::boolean, v_type not in ('credit_note', 'debit_note', 'support_adjustment')),
      coalesce((p_data ->> 'alert_percent')::integer, 80), coalesce((p_data ->> 'alert_days')::integer, 30),
      coalesce(p_data -> 'metadata', '{}'::jsonb))
    returning * into r;
  else
    update public.fiscal_numbering_ranges set
      fiscal_entity_id = v_entity,
      document_type = v_type,
      environment = coalesce(p_data ->> 'environment', environment),
      name = case when p_data ? 'name' then nullif(trim(coalesce(p_data ->> 'name', '')), '') else name end,
      resolution_number = case when p_data ? 'resolution_number' then p_data ->> 'resolution_number' else resolution_number end,
      resolution_date = case when p_data ? 'resolution_date' then nullif(p_data ->> 'resolution_date', '')::date else resolution_date end,
      valid_from = case when p_data ? 'valid_from' then nullif(p_data ->> 'valid_from', '')::date else valid_from end,
      valid_until = case when p_data ? 'valid_until' then nullif(p_data ->> 'valid_until', '')::date else valid_until end,
      prefix = coalesce(p_data ->> 'prefix', prefix),
      range_from = coalesce((p_data ->> 'range_from')::bigint, range_from),
      range_to = coalesce((p_data ->> 'range_to')::bigint, range_to),
      next_number = coalesce((p_data ->> 'next_number')::bigint, next_number),
      point_ids = v_points,
      status = coalesce(p_data ->> 'status', status),
      requires_resolution = coalesce((p_data ->> 'requires_resolution')::boolean, requires_resolution),
      alert_percent = coalesce((p_data ->> 'alert_percent')::integer, alert_percent),
      alert_days = coalesce((p_data ->> 'alert_days')::integer, alert_days),
      metadata = coalesce(p_data -> 'metadata', metadata)
    where id = r.id
    returning * into r;
  end if;
  return jsonb_build_object('ok', true, 'id', r.id, 'range', public.fiscal__range_info(r));
exception
  when sqlstate 'P0001' or check_violation or invalid_text_representation or invalid_datetime_format or numeric_value_out_of_range then
    return public.fiscal__err('INVALID', sqlerrm);
  when not_null_violation then
    return public.fiscal__err('INVALID', 'Completa el inicio y el final del rango autorizado.');
end;
$$;
grant execute on function public.fiscal_range_save(uuid, jsonb, text) to authenticated;

-- Configuración fiscal del punto. El paso a producción se confirma explícitamente con motivo.
create or replace function public.fiscal_point_config_save(p_point uuid, p_data jsonb, p_reason text default null, p_confirm_production boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store uuid;
  c public.fiscal_point_configs;
  v_env text;
  v_entity uuid;
  v_prod timestamptz;
  v_prod_by uuid;
  v_sensitive boolean;
begin
  select store_id into v_store from public.erp_warehouses where id = p_point;
  if v_store is null then return public.fiscal__err('NOT_FOUND', 'El punto no existe.'); end if;
  if not public.erp_can(v_store, 'fiscal_config') or not public.erp_point_allowed(v_store, p_point) then
    perform public.erp__security_event(v_store, public.erp_my_point(v_store), 'security.fiscal_point_config_denied',
      jsonb_build_object('point', p_point, 'data', p_data));
    return public.fiscal__err('FORBIDDEN', 'No puedes cambiar la configuración fiscal de este punto.');
  end if;
  select * into c from public.fiscal_point_configs where point_id = p_point;
  v_env := coalesce(p_data ->> 'environment', c.environment, 'sandbox');
  v_entity := case when p_data ? 'fiscal_entity_id' then nullif(p_data ->> 'fiscal_entity_id', '')::uuid else c.fiscal_entity_id end;
  if v_entity is not null and not public.fiscal__entity_visible(v_store, v_entity) and c.fiscal_entity_id is distinct from v_entity then
    -- Un usuario de punto no puede asignar a su punto el contribuyente de otro.
    if public.erp_my_points(v_store) is not null then
      perform public.erp__security_event(v_store, public.erp_my_point(v_store), 'security.fiscal_foreign_entity',
        jsonb_build_object('point', p_point, 'entity', v_entity), 'critical');
      return public.fiscal__err('FORBIDDEN', 'No puedes facturar con la identidad fiscal de otro contribuyente.');
    end if;
  end if;
  v_prod := c.production_confirmed_at;
  v_prod_by := c.production_confirmed_by;
  if v_env = 'production' and (c.environment is distinct from 'production' or c.production_confirmed_at is null) then
    if not coalesce(p_confirm_production, false) or length(trim(coalesce(p_reason, ''))) < 5 then
      return public.fiscal__err('CONFIRM_PRODUCTION',
        'Pasar a producción transmite documentos reales a la DIAN: confírmalo y escribe el motivo.');
    end if;
    v_prod := now();
    v_prod_by := auth.uid();
  end if;
  v_sensitive := c.point_id is not null and (v_entity is distinct from c.fiscal_entity_id or v_env is distinct from c.environment
    or coalesce((p_data ->> 'enabled')::boolean, c.enabled) is distinct from c.enabled);
  if v_sensitive and length(trim(coalesce(p_reason, ''))) < 5 then
    return public.fiscal__err('REASON_REQUIRED', 'Cambiar el contribuyente, el ambiente o la activación exige escribir el motivo.');
  end if;

  perform set_config('remhub.audit_reason', coalesce(p_reason, ''), true);
  insert into public.fiscal_point_configs as pc (point_id, store_id, fiscal_entity_id, establishment_id, provider_account_id, environment,
    enabled, pos_document_type, pos_electronic_default, production_confirmed_at, production_confirmed_by, notes)
  values (p_point, v_store, v_entity,
    case when p_data ? 'establishment_id' then nullif(p_data ->> 'establishment_id', '')::uuid else c.establishment_id end,
    case when p_data ? 'provider_account_id' then nullif(p_data ->> 'provider_account_id', '')::uuid else c.provider_account_id end,
    v_env, coalesce((p_data ->> 'enabled')::boolean, c.enabled, false),
    coalesce(p_data ->> 'pos_document_type', c.pos_document_type, 'invoice'),
    coalesce((p_data ->> 'pos_electronic_default')::boolean, c.pos_electronic_default, true),
    v_prod, v_prod_by, case when p_data ? 'notes' then p_data ->> 'notes' else c.notes end)
  on conflict (point_id) do update set
    fiscal_entity_id = excluded.fiscal_entity_id, establishment_id = excluded.establishment_id,
    provider_account_id = excluded.provider_account_id, environment = excluded.environment, enabled = excluded.enabled,
    pos_document_type = excluded.pos_document_type, pos_electronic_default = excluded.pos_electronic_default,
    production_confirmed_at = excluded.production_confirmed_at, production_confirmed_by = excluded.production_confirmed_by,
    notes = excluded.notes
  returning * into c;
  return jsonb_build_object('ok', true, 'config', to_jsonb(c), 'readiness', public.fiscal__point_readiness(p_point));
exception
  when sqlstate 'P0001' or check_violation or invalid_text_representation then
    return public.fiscal__err('INVALID', sqlerrm);
end;
$$;
grant execute on function public.fiscal_point_config_save(uuid, jsonb, text, boolean) to authenticated;

-- Cuenta del proveedor (datos no secretos). Los secretos los cifra y guarda el servidor.
create or replace function public.fiscal_provider_account_save(p_store uuid, p_data jsonb, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := nullif(p_data ->> 'id', '')::uuid;
  a public.fiscal_provider_accounts;
  v_entity uuid;
  v_key text;
begin
  if not public.erp_can(p_store, 'fiscal_provider') then
    perform public.erp__security_event(p_store, public.erp_my_point(p_store), 'security.fiscal_provider_denied', jsonb_build_object('account', v_id));
    return public.fiscal__err('FORBIDDEN', 'Necesitas el permiso del proveedor tecnológico.');
  end if;
  if v_id is not null then
    select * into a from public.fiscal_provider_accounts where id = v_id and store_id = p_store;
    if a.id is null then return public.fiscal__err('NOT_FOUND', 'La cuenta del proveedor no existe.'); end if;
  end if;
  v_entity := coalesce(nullif(p_data ->> 'fiscal_entity_id', '')::uuid, a.fiscal_entity_id);
  if v_entity is null then return public.fiscal__err('INVALID', 'Elige el contribuyente de la cuenta.'); end if;
  if not public.fiscal__entity_visible(p_store, v_entity) then
    perform public.erp__security_event(p_store, public.erp_my_point(p_store), 'security.fiscal_foreign_entity',
      jsonb_build_object('account', v_id, 'entity', v_entity), 'critical');
    return public.fiscal__err('FORBIDDEN', 'No puedes configurar el proveedor de otro contribuyente.');
  end if;
  -- Ningún secreto viaja en la configuración visible.
  for v_key in select jsonb_object_keys(coalesce(p_data -> 'settings', '{}'::jsonb)) loop
    if v_key ~* '(secret|password|passwd|token|apikey|api_key|private|clave)' then
      return public.fiscal__err('INVALID', 'El campo «' || v_key || '» parece un secreto: guárdalo en «Credenciales», no en la configuración.');
    end if;
  end loop;
  perform set_config('remhub.audit_reason', coalesce(p_reason, ''), true);
  if v_id is null then
    insert into public.fiscal_provider_accounts (store_id, fiscal_entity_id, provider, environment, label, external_account_id, settings)
    values (p_store, v_entity, coalesce(p_data ->> 'provider', 'sandbox'), coalesce(p_data ->> 'environment', 'sandbox'),
      nullif(trim(coalesce(p_data ->> 'label', '')), ''), nullif(trim(coalesce(p_data ->> 'external_account_id', '')), ''),
      coalesce(p_data -> 'settings', '{}'::jsonb))
    returning * into a;
  else
    update public.fiscal_provider_accounts set
      fiscal_entity_id = v_entity,
      provider = coalesce(p_data ->> 'provider', provider),
      environment = coalesce(p_data ->> 'environment', environment),
      label = case when p_data ? 'label' then nullif(trim(coalesce(p_data ->> 'label', '')), '') else label end,
      external_account_id = case when p_data ? 'external_account_id' then nullif(trim(coalesce(p_data ->> 'external_account_id', '')), '') else external_account_id end,
      settings = coalesce(p_data -> 'settings', settings),
      status = case when status = 'disconnected' then 'draft' else status end,
      last_test_ok = case when p_data ? 'external_account_id' or p_data ? 'settings' then null else last_test_ok end
    where id = v_id
    returning * into a;
  end if;
  return jsonb_build_object('ok', true, 'id', a.id, 'webhook_token', a.webhook_token, 'account', to_jsonb(a) - 'webhook_token');
exception
  when unique_violation then
    return public.fiscal__err('DUPLICATE', 'Ya existe una cuenta de ese proveedor para el contribuyente en ese ambiente.');
  when sqlstate 'P0001' or check_violation or foreign_key_violation or invalid_text_representation then
    return public.fiscal__err('INVALID', sqlerrm);
end;
$$;
grant execute on function public.fiscal_provider_account_save(uuid, jsonb, text) to authenticated;

-- Desconectar o reconectar (vuelve a borrador hasta una nueva prueba de conexión).
create or replace function public.fiscal_provider_account_set_status(p_account uuid, p_status text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare a public.fiscal_provider_accounts;
begin
  select * into a from public.fiscal_provider_accounts where id = p_account;
  if a.id is null then return public.fiscal__err('NOT_FOUND', 'La cuenta no existe.'); end if;
  if not public.erp_can(a.store_id, 'fiscal_provider') or not public.fiscal__entity_visible(a.store_id, a.fiscal_entity_id) then
    perform public.erp__security_event(a.store_id, public.erp_my_point(a.store_id), 'security.fiscal_provider_denied', jsonb_build_object('account', a.id));
    return public.fiscal__err('FORBIDDEN', 'Necesitas el permiso del proveedor tecnológico.');
  end if;
  if p_status not in ('disconnected', 'draft') then return public.fiscal__err('INVALID', 'Estado inválido.'); end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then return public.fiscal__err('REASON_REQUIRED', 'Escribe el motivo.'); end if;
  perform set_config('remhub.audit_reason', p_reason, true);
  update public.fiscal_provider_accounts set status = p_status,
    disconnected_at = case when p_status = 'disconnected' then now() else disconnected_at end,
    last_test_ok = case when p_status = 'disconnected' then false else last_test_ok end
  where id = a.id;
  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function public.fiscal_provider_account_set_status(uuid, text, text) to authenticated;

-- ¿Puede el usuario gestionar esta cuenta del proveedor? (lo consulta el servidor antes de tocar secretos)
create or replace function public.fiscal_provider_access(p_account uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare a public.fiscal_provider_accounts;
begin
  select * into a from public.fiscal_provider_accounts where id = p_account;
  if a.id is null then return public.fiscal__err('NOT_FOUND', 'La cuenta no existe.'); end if;
  if not public.erp_can(a.store_id, 'fiscal_provider') or not public.fiscal__entity_visible(a.store_id, a.fiscal_entity_id) then
    perform public.erp__security_event(a.store_id, public.erp_my_point(a.store_id), 'security.fiscal_provider_denied', jsonb_build_object('account', a.id));
    return public.fiscal__err('FORBIDDEN', 'Necesitas el permiso del proveedor tecnológico.');
  end if;
  return jsonb_build_object('ok', true, 'store_id', a.store_id, 'provider', a.provider, 'environment', a.environment,
    'fiscal_entity_id', a.fiscal_entity_id, 'external_account_id', a.external_account_id, 'settings', a.settings);
end;
$$;
grant execute on function public.fiscal_provider_access(uuid) to authenticated;

-- Resultado de la prueba de conexión (lo registra el servidor).
create or replace function public.fiscal__provider_test_result(p_account uuid, p_ok boolean, p_message text, p_details jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare a public.fiscal_provider_accounts;
begin
  select * into a from public.fiscal_provider_accounts where id = p_account for update;
  if a.id is null then return; end if;
  update public.fiscal_provider_accounts set
    last_test_at = now(), last_test_ok = p_ok, last_error = case when p_ok then null else left(p_message, 1000) end,
    status = case when p_ok then 'connected' when status = 'disconnected' then 'disconnected' else 'error' end,
    connected_at = case when p_ok and connected_at is null then now() else connected_at end
  where id = a.id;
  perform public.erp__audit_insert(a.store_id, null, 'fiscal', case when p_ok then 'info' else 'warning' end,
    'fiscal.provider_test', 'fiscal_provider_accounts', a.id, null,
    jsonb_build_object('ok', p_ok, 'message', left(p_message, 300), 'provider', a.provider, 'environment', a.environment), null,
    coalesce(p_details, '{}'::jsonb));
end;
$$;
revoke all on function public.fiscal__provider_test_result(uuid, boolean, text, jsonb) from public, anon, authenticated;

-- Pistas visibles de los secretos guardados (por ejemplo «••••1234»).
create or replace function public.fiscal__provider_set_hints(p_account uuid, p_hints jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.fiscal_provider_accounts
  set credentials_hint = jsonb_strip_nulls(credentials_hint || coalesce(p_hints, '{}'::jsonb)),
      last_test_ok = null,
      status = case when status = 'connected' then 'draft' else status end
  where id = p_account;
end;
$$;
revoke all on function public.fiscal__provider_set_hints(uuid, jsonb) from public, anon, authenticated;

-- Clave técnica de una numeración (la cifra el servidor): permisos y pista visible.
create or replace function public.fiscal_range_access(p_range uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r public.fiscal_numbering_ranges;
begin
  select * into r from public.fiscal_numbering_ranges where id = p_range;
  if r.id is null then return public.fiscal__err('NOT_FOUND', 'La numeración no existe.'); end if;
  if not public.erp_can(r.store_id, 'fiscal_numbering')
     or (public.erp_my_points(r.store_id) is not null and not (r.point_ids <@ public.erp_my_points(r.store_id))) then
    perform public.erp__security_event(r.store_id, public.erp_my_point(r.store_id), 'security.fiscal_range_denied', jsonb_build_object('range', r.id));
    return public.fiscal__err('FORBIDDEN', 'El usuario no tiene permiso para modificar esta numeración.');
  end if;
  return jsonb_build_object('ok', true, 'store_id', r.store_id);
end;
$$;
grant execute on function public.fiscal_range_access(uuid) to authenticated;

create or replace function public.fiscal__range_set_key_hint(p_range uuid, p_hint text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.fiscal_numbering_ranges set technical_key_hint = p_hint where id = p_range;
end;
$$;
revoke all on function public.fiscal__range_set_key_hint(uuid, text) from public, anon, authenticated;

-- Certificados (metadatos y vencimiento).
create or replace function public.fiscal_certificate_save(p_store uuid, p_data jsonb, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := nullif(p_data ->> 'id', '')::uuid;
  v_entity uuid := nullif(p_data ->> 'fiscal_entity_id', '')::uuid;
  c public.fiscal_certificates;
begin
  if not public.erp_can(p_store, 'fiscal_config') then return public.fiscal__err('FORBIDDEN', 'Necesitas el permiso «Configuración fiscal».'); end if;
  if v_id is not null then
    select * into c from public.fiscal_certificates where id = v_id and store_id = p_store;
    if c.id is null then return public.fiscal__err('NOT_FOUND', 'El certificado no existe.'); end if;
    v_entity := coalesce(v_entity, c.fiscal_entity_id);
  end if;
  if v_entity is null or not public.fiscal__entity_visible(p_store, v_entity) then
    return public.fiscal__err('FORBIDDEN', 'Elige un contribuyente de tu alcance.');
  end if;
  perform set_config('remhub.audit_reason', coalesce(p_reason, ''), true);
  if v_id is null then
    insert into public.fiscal_certificates (store_id, fiscal_entity_id, provider_account_id, managed_by, subject, issuer, serial_number,
      valid_from, valid_until, status, notes)
    values (p_store, v_entity, nullif(p_data ->> 'provider_account_id', '')::uuid, coalesce(p_data ->> 'managed_by', 'provider'),
      p_data ->> 'subject', p_data ->> 'issuer', p_data ->> 'serial_number', nullif(p_data ->> 'valid_from', '')::date,
      (p_data ->> 'valid_until')::date, coalesce(p_data ->> 'status', 'active'), p_data ->> 'notes')
    returning * into c;
  else
    update public.fiscal_certificates set
      fiscal_entity_id = v_entity,
      provider_account_id = case when p_data ? 'provider_account_id' then nullif(p_data ->> 'provider_account_id', '')::uuid else provider_account_id end,
      managed_by = coalesce(p_data ->> 'managed_by', managed_by),
      subject = case when p_data ? 'subject' then p_data ->> 'subject' else subject end,
      issuer = case when p_data ? 'issuer' then p_data ->> 'issuer' else issuer end,
      serial_number = case when p_data ? 'serial_number' then p_data ->> 'serial_number' else serial_number end,
      valid_from = case when p_data ? 'valid_from' then nullif(p_data ->> 'valid_from', '')::date else valid_from end,
      valid_until = coalesce(nullif(p_data ->> 'valid_until', '')::date, valid_until),
      status = coalesce(p_data ->> 'status', status),
      notes = case when p_data ? 'notes' then p_data ->> 'notes' else notes end,
      updated_at = now()
    where id = v_id
    returning * into c;
  end if;
  return jsonb_build_object('ok', true, 'id', c.id);
exception
  when sqlstate 'P0001' or check_violation or not_null_violation or invalid_text_representation or invalid_datetime_format then
    return public.fiscal__err('INVALID', 'Revisa los datos del certificado: ' || sqlerrm);
end;
$$;
grant execute on function public.fiscal_certificate_save(uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------
-- 13. Puntos de la tienda madre
-- ---------------------------------------------------------------------

-- Crear / editar punto (administración del punto, separada de la configuración fiscal).
create or replace function public.erp_point_save(p_store uuid, p_data jsonb, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := nullif(p_data ->> 'id', '')::uuid;
  w public.erp_warehouses;
  v_code text;
begin
  if not public.erp_can_any(p_store, array['points', 'inventory']::text[]) or public.erp_my_points(p_store) is not null then
    perform public.erp__security_event(p_store, public.erp_my_point(p_store), 'security.point_admin_denied', jsonb_build_object('point', v_id));
    return public.fiscal__err('FORBIDDEN', 'Solo la administración de la tienda madre crea o edita puntos.');
  end if;
  if v_id is not null then
    select * into w from public.erp_warehouses where id = v_id and store_id = p_store;
    if w.id is null then return public.fiscal__err('NOT_FOUND', 'El punto no existe en esta tienda.'); end if;
  end if;
  v_code := upper(regexp_replace(trim(coalesce(p_data ->> 'code', w.code, '')), '\s+', '-', 'g'));
  if v_code = '' then
    v_code := upper(left(regexp_replace(coalesce(p_data ->> 'name', 'PUNTO'), '[^A-Za-z0-9]+', '', 'g'), 8)) || '-' || lpad((floor(random() * 900) + 100)::text, 3, '0');
  end if;
  if coalesce(trim(coalesce(p_data ->> 'name', w.name)), '') = '' then
    return public.fiscal__err('INVALID', 'Escribe el nombre del punto.');
  end if;
  if exists (select 1 from public.erp_warehouses x where x.store_id = p_store and x.code = v_code and x.id is distinct from v_id) then
    return public.fiscal__err('DUPLICATE', 'Ya existe un punto o bodega con el código ' || v_code || '.');
  end if;
  perform set_config('remhub.audit_reason', coalesce(p_reason, ''), true);
  if v_id is null then
    insert into public.erp_warehouses (store_id, code, name, kind, address, phone, city, email, description, status,
      responsible_user_id, responsible_name, responsible_doc, responsible_phone, responsible_email, invoice_prefix, remision_prefix)
    values (p_store, v_code, upper(trim(p_data ->> 'name')), coalesce(p_data ->> 'kind', 'point'),
      nullif(trim(coalesce(p_data ->> 'address', '')), ''), nullif(trim(coalesce(p_data ->> 'phone', '')), ''),
      nullif(upper(trim(coalesce(p_data ->> 'city', ''))), ''), nullif(lower(trim(coalesce(p_data ->> 'email', ''))), ''),
      nullif(trim(coalesce(p_data ->> 'description', '')), ''), coalesce(p_data ->> 'status', 'active'),
      nullif(p_data ->> 'responsible_user_id', '')::uuid, nullif(upper(trim(coalesce(p_data ->> 'responsible_name', ''))), ''),
      nullif(trim(coalesce(p_data ->> 'responsible_doc', '')), ''), nullif(trim(coalesce(p_data ->> 'responsible_phone', '')), ''),
      nullif(lower(trim(coalesce(p_data ->> 'responsible_email', ''))), ''),
      coalesce(nullif(upper(trim(coalesce(p_data ->> 'invoice_prefix', ''))), ''), 'FAC'),
      coalesce(nullif(upper(trim(coalesce(p_data ->> 'remision_prefix', ''))), ''), 'REM'))
    returning * into w;
  else
    update public.erp_warehouses set
      code = v_code,
      name = coalesce(nullif(upper(trim(coalesce(p_data ->> 'name', ''))), ''), name),
      kind = coalesce(p_data ->> 'kind', kind),
      address = case when p_data ? 'address' then nullif(trim(coalesce(p_data ->> 'address', '')), '') else address end,
      phone = case when p_data ? 'phone' then nullif(trim(coalesce(p_data ->> 'phone', '')), '') else phone end,
      city = case when p_data ? 'city' then nullif(upper(trim(coalesce(p_data ->> 'city', ''))), '') else city end,
      email = case when p_data ? 'email' then nullif(lower(trim(coalesce(p_data ->> 'email', ''))), '') else email end,
      description = case when p_data ? 'description' then nullif(trim(coalesce(p_data ->> 'description', '')), '') else description end,
      responsible_user_id = case when p_data ? 'responsible_user_id' then nullif(p_data ->> 'responsible_user_id', '')::uuid else responsible_user_id end,
      responsible_name = case when p_data ? 'responsible_name' then nullif(upper(trim(coalesce(p_data ->> 'responsible_name', ''))), '') else responsible_name end,
      responsible_doc = case when p_data ? 'responsible_doc' then nullif(trim(coalesce(p_data ->> 'responsible_doc', '')), '') else responsible_doc end,
      responsible_phone = case when p_data ? 'responsible_phone' then nullif(trim(coalesce(p_data ->> 'responsible_phone', '')), '') else responsible_phone end,
      responsible_email = case when p_data ? 'responsible_email' then nullif(lower(trim(coalesce(p_data ->> 'responsible_email', ''))), '') else responsible_email end,
      updated_at = now()
    where id = v_id
    returning * into w;
  end if;
  if w.responsible_user_id is not null and not exists (
       select 1 from public.store_users su where su.store_id = p_store and su.user_id = w.responsible_user_id)
     and not exists (select 1 from public.stores s where s.id = p_store and s.owner_id = w.responsible_user_id) then
    raise exception 'El usuario responsable no pertenece a esta tienda.';
  end if;
  return jsonb_build_object('ok', true, 'id', w.id, 'point', to_jsonb(w));
exception
  when sqlstate 'P0001' or check_violation or invalid_text_representation then
    return public.fiscal__err('INVALID', sqlerrm);
  when unique_violation then
    return public.fiscal__err('DUPLICATE', 'Ya existe un punto con ese código.');
end;
$$;
grant execute on function public.erp_point_save(uuid, jsonb, text) to authenticated;

-- Activar / suspender / desactivar (operativo). Distinto de estar habilitado fiscalmente.
create or replace function public.erp_point_set_status(p_point uuid, p_status text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare w public.erp_warehouses;
begin
  select * into w from public.erp_warehouses where id = p_point;
  if w.id is null then return public.fiscal__err('NOT_FOUND', 'El punto no existe.'); end if;
  if not public.erp_can_any(w.store_id, array['points', 'inventory']::text[]) or public.erp_my_points(w.store_id) is not null then
    perform public.erp__security_event(w.store_id, public.erp_my_point(w.store_id), 'security.point_status_denied',
      jsonb_build_object('point', p_point, 'status', p_status));
    return public.fiscal__err('FORBIDDEN', 'Solo la administración de la tienda madre cambia el estado de un punto.');
  end if;
  if p_status not in ('draft', 'active', 'suspended', 'inactive') then return public.fiscal__err('INVALID', 'Estado inválido.'); end if;
  if p_status in ('suspended', 'inactive') and length(trim(coalesce(p_reason, ''))) < 5 then
    return public.fiscal__err('REASON_REQUIRED', 'Escribe el motivo para suspender o desactivar el punto.');
  end if;
  if w.is_default and p_status <> 'active' then return public.fiscal__err('INVALID', 'La bodega principal no se puede desactivar.'); end if;
  perform set_config('remhub.audit_reason', coalesce(p_reason, ''), true);
  update public.erp_warehouses set status = p_status, status_reason = nullif(trim(coalesce(p_reason, '')), ''), updated_at = now()
  where id = p_point;
  return jsonb_build_object('ok', true, 'status', p_status);
exception
  when sqlstate 'P0001' then return public.fiscal__err('INVALID', sqlerrm);
end;
$$;
grant execute on function public.erp_point_set_status(uuid, text, text) to authenticated;

-- Asignar usuarios a un punto (y opcionalmente sus permisos, nunca más de los que tiene quien asigna).
create or replace function public.erp_point_assign_users(p_point uuid, p_users jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  w public.erp_warehouses;
  it jsonb;
  v_user uuid;
  v_perms text[];
  v_bad text[];
  v_count integer := 0;
  su public.store_users;
begin
  select * into w from public.erp_warehouses where id = p_point;
  if w.id is null then return public.fiscal__err('NOT_FOUND', 'El punto no existe.'); end if;
  if not public.erp_can(w.store_id, 'users') or public.erp_my_points(w.store_id) is not null then
    perform public.erp__security_event(w.store_id, public.erp_my_point(w.store_id), 'security.point_users_denied', jsonb_build_object('point', p_point));
    return public.fiscal__err('FORBIDDEN', 'El usuario no tiene permiso para asignar usuarios a puntos.');
  end if;
  for it in select * from jsonb_array_elements(coalesce(p_users, '[]'::jsonb)) loop
    v_user := (it ->> 'user_id')::uuid;
    select * into su from public.store_users where store_id = w.store_id and user_id = v_user;
    if su.user_id is null then return public.fiscal__err('INVALID', 'Uno de los usuarios no pertenece a la tienda.'); end if;
    if su.role = 'store_admin' then continue; end if;
    if it ? 'permissions' then
      v_perms := array(select distinct x from jsonb_array_elements_text(it -> 'permissions') as x);
      v_bad := array(select x from unnest(v_perms) as x where not (x = any (public.erp__known_permissions())) or not public.erp_can(w.store_id, x));
      if cardinality(v_bad) > 0 then
        return public.fiscal__err('FORBIDDEN', 'No puedes asignar estos permisos: ' || array_to_string(v_bad, ', '));
      end if;
    else
      v_perms := su.permissions;
    end if;
    update public.store_users set point_id = p_point, permissions = v_perms,
      point_ids = array(select x from unnest(coalesce(point_ids, '{}'::uuid[])) as x where x <> p_point)
    where store_id = w.store_id and user_id = v_user;
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('ok', true, 'updated', v_count);
end;
$$;
grant execute on function public.erp_point_assign_users(uuid, jsonb) to authenticated;

-- Puntos adicionales de consulta de un usuario (alcance «varios puntos»).
create or replace function public.erp_user_set_extra_points(p_store uuid, p_user uuid, p_points uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  su public.store_users;
  v_points uuid[];
begin
  if not public.erp_can(p_store, 'users') or public.erp_my_points(p_store) is not null then
    return public.fiscal__err('FORBIDDEN', 'Solo la administración de la tienda madre define el alcance de los usuarios.');
  end if;
  select * into su from public.store_users where store_id = p_store and user_id = p_user;
  if su.user_id is null then return public.fiscal__err('NOT_FOUND', 'El usuario no pertenece a la tienda.'); end if;
  if su.point_id is null then return public.fiscal__err('INVALID', 'Primero asigna el punto principal del usuario.'); end if;
  v_points := array(select distinct x from unnest(coalesce(p_points, '{}'::uuid[])) as x
                    where x <> su.point_id and exists (select 1 from public.erp_warehouses w where w.id = x and w.store_id = p_store));
  update public.store_users set point_ids = v_points where store_id = p_store and user_id = p_user;
  return jsonb_build_object('ok', true, 'point_ids', to_jsonb(v_points));
end;
$$;
grant execute on function public.erp_user_set_extra_points(uuid, uuid, uuid[]) to authenticated;


-- Inicio del día (hora de Colombia) como timestamptz.
create or replace function public.fiscal__day_start(p_day date)
returns timestamptz
language sql
immutable
as $$
  select (p_day::timestamp) at time zone 'America/Bogota';
$$;

-- Resumen de puntos para la tienda madre (o los puntos del usuario).
create or replace function public.erp_points_overview(p_store uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v uuid[] := public.erp_my_points(p_store);
  v_today timestamptz := public.fiscal__day_start(public.fiscal__today());
  v_month timestamptz := public.fiscal__day_start(date_trunc('month', public.fiscal__today())::date);
  v_fiscal boolean := public.erp_can_any(p_store, public.fiscal__view_perms() || array['points']::text[]);
  v_out jsonb;
begin
  if not public.erp_can_any(p_store, array['points', 'inventory', 'users', 'audit']::text[] || public.fiscal__view_perms()) then
    return public.fiscal__err('FORBIDDEN', 'No tienes acceso a los puntos.');
  end if;
  select coalesce(jsonb_agg(t.x order by (t.x ->> 'kind') desc, t.x ->> 'name'), '[]'::jsonb) into v_out
  from (
    select jsonb_build_object(
      'id', w.id, 'code', w.code, 'name', w.name, 'kind', w.kind, 'status', w.status, 'is_default', w.is_default,
      'address', w.address, 'phone', w.phone, 'city', w.city, 'email', w.email, 'description', w.description,
      'responsible_name', w.responsible_name, 'responsible_user_id', w.responsible_user_id,
      'status_reason', w.status_reason, 'status_changed_at', w.status_changed_at,
      'users', (select count(*) from public.store_users su where su.store_id = p_store and su.active and su.point_id = w.id),
      'units', (select coalesce(sum(greatest(sl.qty, 0)), 0) from public.erp_stock_levels sl where sl.warehouse_id = w.id),
      'skus', (select count(*) from public.erp_stock_levels sl where sl.warehouse_id = w.id and sl.qty > 0),
      'sales_today', (select coalesce(sum(o.total), 0) from public.erp_order_meta m join public.orders o on o.id = m.order_id
                      where m.point_id = w.id and o.created_at >= v_today and coalesce(o.status, '') <> 'cancelled'),
      'sales_month', (select coalesce(sum(o.total), 0) from public.erp_order_meta m join public.orders o on o.id = m.order_id
                      where m.point_id = w.id and o.created_at >= v_month and coalesce(o.status, '') <> 'cancelled'),
      'fiscal', case when v_fiscal then (
        select jsonb_build_object('ready', (r ->> 'ready')::boolean, 'missing', jsonb_array_length(r -> 'missing'),
          'enabled', (r ->> 'enabled')::boolean, 'environment', r ->> 'environment', 'configured', (r ->> 'configured')::boolean,
          'entity', r -> 'entity' ->> 'legal_name', 'warnings', r -> 'warnings')
        from (select public.fiscal__point_readiness(w.id) as r) z) end
    ) as x
    from public.erp_warehouses w
    where w.store_id = p_store and (v is null or w.id = any (v))
  ) t;
  return jsonb_build_object('ok', true, 'points', v_out, 'scope', public.erp_my_scope(p_store),
    'settings', (select to_jsonb(os) from public.erp_org_settings os where os.store_id = p_store));
end;
$$;
grant execute on function public.erp_points_overview(uuid) to authenticated;

-- Expediente / ficha del punto (cada sección según los permisos del usuario).
create or replace function public.erp_point_dossier(p_point uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  w public.erp_warehouses;
  cfg public.fiscal_point_configs;
  v_store uuid;
  v_today timestamptz := public.fiscal__day_start(public.fiscal__today());
  v_month timestamptz := public.fiscal__day_start(date_trunc('month', public.fiscal__today())::date);
  v_out jsonb;
begin
  select * into w from public.erp_warehouses where id = p_point;
  if w.id is null then return public.fiscal__err('NOT_FOUND', 'El punto no existe.'); end if;
  v_store := w.store_id;
  if not public.erp_can_any(v_store, array['points', 'inventory', 'users', 'audit']::text[] || public.fiscal__view_perms())
     or not public.erp_point_allowed(v_store, p_point) then
    return public.fiscal__err('FORBIDDEN', 'No tienes acceso a este punto.');
  end if;
  select * into cfg from public.fiscal_point_configs where point_id = p_point;

  v_out := jsonb_build_object('ok', true,
    'point', to_jsonb(w),
    'scope', public.erp_my_scope(v_store),
    'responsible_user', (select jsonb_build_object('user_id', su.user_id, 'name', coalesce(nullif(trim(su.display_name), ''), su.username), 'role', su.role)
                         from public.store_users su where su.store_id = v_store and su.user_id = w.responsible_user_id));

  if public.erp_can_any(v_store, public.fiscal__view_perms() || array['points']::text[]) then
    v_out := v_out || jsonb_build_object(
      'readiness', public.fiscal__point_readiness(p_point),
      'config', to_jsonb(cfg),
      'entity', (select to_jsonb(e) || jsonb_build_object('missing', to_jsonb(public.fiscal__entity_missing(e)))
                 from public.fiscal_entities e where e.id = cfg.fiscal_entity_id),
      'establishment', (select to_jsonb(s) from public.fiscal_establishments s where s.id = cfg.establishment_id),
      'provider_account', (select to_jsonb(a) - 'webhook_token' || jsonb_build_object('provider_name', p.name, 'provider_status', p.status,
                             'supports_webhooks', p.supports_webhooks, 'supports_production', p.supports_production)
                           from public.fiscal_provider_accounts a join public.fiscal_providers p on p.code = a.provider
                           where a.id = cfg.provider_account_id),
      'ranges', (select coalesce(jsonb_agg(public.fiscal__range_info(r) order by r.document_type, r.created_at), '[]'::jsonb)
                 from public.fiscal_numbering_ranges r where p_point = any (r.point_ids)),
      'certificates', (select coalesce(jsonb_agg(to_jsonb(c) order by c.valid_until), '[]'::jsonb)
                       from public.fiscal_certificates c where c.fiscal_entity_id = cfg.fiscal_entity_id),
      'documents', jsonb_build_object(
        'month', (select coalesce(jsonb_object_agg(x.status, x.n), '{}'::jsonb) from (
                    select d.status, count(*) as n from public.fiscal_documents d
                    where d.point_id = p_point and d.issue_date >= v_month group by d.status) x),
        'month_total', (select coalesce(sum(d.total), 0) from public.fiscal_documents d
                        where d.point_id = p_point and d.issue_date >= v_month and d.status = 'ACCEPTED'
                          and d.document_type in ('invoice', 'pos_equivalent')),
        'recent', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'full_number', d.full_number, 'status', d.status,
                     'document_type', d.document_type, 'total', d.total, 'issue_date', d.issue_date, 'customer_name', d.customer_name,
                     'environment', d.environment) order by d.issue_date desc), '[]'::jsonb)
                   from (select * from public.fiscal_documents d0 where d0.point_id = p_point order by d0.issue_date desc limit 10) d)));
  end if;

  if public.erp_can(v_store, 'users') then
    v_out := v_out || jsonb_build_object('users', (
      select coalesce(jsonb_agg(jsonb_build_object('user_id', su.user_id, 'name', coalesce(nullif(trim(su.display_name), ''), su.username),
               'username', su.username, 'role', su.role, 'active', su.active, 'permissions', to_jsonb(su.permissions),
               'home', su.point_id = p_point) order by su.point_id = p_point desc, su.display_name), '[]'::jsonb)
      from public.store_users su where su.store_id = v_store and (su.point_id = p_point or p_point = any (su.point_ids))));
  end if;

  if public.erp_can_any(v_store, array['inventory', 'products', 'points']::text[]) then
    v_out := v_out || jsonb_build_object('inventory', (
      select jsonb_build_object('units', coalesce(sum(greatest(sl.qty, 0)), 0), 'skus', count(*) filter (where sl.qty > 0),
        'value', coalesce(sum(greatest(sl.qty, 0) * coalesce(p.cost_price, 0)), 0),
        'negative', count(*) filter (where sl.qty < 0), 'low', count(*) filter (where sl.qty between 1 and 5))
      from public.erp_stock_levels sl join public.products p on p.id = sl.product_id where sl.warehouse_id = p_point));
  end if;

  if public.erp_can_any(v_store, array['pos', 'audit', 'points']::text[]) then
    v_out := v_out || jsonb_build_object('sales', jsonb_build_object(
      'today', (select jsonb_build_object('total', coalesce(sum(o.total), 0), 'count', count(*))
                from public.erp_order_meta m join public.orders o on o.id = m.order_id
                where m.point_id = p_point and o.created_at >= v_today and coalesce(o.status, '') <> 'cancelled'),
      'month', (select jsonb_build_object('total', coalesce(sum(o.total), 0), 'count', count(*),
                  'invoices', count(*) filter (where m.doc_kind = 'factura'), 'remisiones', count(*) filter (where m.doc_kind = 'remision'))
                from public.erp_order_meta m join public.orders o on o.id = m.order_id
                where m.point_id = p_point and o.created_at >= v_month and coalesce(o.status, '') <> 'cancelled'),
      'by_method_today', (select coalesce(jsonb_object_agg(x.method, x.total), '{}'::jsonb) from (
                  select coalesce(nullif(o.payment_method, ''), 'sin dato') as method, sum(o.total) as total
                  from public.erp_order_meta m join public.orders o on o.id = m.order_id
                  where m.point_id = p_point and o.created_at >= v_today and coalesce(o.status, '') <> 'cancelled'
                  group by 1) x)));
  end if;

  if public.erp_can_any(v_store, array['audit', 'fiscal_audit']::text[]) then
    v_out := v_out || jsonb_build_object('audit', (
      select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'created_at', a.created_at, 'user_name', a.user_name, 'action', a.action,
               'category', a.category, 'severity', a.severity, 'entity', a.entity, 'before', a.before, 'after', a.after,
               'reason', a.reason, 'detail', a.detail) order by a.created_at desc), '[]'::jsonb)
      from (select * from public.erp_audit_logs a0
            where a0.store_id = v_store and (a0.point_id = p_point or (a0.entity = 'punto' and a0.entity_id = p_point)
                  or (a0.entity = 'config_fiscal_punto' and a0.entity_id = p_point))
              and (a0.category <> 'security' or public.erp_my_points(v_store) is null)
            order by a0.created_at desc limit 40) a));
  end if;
  return v_out;
end;
$$;
grant execute on function public.erp_point_dossier(uuid) to authenticated;

-- Asistente: crea el punto y su configuración en una sola operación (todo o nada).
create or replace function public.erp_point_wizard_create(p_store uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
  v_point uuid;
  v_entity uuid;
  v_est uuid;
  v_account uuid;
  v_range uuid;
  v_env text := coalesce(p_payload -> 'provider' ->> 'environment', 'sandbox');
  v_reason text := coalesce(nullif(trim(coalesce(p_payload ->> 'reason', '')), ''), 'Creación del punto con el asistente');
  v_points uuid[];
begin
  if not public.erp_can_any(p_store, array['points', 'inventory']::text[]) or public.erp_my_points(p_store) is not null then
    perform public.erp__security_event(p_store, public.erp_my_point(p_store), 'security.point_admin_denied', jsonb_build_object('wizard', true));
    return public.fiscal__err('FORBIDDEN', 'Solo la administración de la tienda madre crea puntos.');
  end if;
  begin
    -- Paso 1-2: datos generales y responsable (queda en borrador hasta el final)
    v := public.erp_point_save(p_store, coalesce(p_payload -> 'point', '{}'::jsonb) || jsonb_build_object('status', 'draft'), v_reason);
    if not (v ->> 'ok')::boolean then raise exception '%', v ->> 'message'; end if;
    v_point := (v ->> 'id')::uuid;

    -- Paso 3: contribuyente
    if p_payload -> 'entity' ->> 'mode' = 'existing' then
      v_entity := (p_payload -> 'entity' ->> 'id')::uuid;
      if not exists (select 1 from public.fiscal_entities e where e.id = v_entity and e.store_id = p_store) then
        raise exception 'El contribuyente elegido no pertenece a la tienda.';
      end if;
    elsif p_payload -> 'entity' ->> 'mode' = 'new' then
      v := public.fiscal_entity_save(p_store, (p_payload -> 'entity') - 'mode' - 'id', v_reason);
      if not (v ->> 'ok')::boolean then raise exception 'Información fiscal: %', v ->> 'message'; end if;
      v_entity := (v ->> 'id')::uuid;
    end if;

    if v_entity is not null then
      -- Paso 4: establecimiento
      if coalesce(p_payload -> 'establishment' ->> 'mode', 'skip') = 'new' then
        v := public.fiscal_establishment_save(p_store, ((p_payload -> 'establishment') - 'mode')
               || jsonb_build_object('fiscal_entity_id', v_entity, 'point_id', v_point), v_reason);
        if not (v ->> 'ok')::boolean then raise exception 'Establecimiento: %', v ->> 'message'; end if;
        v_est := (v ->> 'id')::uuid;
      end if;
      -- Paso 5: proveedor tecnológico
      if p_payload -> 'provider' ->> 'mode' = 'existing' then
        v_account := (p_payload -> 'provider' ->> 'account_id')::uuid;
        if not exists (select 1 from public.fiscal_provider_accounts a where a.id = v_account and a.fiscal_entity_id = v_entity) then
          raise exception 'La cuenta del proveedor no es del contribuyente elegido.';
        end if;
        select a.environment into v_env from public.fiscal_provider_accounts a where a.id = v_account;
      elsif p_payload -> 'provider' ->> 'mode' = 'new' then
        v := public.fiscal_provider_account_save(p_store, jsonb_build_object('fiscal_entity_id', v_entity,
               'provider', p_payload -> 'provider' ->> 'provider', 'environment', v_env,
               'label', p_payload -> 'provider' ->> 'label', 'external_account_id', p_payload -> 'provider' ->> 'external_account_id'), v_reason);
        if not (v ->> 'ok')::boolean then raise exception 'Proveedor: %', v ->> 'message'; end if;
        v_account := (v ->> 'id')::uuid;
      end if;
      -- Configuración fiscal del punto (queda apagada hasta probar la conexión)
      v := public.fiscal_point_config_save(v_point, jsonb_build_object('fiscal_entity_id', v_entity, 'establishment_id', v_est,
             'provider_account_id', v_account, 'environment', v_env, 'enabled', false,
             'pos_document_type', coalesce(p_payload -> 'provider' ->> 'pos_document_type', 'invoice')),
             v_reason, coalesce((p_payload -> 'provider' ->> 'confirm_production')::boolean, false));
      if not (v ->> 'ok')::boolean then raise exception 'Configuración fiscal: %', v ->> 'message'; end if;
      -- Paso 6: numeración
      if p_payload -> 'numbering' ->> 'mode' = 'new' then
        v := public.fiscal_range_save(p_store, ((p_payload -> 'numbering') - 'mode')
               || jsonb_build_object('fiscal_entity_id', v_entity, 'environment', v_env, 'point_ids', jsonb_build_array(v_point)), v_reason);
        if not (v ->> 'ok')::boolean then raise exception 'Numeración: %', v ->> 'message'; end if;
        v_range := (v ->> 'id')::uuid;
      elsif p_payload -> 'numbering' ->> 'mode' = 'existing' then
        select r.point_ids into v_points from public.fiscal_numbering_ranges r
        where r.id = (p_payload -> 'numbering' ->> 'range_id')::uuid and r.fiscal_entity_id = v_entity;
        if v_points is null then raise exception 'La numeración elegida no es del contribuyente.'; end if;
        v := public.fiscal_range_save(p_store, jsonb_build_object('id', p_payload -> 'numbering' ->> 'range_id',
               'point_ids', to_jsonb(array_append(v_points, v_point))), 'Compartir numeración con el nuevo punto (validado con contabilidad)');
        if not (v ->> 'ok')::boolean then raise exception 'Numeración: %', v ->> 'message'; end if;
        v_range := (p_payload -> 'numbering' ->> 'range_id')::uuid;
      end if;
    end if;

    -- Paso 7: usuarios
    if jsonb_typeof(p_payload -> 'users') = 'array' and jsonb_array_length(p_payload -> 'users') > 0 then
      v := public.erp_point_assign_users(v_point, p_payload -> 'users');
      if not (v ->> 'ok')::boolean then raise exception 'Usuarios: %', v ->> 'message'; end if;
    end if;

    -- Paso 8: activar operación
    if coalesce((p_payload ->> 'activate')::boolean, true) then
      v := public.erp_point_set_status(v_point, 'active', v_reason);
      if not (v ->> 'ok')::boolean then raise exception 'Activación: %', v ->> 'message'; end if;
    end if;
  exception when sqlstate 'P0001' then
    return public.fiscal__err('WIZARD', sqlerrm);
  end;
  return jsonb_build_object('ok', true, 'point_id', v_point, 'entity_id', v_entity, 'establishment_id', v_est,
    'provider_account_id', v_account, 'range_id', v_range, 'readiness', public.fiscal__point_readiness(v_point));
end;
$$;
grant execute on function public.erp_point_wizard_create(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 14. Centro fiscal: resumen, búsqueda, detalle, pendientes, alertas
-- ---------------------------------------------------------------------

create or replace function public.fiscal_overview(p_store uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v uuid[] := public.erp_my_points(p_store);
  v_month timestamptz := public.fiscal__day_start(date_trunc('month', public.fiscal__today())::date);
  v_out jsonb;
begin
  if not public.erp_can_any(p_store, public.fiscal__view_perms()) then
    return public.fiscal__err('FORBIDDEN', 'No tienes acceso al centro fiscal.');
  end if;
  v_out := jsonb_build_object('ok', true,
    'scope', public.erp_my_scope(p_store),
    'settings', (select to_jsonb(os) from public.erp_org_settings os where os.store_id = p_store),
    'points', (select coalesce(jsonb_agg(public.fiscal__point_readiness(w.id) order by w.kind desc, w.name), '[]'::jsonb)
               from public.erp_warehouses w
               where w.store_id = p_store and (v is null or w.id = any (v))
                 and (w.kind = 'point' or exists (select 1 from public.fiscal_point_configs c where c.point_id = w.id))),
    'month', (select jsonb_build_object(
                'by_status', coalesce((select jsonb_object_agg(x.status, x.n) from (
                   select d.status, count(*) as n from public.fiscal_documents d
                   where d.store_id = p_store and d.issue_date >= v_month and (v is null or d.point_id = any (v))
                   group by d.status) x), '{}'::jsonb),
                'accepted_total', coalesce((select sum(d.total) from public.fiscal_documents d
                   where d.store_id = p_store and d.issue_date >= v_month and d.status = 'ACCEPTED'
                     and d.document_type in ('invoice', 'pos_equivalent') and (v is null or d.point_id = any (v))), 0),
                'credit_total', coalesce((select sum(d.total) from public.fiscal_documents d
                   where d.store_id = p_store and d.issue_date >= v_month and d.status = 'ACCEPTED'
                     and d.document_type = 'credit_note' and (v is null or d.point_id = any (v))), 0))),
    'queue', (select jsonb_build_object(
                'pending', count(*) filter (where d.status in ('QUEUED', 'PROCESSING', 'SENT', 'READY')),
                'errors', count(*) filter (where d.status = 'ERROR'),
                'rejected', count(*) filter (where d.status = 'REJECTED'),
                'contingency', count(*) filter (where d.status = 'CONTINGENCY'))
              from public.fiscal_documents d
              where d.store_id = p_store and d.status in ('QUEUED', 'PROCESSING', 'SENT', 'READY', 'ERROR', 'REJECTED', 'CONTINGENCY')
                and (v is null or d.point_id = any (v))),
    'entities', (select coalesce(jsonb_agg(to_jsonb(e) || jsonb_build_object('missing', to_jsonb(public.fiscal__entity_missing(e)),
                   'points', (select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name)), '[]'::jsonb)
                              from public.fiscal_point_configs c join public.erp_warehouses w on w.id = c.point_id
                              where c.fiscal_entity_id = e.id)) order by e.legal_name), '[]'::jsonb)
                 from public.fiscal_entities e where e.store_id = p_store and public.fiscal__entity_visible(p_store, e.id)),
    'establishments', (select coalesce(jsonb_agg(to_jsonb(s) order by s.name), '[]'::jsonb)
                       from public.fiscal_establishments s where s.store_id = p_store
                         and (v is null or s.point_id = any (v) or public.fiscal__entity_visible(p_store, s.fiscal_entity_id))),
    'accounts', (select coalesce(jsonb_agg(to_jsonb(a) - 'webhook_token' || jsonb_build_object('provider_name', p.name, 'provider_status', p.status,
                   'supports_webhooks', p.supports_webhooks, 'supports_production', p.supports_production,
                   'webhook_path', case when v is null and public.erp_can(p_store, 'fiscal_provider')
                                        then '/api/fiscal/webhooks/' || a.provider || '/' || a.webhook_token end)
                   order by a.created_at), '[]'::jsonb)
                 from public.fiscal_provider_accounts a join public.fiscal_providers p on p.code = a.provider
                 where a.store_id = p_store and public.fiscal__entity_visible(p_store, a.fiscal_entity_id)),
    'ranges', (select coalesce(jsonb_agg(public.fiscal__range_info(r) || jsonb_build_object('fiscal_entity_id', r.fiscal_entity_id,
                 'entity_name', (select e.legal_name from public.fiscal_entities e where e.id = r.fiscal_entity_id))
                 order by r.status = 'active' desc, r.created_at desc), '[]'::jsonb)
               from public.fiscal_numbering_ranges r where r.store_id = p_store and (v is null or r.point_ids && v)),
    'providers', (select coalesce(jsonb_agg(to_jsonb(p) order by p.sort_order), '[]'::jsonb) from public.fiscal_providers p),
    'contingencies', (select coalesce(jsonb_agg(to_jsonb(c) order by c.started_at desc), '[]'::jsonb)
                      from (select * from public.fiscal_contingencies c0 where c0.store_id = p_store
                              and (v is null or c0.point_id = any (v)) order by c0.status = 'open' desc, c0.started_at desc limit 30) c),
    'certificates', (select coalesce(jsonb_agg(to_jsonb(c) order by c.valid_until), '[]'::jsonb)
                     from public.fiscal_certificates c where c.store_id = p_store and public.fiscal__entity_visible(p_store, c.fiscal_entity_id)),
    'webhooks', case when v is null then (select jsonb_build_object(
                  'failed', count(*) filter (where e.status = 'failed'), 'dead', count(*) filter (where e.status = 'dead'),
                  'rejected', count(*) filter (where e.status = 'rejected'), 'last', max(e.received_at))
                from public.fiscal_webhook_events e where e.store_id = p_store and e.received_at > now() - interval '30 days') end,
    'pending_sales', (select count(*) from public.erp_order_meta m
                      join public.fiscal_point_configs c on c.point_id = m.point_id and c.enabled
                      join public.orders o on o.id = m.order_id
                      where m.store_id = p_store and m.doc_kind = 'remision' and coalesce(o.status, '') <> 'cancelled'
                        and o.created_at > now() - interval '120 days' and (v is null or m.point_id = any (v))
                        and not exists (select 1 from public.fiscal_documents d where d.source_id = m.order_id
                                        and d.document_type in ('invoice', 'pos_equivalent') and d.status not in ('VOID', 'CANCELLED'))));
  return v_out;
end;
$$;
grant execute on function public.fiscal_overview(uuid) to authenticated;

-- Búsqueda paginada (cursor) de documentos. p_store nulo = todas las tiendas (solo super admin).
create or replace function public.fiscal__documents_query(p_store uuid, p_points uuid[], p_filters jsonb, p_limit integer, p_cursor jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  f jsonb := coalesce(p_filters, '{}'::jsonb);
  v_q text := trim(coalesce(f ->> 'q', ''));
  v_digits text := regexp_replace(coalesce(f ->> 'q', ''), '\D', '', 'g');
  v_statuses text[] := coalesce(array(select jsonb_array_elements_text(f -> 'statuses')), '{}'::text[]);
  v_types text[] := coalesce(array(select jsonb_array_elements_text(f -> 'types')), '{}'::text[]);
  v_from timestamptz := case when nullif(f ->> 'from', '') is null then null else public.fiscal__day_start((f ->> 'from')::date) end;
  v_to timestamptz := case when nullif(f ->> 'to', '') is null then null else public.fiscal__day_start((f ->> 'to')::date + 1) end;
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_ct timestamptz := nullif(p_cursor ->> 't', '')::timestamptz;
  v_cid uuid := nullif(p_cursor ->> 'id', '')::uuid;
  v_rows jsonb;
  v_count integer;
  v_next jsonb := null;
  v_totals jsonb := null;
begin
  with base as (
    select d.*, w.name as point_name, s.name as store_name
    from public.fiscal_documents d
    left join public.erp_warehouses w on w.id = d.point_id
    left join public.stores s on s.id = d.store_id
    where (p_store is null or d.store_id = p_store)
      and (nullif(f ->> 'store_id', '') is null or d.store_id = (f ->> 'store_id')::uuid)
      and (p_points is null or d.point_id = any (p_points))
      and (nullif(f ->> 'point_id', '') is null or d.point_id = (f ->> 'point_id')::uuid)
      and (nullif(f ->> 'entity_id', '') is null or d.fiscal_entity_id = (f ->> 'entity_id')::uuid)
      and (cardinality(v_statuses) = 0 or d.status = any (v_statuses))
      and (cardinality(v_types) = 0 or d.document_type = any (v_types))
      and (nullif(f ->> 'environment', '') is null or d.environment = f ->> 'environment')
      and (nullif(f ->> 'provider', '') is null or d.provider = f ->> 'provider')
      and (nullif(f ->> 'prefix', '') is null or d.prefix = upper(f ->> 'prefix'))
      and (nullif(f ->> 'number', '') is null or d.number = nullif(regexp_replace(f ->> 'number', '\D', '', 'g'), '')::bigint)
      and (nullif(f ->> 'nit', '') is null or d.issuer ->> 'document_number' = regexp_replace(f ->> 'nit', '\D', '', 'g')
           or d.customer_doc = regexp_replace(f ->> 'nit', '[^0-9A-Za-z]', '', 'g'))
      and (nullif(f ->> 'created_by', '') is null or d.created_by = (f ->> 'created_by')::uuid)
      and (not coalesce((f ->> 'errors_only')::boolean, false) or d.status in ('ERROR', 'REJECTED') or d.last_error_message is not null)
      and (v_from is null or d.issue_date >= v_from)
      and (v_to is null or d.issue_date < v_to)
      and (v_q = '' or d.full_number ilike '%' || v_q || '%' or d.cufe ilike '%' || v_q || '%'
           or d.customer_name ilike '%' || v_q || '%' or d.created_by_name ilike '%' || v_q || '%'
           or d.last_error_message ilike '%' || v_q || '%' or d.source_number ilike '%' || v_q || '%'
           or w.name ilike '%' || v_q || '%' or (d.issuer ->> 'legal_name') ilike '%' || v_q || '%'
           or (v_digits <> '' and (d.customer_doc like '%' || v_digits || '%' or (d.issuer ->> 'document_number') like '%' || v_digits || '%')))
  ), page as (
    select * from base b
    where v_ct is null or (b.issue_date, b.id) < (v_ct, v_cid)
    order by b.issue_date desc, b.id desc
    limit v_limit + 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'store_id', p.store_id, 'store_name', p.store_name, 'point_id', p.point_id, 'point_name', p.point_name,
           'document_type', p.document_type, 'environment', p.environment, 'status', p.status, 'full_number', p.full_number,
           'prefix', p.prefix, 'number', p.number, 'issue_date', p.issue_date, 'total', p.total, 'tax_total', p.tax_total,
           'customer_name', p.customer_name, 'customer_doc', p.customer_doc, 'cufe', p.cufe, 'provider', p.provider,
           'provider_status', p.provider_status, 'dian_status', p.dian_status, 'attempts', p.attempts,
           'last_error_message', p.last_error_message, 'created_by_name', p.created_by_name,
           'issuer_name', p.issuer ->> 'legal_name', 'issuer_doc', p.issuer ->> 'document_number',
           'related_document_id', p.related_document_id, 'source_number', p.source_number)
           order by p.issue_date desc, p.id desc), '[]'::jsonb), count(*)
  into v_rows, v_count
  from page p;

  if v_count > v_limit then
    v_rows := v_rows - v_limit;
    v_next := jsonb_build_object('t', v_rows -> (v_limit - 1) ->> 'issue_date', 'id', v_rows -> (v_limit - 1) ->> 'id');
  end if;

  if coalesce((f ->> 'with_totals')::boolean, false) and p_cursor is null then
    select jsonb_build_object('count', count(*), 'total', coalesce(sum(d.total) filter (where d.status = 'ACCEPTED'), 0),
             'tax', coalesce(sum(d.tax_total) filter (where d.status = 'ACCEPTED'), 0))
    into v_totals
    from public.fiscal_documents d
    left join public.erp_warehouses w on w.id = d.point_id
    where (p_store is null or d.store_id = p_store)
      and (nullif(f ->> 'store_id', '') is null or d.store_id = (f ->> 'store_id')::uuid)
      and (p_points is null or d.point_id = any (p_points))
      and (nullif(f ->> 'point_id', '') is null or d.point_id = (f ->> 'point_id')::uuid)
      and (cardinality(v_statuses) = 0 or d.status = any (v_statuses))
      and (cardinality(v_types) = 0 or d.document_type = any (v_types))
      and (nullif(f ->> 'environment', '') is null or d.environment = f ->> 'environment')
      and (v_from is null or d.issue_date >= v_from)
      and (v_to is null or d.issue_date < v_to);
  end if;

  return jsonb_build_object('ok', true, 'items', v_rows, 'next_cursor', v_next, 'totals', v_totals);
end;
$$;
revoke all on function public.fiscal__documents_query(uuid, uuid[], jsonb, integer, jsonb) from public, anon, authenticated;

create or replace function public.fiscal_documents_search(p_store uuid, p_filters jsonb, p_limit integer default 30, p_cursor jsonb default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v uuid[] := public.erp_my_points(p_store);
begin
  if public.erp_can_any(p_store, public.fiscal__view_perms()) then
    return public.fiscal__documents_query(p_store, v, coalesce(p_filters, '{}'::jsonb) - 'store_id', p_limit, p_cursor);
  end if;
  -- Cajeros: solo su punto.
  if public.erp_can(p_store, 'pos') and public.erp_my_point(p_store) is not null then
    return public.fiscal__documents_query(p_store, array[public.erp_my_point(p_store)], coalesce(p_filters, '{}'::jsonb) - 'store_id', p_limit, p_cursor);
  end if;
  return public.fiscal__err('FORBIDDEN', 'No tienes acceso a los documentos fiscales.');
end;
$$;
grant execute on function public.fiscal_documents_search(uuid, jsonb, integer, jsonb) to authenticated;

-- Detalle con toda la trazabilidad (quién, desde dónde, con qué NIT, resolución, proveedor y respuestas).
create or replace function public.fiscal_document_detail(p_document uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  d public.fiscal_documents;
  r public.fiscal_numbering_ranges;
  a public.fiscal_number_allocations;
  v_view boolean;
begin
  select * into d from public.fiscal_documents where id = p_document;
  if d.id is null then return public.fiscal__err('NOT_FOUND', 'El documento no existe.'); end if;
  v_view := (public.erp_can_any(d.store_id, public.fiscal__view_perms()) and public.erp_point_allowed(d.store_id, d.point_id))
            or (public.erp_can(d.store_id, 'pos') and d.point_id = public.erp_my_point(d.store_id));
  if not v_view then return public.fiscal__err('FORBIDDEN', 'No tienes acceso a este documento.'); end if;
  select * into r from public.fiscal_numbering_ranges where id = d.range_id;
  select * into a from public.fiscal_number_allocations where document_id = d.id limit 1;
  return jsonb_build_object('ok', true,
    'document', to_jsonb(d),
    'point', (select jsonb_build_object('id', w.id, 'name', w.name, 'code', w.code) from public.erp_warehouses w where w.id = d.point_id),
    'lines', (select coalesce(jsonb_agg(to_jsonb(l) order by l.line_no), '[]'::jsonb) from public.fiscal_document_lines l where l.document_id = d.id),
    'events', (select coalesce(jsonb_agg(to_jsonb(e) order by e.id), '[]'::jsonb) from public.fiscal_document_events e where e.document_id = d.id),
    'range', case when r.id is null then null else public.fiscal__range_info(r) end,
    'allocation', to_jsonb(a),
    'provider_account', (select jsonb_build_object('id', x.id, 'provider', x.provider, 'environment', x.environment, 'label', x.label,
                           'external_account_id', x.external_account_id, 'name', p.name)
                         from public.fiscal_provider_accounts x join public.fiscal_providers p on p.code = x.provider
                         where x.id = d.provider_account_id),
    'related', (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'full_number', n.full_number, 'document_type', n.document_type,
                  'status', n.status, 'total', n.total, 'issue_date', n.issue_date, 'note_reason', n.note_reason) order by n.issue_date), '[]'::jsonb)
                from public.fiscal_documents n where n.related_document_id = d.id),
    'original', (select jsonb_build_object('id', o.id, 'full_number', o.full_number, 'status', o.status, 'total', o.total)
                 from public.fiscal_documents o where o.id = d.related_document_id),
    'audit', (select coalesce(jsonb_agg(jsonb_build_object('created_at', l.created_at, 'user_name', l.user_name, 'action', l.action,
                'ip', l.ip, 'user_agent', l.user_agent, 'reason', l.reason, 'after', l.after) order by l.created_at), '[]'::jsonb)
              from public.erp_audit_logs l where l.entity_id = d.id and l.category = 'fiscal'),
    'can', jsonb_build_object(
      'send', public.erp_can(d.store_id, 'fiscal_send') and d.status in ('QUEUED', 'ERROR', 'REJECTED', 'SENT', 'READY'),
      'notes', public.erp_can(d.store_id, 'fiscal_notes') and d.status = 'ACCEPTED' and d.document_type in ('invoice', 'pos_equivalent', 'export_invoice'),
      'void', public.erp_can(d.store_id, 'fiscal_notes') and d.status in ('DRAFT', 'READY', 'QUEUED', 'REJECTED', 'CONTINGENCY')
              or (public.erp_can(d.store_id, 'fiscal_notes') and d.status = 'ERROR' and d.sent_at is null),
      'download', public.erp_can(d.store_id, 'fiscal_download') and (d.xml_path is not null or d.pdf_path is not null or d.status = 'ACCEPTED')));
end;
$$;
grant execute on function public.fiscal_document_detail(uuid) to authenticated;

-- Ventas de puntos habilitados que siguen sin documento fiscal (remisiones de venta).
-- Esto NO oculta nada: muestra qué ventas falta facturar según la regla de la tienda.
create or replace function public.fiscal_pending_sales(p_store uuid, p_point uuid default null, p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v uuid[] := public.erp_my_points(p_store);
  v_days integer;
begin
  if not public.erp_can_any(p_store, array['fiscal', 'fiscal_send', 'fiscal_audit']::text[]) then
    return public.fiscal__err('FORBIDDEN', 'No tienes acceso al centro fiscal.');
  end if;
  select os.remission_max_days into v_days from public.erp_org_settings os where os.store_id = p_store;
  return jsonb_build_object('ok', true, 'max_days', coalesce(v_days, 5), 'items', (
    select coalesce(jsonb_agg(x order by x ->> 'created_at'), '[]'::jsonb) from (
      select jsonb_build_object('order_id', o.id, 'token', o.token, 'doc_number', m.doc_number, 'doc_kind', m.doc_kind,
        'point_id', m.point_id, 'point_name', w.name, 'customer_name', o.customer_name, 'customer_doc', m.customer_doc,
        'total', o.total, 'created_at', o.created_at, 'seller_name', m.seller_name,
        'age_days', public.fiscal__today() - (o.created_at at time zone 'America/Bogota')::date,
        'overdue', public.fiscal__today() - (o.created_at at time zone 'America/Bogota')::date > coalesce(v_days, 5)) as x
      from public.erp_order_meta m
      join public.fiscal_point_configs c on c.point_id = m.point_id and c.enabled
      join public.orders o on o.id = m.order_id
      join public.erp_warehouses w on w.id = m.point_id
      where m.store_id = p_store and m.doc_kind = 'remision' and coalesce(o.status, '') <> 'cancelled'
        and o.created_at > now() - interval '120 days'
        and (v is null or m.point_id = any (v)) and (p_point is null or m.point_id = p_point)
        and not exists (select 1 from public.fiscal_documents d where d.source_id = m.order_id
                        and d.document_type in ('invoice', 'pos_equivalent') and d.status not in ('VOID', 'CANCELLED'))
      order by o.created_at
      limit least(greatest(coalesce(p_limit, 100), 1), 500)) t));
end;
$$;
grant execute on function public.fiscal_pending_sales(uuid, uuid, integer) to authenticated;


-- Alertas adicionales para la campana (fiscal, seguridad y usuarios), con el mismo formato de erp_alerts.
create or replace function public.erp_extra_alerts(p_store uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v uuid[] := public.erp_my_points(p_store);
  v_fiscal boolean := public.erp_can_any(p_store, public.fiscal__view_perms());
  v_out jsonb := '[]'::jsonb;
  v_org boolean;
  r record;
  v_n integer;
begin
  if not public.erp__is_member(p_store) then return '[]'::jsonb; end if;
  select os.fiscal_enabled into v_org from public.erp_org_settings os where os.store_id = p_store;
  v_org := coalesce(v_org, false);

  if v_fiscal then
    -- Numeración: agotándose, por vencer o vencida.
    for r in
      select x.id, x.prefix, x.document_type, i ->> 'used_pct' as used, i ->> 'remaining' as remaining, (i ->> 'days_left')::integer as days,
             (i ->> 'near_exhaustion')::boolean as near_ex, (i ->> 'near_expiry')::boolean as near_exp, (i ->> 'expired')::boolean as expired
      from public.fiscal_numbering_ranges x, lateral (select public.fiscal__range_info(x) as i) z
      where x.store_id = p_store and x.status in ('active', 'exhausted') and (v is null or x.point_ids && v)
    loop
      if r.expired then
        v_out := v_out || jsonb_build_object('key', 'fiscal-range-expired-' || r.id, 'severity', 'critical', 'icon', 'hash',
          'title', 'Resolución vencida', 'body', 'La numeración ' || coalesce(nullif(r.prefix, ''), 'sin prefijo') || ' ya no se puede usar. Carga la nueva resolución.',
          'href', '/dashboard/fiscal?tab=numeracion');
      elsif r.near_exp then
        v_out := v_out || jsonb_build_object('key', 'fiscal-range-expiry-' || r.id, 'severity', case when r.days <= 7 then 'serious' else 'warning' end,
          'icon', 'calendar', 'title', 'Resolución próxima a vencer',
          'body', 'La numeración ' || coalesce(nullif(r.prefix, ''), 'sin prefijo') || ' vence en ' || r.days || ' días.', 'href', '/dashboard/fiscal?tab=numeracion');
      end if;
      if r.near_ex then
        v_out := v_out || jsonb_build_object('key', 'fiscal-range-usage-' || r.id,
          'severity', case when r.remaining::numeric <= 0 then 'critical' when r.used::numeric >= 95 then 'serious' else 'warning' end,
          'icon', 'hash', 'title', case when r.remaining::numeric <= 0 then 'Numeración agotada' else 'Numeración próxima a agotarse' end,
          'body', coalesce(nullif(r.prefix, ''), 'Sin prefijo') || ' al ' || r.used || '% · quedan ' || r.remaining || ' números.',
          'href', '/dashboard/fiscal?tab=numeracion');
      end if;
    end loop;

    select count(*) into v_n from public.fiscal_documents d
    where d.store_id = p_store and d.status = 'REJECTED' and d.rejected_at > now() - interval '15 days' and (v is null or d.point_id = any (v));
    if v_n > 0 then
      v_out := v_out || jsonb_build_object('key', 'fiscal-rejected', 'severity', 'critical', 'icon', 'file-x', 'count', v_n,
        'title', v_n || case when v_n = 1 then ' documento rechazado' else ' documentos rechazados' end,
        'body', 'Revisa el motivo y corrígelos o anúlalos.', 'href', '/dashboard/fiscal?tab=documentos&estado=REJECTED');
    end if;

    select count(*) into v_n from public.fiscal_documents d
    where d.store_id = p_store and d.status = 'ERROR' and (v is null or d.point_id = any (v));
    if v_n > 0 then
      v_out := v_out || jsonb_build_object('key', 'fiscal-errors', 'severity', 'serious', 'icon', 'alert', 'count', v_n,
        'title', v_n || case when v_n = 1 then ' documento con error de envío' else ' documentos con error de envío' end,
        'body', 'Se reintentan solos; si persiste, revisa el proveedor.', 'href', '/dashboard/fiscal?tab=documentos&estado=ERROR');
    end if;

    select count(*) into v_n from public.fiscal_documents d
    where d.store_id = p_store and d.status in ('QUEUED', 'PROCESSING') and d.created_at < now() - interval '30 minutes' and (v is null or d.point_id = any (v));
    if v_n > 0 then
      v_out := v_out || jsonb_build_object('key', 'fiscal-stuck', 'severity', 'warning', 'icon', 'receipt', 'count', v_n,
        'title', v_n || ' documentos esperando envío', 'body', 'Llevan más de 30 minutos en cola.', 'href', '/dashboard/fiscal?tab=documentos&estado=QUEUED');
    end if;

    for r in
      select a.id, p.name, a.status, a.environment from public.fiscal_provider_accounts a
      join public.fiscal_providers p on p.code = a.provider
      where a.store_id = p_store and a.status in ('error', 'disconnected')
        and exists (select 1 from public.fiscal_point_configs c where c.provider_account_id = a.id and c.enabled and (v is null or c.point_id = any (v)))
    loop
      v_out := v_out || jsonb_build_object('key', 'fiscal-provider-' || r.id, 'severity', 'critical', 'icon', 'plug',
        'title', case when r.status = 'disconnected' then 'Proveedor desconectado' else 'Falla del proveedor tecnológico' end,
        'body', r.name || ' (' || case r.environment when 'production' then 'producción' else 'pruebas' end || '). Prueba la conexión.',
        'href', '/dashboard/fiscal?tab=proveedor');
    end loop;

    if v is null then
      select count(*) into v_n from public.fiscal_webhook_events e
      where e.store_id = p_store and e.status in ('failed', 'dead') and e.received_at > now() - interval '7 days';
      if v_n > 0 then
        v_out := v_out || jsonb_build_object('key', 'fiscal-webhooks', 'severity', 'serious', 'icon', 'webhook', 'count', v_n,
          'title', 'Webhooks con fallas', 'body', v_n || ' eventos del proveedor no se pudieron procesar.', 'href', '/dashboard/fiscal?tab=webhooks');
      end if;
    end if;

    for r in
      select c.id, c.valid_until, c.valid_until - public.fiscal__today() as days, e.legal_name
      from public.fiscal_certificates c join public.fiscal_entities e on e.id = c.fiscal_entity_id
      where c.store_id = p_store and c.status = 'active' and c.valid_until <= public.fiscal__today() + 30
        and public.fiscal__entity_visible(p_store, c.fiscal_entity_id)
    loop
      v_out := v_out || jsonb_build_object('key', 'fiscal-cert-' || r.id, 'severity', case when r.days < 0 then 'critical' else 'warning' end,
        'icon', 'shield', 'title', case when r.days < 0 then 'Certificado vencido' else 'Certificado próximo a vencer' end,
        'body', r.legal_name || ': ' || case when r.days < 0 then 'venció' else 'vence en ' || r.days || ' días' end || '.',
        'href', '/dashboard/fiscal?tab=proveedor');
    end loop;

    select count(*) into v_n from public.fiscal_contingencies c
    where c.store_id = p_store and c.status = 'open' and (v is null or c.point_id = any (v));
    if v_n > 0 then
      v_out := v_out || jsonb_build_object('key', 'fiscal-contingency', 'severity', 'serious', 'icon', 'alert', 'count', v_n,
        'title', 'Contingencia abierta', 'body', 'Los documentos quedan en cola hasta cerrarla.', 'href', '/dashboard/fiscal?tab=contingencias');
    end if;

    if v_org then
      for r in
        select w.id, w.name, (public.fiscal__point_readiness(w.id)) as rd, exists (select 1 from public.fiscal_point_configs c where c.point_id = w.id and c.enabled) as en
        from public.erp_warehouses w
        where w.store_id = p_store and w.kind = 'point' and w.status = 'active' and (v is null or w.id = any (v))
      loop
        if r.en and not (r.rd ->> 'ready')::boolean then
          v_out := v_out || jsonb_build_object('key', 'fiscal-point-' || r.id, 'severity', 'serious', 'icon', 'landmark',
            'title', r.name || ' no está listo para facturar', 'body', coalesce(r.rd -> 'missing' ->> 0, 'Revisa su configuración fiscal.'),
            'href', '/dashboard/puntos/' || r.id || '?tab=fiscal');
        elsif not (r.rd ->> 'configured')::boolean then
          v_out := v_out || jsonb_build_object('key', 'fiscal-point-config-' || r.id, 'severity', 'warning', 'icon', 'landmark',
            'title', 'Punto sin configuración fiscal', 'body', r.name || ' aún no tiene contribuyente ni numeración.',
            'href', '/dashboard/puntos/' || r.id || '?tab=fiscal');
        end if;
      end loop;

      select count(*) into v_n from public.erp_order_meta m
      join public.fiscal_point_configs c on c.point_id = m.point_id and c.enabled
      join public.orders o on o.id = m.order_id
      join public.erp_org_settings os on os.store_id = m.store_id and os.remission_policy <> 'allow'
      where m.store_id = p_store and m.doc_kind = 'remision' and coalesce(o.status, '') <> 'cancelled'
        and o.created_at < now() - make_interval(days => os.remission_max_days) and o.created_at > now() - interval '120 days'
        and (v is null or m.point_id = any (v))
        and not exists (select 1 from public.fiscal_documents d where d.source_id = m.order_id
                        and d.document_type in ('invoice', 'pos_equivalent') and d.status not in ('VOID', 'CANCELLED'));
      if v_n > 0 then
        v_out := v_out || jsonb_build_object('key', 'fiscal-pending-sales', 'severity', 'warning', 'icon', 'receipt', 'count', v_n,
          'title', v_n || ' remisiones de venta sin facturar', 'body', 'Superaron el plazo configurado por la tienda.',
          'href', '/dashboard/fiscal?tab=pendientes');
      end if;
    end if;
  end if;

  -- Seguridad: intentos sospechosos de las últimas 24 horas (solo tienda madre).
  if v is null and public.erp_can_any(p_store, array['audit', 'fiscal_audit']::text[]) then
    select count(*) into v_n from public.erp_audit_logs l
    where l.store_id = p_store and l.category = 'security' and l.severity = 'critical' and l.created_at > now() - interval '24 hours';
    if v_n > 0 then
      v_out := v_out || jsonb_build_object('key', 'security-critical', 'severity', 'critical', 'icon', 'shield', 'count', v_n,
        'title', 'Intentos de acceso sospechosos', 'body', v_n || ' en las últimas 24 horas (otro punto, NIT o numeración ajena).',
        'href', '/dashboard/fiscal?tab=auditoria&categoria=security');
    end if;
  end if;

  -- Usuarios sin permisos.
  if public.erp_can(p_store, 'users') and v is null then
    select count(*) into v_n from public.store_users su
    where su.store_id = p_store and su.active and su.role <> 'store_admin' and cardinality(coalesce(su.permissions, '{}'::text[])) = 0;
    if v_n > 0 then
      v_out := v_out || jsonb_build_object('key', 'users-no-perms', 'severity', 'info', 'icon', 'users', 'count', v_n,
        'title', v_n || case when v_n = 1 then ' usuario sin permisos' else ' usuarios sin permisos' end,
        'body', 'No pueden abrir ninguna sección hasta que les asignes permisos.', 'href', '/dashboard/store/users');
    end if;
  end if;
  return v_out;
end;
$$;
grant execute on function public.erp_extra_alerts(uuid) to authenticated;

-- Auditoría (fiscal, seguridad, usuarios, configuración y operación) con filtros y cursor.
create or replace function public.fiscal_audit_search(p_store uuid, p_filters jsonb, p_limit integer default 50, p_cursor jsonb default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  f jsonb := coalesce(p_filters, '{}'::jsonb);
  v uuid[] := public.erp_my_points(p_store);
  v_cats text[] := coalesce(array(select jsonb_array_elements_text(f -> 'categories')), '{}'::text[]);
  v_q text := trim(coalesce(f ->> 'q', ''));
  v_from timestamptz := case when nullif(f ->> 'from', '') is null then null else public.fiscal__day_start((f ->> 'from')::date) end;
  v_to timestamptz := case when nullif(f ->> 'to', '') is null then null else public.fiscal__day_start((f ->> 'to')::date + 1) end;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_ct timestamptz := nullif(p_cursor ->> 't', '')::timestamptz;
  v_cid uuid := nullif(p_cursor ->> 'id', '')::uuid;
  v_rows jsonb;
  v_count integer;
  v_next jsonb;
begin
  if not public.erp_can_any(p_store, array['audit', 'fiscal_audit']::text[]) then
    return public.fiscal__err('FORBIDDEN', 'Necesitas el permiso de auditoría.');
  end if;
  with page as (
    select l.* from public.erp_audit_logs l
    where l.store_id = p_store
      and (v is null or (l.point_id = any (v) and l.category <> 'security') or l.user_id = auth.uid())
      and (cardinality(v_cats) = 0 or l.category = any (v_cats))
      and (nullif(f ->> 'severity', '') is null or l.severity = f ->> 'severity')
      and (nullif(f ->> 'point_id', '') is null or l.point_id = (f ->> 'point_id')::uuid)
      and (nullif(f ->> 'user_id', '') is null or l.user_id = (f ->> 'user_id')::uuid)
      and (nullif(f ->> 'entity_id', '') is null or l.entity_id = (f ->> 'entity_id')::uuid)
      and (v_from is null or l.created_at >= v_from) and (v_to is null or l.created_at < v_to)
      and (v_q = '' or l.action ilike '%' || v_q || '%' or l.user_name ilike '%' || v_q || '%' or l.entity ilike '%' || v_q || '%'
           or coalesce(l.reason, '') ilike '%' || v_q || '%' or l.detail::text ilike '%' || v_q || '%'
           or coalesce(l.after::text, '') ilike '%' || v_q || '%' or coalesce(l.ip, '') ilike '%' || v_q || '%')
      and (v_ct is null or (l.created_at, l.id) < (v_ct, v_cid))
    order by l.created_at desc, l.id desc
    limit v_limit + 1
  )
  select coalesce(jsonb_agg(to_jsonb(p) || jsonb_build_object('point_name', (select w.name from public.erp_warehouses w where w.id = p.point_id))
           order by p.created_at desc, p.id desc), '[]'::jsonb), count(*)
  into v_rows, v_count from page p;
  if v_count > v_limit then
    v_rows := v_rows - v_limit;
    v_next := jsonb_build_object('t', v_rows -> (v_limit - 1) ->> 'created_at', 'id', v_rows -> (v_limit - 1) ->> 'id');
  end if;
  return jsonb_build_object('ok', true, 'items', v_rows, 'next_cursor', v_next);
end;
$$;
grant execute on function public.fiscal_audit_search(uuid, jsonb, integer, jsonb) to authenticated;

-- Expediente fiscal del punto: paquete ordenado para revisión contable / DIAN (no oculta nada).
create or replace function public.fiscal_dossier(p_store uuid, p_point uuid, p_from date, p_to date, p_types text[] default null, p_statuses text[] default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v uuid[] := public.erp_my_points(p_store);
  v_from timestamptz := public.fiscal__day_start(coalesce(p_from, public.fiscal__today() - 30));
  v_to timestamptz := public.fiscal__day_start(coalesce(p_to, public.fiscal__today()) + 1);
  v_docs jsonb;
  v_count integer;
begin
  if not public.erp_can_any(p_store, array['fiscal_download', 'fiscal_audit']::text[])
     or (p_point is null and v is not null) or (p_point is not null and not public.erp_point_allowed(p_store, p_point)) then
    perform public.erp__security_event(p_store, public.erp_my_point(p_store), 'security.fiscal_export_denied',
      jsonb_build_object('point', p_point, 'from', p_from, 'to', p_to));
    return public.fiscal__err('FORBIDDEN', 'No tienes permiso para exportar información fiscal de este alcance.');
  end if;
  if p_to - p_from > 400 then return public.fiscal__err('RANGE', 'El periodo máximo del expediente es de 400 días.'); end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'full_number', d.full_number, 'prefix', d.prefix, 'number', d.number, 'document_type', d.document_type,
           'environment', d.environment, 'status', d.status, 'issue_date', d.issue_date, 'point', w.name,
           'issuer', d.issuer, 'customer', d.customer, 'subtotal', d.subtotal, 'tax_total', d.tax_total, 'discount_total', d.discount_total,
           'total', d.total, 'currency', d.currency, 'cufe', d.cufe, 'provider', d.provider, 'provider_status', d.provider_status,
           'dian_status', d.dian_status, 'dian_message', d.dian_message, 'xml_path', d.xml_path, 'pdf_path', d.pdf_path,
           'source_number', d.source_number, 'related_document_id', d.related_document_id, 'note_reason', d.note_reason,
           'created_by_name', d.created_by_name, 'created_at', d.created_at, 'attempts', d.attempts,
           'last_error_message', d.last_error_message, 'void_reason', d.void_reason,
           'lines', (select coalesce(jsonb_agg(jsonb_build_object('line_no', l.line_no, 'sku', l.sku, 'description', l.description,
                       'qty', l.qty, 'unit_price', l.unit_price, 'tax_rate', l.tax_rate, 'line_subtotal', l.line_subtotal,
                       'line_tax', l.line_tax, 'line_total', l.line_total) order by l.line_no), '[]'::jsonb)
                     from public.fiscal_document_lines l where l.document_id = d.id),
           'events', (select coalesce(jsonb_agg(jsonb_build_object('at', e.created_at, 'event', e.event, 'from', e.status_from, 'to', e.status_to,
                        'message', e.message, 'actor', e.actor_name, 'source', e.source, 'ip', e.ip) order by e.id), '[]'::jsonb)
                      from public.fiscal_document_events e where e.document_id = d.id))
           order by d.document_type, d.prefix, d.number), '[]'::jsonb), count(*)
  into v_docs, v_count
  from (select * from public.fiscal_documents d0
        where d0.store_id = p_store and (p_point is null or d0.point_id = p_point) and (v is null or d0.point_id = any (v))
          and d0.issue_date >= v_from and d0.issue_date < v_to
          and (p_types is null or cardinality(p_types) = 0 or d0.document_type = any (p_types))
          and (p_statuses is null or cardinality(p_statuses) = 0 or d0.status = any (p_statuses))
        order by d0.issue_date limit 5000) d
  left join public.erp_warehouses w on w.id = d.point_id;

  perform public.erp__audit_insert(p_store, p_point, 'export', 'info', 'fiscal.dossier_export', 'fiscal_documents', null, null,
    jsonb_build_object('from', p_from, 'to', p_to, 'documents', v_count, 'types', to_jsonb(p_types), 'statuses', to_jsonb(p_statuses)), null, '{}'::jsonb);

  return jsonb_build_object('ok', true,
    'generated_at', now(), 'generated_by', public.erp_actor_name(p_store),
    'store', (select jsonb_build_object('id', s.id, 'name', s.name) from public.stores s where s.id = p_store),
    'point', (select jsonb_build_object('id', w.id, 'name', w.name, 'code', w.code, 'address', w.address, 'city', w.city,
                'responsible_name', w.responsible_name, 'status', w.status) from public.erp_warehouses w where w.id = p_point),
    'period', jsonb_build_object('from', coalesce(p_from, public.fiscal__today() - 30), 'to', coalesce(p_to, public.fiscal__today())),
    'readiness', case when p_point is null then null else public.fiscal__point_readiness(p_point) end,
    'entities', (select coalesce(jsonb_agg(distinct d.issuer), '[]'::jsonb) from public.fiscal_documents d
                 where d.store_id = p_store and (p_point is null or d.point_id = p_point) and d.issue_date >= v_from and d.issue_date < v_to),
    'ranges', (select coalesce(jsonb_agg(public.fiscal__range_info(r) || jsonb_build_object(
                 'allocated', (select count(*) from public.fiscal_number_allocations a where a.range_id = r.id),
                 'voided_unsent', (select coalesce(jsonb_agg(a.number order by a.number), '[]'::jsonb) from public.fiscal_number_allocations a
                                   where a.range_id = r.id and a.status = 'voided_unsent'),
                 'first_used', (select min(a.number) from public.fiscal_number_allocations a where a.range_id = r.id),
                 'last_used', (select max(a.number) from public.fiscal_number_allocations a where a.range_id = r.id))), '[]'::jsonb)
               from public.fiscal_numbering_ranges r
               where r.store_id = p_store and (p_point is null or p_point = any (r.point_ids)) and (v is null or r.point_ids && v)),
    'summary', (select coalesce(jsonb_agg(jsonb_build_object('document_type', x.document_type, 'status', x.status, 'count', x.n,
                  'subtotal', x.sub, 'tax', x.tax, 'total', x.tot)), '[]'::jsonb)
                from (select d.document_type, d.status, count(*) as n, sum(d.subtotal) as sub, sum(d.tax_total) as tax, sum(d.total) as tot
                      from public.fiscal_documents d
                      where d.store_id = p_store and (p_point is null or d.point_id = p_point) and (v is null or d.point_id = any (v))
                        and d.issue_date >= v_from and d.issue_date < v_to
                      group by d.document_type, d.status) x),
    'documents', v_docs, 'documents_count', v_count, 'truncated', v_count >= 5000);
end;
$$;
grant execute on function public.fiscal_dossier(uuid, uuid, date, date, text[], text[]) to authenticated;

-- Registro de descarga (XML/PDF): permiso y alcance; el servidor entrega el archivo.
create or replace function public.fiscal_download_access(p_document uuid, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare d public.fiscal_documents;
begin
  select * into d from public.fiscal_documents where id = p_document;
  if d.id is null then return public.fiscal__err('NOT_FOUND', 'El documento no existe.'); end if;
  if p_kind not in ('xml', 'pdf') then return public.fiscal__err('INVALID', 'Formato inválido.'); end if;
  if not (public.erp_can(d.store_id, 'fiscal_download') and public.erp_point_allowed(d.store_id, d.point_id)) then
    perform public.erp__security_event(d.store_id, public.erp_my_point(d.store_id), 'security.fiscal_download_denied',
      jsonb_build_object('document', d.id, 'full_number', d.full_number, 'kind', p_kind));
    return public.fiscal__err('FORBIDDEN', 'El usuario no tiene permiso para descargar el ' || upper(p_kind) || ' de este documento.');
  end if;
  perform public.erp__audit_insert(d.store_id, d.point_id, 'export', 'info', 'fiscal.download_' || p_kind, 'fiscal_documents', d.id,
    null, jsonb_build_object('full_number', d.full_number), null, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'store_id', d.store_id, 'path', case p_kind when 'xml' then d.xml_path else d.pdf_path end,
    'full_number', d.full_number, 'provider_account_id', d.provider_account_id, 'provider_document_id', d.provider_document_id,
    'status', d.status);
end;
$$;
grant execute on function public.fiscal_download_access(uuid, text) to authenticated;

-- Centro de operaciones (documentos comerciales internos, separados de los fiscales).
create or replace function public.ops_overview(p_store uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v uuid[] := public.erp_my_points(p_store);
  v_month timestamptz := public.fiscal__day_start(date_trunc('month', public.fiscal__today())::date);
begin
  if not public.erp__is_member(p_store) then return public.fiscal__err('FORBIDDEN', 'No tienes acceso a esta tienda.'); end if;
  return jsonb_build_object('ok', true,
    'orders', case when public.erp_can_any(p_store, array['orders', 'pos']::text[]) then (
      select jsonb_build_object('pending', count(*) filter (where coalesce(o.status, '') in ('draft', 'sent', 'pending', 'new')),
        'month', count(*) filter (where o.created_at >= v_month))
      from public.orders o where o.store_id = p_store and o.created_at > now() - interval '120 days'
        and public.erp__order_visible(p_store, o.id)) end,
    'remisiones', case when public.erp_can_any(p_store, array['pos', 'orders', 'audit']::text[]) then (
      select jsonb_build_object('month', count(*), 'total', coalesce(sum(o.total), 0),
        'without_fiscal', count(*) filter (where c.enabled and not exists (
          select 1 from public.fiscal_documents d where d.source_id = m.order_id
            and d.document_type in ('invoice', 'pos_equivalent') and d.status not in ('VOID', 'CANCELLED'))))
      from public.erp_order_meta m join public.orders o on o.id = m.order_id
      left join public.fiscal_point_configs c on c.point_id = m.point_id
      where m.store_id = p_store and m.doc_kind = 'remision' and o.created_at >= v_month and coalesce(o.status, '') <> 'cancelled'
        and (v is null or m.point_id = any (v))) end,
    'stock_requests', case when public.erp_can_any(p_store, array['stock_requests', 'stock_requests_manage', 'transfers']::text[]) then (
      select jsonb_build_object('open', count(*) filter (where r.status not in ('received', 'closed', 'cancelled', 'rejected')),
        'month', count(*) filter (where r.created_at >= v_month))
      from public.erp_stock_requests r where r.store_id = p_store
        and (v is null or r.from_point_id = any (v) or r.to_point_id = any (v))) end,
    'transfers', case when public.erp_can_any(p_store, array['transfers', 'inventory']::text[]) then (
      select jsonb_build_object('in_transit', count(*) filter (where t.status = 'in_transit'),
        'month', count(*) filter (where t.created_at >= v_month))
      from public.erp_transfers t where t.store_id = p_store
        and (v is null or t.from_warehouse_id = any (v) or t.to_warehouse_id = any (v))) end,
    'adjustments', case when public.erp_can_any(p_store, array['inventory', 'inventory_adjust']::text[]) then (
      select jsonb_build_object('month', count(*)) from public.erp_adjustments a
      where a.store_id = p_store and a.created_at >= v_month and (v is null or a.warehouse_id = any (v))) end,
    'purchases', case when public.erp_can(p_store, 'purchases') and v is null then (
      select jsonb_build_object('month', count(*), 'total', coalesce(sum(p.total), 0)) from public.erp_purchases p
      where p.store_id = p_store and p.status = 'received' and p.created_at >= v_month) end);
end;
$$;
grant execute on function public.ops_overview(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 15. Super administrador (todas las tiendas madre)
-- ---------------------------------------------------------------------
create or replace function public.admin_fiscal_overview(p_from date default null, p_to date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_from timestamptz := public.fiscal__day_start(coalesce(p_from, public.fiscal__today() - 29));
  v_to timestamptz := public.fiscal__day_start(coalesce(p_to, public.fiscal__today()) + 1);
begin
  if not public.erp_is_platform_admin() then return public.fiscal__err('FORBIDDEN', 'Solo el super administrador.'); end if;
  return jsonb_build_object('ok', true,
    'period', jsonb_build_object('from', coalesce(p_from, public.fiscal__today() - 29), 'to', coalesce(p_to, public.fiscal__today())),
    'kpis', jsonb_build_object(
      'stores_active', (select count(*) from public.stores s where s.active),
      'stores_total', (select count(*) from public.stores),
      'points_active', (select count(*) from public.erp_warehouses w where w.kind = 'point' and w.status = 'active'),
      'points_suspended', (select count(*) from public.erp_warehouses w where w.kind = 'point' and w.status = 'suspended'),
      'points_inactive', (select count(*) from public.erp_warehouses w where w.kind = 'point' and w.status in ('inactive', 'draft')),
      'points_fiscal_enabled', (select count(*) from public.fiscal_point_configs c where c.enabled),
      'users_active', (select count(*) from public.store_users su where su.active),
      'entities', (select count(*) from public.fiscal_entities e where e.status = 'active'),
      'documents', (select count(*) from public.fiscal_documents d where d.issue_date >= v_from and d.issue_date < v_to and d.document_type in ('invoice', 'pos_equivalent')),
      'accepted', (select count(*) from public.fiscal_documents d where d.issue_date >= v_from and d.issue_date < v_to and d.status = 'ACCEPTED'),
      'rejected', (select count(*) from public.fiscal_documents d where d.issue_date >= v_from and d.issue_date < v_to and d.status = 'REJECTED'),
      'pending', (select count(*) from public.fiscal_documents d where d.status in ('QUEUED', 'PROCESSING', 'SENT', 'READY')),
      'errors', (select count(*) from public.fiscal_documents d where d.status = 'ERROR'),
      'credit_notes', (select count(*) from public.fiscal_documents d where d.issue_date >= v_from and d.issue_date < v_to and d.document_type = 'credit_note'),
      'debit_notes', (select count(*) from public.fiscal_documents d where d.issue_date >= v_from and d.issue_date < v_to and d.document_type = 'debit_note'),
      'contingencies_open', (select count(*) from public.fiscal_contingencies c where c.status = 'open'),
      'providers_down', (select count(*) from public.fiscal_provider_accounts a where a.status in ('error', 'disconnected')),
      'webhooks_failed', (select count(*) from public.fiscal_webhook_events e where e.status in ('failed', 'dead') and e.received_at > now() - interval '7 days'),
      'webhooks_rejected', (select count(*) from public.fiscal_webhook_events e where e.status = 'rejected' and e.received_at > now() - interval '7 days'),
      'ranges_expiring', (select count(*) from public.fiscal_numbering_ranges r where r.status = 'active' and (public.fiscal__range_info(r) ->> 'near_expiry')::boolean),
      'ranges_exhausting', (select count(*) from public.fiscal_numbering_ranges r where r.status in ('active', 'exhausted') and (public.fiscal__range_info(r) ->> 'near_exhaustion')::boolean),
      'security_critical', (select count(*) from public.erp_audit_logs l where l.category = 'security' and l.severity = 'critical' and l.created_at > now() - interval '7 days'),
      'accepted_total', (select coalesce(sum(d.total), 0) from public.fiscal_documents d where d.issue_date >= v_from and d.issue_date < v_to
                           and d.status = 'ACCEPTED' and d.document_type in ('invoice', 'pos_equivalent'))),
    'by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', x.day, 'documents', x.n, 'accepted', x.acc, 'rejected', x.rej, 'total', x.tot) order by x.day), '[]'::jsonb)
               from (select (d.issue_date at time zone 'America/Bogota')::date as day, count(*) as n,
                            count(*) filter (where d.status = 'ACCEPTED') as acc, count(*) filter (where d.status = 'REJECTED') as rej,
                            coalesce(sum(d.total) filter (where d.status = 'ACCEPTED'), 0) as tot
                     from public.fiscal_documents d where d.issue_date >= v_from and d.issue_date < v_to
                       and d.document_type in ('invoice', 'pos_equivalent') group by 1) x),
    'by_store', (select coalesce(jsonb_agg(jsonb_build_object('id', x.store_id, 'name', x.name, 'documents', x.n, 'total', x.tot) order by x.tot desc), '[]'::jsonb)
                 from (select d.store_id, s.name, count(*) as n, coalesce(sum(d.total) filter (where d.status = 'ACCEPTED'), 0) as tot
                       from public.fiscal_documents d join public.stores s on s.id = d.store_id
                       where d.issue_date >= v_from and d.issue_date < v_to and d.document_type in ('invoice', 'pos_equivalent')
                       group by d.store_id, s.name order by 4 desc limit 12) x),
    'by_point', (select coalesce(jsonb_agg(jsonb_build_object('id', x.point_id, 'name', x.name, 'store', x.store, 'documents', x.n, 'total', x.tot) order by x.tot desc), '[]'::jsonb)
                 from (select d.point_id, w.name, s.name as store, count(*) as n, coalesce(sum(d.total) filter (where d.status = 'ACCEPTED'), 0) as tot
                       from public.fiscal_documents d join public.erp_warehouses w on w.id = d.point_id join public.stores s on s.id = d.store_id
                       where d.issue_date >= v_from and d.issue_date < v_to and d.document_type in ('invoice', 'pos_equivalent')
                       group by d.point_id, w.name, s.name order by 5 desc limit 12) x),
    'by_entity', (select coalesce(jsonb_agg(jsonb_build_object('id', x.fiscal_entity_id, 'name', x.name, 'nit', x.nit, 'documents', x.n, 'total', x.tot) order by x.tot desc), '[]'::jsonb)
                  from (select d.fiscal_entity_id, e.legal_name as name, e.document_number as nit, count(*) as n,
                               coalesce(sum(d.total) filter (where d.status = 'ACCEPTED'), 0) as tot
                        from public.fiscal_documents d join public.fiscal_entities e on e.id = d.fiscal_entity_id
                        where d.issue_date >= v_from and d.issue_date < v_to and d.document_type in ('invoice', 'pos_equivalent')
                        group by d.fiscal_entity_id, e.legal_name, e.document_number order by 5 desc limit 12) x),
    'by_status', (select coalesce(jsonb_object_agg(x.status, x.n), '{}'::jsonb) from (
                    select d.status, count(*) as n from public.fiscal_documents d
                    where d.issue_date >= v_from and d.issue_date < v_to group by d.status) x));
end;
$$;
grant execute on function public.admin_fiscal_overview(date, date) to authenticated;

create or replace function public.admin_fiscal_documents(p_filters jsonb, p_limit integer default 30, p_cursor jsonb default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.erp_is_platform_admin() then return public.fiscal__err('FORBIDDEN', 'Solo el super administrador.'); end if;
  return public.fiscal__documents_query(null, null, p_filters, p_limit, p_cursor);
end;
$$;
grant execute on function public.admin_fiscal_documents(jsonb, integer, jsonb) to authenticated;

-- Todos los puntos de todas las tiendas con su salud fiscal.
create or replace function public.admin_fiscal_points(p_q text default null, p_limit integer default 60, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_q text := trim(coalesce(p_q, ''));
begin
  if not public.erp_is_platform_admin() then return public.fiscal__err('FORBIDDEN', 'Solo el super administrador.'); end if;
  return jsonb_build_object('ok', true, 'items', (
    select coalesce(jsonb_agg(x.j order by x.store_name, x.name), '[]'::jsonb) from (
      select s.name as store_name, w.name,
        jsonb_build_object('store_id', s.id, 'store_name', s.name, 'store_active', s.active, 'point_id', w.id, 'name', w.name,
          'code', w.code, 'kind', w.kind, 'status', w.status, 'responsible_name', w.responsible_name,
          'readiness', public.fiscal__point_readiness(w.id)) as j
      from public.erp_warehouses w join public.stores s on s.id = w.store_id
      where (w.kind = 'point' or exists (select 1 from public.fiscal_point_configs c where c.point_id = w.id))
        and (v_q = '' or w.name ilike '%' || v_q || '%' or s.name ilike '%' || v_q || '%' or w.code ilike '%' || v_q || '%'
             or exists (select 1 from public.fiscal_point_configs c join public.fiscal_entities e on e.id = c.fiscal_entity_id
                        where c.point_id = w.id and (e.legal_name ilike '%' || v_q || '%' or e.document_number like '%' || regexp_replace(v_q, '\D', '', 'g') || '%')))
      order by s.name, w.name
      limit least(greatest(coalesce(p_limit, 60), 1), 200) offset greatest(coalesce(p_offset, 0), 0)) x));
end;
$$;
grant execute on function public.admin_fiscal_points(text, integer, integer) to authenticated;

create or replace function public.admin_security_events(p_filters jsonb, p_limit integer default 50, p_cursor jsonb default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  f jsonb := coalesce(p_filters, '{}'::jsonb);
  v_cats text[] := coalesce(array(select jsonb_array_elements_text(f -> 'categories')), array['security']::text[]);
  v_q text := trim(coalesce(f ->> 'q', ''));
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_ct timestamptz := nullif(p_cursor ->> 't', '')::timestamptz;
  v_cid uuid := nullif(p_cursor ->> 'id', '')::uuid;
  v_rows jsonb;
  v_count integer;
  v_next jsonb;
begin
  if not public.erp_is_platform_admin() then return public.fiscal__err('FORBIDDEN', 'Solo el super administrador.'); end if;
  with page as (
    select l.*, s.name as store_name from public.erp_audit_logs l left join public.stores s on s.id = l.store_id
    where (cardinality(v_cats) = 0 or l.category = any (v_cats))
      and (nullif(f ->> 'store_id', '') is null or l.store_id = (f ->> 'store_id')::uuid)
      and (nullif(f ->> 'severity', '') is null or l.severity = f ->> 'severity')
      and (v_q = '' or l.action ilike '%' || v_q || '%' or l.user_name ilike '%' || v_q || '%' or coalesce(l.ip, '') ilike '%' || v_q || '%'
           or l.detail::text ilike '%' || v_q || '%' or coalesce(s.name, '') ilike '%' || v_q || '%')
      and (v_ct is null or (l.created_at, l.id) < (v_ct, v_cid))
    order by l.created_at desc, l.id desc
    limit v_limit + 1)
  select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc, p.id desc), '[]'::jsonb), count(*) into v_rows, v_count from page p;
  if v_count > v_limit then
    v_rows := v_rows - v_limit;
    v_next := jsonb_build_object('t', v_rows -> (v_limit - 1) ->> 'created_at', 'id', v_rows -> (v_limit - 1) ->> 'id');
  end if;
  return jsonb_build_object('ok', true, 'items', v_rows, 'next_cursor', v_next);
end;
$$;
grant execute on function public.admin_security_events(jsonb, integer, jsonb) to authenticated;

-- Postura de seguridad: tablas públicas sin RLS y funciones privilegiadas sin search_path fijo.
create or replace function public.admin_security_posture()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.erp_is_platform_admin() then return public.fiscal__err('FORBIDDEN', 'Solo el super administrador.'); end if;
  return jsonb_build_object('ok', true,
    'public_hardening', jsonb_build_object(
      'orders_closed', exists (select 1 from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname = 'orders' and p.polname = 'orders_no_anon'),
      'order_items_closed', exists (select 1 from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname = 'order_items' and p.polname = 'order_items_no_anon'),
      'product_costs_hidden', not has_column_privilege('anon', 'public.products', 'cost_price', 'select')),
    'tables_without_rls', (select coalesce(jsonb_agg(c.relname order by c.relname), '[]'::jsonb)
                           from pg_class c join pg_namespace n on n.oid = c.relnamespace
                           where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
    'tables_rls_no_policies', (select coalesce(jsonb_agg(c.relname order by c.relname), '[]'::jsonb)
                               from pg_class c join pg_namespace n on n.oid = c.relnamespace
                               where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
                                 and not exists (select 1 from pg_policy p where p.polrelid = c.oid)),
    'definer_without_search_path', (select coalesce(jsonb_agg(p.proname order by p.proname), '[]'::jsonb)
                                    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                    where n.nspname = 'public' and p.prosecdef
                                      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) as cfg where cfg like 'search_path=%')));
end;
$$;
grant execute on function public.admin_security_posture() to authenticated;


-- ---------------------------------------------------------------------
-- 16. Endurecimiento de lectura pública (hallazgo del diagnóstico)
--     Con la llave pública se podían leer TODAS las ventas y sus líneas
--     (nombres y WhatsApp de clientes) y el costo de los productos.
--     Las páginas públicas usan funciones seguras (get_order_by_token_v2,
--     catálogos), así que nada de la tienda pública cambia.
-- ---------------------------------------------------------------------
-- Solo se aplica si ninguna función pública que el visitante puede ejecutar lee estas tablas
-- con los permisos del visitante (SECURITY INVOKER); si existe alguna, se omite y se avisa.
create or replace function public.erp__anon_invoker_readers(p_table text)
returns text
language sql
stable
security definer
set search_path = public
as $fn$
  select string_agg(p.proname, ', ' order by p.proname)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and not p.prosecdef and p.prokind = 'f'
    and p.prosrc ~* ('\m' || p_table || '\M')
    and has_function_privilege('anon', p.oid, 'execute')
    and p.proname not like 'fiscal%' and p.proname not like 'erp\_\_%';
$fn$;
revoke all on function public.erp__anon_invoker_readers(text) from public, anon, authenticated;

do $$
declare
  v_rls boolean;
  v_readers text;
begin
  select c.relrowsecurity into v_rls from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'orders';
  if coalesce(v_rls, false) then
    -- Un usuario autenticado solo ve ventas de tiendas a las que pertenece (y de su punto).
    execute 'drop policy if exists orders_point_scope_select on public.orders';
    execute 'create policy orders_point_scope_select on public.orders as restrictive for select to authenticated using (public.erp__is_member(store_id) and public.erp__order_visible(store_id, id))';
    v_readers := public.erp__anon_invoker_readers('orders');
    if v_readers is null then
      execute 'drop policy if exists orders_no_anon on public.orders';
      execute 'create policy orders_no_anon on public.orders as restrictive for all to anon using (false) with check (false)';
    else
      raise notice 'No se cerró la lectura anónima de orders: estas funciones la usan con permisos del visitante: %', v_readers;
    end if;
  end if;
  select c.relrowsecurity into v_rls from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'order_items';
  if coalesce(v_rls, false) then
    v_readers := public.erp__anon_invoker_readers('order_items');
    if v_readers is null then
      execute 'drop policy if exists order_items_no_anon on public.order_items';
      execute 'create policy order_items_no_anon on public.order_items as restrictive for all to anon using (false) with check (false)';
    else
      raise notice 'No se cerró la lectura anónima de order_items: %', v_readers;
    end if;
  end if;
end $$;

-- Productos: el público solo lee lo que muestran los catálogos (sin costos, márgenes ni listas internas).
do $$
declare
  v_cols text;
  v_readers text := public.erp__anon_invoker_readers('products');
begin
  if v_readers is not null then
    raise notice 'No se limitaron las columnas públicas de products: estas funciones las leen con permisos del visitante: %', v_readers;
    return;
  end if;
  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into v_cols
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'products'
    and c.column_name = any (array['id', 'store_id', 'name', 'description', 'price_retail', 'price_wholesale',
      'min_wholesale', 'min_wholesale_qty', 'active', 'image_url', 'category_id', 'stock', 'product_details',
      'created_at', 'updated_at']);
  if v_cols is not null then
    execute 'revoke select on public.products from anon';
    execute 'grant select (' || v_cols || ') on public.products to anon';
  end if;
end $$;

-- Archivos XML/PDF de los documentos fiscales: bucket privado (solo el servidor lee y escribe;
-- las descargas pasan por /api/fiscal/documents/download, que valida permiso y alcance).
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('fiscal-docs', 'fiscal-docs', false, 10485760)
    on conflict (id) do update set public = false;
  end if;
end $$;

-- Funciones que solo usa el servidor de RemHub (llave de servicio). El navegador no puede llamarlas.
grant execute on function public.fiscal__claim(uuid) to service_role;
grant execute on function public.fiscal__record_result(uuid, jsonb) to service_role;
grant execute on function public.fiscal__due_documents(integer, uuid) to service_role;
grant execute on function public.fiscal__webhook_store(uuid, text, text, text, jsonb, text, boolean, jsonb, text) to service_role;
grant execute on function public.fiscal__webhook_apply(uuid, jsonb) to service_role;
grant execute on function public.fiscal__webhook_fail(uuid, text) to service_role;
grant execute on function public.fiscal__due_webhooks(integer) to service_role;
grant execute on function public.fiscal__provider_test_result(uuid, boolean, text, jsonb) to service_role;
grant execute on function public.fiscal__provider_set_hints(uuid, jsonb) to service_role;
grant execute on function public.fiscal__range_set_key_hint(uuid, text) to service_role;
grant execute on function public.erp__security_event(uuid, uuid, text, jsonb, text) to service_role;

-- Datos fiscales que se imprimen en el comprobante de la venta (el token de la venta es la llave;
-- solo devuelve lo que ya va impreso en una factura: emisor, número, resolución y CUFE).
create or replace function public.fiscal_public_receipt(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  select jsonb_build_object(
    'full_number', d.full_number, 'document_type', d.document_type, 'environment', d.environment, 'status', d.status,
    'cufe', d.cufe, 'qr_data', d.qr_data, 'issue_date', d.issue_date, 'subtotal', d.subtotal, 'tax_total', d.tax_total, 'total', d.total,
    'issuer', jsonb_build_object('legal_name', d.issuer ->> 'legal_name', 'trade_name', d.issuer ->> 'trade_name',
      'document_type', d.issuer ->> 'document_type', 'document_number', d.issuer ->> 'document_number',
      'verification_digit', d.issuer ->> 'verification_digit', 'tax_regime', d.issuer ->> 'tax_regime',
      'tax_responsibilities', d.issuer -> 'tax_responsibilities', 'fiscal_address', d.issuer ->> 'fiscal_address',
      'city', d.issuer ->> 'city', 'email', d.issuer ->> 'email'),
    'resolution', jsonb_build_object('number', r.resolution_number, 'date', r.resolution_date, 'from', r.range_from, 'to', r.range_to,
      'valid_until', r.valid_until, 'prefix', r.prefix))
  from public.orders o
  join public.fiscal_documents d on d.source_id = o.id and d.source_type in ('pos_order', 'order')
    and d.document_type in ('invoice', 'pos_equivalent', 'export_invoice', 'contingency_invoice') and d.status <> 'VOID'
  left join public.fiscal_numbering_ranges r on r.id = d.range_id
  where o.token = p_token
  order by d.created_at desc
  limit 1;
$fn$;
grant execute on function public.fiscal_public_receipt(text) to anon, authenticated;

notify pgrst, 'reload schema';
