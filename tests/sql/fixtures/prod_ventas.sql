-- Copia de funciones de PRODUCCIÓN (consulta_funciones_ventas.sql, 2026-10-14) para probar sobre la lógica real.
alter table public.store_users add column if not exists point_ids uuid[];
alter table public.orders add column if not exists customer_note text;
alter table public.orders add column if not exists confirmed_at timestamptz;
alter table public.orders add column if not exists stock_applied boolean default false;
create table if not exists public.erp_order_stock (order_id uuid primary key, store_id uuid not null, warehouse_id uuid, applied_at timestamptz not null default now());
create table if not exists public.store_catalog_products (catalog_id uuid, product_id uuid, store_id uuid, included boolean default true, price_override numeric);
create table if not exists public.product_category_links (product_id uuid, category_id uuid, store_id uuid);
alter table public.products add column if not exists category_id uuid;
alter table public.store_catalog_orders add column if not exists catalog_name text;

create or replace function public.catalog__price(p_product public.products, p_level integer)
returns numeric language sql immutable as $$
  select case p_level when 1 then p_product.price_1 when 2 then p_product.price_2 when 4 then p_product.price_4 when 5 then p_product.price_5 else p_product.price_3 end;
$$;

create or replace function public.erp_my_points(p_store uuid)
returns uuid[] language sql stable security definer set search_path to 'public' as $$
  select case when su.point_id is null then null
           else array(select distinct x from unnest(array_prepend(su.point_id, coalesce(su.point_ids, '{}'::uuid[]))) as x where x is not null) end
  from public.store_users su
  where su.store_id = p_store and su.user_id = auth.uid() and su.active and su.role <> 'store_admin'
    and not exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
    and not exists (select 1 from public.user_profiles up where up.user_id = auth.uid() and up.role = 'admin')
  limit 1;
$$;

create or replace function public.erp_point_allowed(p_store uuid, p_point uuid)
returns boolean language plpgsql stable security definer set search_path to 'public' as $$
declare v uuid[] := public.erp_my_points(p_store);
begin
  if v is null then return true; end if;
  return p_point is not null and p_point = any (v);
end;
$$;

create or replace function public.create_order_from_cart(p_store_id uuid, p_catalog_type text, p_items jsonb, p_customer_name text, p_customer_note text default null, p_customer_whatsapp text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_order_id uuid; v_token text; v_total numeric := 0; v_bad_name text;
begin
  if p_store_id is null then raise exception 'STORE_ID_REQUIRED'; end if;
  if p_catalog_type not in ('retail','wholesale') then raise exception 'INVALID_CATALOG_TYPE'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'ITEMS_REQUIRED'; end if;
  if coalesce(trim(p_customer_name),'') = '' then raise exception 'CUSTOMER_NAME_REQUIRED'; end if;
  with req as (select (x->>'product_id')::uuid as product_id, greatest(1, (x->>'qty')::int) as qty from jsonb_array_elements(p_items) x),
  agg as (select product_id, sum(qty)::int as need from req group by 1)
  select p.name into v_bad_name from agg a join public.products p on p.id = a.product_id
  where p.store_id = p_store_id and p.active = true and p.stock is not null and p.stock < a.need limit 1;
  if v_bad_name is not null then raise exception 'OUT_OF_STOCK' using detail = v_bad_name; end if;
  v_token := replace(gen_random_uuid()::text, '-', '');
  insert into public.orders(store_id, catalog_type, status, total, token, customer_name, customer_note, customer_whatsapp)
  values (p_store_id, p_catalog_type, 'draft', 0, v_token, trim(p_customer_name), nullif(trim(p_customer_note),''), nullif(trim(p_customer_whatsapp),''))
  returning id into v_order_id;
  insert into public.order_items(order_id, product_id, quantity, price)
  select v_order_id, (x->>'product_id')::uuid, greatest(1, (x->>'qty')::int), coalesce((x->>'price')::numeric, 0) from jsonb_array_elements(p_items) as x;
  select coalesce(sum(quantity * price), 0) into v_total from public.order_items where order_id = v_order_id;
  update public.orders set total = v_total where id = v_order_id;
  return jsonb_build_object('token', v_token, 'order_id', v_order_id, 'total', v_total);
end;
$$;

create or replace function public.erp__sale_out(p_store uuid, p_wh uuid, p_product uuid, p_qty integer, p_order uuid, p_note text, p_touch_total boolean)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_avail integer;
begin
  select coalesce(qty, 0) into v_avail from public.erp_stock_levels where warehouse_id = p_wh and product_id = p_product;
  if coalesce(v_avail, 0) < p_qty then raise exception 'No hay unidades suficientes'; end if;
  perform public.erp__move(p_store, p_wh, p_product, -p_qty, 'sale', 'order', p_order, null, p_note, null, p_touch_total);
end;
$$;

-- Versión simplificada de erp__apply_order_stock (misma salida: descuenta y registra erp_order_stock).
create or replace function public.erp__apply_order_stock(p_order uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare o record; v_wh uuid; it record;
begin
  if exists (select 1 from public.erp_order_stock where order_id = p_order) then return; end if;
  select id, store_id, receipt_no into o from public.orders where id = p_order;
  select m.point_id into v_wh from public.erp_order_meta m where m.order_id = p_order;
  v_wh := coalesce(v_wh, public.erp_ensure_default_warehouse(o.store_id));
  for it in select oi.product_id, sum(oi.quantity)::integer as qty from public.order_items oi where oi.order_id = p_order group by oi.product_id loop
    perform public.erp__sale_out(o.store_id, v_wh, it.product_id, it.qty, p_order, 'Venta', true);
  end loop;
  insert into public.erp_order_stock (order_id, store_id, warehouse_id) values (p_order, o.store_id, v_wh);
end;
$$;

create or replace function public.erp__sale_lines(p_store uuid, p_from timestamptz, p_to timestamptz, p_point uuid)
returns table(order_id uuid, sold_at timestamptz, point_id uuid, seller_name text, catalog_id uuid, catalog_name text, channel text, customer_name text, product_id uuid, qty integer, revenue numeric, cost numeric)
language sql stable security definer set search_path to 'public' as $$
  select o.id, coalesce(o.confirmed_at, o.created_at), m.point_id, nullif(btrim(m.seller_name), ''), co.catalog_id, co.catalog_name,
         case when co.order_id is not null then 'catalog' when m.doc_number is not null or m.seller_name is not null then 'pos'
              when o.catalog_type = 'wholesale' then 'wholesale' else 'retail' end,
         nullif(upper(btrim(coalesce(o.customer_name, ''))), ''), oi.product_id, oi.quantity, oi.quantity * oi.price, oi.quantity * coalesce(p.cost_price, 0)
  from public.orders o
  join public.order_items oi on oi.order_id = o.id
  left join public.products p on p.id = oi.product_id
  left join public.erp_order_meta m on m.order_id = o.id
  left join public.store_catalog_orders co on co.order_id = o.id
  where o.store_id = p_store and o.status in ('confirmed', 'completed')
    and coalesce(o.confirmed_at, o.created_at) >= p_from and coalesce(o.confirmed_at, o.created_at) < p_to
    and (p_point is null or m.point_id = p_point);
$$;

-- Catálogos (columnas usadas por catalog__items en producción).
alter table public.store_catalogs add column if not exists price_level integer default 3;
alter table public.store_catalogs add column if not exists fallback_price_level integer;
alter table public.store_catalogs add column if not exists include_all_products boolean default true;
alter table public.store_catalog_products add column if not exists catalog_category_id uuid;
alter table public.store_catalog_products add column if not exists featured boolean default false;
alter table public.store_catalog_products add column if not exists sort_order integer default 0;
create table if not exists public.store_catalog_categories (id uuid primary key default gen_random_uuid(), catalog_id uuid, store_id uuid, category_id uuid, visible boolean default true);

-- erp_tag_order de producción (2026-10-14).
create or replace function public.erp_tag_order(p_store uuid, p_token text, p_point uuid, p_seller uuid, p_kind text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_order uuid; v_meta public.erp_order_meta; v_prefix text; v_seq bigint; v_name text; v_num text; v_wh public.erp_warehouses;
begin
  if not public.erp_can(p_store, 'pos') then raise exception 'No tienes permiso para facturar.'; end if;
  if p_kind not in ('factura', 'remision') then raise exception 'Tipo de documento inválido.'; end if;
  select id into v_order from public.orders where token = p_token and store_id = p_store;
  if not found then raise exception 'Pedido no encontrado.'; end if;
  select * into v_meta from public.erp_order_meta where order_id = v_order;
  if found then return jsonb_build_object('doc_number', v_meta.doc_number, 'seller_name', v_meta.seller_name); end if;
  select * into v_wh from public.erp_warehouses where id = p_point and store_id = p_store and active for update;
  if not found then raise exception 'Elige un punto de venta válido.'; end if;
  if p_seller is not null then
    select name into v_name from public.erp_sellers(p_store) where user_id = p_seller limit 1;
    if v_name is null then raise exception 'El vendedor elegido no es válido.'; end if;
  else
    v_name := public.erp_actor_name(p_store);
    p_seller := auth.uid();
  end if;
  if p_kind = 'factura' then
    v_prefix := v_wh.invoice_prefix; v_seq := v_wh.next_invoice_number;
    update public.erp_warehouses set next_invoice_number = next_invoice_number + 1 where id = v_wh.id;
  else
    v_prefix := v_wh.remision_prefix; v_seq := v_wh.next_remision_number;
    update public.erp_warehouses set next_remision_number = next_remision_number + 1 where id = v_wh.id;
  end if;
  v_num := case when coalesce(v_prefix, '') = '' then lpad(v_seq::text, 5, '0') else v_prefix || '-' || lpad(v_seq::text, 5, '0') end;
  insert into public.erp_order_meta (order_id, store_id, point_id, seller_id, seller_name, doc_kind, doc_prefix, doc_seq, doc_number, created_by, created_by_name)
  values (v_order, p_store, p_point, p_seller, v_name, p_kind, v_prefix, v_seq, v_num, auth.uid(), public.erp_actor_name(p_store));
  perform public.erp_audit(p_store, 'sale.tagged', 'orders', v_order, jsonb_build_object('doc_number', v_num, 'point', v_wh.name, 'seller', v_name, 'kind', p_kind));
  return jsonb_build_object('doc_number', v_num, 'seller_name', v_name);
end;
$function$;
