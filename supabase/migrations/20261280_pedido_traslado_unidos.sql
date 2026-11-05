-- =====================================================================
-- REMHUB · Pedido interno y traslado como uno solo (sobre 20261276-20261279)
--
--   Un pedido interno, al salir, crea su traslado. Hasta ahora, si el traslado se
--   recibía por el enlace (/traslado/<enlace>) o en Inventario → Traslados, el pedido
--   podía quedarse «En camino». Ahora, se reciba por donde se reciba:
--   · el pedido pasa a «Recibido» con las cantidades que llegaron,
--   · la firma de «Recibió» se copia al pedido,
--   · y queda la constancia en el chat del pedido.
--
--   Es un disparador diferido (corre al final de la transacción): si la función que
--   recibió ya cerró el pedido (Pedidos internos → Confirmar lo que llegó), no hace nada.
--
--   erp_transfer_requests (panel): el pedido de cada traslado, para enlazarlos en pantalla.
-- No borra datos. Es idempotente.
-- =====================================================================

create or replace function public.erp__sr_close_from_transfer()
returns trigger language plpgsql security definer set search_path = public as $$
declare r public.erp_stock_requests; v_missing integer; v_by text;
begin
  if new.status is distinct from 'received' then return null; end if;
  -- Nunca frena la recepción del traslado: si algo falla aquí, se deshace solo esta parte y queda un aviso.
  begin
  for r in select * from public.erp_stock_requests where transfer_id = new.id and status = 'dispatched' for update loop
    -- Lo que llegó, producto por producto (sin pisar lo que ya se haya anotado en el pedido).
    update public.erp_stock_request_items i
       set qty_received = x.received
      from (select ti.product_id, sum(coalesce(ti.received_qty, ti.qty))::integer as received
              from public.erp_transfer_items ti where ti.transfer_id = new.id group by ti.product_id) x
     where i.request_id = r.id and i.product_id = x.product_id and i.qty_received is null;

    select coalesce(sum(greatest(coalesce(i.qty_approved, 0) - coalesce(i.qty_received, 0), 0)), 0)::integer
      into v_missing from public.erp_stock_request_items i where i.request_id = r.id;

    -- La firma de «Recibió» del traslado también es la del pedido.
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
            || case when v_missing > 0 then ' · faltaron ' || v_missing || ' und.' else ' · llegó completo' end
            || case when nullif(btrim(coalesce(new.received_notes, '')), '') is not null then ' · ' || btrim(new.received_notes) else '' end || '.');
    begin
      perform public.erp_audit(r.store_id, 'stock_request.received_by_transfer', 'erp_stock_requests', r.id,
        jsonb_build_object('number', r.number, 'transfer', new.number, 'units_missing', v_missing, 'by', v_by));
    exception when undefined_function then null;
    end;
  end loop;
  exception when others then
    raise warning 'erp__sr_close_from_transfer (traslado %): %', new.number, sqlerrm;
  end;
  return null;
end $$;
revoke all on function public.erp__sr_close_from_transfer() from public, anon, authenticated;

drop trigger if exists erp_transfers_close_request on public.erp_transfers;
create constraint trigger erp_transfers_close_request
  after update of status on public.erp_transfers
  deferrable initially deferred
  for each row
  when (new.status = 'received' and old.status is distinct from 'received')
  execute function public.erp__sr_close_from_transfer();

/** (Panel) El pedido interno de cada traslado, solo los que la persona puede ver. */
create or replace function public.erp_transfer_requests(p_store uuid, p_transfers uuid[])
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_acc jsonb; r record; v_out jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'Inicia sesión.'; end if;
  for r in select q.id, q.number, q.status, q.transfer_id, q.from_point_id, q.to_point_id
             from public.erp_stock_requests q
            where q.store_id = p_store and q.transfer_id = any(coalesce(p_transfers, '{}'::uuid[]))
            limit 500 loop
    v_acc := public.erp__sr_access(p_store, r.from_point_id, r.to_point_id);
    if coalesce((v_acc ->> 'view')::boolean, false) or coalesce((v_acc ->> 'attend')::boolean, false) or coalesce((v_acc ->> 'request')::boolean, false) then
      v_out := v_out || jsonb_build_object('transfer_id', r.transfer_id, 'request_id', r.id, 'number', r.number, 'status', r.status);
    end if;
  end loop;
  return v_out;
end $$;
revoke all on function public.erp_transfer_requests(uuid, uuid[]) from public, anon;
grant execute on function public.erp_transfer_requests(uuid, uuid[]) to authenticated;

notify pgrst, 'reload schema';
