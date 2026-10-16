-- Funciones de PRODUCCIÓN (consulta_traslados.sql, 2026-10-15) para probar el crédito en traslados.
CREATE OR REPLACE FUNCTION public.erp__move(p_store uuid, p_wh uuid, p_product uuid, p_delta integer, p_type text, p_ref_type text, p_ref_id uuid, p_cost numeric, p_note text, p_reason text, p_touch_total boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_before integer; v_after integer;
begin
  if p_delta = 0 then return; end if;
  if not exists (select 1 from public.products where id = p_product and store_id = p_store) then
    raise exception 'El producto no pertenece a esta tienda.';
  end if;
  if not exists (select 1 from public.erp_warehouses where id = p_wh and store_id = p_store and active) then
    raise exception 'La bodega no existe o está inactiva.';
  end if;

  insert into public.erp_stock_levels (warehouse_id, product_id, store_id, qty)
  values (p_wh, p_product, p_store, 0) on conflict do nothing;

  select qty into v_before from public.erp_stock_levels
  where warehouse_id = p_wh and product_id = p_product for update;
  v_after := v_before + p_delta;
  if v_after < 0 then
    raise exception 'Stock insuficiente en la bodega (disponible %, requerido %).', v_before, abs(p_delta);
  end if;

  update public.erp_stock_levels set qty = v_after, updated_at = now()
  where warehouse_id = p_wh and product_id = p_product;

  if p_touch_total then
    perform set_config('erp.skip_sync', '1', true);
    update public.products set stock = coalesce(stock, 0) + p_delta where id = p_product;
    perform set_config('erp.skip_sync', '0', true);
  end if;

  insert into public.inventory_movements
    (store_id, product_id, kind, qty, note, unit_cost, ref_type, ref_id, created_by,
     warehouse_id, movement_type, qty_before, qty_after, reason)
  values
    (p_store, p_product, case when p_delta > 0 then 'in' else 'out' end, abs(p_delta), p_note, p_cost,
     p_ref_type, p_ref_id, auth.uid(), p_wh, p_type, v_before, v_after, p_reason);
end;
$function$;

CREATE OR REPLACE FUNCTION public.erp__confirm_transfer(p_transfer uuid, p_items jsonb, p_notes text, p_user uuid, p_name text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare tr public.erp_transfers; it record; v_recv integer; v_given jsonb; v_diff_total integer := 0;
begin
  select * into tr from public.erp_transfers where id = p_transfer for update;
  if not found then raise exception 'Traslado no encontrado.'; end if;
  if tr.status <> 'in_transit' then raise exception 'El traslado no está en tránsito.'; end if;

  for it in select * from public.erp_transfer_items where transfer_id = p_transfer loop
    v_recv := it.qty;
    v_given := null;
    if p_items is not null and jsonb_typeof(p_items) = 'array' then
      select e into v_given from jsonb_array_elements(p_items) e where (e->>'product_id')::uuid = it.product_id limit 1;
      if v_given is not null then v_recv := (v_given->>'received_qty')::integer; end if;
    end if;
    if v_recv is null or v_recv < 0 or v_recv > it.qty then
      raise exception 'La cantidad recibida debe estar entre 0 y la enviada (%).', it.qty;
    end if;

    if v_recv > 0 then
      perform public.erp__move(tr.store_id, tr.to_warehouse_id, it.product_id, v_recv, 'transfer_in', 'transfer', p_transfer, null,
        'Traslado #' || tr.number || ' (entrada)', null, false);
    end if;
    if v_recv < it.qty then
      perform public.erp__move(tr.store_id, tr.from_warehouse_id, it.product_id, it.qty - v_recv, 'transfer_return', 'transfer', p_transfer, null,
        'Traslado #' || tr.number || ' (faltante devuelto al origen)', nullif(trim(p_notes), ''), false);
      v_diff_total := v_diff_total + (it.qty - v_recv);
    end if;
    update public.erp_transfer_items set received_qty = v_recv where id = it.id;
  end loop;

  update public.erp_transfers
  set status = 'received', received_at = now(), received_by = p_user,
      received_by_name = p_name, received_notes = nullif(trim(p_notes), '')
  where id = p_transfer;
  return v_diff_total;
end;
$function$;

CREATE OR REPLACE FUNCTION public.erp_confirm_transfer(p_transfer uuid, p_items jsonb, p_notes text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare tr public.erp_transfers; v_name text; v_diff integer;
begin
  select * into tr from public.erp_transfers where id = p_transfer;
  if not found then raise exception 'Traslado no encontrado.'; end if;
  if not public.erp_can(tr.store_id, 'transfers') then raise exception 'No tienes permiso para recibir traslados.'; end if;

  v_name := public.erp_actor_name(tr.store_id);
  v_diff := public.erp__confirm_transfer(p_transfer, p_items, p_notes, auth.uid(), v_name);

  insert into public.erp_transfer_signatures (transfer_id, store_id, step, signer_name, notes, via, user_id)
  values (p_transfer, tr.store_id, 'received', left(v_name, 80), left(nullif(trim(p_notes), ''), 500), 'dashboard', auth.uid())
  on conflict (transfer_id, step) do nothing;

  perform public.erp_audit(tr.store_id, 'transfer.received', 'erp_transfers', p_transfer,
    jsonb_build_object('number', tr.number, 'units_missing', v_diff, 'notes', nullif(trim(p_notes), '')));
end;
$function$;

CREATE OR REPLACE FUNCTION public.erp_create_transfer(p_store uuid, p_from uuid, p_to uuid, p_notes text, p_items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid; v_num bigint; it jsonb; v_prod uuid; v_qty integer;
begin
  if not public.erp_can(p_store, 'transfers') then raise exception 'No tienes permiso para crear traslados.'; end if;
  if p_from = p_to then raise exception 'La bodega de origen y destino deben ser distintas.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'El traslado no tiene productos.'; end if;
  if not exists (select 1 from public.erp_warehouses where id = p_to and store_id = p_store and active) then
    raise exception 'Bodega destino no válida.';
  end if;
  v_num := public.erp_next_number(p_store, 'transfer');
  insert into public.erp_transfers (store_id, number, from_warehouse_id, to_warehouse_id, notes, created_by)
  values (p_store, v_num, p_from, p_to, nullif(trim(p_notes), ''), auth.uid()) returning id into v_id;

  for it in select * from jsonb_array_elements(p_items) loop
    v_prod := (it->>'product_id')::uuid;
    v_qty := (it->>'qty')::integer;
    if v_qty is null or v_qty <= 0 then raise exception 'Cantidad inválida.'; end if;
    insert into public.erp_transfer_items (transfer_id, product_id, qty) values (v_id, v_prod, v_qty);
    perform public.erp__move(p_store, p_from, v_prod, -v_qty, 'transfer_out', 'transfer', v_id, null,
      'Traslado #' || v_num || ' (salida)', null, false);
  end loop;
  perform public.erp_audit(p_store, 'transfer.shipped', 'erp_transfers', v_id,
    jsonb_build_object('number', v_num, 'from', p_from, 'to', p_to, 'items', jsonb_array_length(p_items)));
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.erp_dispatch_transfers(p_store uuid, p_from uuid, p_notes text, p_carrier text, p_checked_by text, p_plan jsonb)
 RETURNS uuid[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ids uuid[] := '{}'; leg jsonb; it jsonb; v_to uuid; v_id uuid; v_num bigint; v_prod uuid; v_qty integer;
begin
  if not public.erp_can(p_store, 'transfers') then raise exception 'No tienes permiso para crear traslados.'; end if;
  if jsonb_typeof(p_plan) <> 'array' or jsonb_array_length(p_plan) = 0 then raise exception 'Agrega al menos un destino.'; end if;
  if not exists (select 1 from public.erp_warehouses where id = p_from and store_id = p_store and active) then
    raise exception 'Bodega origen no válida.';
  end if;

  for leg in select * from jsonb_array_elements(p_plan) loop
    v_to := (leg->>'to')::uuid;
    if v_to = p_from then raise exception 'El destino no puede ser igual al origen.'; end if;
    if not exists (select 1 from public.erp_warehouses where id = v_to and store_id = p_store and active) then
      raise exception 'Un destino no es válido.';
    end if;
    if jsonb_typeof(leg->'items') <> 'array' or jsonb_array_length(leg->'items') = 0 then
      raise exception 'Cada destino necesita al menos un producto.';
    end if;

    v_num := public.erp_next_number(p_store, 'transfer');
    insert into public.erp_transfers
      (store_id, number, from_warehouse_id, to_warehouse_id, notes, created_by, carrier_name, checked_by_name)
    values
      (p_store, v_num, p_from, v_to, nullif(trim(p_notes), ''), auth.uid(),
       nullif(trim(p_carrier), ''), nullif(trim(p_checked_by), ''))
    returning id into v_id;

    for it in select * from jsonb_array_elements(leg->'items') loop
      v_prod := (it->>'product_id')::uuid;
      v_qty := (it->>'qty')::integer;
      if v_qty is null or v_qty <= 0 then raise exception 'Cantidad inválida.'; end if;
      insert into public.erp_transfer_items (transfer_id, product_id, qty) values (v_id, v_prod, v_qty);
      perform public.erp__move(p_store, p_from, v_prod, -v_qty, 'transfer_out', 'transfer', v_id, null,
        'Traslado #' || v_num || ' (salida)', null, false);
    end loop;

    perform public.erp_audit(p_store, 'transfer.shipped', 'erp_transfers', v_id,
      jsonb_build_object('number', v_num, 'from', p_from, 'to', v_to, 'items', jsonb_array_length(leg->'items'),
        'carrier', nullif(trim(p_carrier), ''), 'checked_by', nullif(trim(p_checked_by), '')));
    v_ids := v_ids || v_id;
  end loop;
  return v_ids;
end;
$function$;

CREATE OR REPLACE FUNCTION public.erp_cancel_transfer(p_transfer uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare tr public.erp_transfers; it record;
begin
  select * into tr from public.erp_transfers where id = p_transfer for update;
  if not found then raise exception 'Traslado no encontrado.'; end if;
  if not public.erp_can(tr.store_id, 'transfers') then raise exception 'No tienes permiso para anular traslados.'; end if;
  if tr.status <> 'in_transit' then raise exception 'Solo se pueden anular traslados en tránsito.'; end if;
  for it in select * from public.erp_transfer_items where transfer_id = p_transfer loop
    perform public.erp__move(tr.store_id, tr.from_warehouse_id, it.product_id, it.qty, 'transfer_void', 'transfer', p_transfer, null,
      'Anulación traslado #' || tr.number, p_reason, false);
  end loop;
  update public.erp_transfers set status = 'cancelled', cancelled_at = now() where id = p_transfer;
  perform public.erp_audit(tr.store_id, 'transfer.cancelled', 'erp_transfers', p_transfer,
    jsonb_build_object('number', tr.number, 'reason', p_reason));
end;
$function$;
