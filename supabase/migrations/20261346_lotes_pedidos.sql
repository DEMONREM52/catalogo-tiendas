-- =====================================================================
-- REMHUB · Pedidos internos: cantidades que no se pierden y lotes (sobre 20261345)
--
--   1. erp_sr_qty_set: guarda al instante lo que se va a enviar de uno o varios
--      productos (de uno o varios pedidos, todo o nada). Antes la cantidad
--      escrita solo vivía en la pantalla de quien la escribió: al recargar,
--      salir y volver a entrar o al «Preparar», volvía a salir lo pedido.
--      Cada cambio queda en el chat del pedido («✏️ Sara: COJIN 5 → 8») y si la
--      misma persona lo vuelve a cambiar enseguida, se corrige ese mismo mensaje.
--   2. Lotes: juntar 2 a 10 pedidos que salen del mismo lugar para sacarlos
--      juntos (una sola lista) y después repartir. Cada pedido sigue siendo suyo
--      (sus cantidades, su empaque, sus firmas y su traslado).
--        · erp_sr_batch_create: arma el lote (con llave para no repetirlo).
--        · erp_sr_batch_undo: lo deshace (o saca un pedido). Siempre se puede:
--          cada pedido queda como estaba, con lo empacado y las cantidades.
--      La lista de pedidos dice en qué lote está cada uno.
--   3. Cada cambio toca el pedido (updated_at): la conexión en vivo del panel
--      lo avisa y a todos se les actualiza la pantalla.
--
-- Requiere 20261345 (erp__sr_perms). No borra datos. Es idempotente.
-- =====================================================================

do $$
begin
  if to_regprocedure('public.erp__sr_perms(uuid)') is null then
    raise exception 'Primero corre 20261345_funciones_rapidas.sql';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Lotes
-- ---------------------------------------------------------------------
create table if not exists public.erp_sr_batches (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  number int not null,
  source_point_id uuid not null references public.erp_warehouses(id),
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by_name text,
  client_key uuid unique
);
create unique index if not exists erp_sr_batches_store_number on public.erp_sr_batches (store_id, number);
alter table public.erp_sr_batches enable row level security;
revoke all on public.erp_sr_batches from anon, authenticated;

alter table public.erp_stock_requests add column if not exists batch_id uuid references public.erp_sr_batches(id) on delete set null;
create index if not exists erp_stock_requests_batch on public.erp_stock_requests (batch_id) where batch_id is not null;

-- ---------------------------------------------------------------------
-- 1. Cantidades a enviar
-- ---------------------------------------------------------------------
/**
 * Guarda lo que se va a enviar: p_items = [{ "item_id": uuid, "qty": int }, …] (de uno o varios pedidos).
 * Quien atiende, con el pedido enviado o en preparación. Todo o nada.
 */
create or replace function public.erp_sr_qty_set(p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_perms jsonb; v_store uuid; r record; x record; v_old int; v_who text; v_prefix text; v_last record;
  v_from int; v_changed int := 0; v_body text; v_first uuid;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'No hay cantidades para guardar.';
  end if;
  if jsonb_array_length(p_items) > 500 then raise exception 'Son demasiados productos a la vez.'; end if;

  -- Los pedidos, bloqueados en orden (dos personas guardando a la vez no se cruzan).
  for r in
    select q.* from public.erp_stock_requests q
    where q.id in (select i.request_id from public.erp_stock_request_items i
                   where i.id in (select (e->>'item_id')::uuid from jsonb_array_elements(p_items) e))
    order by q.id for update
  loop
    if v_store is null then
      v_store := r.store_id;
      v_first := r.id;
      v_perms := public.erp__sr_perms(v_store);
      v_who := public.erp_actor_name(v_store);
    elsif v_store <> r.store_id then
      raise exception 'Los productos son de tiendas distintas.';
    end if;
    if not coalesce((public.erp__sr_access_of(v_perms, r.from_point_id, r.to_point_id)->>'attend')::boolean, false) then
      raise exception 'Solo quien despacha el pedido #% cambia lo que se envía.', r.number;
    end if;
    if r.status not in ('pending', 'preparing') then
      raise exception 'El pedido #% ya salió o está cerrado: las cantidades ya no se cambian.', r.number;
    end if;
  end loop;

  for x in
    select (e->>'item_id')::uuid as item_id, (e->>'qty') as qty_txt, i.request_id, i.qty_requested, i.qty_approved, p.name
    from jsonb_array_elements(p_items) e
    left join public.erp_stock_request_items i on i.id = (e->>'item_id')::uuid
    left join public.products p on p.id = i.product_id
  loop
    if x.request_id is null then raise exception 'Ese producto ya no está en el pedido.'; end if;
    if x.qty_txt is null or x.qty_txt !~ '^\d{1,6}$' or x.qty_txt::int > 100000 then
      raise exception 'Escribe una cantidad válida para %.', coalesce(x.name, 'el producto');
    end if;
    v_old := coalesce(x.qty_approved, x.qty_requested);
    if x.qty_approved is not null and x.qty_approved = x.qty_txt::int then continue; end if;
    update public.erp_stock_request_items set qty_approved = x.qty_txt::int where id = x.item_id;
    v_changed := v_changed + 1;
    if v_old = x.qty_txt::int then continue; end if;

    -- Constancia en el chat. Si lo último del chat es el cambio de esta misma persona a este producto
    -- (hace menos de 10 min), se corrige ese mensaje en vez de llenar el chat.
    v_prefix := '✏️ ' || v_who || ': ' || coalesce(x.name, 'producto') || ' ';
    select m.id, m.body, m.kind, m.created_at into v_last
    from public.erp_stock_request_messages m where m.request_id = x.request_id
    order by m.created_at desc limit 1;
    if v_last.id is not null and v_last.kind = 'system' and v_last.created_at > now() - interval '10 minutes'
       and left(v_last.body, length(v_prefix)) = v_prefix
       and substring(v_last.body from length(v_prefix) + 1) ~ '^\d+ → \d+ para enviar\.$' then
      v_from := substring(substring(v_last.body from length(v_prefix) + 1) from '^(\d+) →')::int;
      if v_from = x.qty_txt::int then
        delete from public.erp_stock_request_messages where id = v_last.id;
      else
        update public.erp_stock_request_messages set body = v_prefix || v_from || ' → ' || x.qty_txt || ' para enviar.' where id = v_last.id;
      end if;
    else
      v_body := v_prefix || v_old || ' → ' || x.qty_txt || ' para enviar.';
      perform public.erp__sr_system(x.request_id, v_body);
    end if;
  end loop;

  if v_changed > 0 then
    -- Toca los pedidos: la conexión en vivo del panel les avisa a todos.
    update public.erp_stock_requests set updated_at = now()
    where id in (select i.request_id from public.erp_stock_request_items i
                 where i.id in (select (e->>'item_id')::uuid from jsonb_array_elements(p_items) e));
    begin
      perform public.erp_audit(v_store, 'stock_request.qty_set', 'erp_stock_requests', v_first, jsonb_build_object('items', p_items));
    exception when undefined_function then null;
    end;
  end if;
  return jsonb_build_object('ok', true, 'changed', v_changed);
end $$;
revoke all on function public.erp_sr_qty_set(jsonb) from public, anon;
grant execute on function public.erp_sr_qty_set(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Lotes
-- ---------------------------------------------------------------------
/** Junta 2 a 10 pedidos que salen del mismo lugar en un lote. p_key: llave del equipo para no repetirlo. */
create or replace function public.erp_sr_batch_create(p_store uuid, p_requests uuid[], p_key uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_perms jsonb; v_ids uuid[]; r record; v_source uuid; v_n int := 0; v_b public.erp_sr_batches; v_who text; v_list text;
begin
  if p_key is not null then
    select * into v_b from public.erp_sr_batches where client_key = p_key and store_id = p_store;
    if v_b.id is not null then return jsonb_build_object('ok', true, 'id', v_b.id, 'number', v_b.number, 'repeated', true); end if;
  end if;
  select array_agg(distinct x) into v_ids from unnest(p_requests) x where x is not null;
  if coalesce(cardinality(v_ids), 0) < 2 then raise exception 'Elige al menos dos pedidos.'; end if;
  if cardinality(v_ids) > 10 then raise exception 'Máximo 10 pedidos en un lote.'; end if;
  v_perms := public.erp__sr_perms(p_store);

  for r in select q.* from public.erp_stock_requests q where q.id = any(v_ids) and q.store_id = p_store order by q.id for update loop
    v_n := v_n + 1;
    if not coalesce((public.erp__sr_access_of(v_perms, r.from_point_id, r.to_point_id)->>'attend')::boolean, false) then
      raise exception 'El pedido #% no lo despachas tú.', r.number;
    end if;
    if r.status not in ('pending', 'preparing') then raise exception 'El pedido #% ya salió o está cerrado.', r.number; end if;
    if r.batch_id is not null then
      raise exception 'El pedido #% ya está en el lote #%: deshazlo primero.', r.number, (select b.number from public.erp_sr_batches b where b.id = r.batch_id);
    end if;
    if v_source is null then v_source := r.to_point_id;
    elsif v_source <> r.to_point_id then raise exception 'Los pedidos de un lote deben salir del mismo lugar.';
    end if;
  end loop;
  if v_n <> cardinality(v_ids) then raise exception 'Algún pedido no es de esta tienda.'; end if;

  -- Número del lote por tienda, sin choques si dos lo arman a la vez.
  perform pg_advisory_xact_lock(hashtext('erp_sr_batch:' || p_store::text));
  if p_key is not null then
    select * into v_b from public.erp_sr_batches where client_key = p_key and store_id = p_store;
    if v_b.id is not null then return jsonb_build_object('ok', true, 'id', v_b.id, 'number', v_b.number, 'repeated', true); end if;
  end if;
  v_who := public.erp_actor_name(p_store);
  insert into public.erp_sr_batches (store_id, number, source_point_id, created_by, created_by_name, client_key)
  values (p_store, coalesce((select max(number) from public.erp_sr_batches where store_id = p_store), 0) + 1, v_source, auth.uid(), v_who, p_key)
  returning * into v_b;
  update public.erp_stock_requests set batch_id = v_b.id, updated_at = now() where id = any(v_ids);

  select string_agg('#' || number, ', ' order by number) into v_list from public.erp_stock_requests where id = any(v_ids);
  for r in select id from public.erp_stock_requests where id = any(v_ids) loop
    perform public.erp__sr_system(r.id, '🧺 ' || v_who || ' juntó los pedidos ' || v_list || ' en el lote #' || v_b.number
      || ' para sacarlos juntos. Cada pedido se reparte, se firma y se envía por aparte.');
  end loop;
  begin
    perform public.erp_audit(p_store, 'stock_request.batch_created', 'erp_sr_batches', v_b.id, jsonb_build_object('number', v_b.number, 'requests', v_ids));
  exception when undefined_function then null;
  end;
  return jsonb_build_object('ok', true, 'id', v_b.id, 'number', v_b.number);
end $$;
revoke all on function public.erp_sr_batch_create(uuid, uuid[], uuid) from public, anon;
grant execute on function public.erp_sr_batch_create(uuid, uuid[], uuid) to authenticated;

/**
 * Deshace el lote (p_request nulo) o saca un pedido de él. Si quedan menos de dos, se deshace entero.
 * No toca cantidades, empaque ni firmas: cada pedido queda como estaba.
 */
create or replace function public.erp_sr_batch_undo(p_batch uuid, p_request uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_b public.erp_sr_batches; v_perms jsonb; r record; v_who text; v_out uuid[]; v_left int;
begin
  select * into v_b from public.erp_sr_batches where id = p_batch for update;
  if v_b.id is null then raise exception 'Ese lote no existe.'; end if;
  if v_b.undone_at is not null then return jsonb_build_object('ok', true, 'undone', true, 'repeated', true); end if;
  v_perms := public.erp__sr_perms(v_b.store_id);
  if p_request is not null and not exists (select 1 from public.erp_stock_requests where id = p_request and batch_id = v_b.id) then
    raise exception 'Ese pedido no está en el lote #%.', v_b.number;
  end if;

  for r in select q.* from public.erp_stock_requests q where q.batch_id = v_b.id order by q.id for update loop
    if not coalesce((public.erp__sr_access_of(v_perms, r.from_point_id, r.to_point_id)->>'attend')::boolean, false) then
      raise exception 'Solo quien despacha esos pedidos puede deshacer el lote.';
    end if;
  end loop;

  select count(*) into v_left from public.erp_stock_requests
  where batch_id = v_b.id and (p_request is null or id <> p_request);
  if p_request is null or v_left < 2 then
    select array_agg(id) into v_out from public.erp_stock_requests where batch_id = v_b.id;
    update public.erp_sr_batches set undone_at = now(), undone_by_name = public.erp_actor_name(v_b.store_id) where id = v_b.id;
  else
    v_out := array[p_request];
  end if;

  v_who := public.erp_actor_name(v_b.store_id);
  update public.erp_stock_requests set batch_id = null, updated_at = now() where id = any(v_out);
  for r in select id from public.erp_stock_requests where id = any(v_out) loop
    perform public.erp__sr_system(r.id, '↩️ ' || v_who || case when p_request is null or v_left < 2
      then ' deshizo el lote #' || v_b.number else ' sacó este pedido del lote #' || v_b.number end
      || '. El pedido queda como estaba (cantidades y empaque).');
  end loop;
  begin
    perform public.erp_audit(v_b.store_id, 'stock_request.batch_undone', 'erp_sr_batches', v_b.id,
      jsonb_build_object('number', v_b.number, 'requests', v_out, 'whole', p_request is null or v_left < 2));
  exception when undefined_function then null;
  end;
  return jsonb_build_object('ok', true, 'undone', p_request is null or v_left < 2, 'removed', v_out);
end $$;
revoke all on function public.erp_sr_batch_undo(uuid, uuid) from public, anon;
grant execute on function public.erp_sr_batch_undo(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. La lista de pedidos dice en qué lote está cada uno (lo demás igual que 20261345)
-- ---------------------------------------------------------------------
create or replace function public.erp_stock_requests_list(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v jsonb; v_perms jsonb := public.erp__sr_perms(p_store);
begin
  select coalesce(jsonb_agg(x order by (x->>'sort_open')::int, x->>'updated_at' desc), '[]'::jsonb) into v
  from (
    select jsonb_build_object(
      'id', r.id, 'number', r.number, 'status', r.status, 'priority', r.priority, 'note', r.note, 'needed_by', r.needed_by,
      'from_point_id', r.from_point_id, 'from_name', wf.name, 'to_point_id', r.to_point_id, 'to_name', wt.name,
      'requested_by_name', r.requested_by_name, 'handled_by_name', r.handled_by_name,
      'created_at', r.created_at, 'updated_at', coalesce(r.last_message_at, r.updated_at), 'closed_at', r.closed_at,
      'items', (select count(*) from public.erp_stock_request_items i where i.request_id = r.id),
      'units', (select coalesce(sum(i.qty_requested), 0) from public.erp_stock_request_items i where i.request_id = r.id),
      'last_message', (select jsonb_build_object('body', m.body, 'user_name', m.user_name, 'kind', m.kind, 'created_at', m.created_at)
                       from public.erp_stock_request_messages m where m.request_id = r.id order by m.created_at desc limit 1),
      'unread', (select count(*) from public.erp_stock_request_messages m
                 where m.request_id = r.id and m.user_id is distinct from auth.uid()
                   and m.created_at > coalesce((select rd.last_read_at from public.erp_stock_request_reads rd where rd.request_id = r.id and rd.user_id = auth.uid()), '-infinity')),
      'access', a.acc,
      'batch', (select jsonb_build_object('id', b.id, 'number', b.number, 'by', b.created_by_name, 'at', b.created_at)
                from public.erp_sr_batches b where b.id = r.batch_id),
      'sort_open', case when r.status in ('pending', 'preparing', 'dispatched') then 0 else 1 end
    ) as x
    from public.erp_stock_requests r
    join public.erp_warehouses wf on wf.id = r.from_point_id
    join public.erp_warehouses wt on wt.id = r.to_point_id
    cross join lateral (select public.erp__sr_access_of(v_perms, r.from_point_id, r.to_point_id) as acc) a
    where r.store_id = p_store and (a.acc->>'view')::boolean
      and (r.status in ('pending', 'preparing', 'dispatched') or r.created_at > now() - interval '120 days')
    order by r.created_at desc
    limit 300
  ) s;
  return v;
end;
$function$;

notify pgrst, 'reload schema';
