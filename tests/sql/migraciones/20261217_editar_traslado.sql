-- =====================================================================
-- REMHUB · Corregir un traslado antes de que lo revisen
--
-- Mientras el traslado está EN TRÁNSITO y nadie ha firmado «Revisado»
-- (ni «En camino» ni «Recibido»), se pueden cambiar cantidades, quitar o
-- agregar productos:
--   · la bodega de origen se ajusta solo por la diferencia (kardex con el
--     número del traslado);
--   · los productos nuevos congelan su costo y precio interno como siempre
--     (activador de 20261124, incluido el cupo del punto);
--   · si ya estaba firmado «Preparado», esa firma se quita: la mercancía
--     cambió y quien la prepara debe volver a firmar;
--   · todo queda en la auditoría con el antes, el después y el motivo.
-- Desde que firman «Revisado», el traslado ya no se puede cambiar.
-- Idempotente. No borra datos.
-- =====================================================================

create or replace function public.erp_transfer_editable(p_transfer uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'editable', t.status = 'in_transit'
                and not exists (select 1 from public.erp_transfer_signatures s where s.transfer_id = t.id and s.step in ('sent', 'delivered', 'received')),
    'reason', case when t.status <> 'in_transit' then 'Ya no está en tránsito.'
                   when exists (select 1 from public.erp_transfer_signatures s where s.transfer_id = t.id and s.step in ('sent', 'delivered', 'received'))
                     then 'Ya fue revisado: no se puede cambiar.' end,
    'packed_signed', exists (select 1 from public.erp_transfer_signatures s where s.transfer_id = t.id and s.step = 'packed'))
  from public.erp_transfers t
  where t.id = p_transfer and (public.erp_can(t.store_id, 'transfers'));
$$;
revoke all on function public.erp_transfer_editable(uuid) from public, anon;
grant execute on function public.erp_transfer_editable(uuid) to authenticated;

create or replace function public.erp_transfer_update_items(p_transfer uuid, p_items jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tr public.erp_transfers;
  it jsonb;
  v_prod uuid;
  v_qty integer;
  v_old integer;
  v_before jsonb;
  v_after jsonb;
  v_new jsonb := '{}'::jsonb;
  v_changes integer := 0;
  v_packed boolean;
  r record;
begin
  select * into tr from public.erp_transfers where id = p_transfer for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'Traslado no encontrado.'); end if;
  if not public.erp_can(tr.store_id, 'transfers') then return jsonb_build_object('ok', false, 'error', 'No tienes permiso para cambiar traslados.'); end if;
  if to_regprocedure('public.erp_point_allowed(uuid, uuid)') is not null and not public.erp_point_allowed(tr.store_id, tr.from_warehouse_id) then
    return jsonb_build_object('ok', false, 'error', 'Solo quien envía desde ese punto puede cambiar el traslado.');
  end if;
  if tr.status <> 'in_transit' then return jsonb_build_object('ok', false, 'error', 'Solo se puede cambiar un traslado en tránsito.'); end if;
  if exists (select 1 from public.erp_transfer_signatures s where s.transfer_id = p_transfer and s.step in ('sent', 'delivered', 'received')) then
    return jsonb_build_object('ok', false, 'error', 'Este traslado ya fue revisado: ya no se puede cambiar.');
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then return jsonb_build_object('ok', false, 'error', 'Escribe el motivo del cambio.'); end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('ok', false, 'error', 'El traslado debe tener al menos un producto. Para quitarlo todo, anúlalo.');
  end if;

  -- Lista nueva (sumando repetidos) y validación.
  for it in select * from jsonb_array_elements(p_items) loop
    v_prod := (it->>'product_id')::uuid;
    v_qty := (it->>'qty')::integer;
    if v_prod is null or v_qty is null or v_qty < 0 or v_qty > 1000000 then return jsonb_build_object('ok', false, 'error', 'Hay una cantidad no válida.'); end if;
    v_new := jsonb_set(v_new, array[v_prod::text], to_jsonb(coalesce((v_new->>v_prod::text)::int, 0) + v_qty));
  end loop;
  if not exists (select 1 from jsonb_each_text(v_new) where value::int > 0) then
    return jsonb_build_object('ok', false, 'error', 'El traslado debe tener al menos un producto. Para quitarlo todo, anúlalo.');
  end if;

  select coalesce(jsonb_object_agg(product_id::text, qty), '{}'::jsonb) into v_before from public.erp_transfer_items where transfer_id = p_transfer;

  -- Productos que bajan o se quitan: vuelven a la bodega de origen.
  for r in select i.id, i.product_id, i.qty from public.erp_transfer_items i where i.transfer_id = p_transfer loop
    v_qty := coalesce((v_new->>r.product_id::text)::int, 0);
    if v_qty < r.qty then
      perform public.erp__move(tr.store_id, tr.from_warehouse_id, r.product_id, r.qty - v_qty, 'transfer_void', 'transfer', p_transfer, null,
        'Corrección traslado #' || tr.number || ' (vuelve)', btrim(p_reason), false);
      if v_qty = 0 then delete from public.erp_transfer_items where id = r.id;
      else update public.erp_transfer_items set qty = v_qty where id = r.id; end if;
      v_changes := v_changes + 1;
    end if;
  end loop;
  -- Productos que suben o son nuevos: salen de la bodega de origen (falla si no hay unidades).
  for r in select key::uuid as product_id, value::int as qty from jsonb_each_text(v_new) where value::int > 0 loop
    select qty into v_old from public.erp_transfer_items where transfer_id = p_transfer and product_id = r.product_id;
    if v_old is null then
      insert into public.erp_transfer_items (transfer_id, product_id, qty) values (p_transfer, r.product_id, r.qty);
      perform public.erp__move(tr.store_id, tr.from_warehouse_id, r.product_id, -r.qty, 'transfer_out', 'transfer', p_transfer, null,
        'Corrección traslado #' || tr.number || ' (sale)', btrim(p_reason), false);
      v_changes := v_changes + 1;
    elsif r.qty > v_old then
      update public.erp_transfer_items set qty = r.qty where transfer_id = p_transfer and product_id = r.product_id;
      perform public.erp__move(tr.store_id, tr.from_warehouse_id, r.product_id, -(r.qty - v_old), 'transfer_out', 'transfer', p_transfer, null,
        'Corrección traslado #' || tr.number || ' (sale)', btrim(p_reason), false);
      v_changes := v_changes + 1;
    end if;
  end loop;

  if v_changes = 0 then return jsonb_build_object('ok', true, 'changes', 0); end if;

  -- La mercancía cambió: la firma de «Preparado» (si había) ya no vale.
  delete from public.erp_transfer_signatures where transfer_id = p_transfer and step = 'packed' returning true into v_packed;
  select coalesce(jsonb_object_agg(product_id::text, qty), '{}'::jsonb) into v_after from public.erp_transfer_items where transfer_id = p_transfer;
  if to_regprocedure('public.erp_audit(uuid, text, text, uuid, jsonb)') is not null then
    perform public.erp_audit(tr.store_id, 'transfer.edited', 'erp_transfers', p_transfer,
      jsonb_build_object('number', tr.number, 'before', v_before, 'after', v_after, 'reason', btrim(p_reason), 'packed_signature_removed', coalesce(v_packed, false)));
  end if;
  return jsonb_build_object('ok', true, 'changes', v_changes, 'packed_signature_removed', coalesce(v_packed, false));
end $$;
revoke all on function public.erp_transfer_update_items(uuid, jsonb, text) from public, anon;
grant execute on function public.erp_transfer_update_items(uuid, jsonb, text) to authenticated;

notify pgrst, 'reload schema';
