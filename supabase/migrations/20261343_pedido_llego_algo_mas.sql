-- =====================================================================
-- 20261343 · Pedido interno: «Llegó algo que no venía en el envío»
--
-- Antes, al recibir solo se podía anotar más o menos unidades de lo que venía en el traslado
-- (20261281). Si llegaba OTRO producto (p. ej. una máquina que nadie anotó), no había cómo agregarlo.
-- Ahora, mientras el traslado va en camino, quien recibe (o quien atiende) lo agrega:
--   · entra al traslado como si hubiera salido del origen: sale del inventario del origen YA
--     (igual que al despachar) y al confirmar el recibido entra al punto con lo demás;
--   · si al final no llegó, en «Llegó» se pone 0 y vuelve al origen (como cualquier faltante);
--   · el crédito interno y el costo del punto lo cuentan igual que lo demás del traslado;
--   · queda en el pedido marcado «📦 Llegó sin estar en el envío» y en el chat para revisarlo;
--   · como en «llegó de más» (20261281), el origen debe tener esas unidades registradas: si no,
--     no deja y explica qué hacer.
-- No borra datos. Es idempotente.
-- =====================================================================

create or replace function public.erp_sr_receive_extra(p_request uuid, p_product uuid, p_qty int, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.erp_stock_requests; tr public.erp_transfers; v_acc jsonb; v_name text; v_from text; v_have integer;
  v_who text; v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 200); v_item uuid;
begin
  select * into r from public.erp_stock_requests where id = p_request for update;
  if not found then raise exception 'Pedido no encontrado.'; end if;
  v_acc := public.erp__sr_access(r.store_id, r.from_point_id, r.to_point_id);
  if not (coalesce((v_acc ->> 'request')::boolean, false) or coalesce((v_acc ->> 'attend')::boolean, false)) then
    raise exception 'Solo quien recibe o quien atiende el pedido puede anotar lo que llegó.';
  end if;
  if r.status <> 'dispatched' or r.transfer_id is null then
    raise exception 'Solo se anota mientras el pedido va en camino (antes de confirmar el recibido).';
  end if;
  select * into tr from public.erp_transfers where id = r.transfer_id for update;
  if not found or tr.status <> 'in_transit' then
    raise exception 'El traslado de este pedido ya no está en camino.';
  end if;
  if p_qty is null or p_qty < 1 or p_qty > 100000 then raise exception 'Escribe una cantidad válida.'; end if;
  select name into v_name from public.products where id = p_product and store_id = r.store_id;
  if v_name is null then raise exception 'Ese producto no es de la tienda.'; end if;
  if exists (select 1 from public.erp_transfer_items where transfer_id = tr.id and product_id = p_product) then
    raise exception '«%» ya viene en el envío: escribe en «Llegó» cuántas llegaron (pueden ser más de las enviadas).', v_name;
  end if;

  select name into v_from from public.erp_warehouses where id = tr.from_warehouse_id;
  select coalesce(qty, 0) into v_have from public.erp_stock_levels where warehouse_id = tr.from_warehouse_id and product_id = p_product;
  if coalesce(v_have, 0) < p_qty then
    raise exception '% no tiene registradas % und. de «%» (tiene %). Pídeles que hagan primero un ajuste allá, o escríbelo en el chat.',
      coalesce(v_from, 'El origen'), p_qty, v_name, coalesce(v_have, 0);
  end if;
  v_who := public.erp_actor_name(r.store_id);

  -- Al traslado, como si hubiera salido con lo demás (el crédito interno congela su precio al insertarlo).
  insert into public.erp_transfer_items (transfer_id, product_id, qty) values (tr.id, p_product, p_qty);
  perform public.erp__move(tr.store_id, tr.from_warehouse_id, p_product, -p_qty, 'transfer_out', 'transfer', tr.id, null,
    'Traslado #' || tr.number || ' (llegó sin estar en el envío)', v_note, false);

  -- Al pedido, marcado para revisar.
  insert into public.erp_stock_request_items (request_id, product_id, qty_requested, qty_approved, source_qty_at_request, dest_qty_at_request, note)
  values (r.id, p_product, p_qty, p_qty, coalesce(v_have, 0),
          coalesce((select qty from public.erp_stock_levels where warehouse_id = r.from_point_id and product_id = p_product), 0),
          left(concat_ws(' · ', '📦 Llegó sin estar en el envío · lo anotó ' || v_who, v_note), 300))
  returning id into v_item;

  update public.erp_stock_requests set updated_at = now() where id = r.id;
  perform public.erp__sr_system(r.id, '📦 ' || v_who || ' anotó que llegó ' || p_qty || ' × ' || v_name
    || ' que NO venía en el envío. Se descuenta de ' || coalesce(v_from, 'el origen') || ' y entra al confirmar el recibido'
    || case when v_note is not null then ': ' || v_note else '' end || '. ⚠️ Revisen.');
  begin
    perform public.erp_audit(r.store_id, 'stock_request.extra_received', 'erp_stock_requests', r.id,
      jsonb_build_object('number', r.number, 'transfer', tr.number, 'product', v_name, 'product_id', p_product, 'qty', p_qty, 'note', v_note));
  exception when undefined_function then null;
  end;
  return jsonb_build_object('ok', true, 'item_id', v_item);
end $$;
revoke all on function public.erp_sr_receive_extra(uuid, uuid, int, text) from public, anon;
grant execute on function public.erp_sr_receive_extra(uuid, uuid, int, text) to authenticated;

notify pgrst, 'reload schema';
