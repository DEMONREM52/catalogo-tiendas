-- =====================================================================
-- REMHUB · Cargar la factura del proveedor desde el XML de la DIAN
--
--   El navegador lee el XML (o el ZIP que llega al correo) y la base ayuda a
--   reconocer lo que trae:
--   1. erp_purchase_xml_match: el proveedor por NIT, si esa factura ya se
--      ingresó, y para cada línea el producto de la tienda (por el código que
--      ya se aprendió de ese proveedor, código de barras, SKU o nombre igual).
--   2. erp_supplier_item_map: lo que el usuario empareja una vez queda
--      aprendido: la próxima factura de ese proveedor llega sola.
--   3. erp_purchase_xml_supplier: crea el proveedor con los datos del XML si
--      no existe (por NIT).
--   La compra se guarda igual que siempre (erp_receive_invoice).
-- No borra datos. Es idempotente.
-- =====================================================================

create table if not exists public.erp_supplier_item_map (
  store_id uuid not null references public.stores(id) on delete cascade,
  supplier_id uuid not null references public.erp_suppliers(id) on delete cascade,
  supplier_code text not null,
  product_id uuid not null references public.products(id) on delete cascade,
  description text,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (supplier_id, supplier_code)
);
create index if not exists erp_supplier_item_map_store on public.erp_supplier_item_map (store_id);
alter table public.erp_supplier_item_map enable row level security;
drop policy if exists erp_supplier_item_map_read on public.erp_supplier_item_map;
create policy erp_supplier_item_map_read on public.erp_supplier_item_map for select to authenticated
  using (public.erp_can(store_id, 'purchases'));

-- Solo dígitos (el NIT viene con puntos, guion o dígito de verificación según quién lo escriba).
create or replace function public.erp__nit_digits(p text)
returns text language sql immutable as $$ select nullif(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '') $$;

-- Mismo nombre sin tildes, mayúsculas ni signos.
create or replace function public.erp__norm_name(p text)
returns text language sql immutable as $$
  select btrim(regexp_replace(upper(translate(coalesce(p, ''), 'áéíóúüñÁÉÍÓÚÜÑàèìòùÀÈÌÒÙ', 'aeiouunAEIOUUNaeiouAEIOU')), '[^A-Z0-9]+', ' ', 'g'))
$$;

-- ---------------------------------------------------------------- 1. reconocer
create or replace function public.erp_purchase_xml_match(p_store uuid, p_nit text, p_invoice_ref text, p_lines jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_nit text := public.erp__nit_digits(p_nit);
  v_sup public.erp_suppliers;
  v_dup jsonb;
  v_lines jsonb;
begin
  if auth.uid() is null or not public.erp_can(p_store, 'purchases') then
    return jsonb_build_object('ok', false, 'message', 'Necesitas el permiso de compras.');
  end if;
  if jsonb_typeof(coalesce(p_lines, 'null')) <> 'array' or jsonb_array_length(p_lines) > 1000 then
    return jsonb_build_object('ok', false, 'message', 'Las líneas de la factura no son válidas.');
  end if;

  -- El NIT puede estar guardado con o sin dígito de verificación.
  select * into v_sup from public.erp_suppliers s
  where s.store_id = p_store and v_nit is not null
    and (public.erp__nit_digits(s.nit) = v_nit or public.erp__nit_digits(s.nit) = left(v_nit, length(v_nit) - 1)
         or left(public.erp__nit_digits(s.nit), length(public.erp__nit_digits(s.nit)) - 1) = v_nit)
  order by s.active desc, (public.erp__nit_digits(s.nit) = v_nit) desc, s.created_at
  limit 1;

  if v_sup.id is not null and nullif(btrim(p_invoice_ref), '') is not null then
    select jsonb_build_object('id', pu.id, 'number', pu.number, 'created_at', pu.created_at) into v_dup
    from public.erp_purchases pu
    where pu.store_id = p_store and pu.supplier_id = v_sup.id and pu.status <> 'cancelled'
      and upper(regexp_replace(coalesce(pu.invoice_ref, ''), '\s', '', 'g')) = upper(regexp_replace(p_invoice_ref, '\s', '', 'g'))
    order by pu.created_at desc limit 1;
  end if;

  with l as (
    select (e.ord - 1)::integer as idx, nullif(btrim(e.v->>'seller_code'), '') as seller, nullif(btrim(e.v->>'standard_code'), '') as std,
           public.erp__norm_name(e.v->>'description') as nname
    from jsonb_array_elements(p_lines) with ordinality as e(v, ord)
  ),
  hit as (
    select l.idx, m.product_id, m.how from l
    left join lateral (
      select x.product_id, x.how from (
        select mp.product_id, 'learned'::text as how, 1 as rank from public.erp_supplier_item_map mp
          where v_sup.id is not null and mp.supplier_id = v_sup.id and mp.supplier_code in (l.seller, l.std)
        union all
        select p.id, 'barcode', 2 from public.products p where p.store_id = p_store and p.barcode is not null and p.barcode in (l.std, l.seller)
        union all
        select p.id, 'sku', 3 from public.products p where p.store_id = p_store and p.sku is not null and upper(p.sku) in (upper(l.seller), upper(l.std))
        union all
        select p.id, 'name', 4 from public.products p where p.store_id = p_store and l.nname <> '' and public.erp__norm_name(p.name) = l.nname
      ) x order by x.rank limit 1
    ) m on true
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'idx', h.idx, 'how', h.how, 'product_id', p.id, 'name', p.name, 'sku', p.sku, 'tax_rate', p.tax_rate,
           'stock', (select coalesce(sum(sl.qty), 0) from public.erp_stock_levels sl where sl.product_id = p.id and sl.store_id = p_store))
         order by h.idx), '[]'::jsonb)
    into v_lines
  from hit h left join public.products p on p.id = h.product_id;

  return jsonb_build_object(
    'ok', true,
    'supplier', case when v_sup.id is null then null else jsonb_build_object('id', v_sup.id, 'name', v_sup.name, 'nit', v_sup.nit, 'payment_days', v_sup.payment_days, 'active', v_sup.active) end,
    'duplicate', v_dup,
    'lines', v_lines
  );
end;
$$;

-- ---------------------------------------------------------------- 2. aprender códigos
create or replace function public.erp_supplier_item_map_save(p_store uuid, p_supplier uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if auth.uid() is null or not public.erp_can(p_store, 'purchases') then
    return jsonb_build_object('ok', false, 'message', 'Necesitas el permiso de compras.');
  end if;
  if not exists (select 1 from public.erp_suppliers where id = p_supplier and store_id = p_store) then
    return jsonb_build_object('ok', false, 'message', 'El proveedor no es de esta tienda.');
  end if;
  insert into public.erp_supplier_item_map (store_id, supplier_id, supplier_code, product_id, description, updated_by, updated_at)
  select p_store, p_supplier, x.code, x.product_id, left(x.description, 200), auth.uid(), now()
  from (
    select distinct on (btrim(e->>'code')) btrim(e->>'code') as code, (e->>'product_id')::uuid as product_id, e->>'description' as description
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e
    where nullif(btrim(e->>'code'), '') is not null and e->>'product_id' is not null
  ) x
  join public.products p on p.id = x.product_id and p.store_id = p_store
  on conflict (supplier_id, supplier_code) do update
    set product_id = excluded.product_id, description = excluded.description, updated_by = excluded.updated_by, updated_at = now();
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'saved', n);
end;
$$;

-- ---------------------------------------------------------------- 3. proveedor desde el XML
create or replace function public.erp_purchase_xml_supplier(p_store uuid, p_nit text, p_name text, p_email text default null, p_phone text default null, p_address text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nit text := public.erp__nit_digits(p_nit);
  v_id uuid;
begin
  if auth.uid() is null or not public.erp_can(p_store, 'purchases') then
    return jsonb_build_object('ok', false, 'message', 'Necesitas el permiso de compras.');
  end if;
  if v_nit is null or nullif(btrim(p_name), '') is null then
    return jsonb_build_object('ok', false, 'message', 'El XML no trae el NIT o el nombre del proveedor.');
  end if;
  select id into v_id from public.erp_suppliers where store_id = p_store and public.erp__nit_digits(nit) = v_nit limit 1;
  if v_id is null then
    insert into public.erp_suppliers (store_id, name, nit, email, phone, address)
    values (p_store, left(upper(btrim(p_name)), 160), v_nit, nullif(btrim(p_email), ''), nullif(btrim(p_phone), ''), nullif(btrim(p_address), ''))
    returning id into v_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke all on function public.erp_purchase_xml_match(uuid, text, text, jsonb) from public, anon;
revoke all on function public.erp_supplier_item_map_save(uuid, uuid, jsonb) from public, anon;
revoke all on function public.erp_purchase_xml_supplier(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.erp_purchase_xml_match(uuid, text, text, jsonb) to authenticated;
grant execute on function public.erp_supplier_item_map_save(uuid, uuid, jsonb) to authenticated;
grant execute on function public.erp_purchase_xml_supplier(uuid, text, text, text, text, text) to authenticated;
grant select on public.erp_supplier_item_map to authenticated;
