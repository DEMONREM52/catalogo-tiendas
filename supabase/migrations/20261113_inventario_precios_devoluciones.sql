-- =====================================================================
-- REMHUB · Inventario serio, precios por porcentaje y devoluciones
--
--   1. Devoluciones: quien tiene «Devolución de venta» ya puede devolver
--      una venta confirmada (antes la bloqueaba la regla ORDER_LOCKED que
--      impide «reabrir» pedidos). La regla sigue protegiendo todo lo demás.
--   2. El COSTO y las UNIDADES de un producto ya no se pueden cambiar
--      editando el producto: solo con ingreso de factura, ajuste de
--      inventario, traslados y ventas (todo queda en el kardex).
--      Así no vuelve a pasar que guardar un producto «devuelva» unidades.
--   3. Precios por porcentaje: cada producto puede tener su % de ganancia
--      en cada precio (1 a 5). El precio se calcula solo:
--      costo × (1 + %) y se redondea (por defecto al $100 más cercano).
--      Cuando entra una factura y cambia el costo, los precios se ajustan.
--      Los productos sin % conservan sus precios como estaban.
--   4. Alertas: productos creados hace más de 1 hora sin ingreso de factura
--      (sin costo y sin unidades). Las ven quienes tengan el permiso nuevo
--      «Alertas de inventario» (inventory_alerts).
--
-- Requiere 20261106 (configuración de rentabilidad). No borra datos.
-- Es idempotente.
-- =====================================================================

-- 0. Permisos (igual que src/lib/store-user-auth.ts).
create or replace function public.erp__known_permissions()
returns text[]
language sql
immutable
as $$
  select array[
    'store', 'billing', 'pos', 'sales_void', 'sales_return', 'clients', 'clients_delete', 'credit', 'receivables', 'users',
    'products', 'products_view', 'categories', 'orders', 'inventory', 'inventory_adjust', 'inventory_alerts', 'transfers', 'stock_requests',
    'stock_requests_manage', 'notifications_config', 'purchases', 'suppliers', 'payables', 'audit', 'points', 'fiscal', 'fiscal_send',
    'fiscal_notes', 'fiscal_download', 'fiscal_config', 'fiscal_numbering', 'fiscal_provider', 'fiscal_audit',
    'profit_view', 'profit_rules', 'profit_approve',
    'profit_beneficiaries', 'profit_settle', 'profit_settle_approve', 'profit_pay',
    'expenses', 'expenses_pay', 'budgets', 'payroll', 'payroll_approve', 'payroll_pay'
  ]::text[];
$$;

-- ================================================================ 1. DEVOLUCIONES
-- La regla que impide «reabrir» pedidos confirmados deja pasar SOLO la anulación hecha por erp_sale_void
-- (que ya valida permisos, cartera, factura electrónica y devuelve el inventario según el kardex).
do $$
begin
  if exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname = 'orders' and t.tgname = 'prevent_order_status_downgrade' and not t.tgisinternal)
     and exists (select 1 from pg_proc where proname = 'prevent_order_status_downgrade') then
    drop trigger prevent_order_status_downgrade on public.orders;
    create trigger prevent_order_status_downgrade before update of status on public.orders
      for each row when (not (new.status = 'cancelled' and coalesce(current_setting('erp.sale_void', true), '') = '1'))
      execute function public.prevent_order_status_downgrade();
  end if;
  if exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname = 'orders' and t.tgname = 'orders_cancel_guard' and not t.tgisinternal)
     and exists (select 1 from pg_proc where proname = 'orders__cancel_guard') then
    drop trigger orders_cancel_guard on public.orders;
    create trigger orders_cancel_guard before update of status on public.orders
      for each row when (not (new.status = 'cancelled' and coalesce(current_setting('erp.sale_void', true), '') = '1'))
      execute function public.orders__cancel_guard();
  end if;
end $$;

-- erp_sale_void de producción, con una sola diferencia: marca la anulación como autorizada.
create or replace function public.erp_sale_void(p_order uuid, p_reason text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  o public.orders;
  m public.erp_order_meta;
  v_reason text := trim(coalesce(p_reason, ''));
  v_confirmed boolean;
  v_kind text;
  v_label text;
  v_units integer := 0;
  v_items jsonb;
  v_receivables integer := 0;
  v_fiscal integer := 0;
  v_name text;
  r record;
begin
  select * into o from public.orders where id = p_order for update;
  if o.id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'El documento no existe.'); end if;
  select * into m from public.erp_order_meta where order_id = o.id;
  v_label := coalesce(m.doc_number, '#' || coalesce(o.receipt_no::text, left(o.id::text, 8)));

  if not public.erp_point_allowed(o.store_id, m.point_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Este documento es de un punto que no tienes asignado.');
  end if;
  if o.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'code', 'ALREADY', 'message', v_label || ' ya está anulado.');
  end if;
  if length(v_reason) < 5 then
    return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED', 'message', 'Escribe el motivo (mínimo 5 letras).');
  end if;

  v_confirmed := o.status in ('confirmed', 'completed') or coalesce(o.stock_applied, false)
    or exists (select 1 from public.erp_order_stock s where s.order_id = o.id);
  v_kind := case when v_confirmed then 'return' else 'void' end;

  if v_confirmed and not public.erp_can(o.store_id, 'sales_return') then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN',
      'message', v_label || ' ya está confirmado: solo un usuario con el permiso «Devolución de venta» puede anularlo.');
  end if;
  if not v_confirmed and not public.erp_can_any(o.store_id, array['sales_void', 'sales_return']::text[]) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Necesitas el permiso «Anular documentos sin confirmar».');
  end if;

  if exists (select 1 from public.fiscal_documents f
             where f.store_id = o.store_id and f.source_id = o.id
               and (f.status in ('ACCEPTED', 'SENT', 'PROCESSING', 'CANCEL_PENDING') or (f.status = 'ERROR' and f.sent_at is not null))) then
    return jsonb_build_object('ok', false, 'code', 'FISCAL_TRANSMITTED',
      'message', 'La factura electrónica de ' || v_label || ' ya se envió a la DIAN. Anúlala con una nota crédito en Facturación electrónica.');
  end if;

  if exists (select 1 from public.erp_receivables rc
             join public.erp_receivable_payments pp on pp.receivable_id = rc.id and not coalesce(pp.voided, false)
             where rc.order_id = o.id and rc.status <> 'void') then
    return jsonb_build_object('ok', false, 'code', 'HAS_PAYMENTS',
      'message', v_label || ' tiene abonos registrados en Cartera. Anula primero esos abonos y vuelve a intentarlo.');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('product_id', oi.product_id, 'name', p.name, 'qty', oi.quantity, 'price', oi.price)), '[]'::jsonb)
    into v_items
  from public.order_items oi left join public.products p on p.id = oi.product_id
  where oi.order_id = o.id;

  if v_confirmed then
    for r in
      select im.product_id, im.warehouse_id,
             sum(case when im.kind = 'out' then im.qty else -im.qty end)::integer as net
      from public.inventory_movements im
      where im.store_id = o.store_id
        and (im.order_id = o.id or (im.ref_id = o.id and coalesce(im.ref_type, '') in ('order', 'sale', 'document')))
        and coalesce(im.movement_type, '') in ('sale', 'sale_return')
        and im.warehouse_id is not null
      group by im.product_id, im.warehouse_id
      having sum(case when im.kind = 'out' then im.qty else -im.qty end) > 0
    loop
      perform public.erp__move(o.store_id, r.warehouse_id, r.product_id, r.net, 'sale_return', 'order', o.id, null,
        'Devolución de venta ' || v_label, v_reason, true);
      v_units := v_units + r.net;
    end loop;
    delete from public.erp_order_stock where order_id = o.id;
  end if;

  update public.erp_receivables
  set status = 'void', balance = 0, void_reason = 'Documento anulado: ' || v_reason, updated_at = now()
  where order_id = o.id and status <> 'void';
  get diagnostics v_receivables = row_count;

  update public.fiscal_documents
  set status = 'VOID', voided_at = now(), void_reason = 'Documento de venta anulado: ' || v_reason
  where store_id = o.store_id and source_id = o.id and status in ('DRAFT', 'READY', 'QUEUED', 'ERROR', 'REJECTED');
  get diagnostics v_fiscal = row_count;

  -- ÚNICO CAMBIO: la regla ORDER_LOCKED deja pasar esta anulación (ya validada arriba).
  perform set_config('erp.sale_void', '1', true);
  update public.orders
  set status = 'cancelled', stock_applied = false, cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = v_reason
  where id = o.id;
  perform set_config('erp.sale_void', '', true);

  select coalesce(nullif(trim(su.display_name), ''), nullif(trim(su.username), ''), 'Usuario') into v_name
  from public.store_users su where su.store_id = o.store_id and su.user_id = auth.uid();
  if v_name is null and exists (select 1 from public.stores st where st.id = o.store_id and st.owner_id = auth.uid()) then
    v_name := 'Dueño';
  end if;

  insert into public.erp_sale_voids (store_id, order_id, point_id, kind, doc_kind, doc_number, status_before, total, units_returned,
                                     reason, detail, created_by, created_by_name)
  values (o.store_id, o.id, m.point_id, v_kind, m.doc_kind, v_label, o.status, coalesce(o.total, 0), v_units, v_reason,
          jsonb_build_object('items', v_items, 'receivables_voided', v_receivables, 'fiscal_voided', v_fiscal),
          auth.uid(), coalesce(v_name, 'Administrador'));

  perform public.erp__audit_insert(o.store_id, m.point_id, 'ops', 'warning',
    case when v_kind = 'return' then 'sale.returned' else 'sale.voided' end, 'orders', o.id,
    jsonb_build_object('status', o.status, 'total', o.total), jsonb_build_object('status', 'cancelled', 'units_returned', v_units),
    v_reason, jsonb_build_object('doc_number', v_label));

  return jsonb_build_object('ok', true, 'kind', v_kind, 'doc_number', v_label, 'units_returned', v_units,
                            'receivables_voided', v_receivables, 'fiscal_voided', v_fiscal);
end;
$function$;

-- ================================================================ 2. COSTO Y UNIDADES SOLO POR MOVIMIENTOS
-- Los usuarios ya no pueden escribir cost_price ni stock directamente (las funciones de compras,
-- ajustes, traslados y ventas sí, porque corren con permisos del sistema y dejan kardex).
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'products' and column_name not in ('cost_price', 'stock');
  revoke update on public.products from authenticated;
  execute format('grant update (%s) on public.products to authenticated', cols);
end $$;

-- ================================================================ 3. PRECIOS POR PORCENTAJE
alter table public.products add column if not exists markup_1 numeric(9, 4);
alter table public.products add column if not exists markup_2 numeric(9, 4);
alter table public.products add column if not exists markup_3 numeric(9, 4);
alter table public.products add column if not exists markup_4 numeric(9, 4);
alter table public.products add column if not exists markup_5 numeric(9, 4);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_markup_range') then
    alter table public.products add constraint products_markup_range check (
      coalesce(markup_1, 0) between 0 and 1000 and coalesce(markup_2, 0) between 0 and 1000 and coalesce(markup_3, 0) between 0 and 1000
      and coalesce(markup_4, 0) between 0 and 1000 and coalesce(markup_5, 0) between 0 and 1000);
  end if;
end $$;
-- La columna nueva también se puede editar (el % de ganancia).
grant update (markup_1, markup_2, markup_3, markup_4, markup_5) on public.products to authenticated;

alter table public.erp_profit_settings add column if not exists product_round_step integer not null default 100;
alter table public.erp_profit_settings add column if not exists product_round_dir text not null default 'nearest';
alter table public.erp_profit_settings add column if not exists default_markup numeric(9, 4) not null default 15;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'erp_profit_settings_product_round') then
    alter table public.erp_profit_settings add constraint erp_profit_settings_product_round check (
      product_round_step in (0, 1, 50, 100, 500, 1000) and product_round_dir in ('nearest', 'up', 'down') and default_markup between 0 and 1000);
  end if;
end $$;

-- Precio = costo × (1 + %), redondeado según la tienda. Solo si hay costo y el nivel tiene %.
create or replace function public.erp__product_autoprice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_step integer := 100; v_dir text := 'nearest'; v_changed boolean;
begin
  if coalesce(current_setting('erp.skip_reprice', true), '') = '1' then return new; end if;
  if coalesce(new.cost_price, 0) <= 0 then return new; end if;
  if new.markup_1 is null and new.markup_2 is null and new.markup_3 is null and new.markup_4 is null and new.markup_5 is null then return new; end if;
  v_changed := tg_op = 'INSERT'
    or new.cost_price is distinct from old.cost_price
    or new.markup_1 is distinct from old.markup_1 or new.markup_2 is distinct from old.markup_2 or new.markup_3 is distinct from old.markup_3
    or new.markup_4 is distinct from old.markup_4 or new.markup_5 is distinct from old.markup_5;
  if not v_changed then return new; end if;
  select coalesce(s.product_round_step, 100), coalesce(s.product_round_dir, 'nearest') into v_step, v_dir from public.erp_profit_settings s where s.store_id = new.store_id;
  v_step := coalesce(v_step, 100); v_dir := coalesce(v_dir, 'nearest');
  if new.markup_1 is not null then new.price_1 := public.erp__round_step(new.cost_price * (1 + new.markup_1 / 100), v_step, v_dir); end if;
  if new.markup_2 is not null then new.price_2 := public.erp__round_step(new.cost_price * (1 + new.markup_2 / 100), v_step, v_dir); end if;
  if new.markup_3 is not null then new.price_3 := public.erp__round_step(new.cost_price * (1 + new.markup_3 / 100), v_step, v_dir); end if;
  if new.markup_4 is not null then new.price_4 := public.erp__round_step(new.cost_price * (1 + new.markup_4 / 100), v_step, v_dir); end if;
  if new.markup_5 is not null then new.price_5 := public.erp__round_step(new.cost_price * (1 + new.markup_5 / 100), v_step, v_dir); end if;
  new.price_retail := new.price_3;
  new.price_wholesale := new.price_2;
  return new;
end;
$$;
drop trigger if exists erp_products_autoprice on public.products;
create trigger erp_products_autoprice before insert or update on public.products
for each row execute function public.erp__product_autoprice();

create or replace function public.erp_product_pricing_get(p_store uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.erp__is_store_member(p_store) then jsonb_build_object(
    'round_step', coalesce((select product_round_step from public.erp_profit_settings where store_id = p_store), 100),
    'round_dir', coalesce((select product_round_dir from public.erp_profit_settings where store_id = p_store), 'nearest'),
    'default_markup', coalesce((select default_markup from public.erp_profit_settings where store_id = p_store), 15),
    'can_edit', public.erp_can(p_store, 'products') and public.erp_my_points(p_store) is null)
  else null end;
$$;
revoke all on function public.erp_product_pricing_get(uuid) from public, anon;
grant execute on function public.erp_product_pricing_get(uuid) to authenticated;

create or replace function public.erp_product_pricing_save(p_store uuid, p_round_step integer, p_round_dir text, p_default_markup numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.erp_can(p_store, 'products') or public.erp_my_points(p_store) is not null then raise exception 'Solo la madre (permiso Productos) cambia el redondeo de precios.'; end if;
  insert into public.erp_profit_settings (store_id, product_round_step, product_round_dir, default_markup, updated_by, updated_by_name)
  values (p_store, p_round_step, p_round_dir, p_default_markup, auth.uid(), public.erp_actor_name(p_store))
  on conflict (store_id) do update set product_round_step = excluded.product_round_step, product_round_dir = excluded.product_round_dir,
    default_markup = excluded.default_markup, updated_by = excluded.updated_by, updated_by_name = excluded.updated_by_name, updated_at = now();
  perform public.erp_audit(p_store, 'product_pricing.settings', 'erp_profit_settings', null,
    jsonb_build_object('round_step', p_round_step, 'round_dir', p_round_dir, 'default_markup', p_default_markup));
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.erp_product_pricing_save(uuid, integer, text, numeric) from public, anon;
grant execute on function public.erp_product_pricing_save(uuid, integer, text, numeric) to authenticated;

-- Existencias de un producto en cada punto/bodega (solo lectura).
create or replace function public.erp_product_stock_by_point(p_product uuid)
returns table (warehouse_id uuid, name text, kind text, qty integer, updated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare v_store uuid;
begin
  select store_id into v_store from public.products where id = p_product;
  if v_store is null then raise exception 'Producto no encontrado.'; end if;
  if not (public.erp_can(v_store, 'products') or public.erp_can(v_store, 'products_view') or public.erp_can(v_store, 'inventory')
          or public.erp_can(v_store, 'pos') or public.erp_can(v_store, 'purchases')) then
    raise exception 'No tienes permiso para ver las existencias.';
  end if;
  return query
    select w.id, w.name::text, coalesce(w.kind, 'warehouse')::text, coalesce(l.qty, 0)::integer, l.updated_at
    from public.erp_warehouses w
    left join public.erp_stock_levels l on l.warehouse_id = w.id and l.product_id = p_product
    where w.store_id = v_store and w.active
    order by coalesce(l.qty, 0) desc, w.name;
end;
$$;
revoke all on function public.erp_product_stock_by_point(uuid) from public, anon;
grant execute on function public.erp_product_stock_by_point(uuid) to authenticated;

-- ================================================================ 4. ALERTAS DE PRODUCTOS SIN INGRESO
create or replace function public.erp_products_pending_entry(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.erp_can(p_store, 'inventory_alerts') then return jsonb_build_object('ok', false, 'rows', '[]'::jsonb); end if;
  return jsonb_build_object('ok', true, 'rows', coalesce((
    select jsonb_agg(x order by x.created_at) from (
      select p.id, p.name, p.sku, p.image_url, p.created_at,
             round(extract(epoch from (now() - p.created_at)) / 3600, 1) as hours
      from public.products p
      where p.store_id = p_store
        and p.created_at < now() - interval '1 hour'
        and coalesce(p.cost_price, 0) = 0
        and coalesce(p.stock, 0) <= 0
        and not exists (select 1 from public.erp_purchase_items pi where pi.product_id = p.id)
      order by p.created_at
      limit 50) x), '[]'::jsonb));
end;
$$;
revoke all on function public.erp_products_pending_entry(uuid) from public, anon;
grant execute on function public.erp_products_pending_entry(uuid) to authenticated;

notify pgrst, 'reload schema';
