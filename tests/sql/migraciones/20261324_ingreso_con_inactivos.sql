-- =====================================================================
-- REMHUB · Ingresos de mercancía: buscar también productos inactivos
--
-- Problema: un producto inactivado a mano no salía en el buscador del
-- ingreso, así que no se podía registrar que volvió a llegar.
--
-- erp_search_products recibe p_include_inactive (por defecto false):
--   · false → igual que antes (activos + los apagados solos por falta de
--     unidades, 20261210). El POS, traslados, pedidos, etc. no cambian.
--   · true  → también los inactivos a mano, pero SOLO si quien busca tiene
--     el permiso de Ingresos, Inventario o Productos. Si no, se ignora.
-- Además devuelve active y auto_inactive, para que la pantalla los marque
-- («🙈 Inactivo» / «se activa solo al registrar»).
--
-- Activar un producto sigue siendo editar el producto (permiso de
-- Productos, revisado por la base como siempre). No cambia permisos ni
-- datos. Es idempotente.
-- Para volver atrás: correr de nuevo la función de 20261204 + el parche
-- de 20261210 (y borrar esta versión de 6 argumentos).
-- =====================================================================

drop function if exists public.erp_search_products(uuid, text, uuid, boolean, integer);

create or replace function public.erp_search_products(p_store uuid, p_q text, p_warehouse uuid default null::uuid, p_in_stock boolean default false,
  p_limit integer default 20, p_include_inactive boolean default false)
returns table(id uuid, name text, sku text, barcode text, cost_price numeric, tax_rate numeric, stock integer, wh_qty integer, product_no integer,
  active boolean, auto_inactive boolean)
language plpgsql stable security definer set search_path to 'public', 'extensions' as $function$
declare
  v_all boolean;
begin
  if not public.erp_can_any(p_store, array['inventory', 'purchases', 'transfers', 'inventory_adjust', 'pos', 'stock_requests',
                                           'stock_requests_manage', 'products', 'products_view']::text[]) then
    raise exception 'No tienes permiso para consultar productos.';
  end if;
  -- Los inactivos a mano solo para quien registra mercancía o edita productos.
  v_all := coalesce(p_include_inactive, false)
           and public.erp_can_any(p_store, array['purchases', 'inventory', 'products']::text[]);
  return query
    with q as materialized (
      select public.product__tokens(p_q) as tokens, public.product__code_key(p_q) as code,
             public.erp__norm_text(btrim(coalesce(p_q, ''))) as norm
    )
    select p.id, p.name::text, p.sku::text, p.barcode::text, coalesce(p.cost_price, 0)::numeric, coalesce(p.tax_rate, 0)::numeric,
           coalesce(p.stock, 0)::integer, coalesce(l.qty, 0)::integer, p.product_no,
           coalesce(p.active, true), coalesce(p.auto_inactive, false)
    from q
    cross join public.products p
    left join public.erp_stock_levels l on l.product_id = p.id and l.warehouse_id = p_warehouse
    where p.store_id = p_store and (coalesce(p.active, true) or p.auto_inactive or v_all)
      and (cardinality(q.tokens) = 0
           or public.product__code_hit(p.sku, p.barcode, p.product_no, q.code)
           or public.product__has_tokens(public.product__haystack(p.name, p.sku, p.barcode, null), q.tokens)
           or (length(q.norm) >= 4 and public.product__fuzzy(q.norm, public.erp__norm_text(p.name)) >= 0.5))
      and (not p_in_stock or coalesce(l.qty, 0) > 0)
    order by (case
                when cardinality(q.tokens) = 0 then 0
                when public.product__code_hit(p.sku, p.barcode, p.product_no, q.code) then 100
                when public.erp__norm_text(p.name) = q.norm then 90
                when public.erp__norm_text(p.name) like q.norm || '%' then 70
                when public.product__has_tokens(public.erp__norm_text(p.name), q.tokens) then 50
                when public.product__has_tokens(public.product__haystack(p.name, p.sku, p.barcode, null), q.tokens) then 40
                else 10 + 20 * public.product__fuzzy(q.norm, public.erp__norm_text(p.name))
              end)::real desc, (coalesce(p.active, true) or p.auto_inactive) desc, p.name
    limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$function$;

-- Igual que las demás funciones del panel (20261238): solo con sesión.
revoke execute on function public.erp_search_products(uuid, text, uuid, boolean, integer, boolean) from public, anon;
grant execute on function public.erp_search_products(uuid, text, uuid, boolean, integer, boolean) to authenticated;

notify pgrst, 'reload schema';
