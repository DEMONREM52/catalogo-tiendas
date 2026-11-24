-- Pedidos de clientes: buscar los pedidos que llevan un producto.
--
-- Usa las mismas reglas del buscador de productos (20261204/20261325): sin importar tildes ni mayúsculas,
-- por nombre, código, código de barras o número; si nada tiene todas las palabras, los más parecidos
-- (un error de escritura). Una sola consulta en la base en vez de buscar producto por producto desde el navegador.
--
-- · Permiso de Pedidos (orders). Solo pedidos que el usuario puede ver (su punto, erp__order_visible).
-- · Solo lee: no cambia pedidos, productos ni permisos.
-- · Devuelve {ok, items: [{order_id, names[]}]} con los más nuevos primero (tope 5.000 pedidos).

create or replace function public.erp_orders_by_product(p_store uuid, p_q text, p_since timestamptz default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_tokens text[];
  v_code text;
  v_norm text;
  v_ids uuid[];
begin
  if auth.uid() is null or not public.erp_can(p_store, 'orders') then
    return jsonb_build_object('ok', false, 'message', 'Necesitas el permiso de Pedidos.');
  end if;

  v_tokens := public.product__tokens(left(coalesce(p_q, ''), 120));
  v_code := public.product__code_key(left(coalesce(p_q, ''), 120));
  v_norm := public.erp__norm_text(btrim(left(coalesce(p_q, ''), 120)));
  if coalesce(cardinality(v_tokens), 0) = 0 then
    return jsonb_build_object('ok', true, 'items', '[]'::jsonb);
  end if;

  -- 1. Productos con todas las palabras (en nombre, código o código de barras) o con el código exacto.
  select coalesce(array_agg(x.id), '{}') into v_ids
  from (
    select p.id
    from public.products p
    where p.store_id = p_store
      and (public.product__code_hit(p.sku, p.barcode, p.product_no, v_code)
           or public.product__has_tokens(public.product__haystack(p.name, p.sku, p.barcode, null), v_tokens))
    limit 1000
  ) x;

  -- 2. Si ninguno las tiene todas: los más parecidos (un error de escritura), como el buscador de productos.
  if cardinality(v_ids) = 0 and length(v_norm) >= 4 then
    select coalesce(array_agg(x.id), '{}') into v_ids
    from (
      select p.id
      from public.products p
      where p.store_id = p_store
        and public.product__fuzzy(v_norm, public.erp__norm_text(p.name)) >= 0.5
      order by public.product__fuzzy(v_norm, public.erp__norm_text(p.name)) desc, p.name
      limit 30
    ) x;
  end if;

  if cardinality(v_ids) = 0 then
    return jsonb_build_object('ok', true, 'items', '[]'::jsonb);
  end if;

  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object('order_id', h.order_id, 'names', to_jsonb(h.names)) order by h.created_at desc)
    from (
      select o.id as order_id, o.created_at,
             array_agg(distinct p.name::text order by p.name::text) as names
      from public.order_items oi
      join public.orders o on o.id = oi.order_id and o.store_id = p_store
      join public.products p on p.id = oi.product_id
      where oi.product_id = any (v_ids)
        and (p_since is null or o.created_at >= p_since)
        and public.erp__order_visible(p_store, o.id)
      group by o.id, o.created_at
      order by o.created_at desc
      limit 5000
    ) h
  ), '[]'::jsonb));
end;
$$;

revoke execute on function public.erp_orders_by_product(uuid, text, timestamptz) from public, anon;
grant execute on function public.erp_orders_by_product(uuid, text, timestamptz) to authenticated;
