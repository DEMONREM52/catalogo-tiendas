-- =====================================================================
-- REMHUB · Anular el traslado también anula su pedido interno (sobre 20261280-20261281)
--
--   Si alguien con permiso de traslados anula un traslado que salió de un pedido
--   interno (Inventario → Traslados → Anular, o «Anular pedido y traslado» en el pedido),
--   la mercancía vuelve al origen (como siempre) y ahora además:
--   · el pedido pasa a «Cancelado» y deja de aparecer como «En camino»,
--   · queda la constancia en el chat del pedido y en la auditoría.
--
--   También arregla los pedidos que ya quedaron «En camino» con su traslado anulado.
--   Es un disparador diferido; si algo del pedido falla, la anulación del traslado sigue igual.
-- No borra datos. Es idempotente.
-- =====================================================================

create or replace function public.erp__sr_cancel_from_transfer()
returns trigger language plpgsql security definer set search_path = public as $$
declare r public.erp_stock_requests; v_by text;
begin
  if new.status is distinct from 'cancelled' then return null; end if;
  begin
  v_by := coalesce((select coalesce(nullif(btrim(p.full_name), ''), u.email) from auth.users u left join public.profiles p on p.id = u.id where u.id = auth.uid()), 'alguien');
  exception when others then v_by := 'alguien';
  end;
  begin
  for r in select * from public.erp_stock_requests
            where transfer_id = new.id and status in ('pending', 'preparing', 'dispatched') for update loop
    update public.erp_stock_requests set status = 'cancelled', updated_at = now(), last_message_at = now() where id = r.id;
    begin
      update public.erp_stock_requests set closed_at = coalesce(closed_at, now()) where id = r.id;
    exception when undefined_column then null;
    end;
    insert into public.erp_stock_request_messages (request_id, store_id, user_id, user_name, kind, body)
    values (r.id, r.store_id, null, null, 'system',
            '🚫 ' || v_by || ' anuló el traslado #' || new.number || '. La mercancía volvió al inventario de quien la envió y el pedido quedó cancelado.');
    begin
      perform public.erp_audit(r.store_id, 'stock_request.cancelled_by_transfer', 'erp_stock_requests', r.id,
        jsonb_build_object('number', r.number, 'transfer', new.number, 'by', v_by));
    exception when undefined_function then null;
    end;
  end loop;
  exception when others then
    raise warning 'erp__sr_cancel_from_transfer (traslado %): %', new.number, sqlerrm;
  end;
  return null;
end $$;
revoke all on function public.erp__sr_cancel_from_transfer() from public, anon, authenticated;

drop trigger if exists erp_transfers_cancel_request on public.erp_transfers;
create constraint trigger erp_transfers_cancel_request
  after update of status on public.erp_transfers
  deferrable initially deferred
  for each row
  when (new.status = 'cancelled' and old.status is distinct from 'cancelled')
  execute function public.erp__sr_cancel_from_transfer();

-- Los que ya quedaron colgados (traslado anulado, pedido «En camino»).
do $$
declare r record;
begin
  for r in select q.id, q.store_id, q.number, t.number as tnum
             from public.erp_stock_requests q join public.erp_transfers t on t.id = q.transfer_id
            where t.status = 'cancelled' and q.status in ('pending', 'preparing', 'dispatched') loop
    update public.erp_stock_requests set status = 'cancelled', updated_at = now(), last_message_at = now() where id = r.id;
    begin
      update public.erp_stock_requests set closed_at = coalesce(closed_at, now()) where id = r.id;
    exception when undefined_column then null;
    end;
    insert into public.erp_stock_request_messages (request_id, store_id, user_id, user_name, kind, body)
    values (r.id, r.store_id, null, null, 'system',
            '🚫 El traslado #' || r.tnum || ' se había anulado: la mercancía volvió al inventario de quien la envió y el pedido quedó cancelado.');
  end loop;
end $$;

notify pgrst, 'reload schema';
