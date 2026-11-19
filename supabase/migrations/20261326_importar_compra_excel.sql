-- =====================================================================
-- REMHUB · Ingresos: cargar la factura del proveedor desde Excel o CSV
--
-- El navegador lee el archivo (código, descripción, cantidad, costo) y la
-- base reconoce cada línea con la misma lógica que se usó para la remisión
-- 30947, en este orden:
--   1. learned   · el código ya se aprendió de ese proveedor (20261246/25)
--   2. sku       · un producto tiene ese mismo código
--   3. barcode   · un producto tiene ese código de barras
--   4. name_code · el código aparece como palabra en el nombre de UN solo
--                  producto (ej. 88130 → «CLOSET ARMABLE DE TELA 88130»)
--   5. name      · un producto con el mismo nombre (sin tildes ni signos)
-- Si el código está en el nombre de varios productos, no elige: devuelve
-- los candidatos para que la persona escoja.
-- También dice si la factura ya se ingresó (mismo proveedor y número) y si
-- el código está libre para crear el producto nuevo con él.
--
-- Solo lee. No cambia datos ni permisos. Es idempotente.
-- La compra se registra como siempre (erp_receive_invoice).
-- =====================================================================

create or replace function public.erp_purchase_import_match(p_store uuid, p_supplier uuid, p_invoice_ref text, p_lines jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_sup uuid;
  v_dup jsonb;
  v_lines jsonb;
begin
  if auth.uid() is null or not public.erp_can(p_store, 'purchases') then
    return jsonb_build_object('ok', false, 'message', 'Necesitas el permiso de Ingresos.');
  end if;
  if jsonb_typeof(coalesce(p_lines, 'null')) <> 'array' or jsonb_array_length(p_lines) > 1000 then
    return jsonb_build_object('ok', false, 'message', 'El archivo debe traer entre 1 y 1.000 líneas.');
  end if;
  select id into v_sup from public.erp_suppliers where id = p_supplier and store_id = p_store;

  if v_sup is not null and nullif(btrim(p_invoice_ref), '') is not null then
    select jsonb_build_object('id', pu.id, 'number', pu.number, 'created_at', pu.created_at) into v_dup
    from public.erp_purchases pu
    where pu.store_id = p_store and pu.supplier_id = v_sup and pu.status <> 'cancelled'
      and upper(regexp_replace(coalesce(pu.invoice_ref, ''), '\s', '', 'g')) = upper(regexp_replace(p_invoice_ref, '\s', '', 'g'))
    order by pu.created_at desc limit 1;
  end if;

  with l as (
    select (e.ord - 1)::integer as idx,
           nullif(upper(btrim(regexp_replace(coalesce(e.v->>'code', ''), '\s+', ' ', 'g'))), '') as code,
           public.erp__norm_name(e.v->>'code') as ncode,
           public.erp__norm_name(e.v->>'description') as nname
    from jsonb_array_elements(p_lines) with ordinality as e(v, ord)
  ),
  prods as materialized (
    select p.id, p.name, p.sku, p.barcode, p.tax_rate, coalesce(p.active, true) as active, coalesce(p.auto_inactive, false) as auto_inactive,
           ' ' || public.erp__norm_name(p.name) || ' ' as hay, public.erp__norm_name(p.name) as nname
    from public.products p where p.store_id = p_store
  ),
  hit as (
    select l.idx, l.code, l.ncode,
      coalesce(
        (select jsonb_build_object('id', m.product_id, 'how', 'learned') from public.erp_supplier_item_map m
          where v_sup is not null and m.supplier_id = v_sup and upper(m.supplier_code) = l.code limit 1),
        (select jsonb_build_object('id', p.id, 'how', 'sku') from prods p where l.code is not null and upper(p.sku) = l.code limit 1),
        (select jsonb_build_object('id', p.id, 'how', 'barcode') from prods p where l.code is not null and upper(p.barcode) = l.code limit 1),
        (select case when count(*) = 1 then jsonb_build_object('id', min(p.id::text)::uuid, 'how', 'name_code') end
           from prods p where length(l.ncode) >= 3 and position(' ' || l.ncode || ' ' in p.hay) > 0),
        (select jsonb_build_object('id', p.id, 'how', 'name') from prods p where l.nname <> '' and p.nname = l.nname limit 1)
      ) as m,
      -- Varios productos con el código en el nombre: se muestran para elegir.
      (select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'sku', p.sku) order by p.name)
         from (select * from prods p where length(l.ncode) >= 3 and position(' ' || l.ncode || ' ' in p.hay) > 0 limit 6) p
       having count(*) > 1) as candidates,
      -- ¿Se puede crear el producto nuevo con este mismo código?
      (l.code is not null and not exists (select 1 from prods p where upper(p.sku) = l.code)) as code_free
    from l
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'idx', h.idx, 'how', h.m->>'how', 'product_id', p.id, 'name', p.name, 'sku', p.sku, 'tax_rate', p.tax_rate,
           'active', p.active, 'auto_inactive', p.auto_inactive,
           'stock', case when p.id is null then 0 else (select coalesce(sum(sl.qty), 0) from public.erp_stock_levels sl where sl.product_id = p.id) end,
           'candidates', case when h.m is null then h.candidates end,
           'code_free', h.code_free)
         order by h.idx), '[]'::jsonb)
    into v_lines
  from hit h left join prods p on p.id = (h.m->>'id')::uuid;

  return jsonb_build_object('ok', true, 'supplier_found', v_sup is not null, 'duplicate', v_dup, 'lines', v_lines);
end;
$$;

revoke all on function public.erp_purchase_import_match(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.erp_purchase_import_match(uuid, uuid, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
