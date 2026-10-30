-- =====================================================================
-- REMHUB · Pedidos internos: agregar y quitar productos (sobre 20261274)
--
--   · erp_sr_item_add: agrega un producto (o suma unidades si ya está).
--       - Quien pidió (mientras nadie lo ha tomado): sube lo pedido.
--       - Quien atiende: lo agrega a lo que se va a enviar («enviamos más»).
--   · erp_sr_item_remove: quita un producto del pedido.
--   · Se puede mientras no esté firmado «Revisó» y el pedido no haya salido.
--   · Cada cambio queda en el chat del pedido (evidencia) y en la auditoría.
-- No borra datos fuera del pedido. Es idempotente.
-- =====================================================================

-- ¿Se puede cambiar la lista? Devuelve el motivo si no.
create or replace function public.erp__sr_items_lock(r public.erp_stock_requests)
returns text language sql stable security definer set search_path = public as $$
  select case
    when r.status not in ('pending', 'preparing') then 'El pedido ya salió o está cerrado: ya no se pueden cambiar los productos.'
    when exists (select 1 from public.erp_stock_request_signatures s where s.request_id = r.id and s.step in ('sent', 'delivered', 'received'))
      then 'Ya se firmó «Revisó»: para cambiar productos, primero hay que volver a revisar.'
  end;
$$;
revoke all on function public.erp__sr_items_lock(public.erp_stock_requests) from public, anon, authenticated;

/** Agrega un producto al pedido (o suma unidades). */
create or replace function public.erp_sr_item_add(p_request uuid, p_product uuid, p_qty int, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.erp_stock_requests; v_acc jsonb; v_attend boolean; v_request boolean; v_lock text; v_name text; v_item public.erp_stock_request_items;
  v_who text; v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 200); v_total int;
begin
  select * into r from public.erp_stock_requests where id = p_request for update;
  if not found then raise exception 'Pedido no encontrado.'; end if;
  v_acc := public.erp__sr_access(r.store_id, r.from_point_id, r.to_point_id);
  v_attend := coalesce((v_acc ->> 'attend')::boolean, false);
  v_request := coalesce((v_acc ->> 'request')::boolean, false);
  if not v_attend and not (v_request and r.status = 'pending') then
    raise exception 'Solo quien atiende puede agregar productos (o quien pidió, mientras nadie lo ha tomado).';
  end if;
  v_lock := public.erp__sr_items_lock(r);
  if v_lock is not null then raise exception '%', v_lock; end if;
  if p_qty is null or p_qty < 1 or p_qty > 100000 then raise exception 'Escribe una cantidad válida.'; end if;
  select name into v_name from public.products where id = p_product and store_id = r.store_id;
  if v_name is null then raise exception 'Ese producto no es de la tienda.'; end if;
  v_who := public.erp_actor_name(r.store_id);

  select * into v_item from public.erp_stock_request_items where request_id = r.id and product_id = p_product limit 1;
  if v_item.id is null then
    -- Lo nuevo de quien atiende va pedido y aprobado por la misma cantidad: así sale en el envío.
    insert into public.erp_stock_request_items (request_id, product_id, qty_requested, qty_approved, source_qty_at_request, dest_qty_at_request, note)
    values (r.id, p_product, p_qty, case when v_attend then p_qty end,
            coalesce((select qty from public.erp_stock_levels where warehouse_id = r.to_point_id and product_id = p_product), 0),
            coalesce((select qty from public.erp_stock_levels where warehouse_id = r.from_point_id and product_id = p_product), 0),
            left(concat_ws(' · ', '➕ Agregado por ' || v_who, v_note), 300))
    returning * into v_item;
    v_total := p_qty;
  elsif v_attend then
    v_total := coalesce(v_item.qty_approved, v_item.qty_requested) + p_qty;
    update public.erp_stock_request_items set qty_approved = v_total,
           note = left(concat_ws(' · ', nullif(note, ''), '➕ +' || p_qty || ' por ' || v_who), 300)
    where id = v_item.id;
  else
    v_total := v_item.qty_requested + p_qty;
    update public.erp_stock_request_items set qty_requested = v_total where id = v_item.id;
  end if;

  update public.erp_stock_requests set updated_at = now() where id = r.id;
  perform public.erp__sr_system(r.id, '➕ ' || v_who || ' agregó ' || p_qty || ' × ' || v_name
    || case when v_total <> p_qty then ' (ahora ' || v_total || ')' else '' end
    || case when v_attend then ' al envío' else ' al pedido' end
    || case when v_note is not null then ': ' || v_note else '' end || '.');
  begin
    perform public.erp_audit(r.store_id, 'stock_request.item_added', 'erp_stock_requests', r.id,
      jsonb_build_object('number', r.number, 'product', v_name, 'qty', p_qty, 'total', v_total));
  exception when undefined_function then null;
  end;
  return jsonb_build_object('ok', true, 'item_id', v_item.id, 'total', v_total);
end $$;
revoke all on function public.erp_sr_item_add(uuid, uuid, int, text) from public, anon;
grant execute on function public.erp_sr_item_add(uuid, uuid, int, text) to authenticated;

/** Quita un producto del pedido. */
create or replace function public.erp_sr_item_remove(p_request uuid, p_item uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.erp_stock_requests; v_acc jsonb; v_attend boolean; v_request boolean; v_lock text; v_item public.erp_stock_request_items;
  v_name text; v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 200);
begin
  select * into r from public.erp_stock_requests where id = p_request for update;
  if not found then raise exception 'Pedido no encontrado.'; end if;
  v_acc := public.erp__sr_access(r.store_id, r.from_point_id, r.to_point_id);
  v_attend := coalesce((v_acc ->> 'attend')::boolean, false);
  v_request := coalesce((v_acc ->> 'request')::boolean, false);
  if not v_attend and not (v_request and r.status = 'pending') then
    raise exception 'Solo quien atiende puede quitar productos (o quien pidió, mientras nadie lo ha tomado).';
  end if;
  v_lock := public.erp__sr_items_lock(r);
  if v_lock is not null then raise exception '%', v_lock; end if;
  select * into v_item from public.erp_stock_request_items where id = p_item and request_id = r.id;
  if v_item.id is null then raise exception 'Ese producto no está en el pedido.'; end if;
  if (select count(*) from public.erp_stock_request_items where request_id = r.id) <= 1 then
    raise exception 'Es el único producto del pedido: si no se va a enviar nada, mejor rechaza o cancela el pedido.';
  end if;
  select name into v_name from public.products where id = v_item.product_id;
  delete from public.erp_stock_request_items where id = v_item.id;
  update public.erp_stock_requests set updated_at = now() where id = r.id;
  perform public.erp__sr_system(r.id, '➖ ' || public.erp_actor_name(r.store_id) || ' quitó ' || coalesce(v_name, 'un producto')
    || ' (' || coalesce(v_item.qty_approved, v_item.qty_requested) || ' und.) del pedido'
    || case when v_reason is not null then ': ' || v_reason else '' end || '.');
  begin
    perform public.erp_audit(r.store_id, 'stock_request.item_removed', 'erp_stock_requests', r.id,
      jsonb_build_object('number', r.number, 'product', v_name, 'requested', v_item.qty_requested, 'approved', v_item.qty_approved, 'reason', v_reason));
  exception when undefined_function then null;
  end;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.erp_sr_item_remove(uuid, uuid, text) from public, anon;
grant execute on function public.erp_sr_item_remove(uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';
