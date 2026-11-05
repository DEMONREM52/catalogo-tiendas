-- =====================================================================
-- REMHUB · Traslados: anotar que llegó DE MÁS (sobre 20261280)
--
--   Antes, al recibir un traslado solo se podía anotar entre 0 y lo enviado.
--   Ahora también se puede anotar más (pasa: se empacó una unidad de más):
--   · el destino suma todo lo que llegó,
--   · las unidades de más salen del origen (de ahí salieron de verdad); si el origen
--     no las tiene registradas, no deja recibir y lo explica,
--   · el crédito interno y el costo del punto ya usan lo recibido, así que las cuentan,
--   · el pedido interno (20261280) dice en el chat cuántas llegaron de más.
--
--   Vale para el panel (Inventario → Traslados) y para el enlace del traslado.
-- No borra datos. Es idempotente.
-- =====================================================================

create or replace function public.erp__confirm_transfer(p_transfer uuid, p_items jsonb, p_notes text, p_user uuid, p_name text)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare tr public.erp_transfers; it record; v_recv integer; v_given jsonb; v_diff_total integer := 0; v_have integer;
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
    if v_recv is null or v_recv < 0 or v_recv > it.qty + 100000 then
      raise exception 'La cantidad recibida no es válida (enviadas %).', it.qty;
    end if;

    -- Llegó de más: esas unidades salen del origen.
    if v_recv > it.qty then
      select coalesce(qty, 0) into v_have from public.erp_stock_levels where warehouse_id = tr.from_warehouse_id and product_id = it.product_id;
      if coalesce(v_have, 0) < v_recv - it.qty then
        raise exception 'Llegaron % de más de «%», pero el origen solo tiene % registradas. Haz primero un ajuste en el origen o anota lo enviado.',
          v_recv - it.qty, (select name from public.products where id = it.product_id), coalesce(v_have, 0);
      end if;
      perform public.erp__move(tr.store_id, tr.from_warehouse_id, it.product_id, -(v_recv - it.qty), 'transfer_out', 'transfer', p_transfer, null,
        'Traslado #' || tr.number || ' (llegó de más)', nullif(trim(p_notes), ''), false);
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
revoke all on function public.erp__confirm_transfer(uuid, jsonb, text, uuid, text) from public, anon, authenticated;

-- El chat del pedido también dice si llegó de más.
create or replace function public.erp__sr_close_from_transfer()
returns trigger language plpgsql security definer set search_path = public as $$
declare r public.erp_stock_requests; v_missing integer; v_extra integer; v_by text;
begin
  if new.status is distinct from 'received' then return null; end if;
  -- Nunca frena la recepción del traslado: si algo falla aquí, se deshace solo esta parte y queda un aviso.
  begin
  for r in select * from public.erp_stock_requests where transfer_id = new.id and status = 'dispatched' for update loop
    update public.erp_stock_request_items i
       set qty_received = x.received
      from (select ti.product_id, sum(coalesce(ti.received_qty, ti.qty))::integer as received
              from public.erp_transfer_items ti where ti.transfer_id = new.id group by ti.product_id) x
     where i.request_id = r.id and i.product_id = x.product_id and i.qty_received is null;

    select coalesce(sum(greatest(coalesce(i.qty_approved, 0) - coalesce(i.qty_received, 0), 0)), 0)::integer,
           coalesce(sum(greatest(coalesce(i.qty_received, 0) - coalesce(i.qty_approved, 0), 0)), 0)::integer
      into v_missing, v_extra from public.erp_stock_request_items i where i.request_id = r.id;

    insert into public.erp_stock_request_signatures (request_id, store_id, step, signer_name, signer_doc, signature, notes, via, user_id, signed_at)
    select r.id, r.store_id, 'received', s.signer_name, s.signer_doc, s.signature, s.notes, coalesce(s.via, 'dashboard'), s.user_id, coalesce(s.signed_at, now())
      from public.erp_transfer_signatures s
     where s.transfer_id = new.id and s.step = 'received'
       and not exists (select 1 from public.erp_stock_request_signatures x where x.request_id = r.id and x.step = 'received')
     limit 1;

    v_by := coalesce(nullif(btrim(new.received_by_name), ''),
                     (select s.signer_name from public.erp_transfer_signatures s where s.transfer_id = new.id and s.step = 'received' limit 1), 'alguien');
    update public.erp_stock_requests
       set status = 'received', updated_at = now(), last_message_at = now()
     where id = r.id;
    begin
      update public.erp_stock_requests set closed_at = coalesce(closed_at, now()) where id = r.id;
    exception when undefined_column then null;
    end;
    insert into public.erp_stock_request_messages (request_id, store_id, user_id, user_name, kind, body)
    values (r.id, r.store_id, null, null, 'system',
            '📥 ' || v_by || ' recibió el traslado #' || new.number
            || case when v_missing > 0 then ' · faltaron ' || v_missing || ' und.' else '' end
            || case when v_extra > 0 then ' · llegaron ' || v_extra || ' und. de más' else '' end
            || case when v_missing = 0 and v_extra = 0 then ' · llegó completo' else '' end
            || case when nullif(btrim(coalesce(new.received_notes, '')), '') is not null then ' · ' || btrim(new.received_notes) else '' end || '.');
    begin
      perform public.erp_audit(r.store_id, 'stock_request.received_by_transfer', 'erp_stock_requests', r.id,
        jsonb_build_object('number', r.number, 'transfer', new.number, 'units_missing', v_missing, 'units_extra', v_extra, 'by', v_by));
    exception when undefined_function then null;
    end;
  end loop;
  exception when others then
    raise warning 'erp__sr_close_from_transfer (traslado %): %', new.number, sqlerrm;
  end;
  return null;
end $$;
revoke all on function public.erp__sr_close_from_transfer() from public, anon, authenticated;

notify pgrst, 'reload schema';
