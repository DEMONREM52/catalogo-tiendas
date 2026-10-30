-- =====================================================================
-- REMHUB · Pedidos internos: lista de chequeo de productos (sobre 20261276)
--
--   · Quien despacha va chuleando lo que ya empacó («pack»); quien recibe va
--     chuleando lo que ya contó («receive»). En cualquier orden.
--   · Se guarda quién y a qué hora chuleó cada producto: varias personas pueden
--     chulear a la vez desde su celular y todos lo ven en vivo.
--   · Cuando se completa la lista, queda una constancia en el chat del pedido.
--
--   erp_sr_item_check (marcar / desmarcar) · erp_sr_item_checks (la lista)
-- No borra datos. Es idempotente.
-- =====================================================================

create table if not exists public.erp_sr_item_checks (
  item_id uuid not null references public.erp_stock_request_items(id) on delete cascade,
  request_id uuid not null references public.erp_stock_requests(id) on delete cascade,
  side text not null check (side in ('pack', 'receive')),
  checked_by uuid,
  checked_by_name text,
  checked_at timestamptz not null default clock_timestamp(),
  primary key (item_id, side)
);
create index if not exists erp_sr_item_checks_request on public.erp_sr_item_checks (request_id);

alter table public.erp_sr_item_checks enable row level security;
revoke all on public.erp_sr_item_checks from anon, authenticated;
grant select on public.erp_sr_item_checks to authenticated;
drop policy if exists erp_sr_item_checks_read on public.erp_sr_item_checks;
create policy erp_sr_item_checks_read on public.erp_sr_item_checks for select to authenticated using (public.erp__sr_visible(request_id));

-- En vivo: lo que chulea uno lo ven los demás.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'erp_sr_item_checks') then
    execute 'alter publication supabase_realtime add table public.erp_sr_item_checks';
  end if;
end $$;

/** Chulear (o deschulear) un producto: «pack» = ya empacado (quien despacha), «receive» = ya contado (quien recibe). */
create or replace function public.erp_sr_item_check(p_request uuid, p_item uuid, p_side text, p_on boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.erp_stock_requests; v_acc jsonb; v_total int; v_done int; v_who text; v_new int := 0;
begin
  select * into r from public.erp_stock_requests where id = p_request;
  if not found then raise exception 'Pedido no encontrado.'; end if;
  if p_side not in ('pack', 'receive') then raise exception 'Lista no válida.'; end if;
  v_acc := public.erp__sr_access(r.store_id, r.from_point_id, r.to_point_id);
  if p_side = 'pack' then
    if not coalesce((v_acc ->> 'attend')::boolean, false) then raise exception 'Solo quien despacha chulea lo empacado.'; end if;
    if r.status not in ('pending', 'preparing') then raise exception 'El pedido ya salió: el empaque ya no se cambia.'; end if;
  else
    if not coalesce((v_acc ->> 'request')::boolean, false) then raise exception 'Solo quien recibe chulea lo que llegó.'; end if;
    if r.status <> 'dispatched' then raise exception 'Se chulea lo recibido cuando el pedido va en camino.'; end if;
  end if;
  if not exists (select 1 from public.erp_stock_request_items where id = p_item and request_id = r.id) then
    raise exception 'Ese producto no está en el pedido.';
  end if;

  if p_on then
    v_who := public.erp_actor_name(r.store_id);
    insert into public.erp_sr_item_checks (item_id, request_id, side, checked_by, checked_by_name)
    values (p_item, r.id, p_side, auth.uid(), v_who)
    on conflict (item_id, side) do nothing;
    get diagnostics v_new = row_count;
  else
    delete from public.erp_sr_item_checks where item_id = p_item and side = p_side;
  end if;

  select count(*) into v_total from public.erp_stock_request_items where request_id = r.id;
  select count(*) into v_done from public.erp_sr_item_checks c join public.erp_stock_request_items i on i.id = c.item_id
  where c.request_id = r.id and c.side = p_side;
  -- La lista completa queda en el chat (una vez por cada vez que se completa).
  if v_new > 0 and v_done = v_total and v_total > 0 then
    perform public.erp__sr_system(r.id, case when p_side = 'pack'
      then '📦✅ ' || v_who || ' terminó de chulear el empaque: ' || v_total || ' de ' || v_total || ' productos listos.'
      else '📥✅ ' || v_who || ' terminó de chulear lo recibido: ' || v_total || ' de ' || v_total || ' productos contados.' end);
  end if;
  return jsonb_build_object('ok', true, 'done', v_done, 'total', v_total);
end $$;
revoke all on function public.erp_sr_item_check(uuid, uuid, text, boolean) from public, anon;
grant execute on function public.erp_sr_item_check(uuid, uuid, text, boolean) to authenticated;

/** La lista de chequeo del pedido: qué producto, de qué lado, quién y cuándo. */
create or replace function public.erp_sr_item_checks(p_request uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.erp__sr_visible(p_request) then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('item_id', c.item_id, 'side', c.side, 'by', c.checked_by_name, 'at', c.checked_at) order by c.checked_at)
                   from public.erp_sr_item_checks c where c.request_id = p_request), '[]'::jsonb);
end $$;
revoke all on function public.erp_sr_item_checks(uuid) from public, anon;
grant execute on function public.erp_sr_item_checks(uuid) to authenticated;

notify pgrst, 'reload schema';
