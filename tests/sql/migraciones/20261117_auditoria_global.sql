-- =====================================================================
-- REMHUB · Auditoría global inalterable
--
-- Se construye SOBRE la auditoría que ya existe (erp_audit_logs, de la
-- migración fiscal 20261027). No borra ni reescribe eventos existentes.
--
--   1. Cada evento nuevo queda encadenado (hash SHA-256 del evento + hash del
--      anterior, por tienda). Si alguien borra, cambia o inserta eventos «por
--      debajo», la verificación lo detecta. Los eventos viejos quedan como
--      «anteriores a la cadena» (sin hash).
--   2. Se completan datos de cada evento: módulo, resultado, tipo de actor
--      (persona, integración, sistema, público), rol y permisos del usuario en
--      ese momento, y correlación de la operación.
--   3. Protección más fuerte: ya no basta un ajuste de sesión para saltarse la
--      protección (solo el dueño técnico de la base, postgres); se bloquea
--      TRUNCATE; borrar una tienda deja constancia en la cadena de plataforma.
--   4. Más módulos auditados con antes/después: productos (datos), categorías,
--      catálogos y precios por catálogo, reglas y límites de precio, rentabilidad,
--      repartos y liquidaciones, gastos, presupuestos, reservas, nómina,
--      empleados, compras, traslados, ajustes, cuentas por pagar y cobrar,
--      pedidos/ventas, métodos de pago, perfil y datos de facturación, tiendas.
--      Datos sensibles (claves, tokens, contraseñas, cuentas) se excluyen o enmascaran.
--   5. Consulta: centro global con filtros y paginación en el servidor,
--      auditoría de un registro (botón contextual), resumen e integridad.
--      Exportar y abrir el centro quedan registrados.
--   6. Alcance opcional: la tienda madre puede permitir que cada usuario de un
--      punto consulte los eventos de SU punto (por defecto: solo con el permiso
--      «Auditoría»).
--
-- Requiere la migración fiscal 20261027. No borra datos. Es idempotente.
-- REVERSIÓN: ver el bloque comentado al final.
-- =====================================================================

-- ---------------------------------------------------------------- 0. Columnas nuevas (no destructivo)
create sequence if not exists public.erp_audit_chain_seq;
alter table public.erp_audit_logs add column if not exists module text;
alter table public.erp_audit_logs add column if not exists result text;
alter table public.erp_audit_logs add column if not exists actor_type text;
alter table public.erp_audit_logs add column if not exists actor_role text;
alter table public.erp_audit_logs add column if not exists actor_permissions text[];
alter table public.erp_audit_logs add column if not exists correlation_id text;
alter table public.erp_audit_logs add column if not exists chain_seq bigint;
alter table public.erp_audit_logs add column if not exists prev_hash text;
alter table public.erp_audit_logs add column if not exists hash text;
alter table public.erp_audit_logs add column if not exists schema_version smallint;

do $$
begin
  -- Categorías: se amplían (las anteriores siguen válidas).
  if exists (select 1 from pg_constraint where conname = 'erp_audit_logs_category_check') then
    alter table public.erp_audit_logs drop constraint erp_audit_logs_category_check;
  end if;
  alter table public.erp_audit_logs add constraint erp_audit_logs_category_check
    check (category in ('ops', 'fiscal', 'security', 'auth', 'users', 'config', 'export', 'audit', 'inventory', 'sales', 'finance', 'catalog', 'legal'));
  if not exists (select 1 from pg_constraint where conname = 'erp_audit_logs_result_check') then
    alter table public.erp_audit_logs add constraint erp_audit_logs_result_check
      check (result is null or result in ('success', 'failed', 'blocked', 'suspicious'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'erp_audit_logs_actor_check') then
    alter table public.erp_audit_logs add constraint erp_audit_logs_actor_check
      check (actor_type is null or actor_type in ('user', 'service', 'system', 'public'));
  end if;
end $$;

create unique index if not exists erp_audit_logs_chain on public.erp_audit_logs ((coalesce(store_id::text, 'platform')), chain_seq) where chain_seq is not null;
create index if not exists erp_audit_logs_module_date on public.erp_audit_logs (store_id, module, created_at desc);
create index if not exists erp_audit_logs_result on public.erp_audit_logs (store_id, created_at desc) where result in ('blocked', 'suspicious', 'failed');

-- Módulo legible a partir de la entidad / acción / categoría.
create or replace function public.erp__audit_module(p_entity text, p_action text, p_category text)
returns text language sql immutable as $$
  select case
    when p_category in ('security', 'auth') then 'seguridad'
    when p_category = 'fiscal' or p_action like 'fiscal.%' or p_entity like 'fiscal%' or p_entity = 'contribuyente' then 'facturacion_electronica'
    when p_entity in ('products', 'producto', 'categoria', 'catalogo', 'catalogo_producto') then 'productos'
    when p_entity in ('regla_precio', 'limite_precio', 'rentabilidad', 'autorizacion_precio') or p_action like 'price%' or p_action like 'profit%' then 'precios'
    when p_entity in ('beneficiario', 'reparto', 'liquidacion') then 'liquidaciones'
    when p_entity in ('gasto', 'gasto_recurrente', 'categoria_gasto', 'presupuesto', 'reserva', 'nomina', 'concepto_nomina', 'empleado') then 'gastos_nomina'
    when p_entity in ('compra', 'traslado', 'ajuste', 'punto', 'proveedor', 'stock') or p_action like 'purchase.%' or p_action like 'transfer.%' or p_action like 'adjust%' then 'inventario'
    when p_entity in ('pedido', 'orders', 'venta', 'cuenta_por_cobrar', 'cuenta_por_pagar', 'metodo_pago') or p_action like 'sale.%' or p_action like 'order.%' then 'ventas'
    when p_entity in ('tercero', 'customer') then 'terceros'
    when p_entity in ('usuario', 'rol') or p_category = 'users' then 'usuarios'
    when p_entity in ('tienda', 'perfil_tienda', 'datos_facturacion', 'configuracion_tienda') or p_category = 'config' then 'configuracion'
    when p_category = 'export' then 'exportaciones'
    when p_category = 'audit' then 'auditoria'
    when p_category = 'legal' then 'legal'
    else 'operaciones' end;
$$;

-- ---------------------------------------------------------------- 1. Cadena de integridad
-- Representación canónica del evento (jsonb ordena las llaves siempre igual).
create or replace function public.erp__audit_canonical(l public.erp_audit_logs)
returns text language sql immutable as $$
  select jsonb_build_object(
    -- La hora en UTC con microsegundos: no depende de la zona horaria de la sesión.
    'v', l.schema_version, 'id', l.id, 'seq', l.chain_seq, 't', to_char(l.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'store', l.store_id, 'point', l.point_id,
    'user', l.user_id, 'user_name', l.user_name, 'actor', l.actor_type, 'role', l.actor_role, 'perms', l.actor_permissions,
    'category', l.category, 'severity', l.severity, 'result', l.result, 'module', l.module, 'action', l.action,
    'entity', l.entity, 'entity_id', l.entity_id, 'before', l.before, 'after', l.after, 'reason', l.reason, 'detail', l.detail,
    'ip', l.ip, 'ua', l.user_agent, 'req', l.request_id, 'corr', l.correlation_id)::text;
$$;

create or replace function public.erp__audit_hash(p_prev text, l public.erp_audit_logs)
returns text language sql immutable as $$
  select encode(sha256(convert_to(coalesce(p_prev, 'GENESIS') || '|' || public.erp__audit_canonical(l), 'UTF8')), 'hex');
$$;

-- Antes de guardar: hora del servidor, datos del actor y eslabón de la cadena (con candado por tienda).
create or replace function public.erp__audit_chain()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := coalesce(new.store_id::text, 'platform');
  v_prev public.erp_audit_logs;
  su public.store_users;
begin
  new.created_at := now();
  new.id := coalesce(new.id, gen_random_uuid());
  new.schema_version := 2;
  new.module := coalesce(new.module, public.erp__audit_module(new.entity, new.action, new.category));
  new.correlation_id := coalesce(new.correlation_id, nullif(current_setting('remhub.correlation_id', true), ''), new.request_id);
  new.actor_type := coalesce(new.actor_type,
    case when new.user_id is not null then 'user'
         when coalesce(current_setting('request.jwt.claim.role', true), '') = 'anon' then 'public'
         when coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' then 'service'
         else 'system' end);
  new.result := coalesce(new.result,
    case when new.action ~ '(denied|blocked|forbidden|cross_point|foreign|bad_signature|rejected)' then 'blocked'
         when new.category = 'security' then 'suspicious'
         when new.action ~ '(failed|error)' then 'failed'
         else 'success' end);
  if new.user_id is not null and new.store_id is not null and new.actor_role is null then
    select * into su from public.store_users where store_id = new.store_id and user_id = new.user_id limit 1;
    if su.user_id is not null then
      new.actor_role := su.role;
      new.actor_permissions := su.permissions;
    elsif exists (select 1 from public.stores s where s.id = new.store_id and s.owner_id = new.user_id) then
      new.actor_role := 'owner';
    end if;
  end if;

  -- Un solo eslabón a la vez por tienda: el candado dura hasta el fin de la transacción.
  perform pg_advisory_xact_lock(hashtext('remhub_audit_chain:' || v_key));
  select * into v_prev from public.erp_audit_logs
  where coalesce(store_id::text, 'platform') = v_key and chain_seq is not null
  order by chain_seq desc limit 1;
  new.chain_seq := coalesce(v_prev.chain_seq, 0) + 1;
  new.prev_hash := v_prev.hash;
  new.hash := public.erp__audit_hash(new.prev_hash, new);
  return new;
end;
$$;
drop trigger if exists erp_audit_logs_chain on public.erp_audit_logs;
create trigger erp_audit_logs_chain before insert on public.erp_audit_logs
  for each row execute function public.erp__audit_chain();

-- ---------------------------------------------------------------- 2. Protección más fuerte
-- Solo el dueño técnico de la base (conectado como postgres/supabase_admin) puede hacer
-- mantenimiento explícito. La app (authenticator / service_role) nunca puede.
create or replace function public.erp__audit_immutable()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('remhub.audit_maintenance', true), '') = 'on'
     and session_user in ('postgres', 'supabase_admin') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  -- Al eliminar una tienda completa (super admin) se permite el borrado en cascada:
  -- antes queda constancia en la cadena de la plataforma (ver erp__audit_store_deleted).
  if tg_op = 'DELETE' and old.store_id is not null
     and not exists (select 1 from public.stores s where s.id = old.store_id) then
    return old;
  end if;
  raise exception 'La auditoría no se puede modificar ni borrar.' using errcode = '42501';
end;
$$;

create or replace function public.erp__audit_no_truncate()
returns trigger language plpgsql as $$
begin
  raise exception 'La auditoría no se puede vaciar.' using errcode = '42501';
end;
$$;
drop trigger if exists erp_audit_logs_no_truncate on public.erp_audit_logs;
create trigger erp_audit_logs_no_truncate before truncate on public.erp_audit_logs
  for each statement execute function public.erp__audit_no_truncate();
revoke truncate, update, delete on public.erp_audit_logs from public, anon, authenticated, service_role;
revoke insert on public.erp_audit_logs from public, anon, authenticated;

-- Borrar una tienda: antes queda en la cadena de plataforma cuántos eventos tenía y su último hash.
create or replace function public.erp__audit_store_deleted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_count bigint; v_head text; v_seq bigint;
begin
  select count(*), max(chain_seq) into v_count, v_seq from public.erp_audit_logs where store_id = old.id;
  select hash into v_head from public.erp_audit_logs where store_id = old.id and chain_seq = v_seq;
  perform public.erp__audit_insert(null, null, 'security', 'critical', 'tienda.eliminada', 'tienda', old.id,
    jsonb_build_object('name', old.name, 'slug', old.slug), null, null,
    jsonb_build_object('audit_events', v_count, 'chain_head_seq', v_seq, 'chain_head_hash', v_head));
  return old;
end;
$$;
drop trigger if exists stores_audit_deleted on public.stores;
create trigger stores_audit_deleted before delete on public.stores
  for each row execute function public.erp__audit_store_deleted();

-- ---------------------------------------------------------------- 3. Auditoría genérica (antes → después)
-- Igual que la anterior + enmascara datos sensibles + permite indicar la columna de la tienda.
-- Argumentos: categoría, entidad, columna del punto, columnas ignoradas, columnas sensibles, columna id, columna tienda.
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
  v_store_key text := coalesce(nullif(tg_argv[6], ''), 'store_id');
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
  -- Nunca se guardan secretos: claves, tokens, contraseñas, firmas, certificados.
  for v_key in select k from jsonb_object_keys(coalesce(v_new, v_old)) k
               where k ~* '(password|secret|token|api_key|apikey|private|credential|signature|certificate|pin_hash)' loop
    v_skip := v_skip || v_key;
  end loop;
  -- Cuentas bancarias: solo los últimos 4 dígitos.
  if v_new ? 'bank_account_number' then v_new := jsonb_set(v_new, '{bank_account_number}', to_jsonb('••••' || right(coalesce(v_new ->> 'bank_account_number', ''), 4))); end if;
  if v_old ? 'bank_account_number' then v_old := jsonb_set(v_old, '{bank_account_number}', to_jsonb('••••' || right(coalesce(v_old ->> 'bank_account_number', ''), 4))); end if;
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

  begin v_store := (v_row ->> v_store_key)::uuid; exception when others then v_store := null; end;
  -- Borrado en cascada de una tienda completa: el resumen ya quedó en la cadena de plataforma
  -- (erp__audit_store_deleted); registrar cada fila apuntaría a una tienda que ya no existe.
  if tg_op = 'DELETE' and v_store is not null and not exists (select 1 from public.stores s where s.id = v_store) then
    return old;
  end if;
  begin v_id := (v_row ->> v_id_key)::uuid; exception when others then v_id := null; end;
  if v_point_key is not null then
    begin v_point := (v_row ->> v_point_key)::uuid; exception when others then v_point := null; end;
  end if;

  perform public.erp__audit_insert(v_store, v_point, v_cat, v_sev, v_entity || '.' || lower(tg_op), v_entity, v_id,
    v_before, v_after, null, '{}'::jsonb);
  return coalesce(new, old);
end;
$$;

-- Engancha la auditoría solo si la tabla (y sus columnas) existen en esta base.
create or replace function public.erp__audit_attach(p_table text, p_args text[], p_ops text default 'insert or update or delete')
returns void
language plpgsql
as $$
declare v_args text;
begin
  if to_regclass('public.' || p_table) is null then return; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = p_table and column_name = coalesce(nullif(p_args[7], ''), 'store_id')) then
    return;
  end if;
  select string_agg(quote_literal(coalesce(a, '')), ', ') into v_args from unnest(p_args) a;
  execute format('drop trigger if exists %I on public.%I', p_table || '_audit', p_table);
  execute format('create trigger %I after %s on public.%I for each row execute function public.erp__audit_row(%s)',
    p_table || '_audit', p_ops, p_table, v_args);
end;
$$;

-- Categoría, entidad, columna punto, ignoradas, sensibles (→ advertencia), id, tienda.
select public.erp__audit_attach('products', array['catalog', 'producto', '',
  'updated_at,stock,cost_price,price_1,price_2,price_3,price_4,price_5,price_retail,price_wholesale,min_price,tax_rate,product_details,search_text,search_vector,image_embedding,fts',
  'active,sku,name,category_id,markup_1,markup_2,markup_3,markup_4,markup_5', 'id', 'store_id']);
select public.erp__audit_attach('product_categories', array['catalog', 'categoria', '', 'updated_at', 'name,active', 'id', 'store_id']);
select public.erp__audit_attach('store_catalogs', array['catalog', 'catalogo', '', 'updated_at', 'active,price_level,access_key,slug', 'id', 'store_id']);
select public.erp__audit_attach('store_catalog_products', array['catalog', 'catalogo_producto', '', 'updated_at', 'price_override,included', 'product_id', 'store_id']);
select public.erp__audit_attach('erp_price_rules', array['config', 'regla_precio', 'point_id', '', 'status,kind,value,valid_to', 'id', 'store_id']);
select public.erp__audit_attach('erp_price_limits', array['config', 'limite_precio', 'point_id', 'updated_at', 'mode,margin_pct', 'id', 'store_id']);
select public.erp__audit_attach('erp_profit_settings', array['config', 'rentabilidad', '', 'updated_at', 'price_guard,point_min_pct,point_max_pct,require_approval', 'store_id', 'store_id']);
select public.erp__audit_attach('erp_price_approvals', array['sales', 'autorizacion_precio', 'point_id', '', 'status', 'id', 'store_id'], 'update');
select public.erp__audit_attach('erp_beneficiaries', array['finance', 'beneficiario', 'point_id', 'updated_at', 'active,name', 'id', 'store_id']);
select public.erp__audit_attach('erp_profit_splits', array['finance', 'reparto', 'point_id', 'updated_at', 'pct,active', 'id', 'store_id']);
select public.erp__audit_attach('erp_settlements', array['finance', 'liquidacion', 'point_id', 'updated_at', 'status,total,paid', 'id', 'store_id']);
select public.erp__audit_attach('erp_expenses', array['finance', 'gasto', 'point_id', 'updated_at', 'amount,status,voided_at', 'id', 'store_id']);
select public.erp__audit_attach('erp_recurring_expenses', array['finance', 'gasto_recurrente', 'point_id', 'updated_at', 'amount,active,deleted_at', 'id', 'store_id']);
select public.erp__audit_attach('erp_expense_categories', array['finance', 'categoria_gasto', '', 'updated_at', 'name,active', 'id', 'store_id']);
select public.erp__audit_attach('erp_budgets', array['finance', 'presupuesto', 'point_id', 'updated_at', 'amount', 'id', 'store_id']);
select public.erp__audit_attach('erp_reserve_funds', array['finance', 'reserva', 'point_id', 'updated_at', 'balance,deleted_at', 'id', 'store_id']);
select public.erp__audit_attach('erp_employees', array['finance', 'empleado', 'point_id', 'updated_at', 'salary,base_salary,active,deleted_at,bank_account_number', 'id', 'store_id']);
select public.erp__audit_attach('erp_payroll_runs', array['finance', 'nomina', 'point_id', 'updated_at', 'status,total,deleted_at', 'id', 'store_id']);
select public.erp__audit_attach('erp_payroll_concepts', array['finance', 'concepto_nomina', '', 'updated_at', 'active,value,pct', 'id', 'store_id']);
select public.erp__audit_attach('erp_purchases', array['inventory', 'compra', 'warehouse_id', 'updated_at', 'status,total,warehouse_id,supplier_id', 'id', 'store_id']);
select public.erp__audit_attach('erp_transfers', array['inventory', 'traslado', 'from_warehouse_id', 'updated_at', 'status', 'id', 'store_id']);
select public.erp__audit_attach('erp_adjustments', array['inventory', 'ajuste', 'warehouse_id', 'updated_at', 'status', 'id', 'store_id']);
select public.erp__audit_attach('erp_payables', array['finance', 'cuenta_por_pagar', '', 'updated_at', 'status,balance,total', 'id', 'store_id']);
select public.erp__audit_attach('erp_receivables', array['finance', 'cuenta_por_cobrar', 'point_id', 'updated_at', 'status,balance,total', 'id', 'store_id']);
select public.erp__audit_attach('orders', array['sales', 'pedido', '',
  'updated_at,customer_whatsapp,customer_note,stock_applied,search_text', 'status,total,cancelled_at,cancel_reason', 'id', 'store_id']);
select public.erp__audit_attach('store_payment_methods', array['config', 'metodo_pago', '', 'updated_at', 'enabled,show_on_invoice', 'id', 'store_id']);
select public.erp__audit_attach('billing_settings', array['config', 'datos_facturacion', '', 'updated_at', 'nit,business_name,invoice_prefix,remision_prefix', 'store_id', 'store_id']);
select public.erp__audit_attach('store_profiles', array['config', 'perfil_tienda', '', 'updated_at', '', 'store_id', 'store_id']);
select public.erp__audit_attach('erp_role_templates', array['users', 'rol', '', 'updated_at', 'permissions,name', 'id', 'store_id']);
-- La tienda misma: su id es la tienda (activación, vencimiento, nombre, enlace).
select public.erp__audit_attach('stores', array['config', 'tienda', '', 'updated_at,theme,logo_url,banner_url', 'active,active_until,slug,owner_id,name', 'id', 'id'], 'update');

-- ---------------------------------------------------------------- 4. Alcance de consulta
alter table public.erp_org_settings add column if not exists audit_scope text not null default 'permission';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'erp_org_settings_audit_scope') then
    alter table public.erp_org_settings add constraint erp_org_settings_audit_scope check (audit_scope in ('permission', 'point_users'));
  end if;
end $$;

-- ¿Puede consultar la auditoría de esta tienda? Devuelve el alcance: 'all' (toda la tienda),
-- 'points' (sus puntos), 'own' (solo su punto, sin seguridad) o null (nada).
create or replace function public.erp__audit_reader(p_store uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_points uuid[];
begin
  if auth.uid() is null then return null; end if;
  if public.erp_is_platform_admin() then return 'all'; end if;
  if not public.erp__is_member(p_store) then return null; end if;
  v_points := public.erp_my_points(p_store);
  if public.erp_can_any(p_store, array['audit', 'fiscal_audit']::text[]) then
    return case when v_points is null then 'all' else 'points' end;
  end if;
  if v_points is not null and coalesce((select audit_scope from public.erp_org_settings where store_id = p_store), 'permission') = 'point_users' then
    return 'own';
  end if;
  return null;
end;
$$;
revoke all on function public.erp__audit_reader(uuid) from public, anon, authenticated;

-- Para la interfaz: ¿muestra el botón de auditoría? (no registra nada; no revela eventos).
create or replace function public.erp_audit_access(p_store uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_scope text := case when p_store is null then (case when public.erp_is_platform_admin() then 'all' end) else public.erp__audit_reader(p_store) end;
begin
  return jsonb_build_object('scope', v_scope,
    'can_verify', v_scope in ('all', 'points'),
    'can_configure', p_store is not null and public.erp_can(p_store, 'users') and public.erp_my_points(p_store) is null,
    'audit_scope', coalesce((select audit_scope from public.erp_org_settings where store_id = p_store), 'permission'));
end;
$$;
revoke all on function public.erp_audit_access(uuid) from public, anon;
grant execute on function public.erp_audit_access(uuid) to authenticated;

-- Configurar el alcance (dueño / quien administra usuarios en la madre).
create or replace function public.erp_audit_scope_save(p_store uuid, p_scope text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.erp_can(p_store, 'users') or public.erp_my_points(p_store) is not null then
    raise exception 'Solo la madre (permiso Usuarios) define quién consulta la auditoría.';
  end if;
  if p_scope not in ('permission', 'point_users') then raise exception 'Alcance no válido.'; end if;
  insert into public.erp_org_settings (store_id, audit_scope) values (p_store, p_scope)
  on conflict (store_id) do update set audit_scope = excluded.audit_scope;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.erp_audit_scope_save(uuid, text) from public, anon;
grant execute on function public.erp_audit_scope_save(uuid, text) to authenticated;

-- ---------------------------------------------------------------- 5. Consultas
-- Búsqueda (centro global y botón contextual). p_store null = toda la plataforma (solo admin global).
-- Filtros: from, to (fecha), user_id, point_id, module, category, severity, result, action, entity, entity_id, q.
create or replace function public.erp_audit_search(p_store uuid, p_filters jsonb, p_limit integer default 50, p_cursor jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  f jsonb := coalesce(p_filters, '{}'::jsonb);
  v_scope text;
  v_points uuid[];
  v_my_point uuid;
  v_q text := trim(coalesce(f ->> 'q', ''));
  v_from timestamptz := nullif(f ->> 'from', '')::date::timestamptz;
  v_to timestamptz := (nullif(f ->> 'to', '')::date + 1)::timestamptz;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_ct timestamptz := nullif(p_cursor ->> 't', '')::timestamptz;
  v_cid uuid := nullif(p_cursor ->> 'id', '')::uuid;
  v_entities text[] := coalesce(array(select jsonb_array_elements_text(f -> 'entities')), '{}'::text[]);
  v_rows jsonb;
  v_count integer;
  v_next jsonb;
begin
  -- Los rechazos devuelven ok=false (no error) para que el evento de seguridad SÍ quede guardado.
  if p_store is null then
    if not public.erp_is_platform_admin() then
      return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Solo el administrador global consulta toda la plataforma.');
    end if;
    v_scope := 'all';
  else
    v_scope := public.erp__audit_reader(p_store);
    if v_scope is null then
      if auth.uid() is not null then
        perform public.erp__security_event(p_store, null, 'security.audit_denied', jsonb_build_object('filters', f));
      end if;
      return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'No tienes permiso para consultar la auditoría de esta tienda.');
    end if;
    v_points := public.erp_my_points(p_store);
    v_my_point := public.erp_my_point(p_store);
  end if;
  -- Pedir un punto que no es suyo cambiando el identificador: se registra y no devuelve nada ajeno.
  if p_store is not null and nullif(f ->> 'point_id', '') is not null and v_points is not null
     and not ((f ->> 'point_id')::uuid = any (v_points)) then
    perform public.erp__security_event(p_store, v_my_point, 'security.audit_cross_point', jsonb_build_object('point_id', f ->> 'point_id'));
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Ese punto no lo tienes asignado.');
  end if;

  with page as (
    select l.* from public.erp_audit_logs l
    where (p_store is null or l.store_id = p_store)
      and (nullif(f ->> 'store_id', '') is null or l.store_id = (f ->> 'store_id')::uuid)
      and (v_scope = 'all'
           or (v_scope = 'points' and ((l.point_id = any (v_points) and l.category <> 'security') or l.user_id = auth.uid()))
           or (v_scope = 'own' and l.point_id = v_my_point and l.category not in ('security', 'auth', 'users')))
      and (nullif(f ->> 'module', '') is null or l.module = f ->> 'module')
      and (nullif(f ->> 'category', '') is null or l.category = f ->> 'category')
      and (nullif(f ->> 'severity', '') is null or l.severity = f ->> 'severity')
      and (nullif(f ->> 'result', '') is null or l.result = f ->> 'result')
      and (nullif(f ->> 'point_id', '') is null or l.point_id = (f ->> 'point_id')::uuid)
      and (nullif(f ->> 'user_id', '') is null or l.user_id = (f ->> 'user_id')::uuid)
      and (nullif(f ->> 'entity_id', '') is null or l.entity_id = (f ->> 'entity_id')::uuid)
      and (cardinality(v_entities) = 0 or l.entity = any (v_entities))
      and (nullif(f ->> 'action', '') is null or l.action ilike (f ->> 'action') || '%')
      and (nullif(f ->> 'event_id', '') is null or l.id = (f ->> 'event_id')::uuid or l.correlation_id = f ->> 'event_id')
      and (v_from is null or l.created_at >= v_from) and (v_to is null or l.created_at < v_to)
      and (v_q = '' or l.action ilike '%' || v_q || '%' or coalesce(l.user_name, '') ilike '%' || v_q || '%' or l.entity ilike '%' || v_q || '%'
           or coalesce(l.reason, '') ilike '%' || v_q || '%' or coalesce(l.after::text, '') ilike '%' || v_q || '%'
           or coalesce(l.before::text, '') ilike '%' || v_q || '%')
      and (v_ct is null or (l.created_at, l.id) < (v_ct, v_cid))
    order by l.created_at desc, l.id desc
    limit v_limit + 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'created_at', p.created_at, 'store_id', p.store_id, 'point_id', p.point_id,
      'point_name', (select w.name from public.erp_warehouses w where w.id = p.point_id),
      'store_name', case when p_store is null then (select s.name from public.stores s where s.id = p.store_id) end,
      'user_id', p.user_id, 'user_name', p.user_name, 'actor_type', p.actor_type, 'actor_role', p.actor_role,
      'category', p.category, 'module', p.module, 'severity', p.severity, 'result', p.result,
      'action', p.action, 'entity', p.entity, 'entity_id', p.entity_id, 'before', p.before, 'after', p.after,
      'reason', p.reason, 'detail', p.detail, 'ip', case when v_scope = 'own' then null else p.ip end,
      'user_agent', case when v_scope = 'own' then null else p.user_agent end,
      'correlation_id', p.correlation_id, 'chain_seq', p.chain_seq, 'hash', p.hash)
      order by p.created_at desc, p.id desc), '[]'::jsonb), count(*)
  into v_rows, v_count from page p;
  if v_count > v_limit then
    v_rows := v_rows - v_limit;
    v_next := jsonb_build_object('t', v_rows -> (v_limit - 1) ->> 'created_at', 'id', v_rows -> (v_limit - 1) ->> 'id');
  end if;
  -- Abrir el centro (primera página) queda registrado; las páginas siguientes no (evita ruido).
  if p_cursor is null and coalesce((f ->> 'log')::boolean, false) then
    perform public.erp__audit_insert(p_store, v_my_point, 'audit', 'info', 'audit.view', 'auditoria', null, null, null, null,
      jsonb_build_object('filters', f - 'log', 'scope', v_scope));
  end if;
  return jsonb_build_object('ok', true, 'scope', v_scope, 'items', v_rows, 'next_cursor', v_next);
end;
$$;
revoke all on function public.erp_audit_search(uuid, jsonb, integer, jsonb) from public, anon;
grant execute on function public.erp_audit_search(uuid, jsonb, integer, jsonb) to authenticated;

-- Exportación controlada (máx. 5.000 filas) que queda registrada.
create or replace function public.erp_audit_export(p_store uuid, p_filters jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v jsonb; v_all jsonb := '[]'::jsonb; v_cursor jsonb := null; i integer := 0;
begin
  loop
    v := public.erp_audit_search(p_store, coalesce(p_filters, '{}'::jsonb) - 'log', 200, v_cursor);
    if coalesce((v ->> 'ok')::boolean, false) is false then return v; end if;
    v_all := v_all || (v -> 'items');
    v_cursor := v -> 'next_cursor';
    i := i + 1;
    exit when v_cursor is null or jsonb_typeof(v_cursor) = 'null' or i >= 25;
  end loop;
  perform public.erp__audit_insert(p_store, public.erp_my_point(p_store), 'export', case when jsonb_array_length(v_all) >= 1000 then 'warning' else 'info' end,
    'export.audit', 'auditoria', null, null, null, null, jsonb_build_object('rows', jsonb_array_length(v_all), 'filters', p_filters));
  return jsonb_build_object('ok', true, 'items', v_all, 'truncated', v_cursor is not null and jsonb_typeof(v_cursor) <> 'null');
end;
$$;
revoke all on function public.erp_audit_export(uuid, jsonb) from public, anon;
grant execute on function public.erp_audit_export(uuid, jsonb) to authenticated;

-- Resumen real (últimos N días) para el centro de control.
create or replace function public.erp_audit_overview(p_store uuid, p_days integer default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_scope text; v_from timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 7), 1), 90));
begin
  v_scope := case when p_store is null then (case when public.erp_is_platform_admin() then 'all' end) else public.erp__audit_reader(p_store) end;
  if v_scope is null then raise exception 'No tienes permiso para consultar la auditoría.' using errcode = '42501'; end if;
  if v_scope not in ('all', 'points') then
    return jsonb_build_object('ok', true, 'scope', v_scope, 'limited', true);
  end if;
  return jsonb_build_object('ok', true, 'scope', v_scope, 'days', p_days,
    'total', (select count(*) from public.erp_audit_logs where (p_store is null or store_id = p_store) and created_at >= v_from),
    'by_module', coalesce((select jsonb_object_agg(module, n) from (select coalesce(module, 'operaciones') module, count(*) n from public.erp_audit_logs where (p_store is null or store_id = p_store) and created_at >= v_from group by 1) x), '{}'::jsonb),
    'by_result', coalesce((select jsonb_object_agg(result, n) from (select coalesce(result, 'success') result, count(*) n from public.erp_audit_logs where (p_store is null or store_id = p_store) and created_at >= v_from group by 1) x), '{}'::jsonb),
    'critical', (select count(*) from public.erp_audit_logs where (p_store is null or store_id = p_store) and created_at >= v_from and severity = 'critical'),
    'security', (select count(*) from public.erp_audit_logs where (p_store is null or store_id = p_store) and created_at >= v_from and category = 'security'),
    'last_verification', (select to_jsonb(v) - 'store_id' from public.erp_audit_verifications v where (p_store is null and v.store_id is null) or v.store_id = p_store order by checked_at desc limit 1),
    'chain', (select jsonb_build_object('events', count(*), 'first_seq', min(chain_seq), 'last_seq', max(chain_seq), 'legacy', count(*) filter (where chain_seq is null))
              from public.erp_audit_logs where (p_store is null and store_id is null) or store_id = p_store));
end;
$$;
revoke all on function public.erp_audit_overview(uuid, integer) from public, anon;
grant execute on function public.erp_audit_overview(uuid, integer) to authenticated;

-- ---------------------------------------------------------------- 6. Verificación de integridad
create table if not exists public.erp_audit_verifications (
  id uuid primary key default gen_random_uuid(),
  store_id uuid,
  checked_at timestamptz not null default now(),
  checked_by uuid,
  ok boolean not null,
  checked integer not null,
  first_seq bigint,
  last_seq bigint,
  head_hash text,
  breaks jsonb not null default '[]'::jsonb
);
create index if not exists erp_audit_verifications_store on public.erp_audit_verifications (store_id, checked_at desc);
alter table public.erp_audit_verifications enable row level security;
revoke all on public.erp_audit_verifications from anon, authenticated;
drop trigger if exists erp_audit_verifications_immutable on public.erp_audit_verifications;
create trigger erp_audit_verifications_immutable before update or delete on public.erp_audit_verifications
  for each row execute function public.erp__audit_immutable();

-- Recalcula la cadena (los últimos p_limit eslabones): hash de cada evento, enlace con el anterior
-- y números consecutivos (un hueco = eventos borrados).
create or replace function public.erp_audit_verify(p_store uuid, p_limit integer default 5000)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_breaks jsonb := '[]'::jsonb;
  v_prev public.erp_audit_logs;
  r public.erp_audit_logs;
  v_n integer := 0;
  v_first bigint;
  v_last bigint;
  v_head text;
  v_lim integer := least(greatest(coalesce(p_limit, 5000), 1), 50000);
  v_start bigint;
begin
  if p_store is null then
    if not public.erp_is_platform_admin() and coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' and auth.uid() is not null then
      raise exception 'Solo el administrador global verifica la cadena de la plataforma.' using errcode = '42501';
    end if;
  elsif coalesce(public.erp__audit_reader(p_store), '') not in ('all', 'points') and coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
        and auth.uid() is not null then
    raise exception 'Necesitas el permiso de auditoría.' using errcode = '42501';
  end if;
  select max(chain_seq) into v_last from public.erp_audit_logs where coalesce(store_id::text, 'platform') = coalesce(p_store::text, 'platform');
  v_start := greatest(coalesce(v_last, 0) - v_lim + 1, 1);
  for r in
    select * from public.erp_audit_logs
    where coalesce(store_id::text, 'platform') = coalesce(p_store::text, 'platform') and chain_seq >= v_start - 1
    order by chain_seq
  loop
    -- El eslabón anterior al tramo revisado solo sirve de referencia.
    if r.chain_seq < v_start then v_prev := r; continue; end if;
    v_n := v_n + 1;
    v_first := coalesce(v_first, r.chain_seq);
    -- Números consecutivos: un hueco significa eventos borrados.
    if v_prev.id is not null and r.chain_seq <> v_prev.chain_seq + 1 then
      v_breaks := v_breaks || jsonb_build_object('type', 'gap', 'after_seq', v_prev.chain_seq, 'seq', r.chain_seq, 'missing', r.chain_seq - v_prev.chain_seq - 1);
    elsif v_prev.id is null and r.chain_seq <> v_start then
      v_breaks := v_breaks || jsonb_build_object('type', 'gap', 'after_seq', v_start - 1, 'seq', r.chain_seq, 'missing', r.chain_seq - v_start + 1);
    elsif v_prev.id is null and v_start > 1 then
      v_breaks := v_breaks || jsonb_build_object('type', 'gap', 'after_seq', v_start - 2, 'seq', v_start - 1, 'missing', 1);
    end if;
    -- Enlace con el anterior.
    if (v_prev.id is not null and r.prev_hash is distinct from v_prev.hash) or (r.chain_seq = 1 and r.prev_hash is not null) then
      v_breaks := v_breaks || jsonb_build_object('type', 'link', 'seq', r.chain_seq, 'id', r.id);
    end if;
    -- Contenido: el hash guardado debe coincidir con el recalculado.
    if r.hash is distinct from public.erp__audit_hash(r.prev_hash, r) then
      v_breaks := v_breaks || jsonb_build_object('type', 'altered', 'seq', r.chain_seq, 'id', r.id, 'action', r.action);
    end if;
    v_prev := r;
    v_head := r.hash;
  end loop;
  insert into public.erp_audit_verifications (store_id, checked_by, ok, checked, first_seq, last_seq, head_hash, breaks)
  values (p_store, auth.uid(), jsonb_array_length(v_breaks) = 0, v_n, v_first, v_last, v_head, v_breaks);
  if jsonb_array_length(v_breaks) > 0 then
    perform public.erp__audit_insert(p_store, null, 'security', 'critical', 'security.audit_integrity_failed', 'auditoria', null, null, null, null,
      jsonb_build_object('breaks', jsonb_array_length(v_breaks), 'sample', v_breaks -> 0));
  end if;
  return jsonb_build_object('ok', jsonb_array_length(v_breaks) = 0, 'checked', v_n, 'first_seq', v_first, 'last_seq', v_last, 'head_hash', v_head, 'breaks', v_breaks);
end;
$$;
revoke all on function public.erp_audit_verify(uuid, integer) from public, anon;
grant execute on function public.erp_audit_verify(uuid, integer) to authenticated, service_role;

-- Último eslabón de cada cadena: para guardarlo FUERA de la base (ancla externa, ver informe).
create or replace function public.erp_audit_chain_heads()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('chain', k, 'seq', seq, 'hash', hash, 'at', created_at)), '[]'::jsonb)
  from (
    select distinct on (coalesce(store_id::text, 'platform')) coalesce(store_id::text, 'platform') k, chain_seq seq, hash, created_at
    from public.erp_audit_logs where chain_seq is not null
    order by coalesce(store_id::text, 'platform'), chain_seq desc) x;
$$;
revoke all on function public.erp_audit_chain_heads() from public, anon, authenticated;
grant execute on function public.erp_audit_chain_heads() to service_role;

-- Permisos (igual que src/lib/store-user-auth.ts): no cambian; «audit» ya existe.
notify pgrst, 'reload schema';

-- =====================================================================
-- REVERSIÓN (solo si algo falla; no borra eventos):
--   drop trigger if exists erp_audit_logs_chain on public.erp_audit_logs;
--   drop trigger if exists erp_audit_logs_no_truncate on public.erp_audit_logs;
--   drop trigger if exists stores_audit_deleted on public.stores;
--   -- y los disparadores «<tabla>_audit» nuevos, p. ej.:
--   drop trigger if exists products_audit on public.products;
--   Las columnas nuevas pueden quedarse (no molestan). Los eventos ya guardados
--   se conservan; volver a ejecutar esta migración retoma la cadena.
-- =====================================================================
