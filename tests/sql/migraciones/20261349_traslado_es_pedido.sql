-- =====================================================================
-- REMHUB · El traslado hecho en Inventario también es un pedido interno (Logística, fases 2, 7 y 8)
--
--   Decisión del usuario (27/11/2026): un traslado creado en Inventario aparece como
--   pedido interno (saliente para el origen, entrante para el destino), unido al
--   traslado, sin mover el inventario dos veces. No se reserva inventario. Se recibe
--   todo de una vez (como hoy), con el chuleo de siempre.
--
--   1. Al guardar un traslado en Inventario se crea su pedido interno «En camino»
--      (origin = 'transfer', transfer_id = el traslado). En Inventario el traslado ya
--      descuenta del origen al guardarse, por eso el pedido nace en camino: si naciera
--      «en preparación», al enviarlo se crearía otro traslado y saldría dos veces.
--      El inventario lo sigue moviendo SOLO el traslado (al crearlo y al recibirlo).
--      Se crea al final de la transacción (disparador diferido): si el traslado lo creó
--      un pedido al enviarse, ese pedido ya tiene el traslado y no se crea otro.
--      Nunca frena el traslado: si algo falla, el traslado queda igual y queda el aviso
--      en la auditoría.
--   2. Si se corrige el traslado (Inventario → Editar) mientras va en camino, su pedido
--      queda con los mismos productos y cantidades.
--   3. Cajas: en esos pedidos se pueden armar mientras va en camino y nadie ha empezado
--      a recibir (la mercancía se empaca después de guardar el traslado). En los demás,
--      como antes: solo antes de enviar.
--   4. Recibir por caja: quien recibe marca «Llegó esta caja»; los productos que quedan
--      completos con las cajas que llegaron se chulean solos en «lo que llegó». No mueve
--      inventario: el recibido se confirma una sola vez, como hoy.
--   5. El enlace del traslado (/traslado/<enlace>) muestra sus cajas.
--
-- Requiere 20261348 (cajas) y 20261277 (chuleo). No borra datos. Es idempotente.
-- =====================================================================

do $$
declare v_missing text;
begin
  if to_regclass('public.erp_sr_box') is null then raise exception 'Primero corre 20261348_cajas_pedidos.sql.'; end if;
  if to_regclass('public.erp_sr_item_checks') is null then raise exception 'Falta 20261277_pedido_checklist.sql.'; end if;
  -- Columnas obligatorias (sin valor por defecto) que este disparador no llenaría: si hay alguna, se detiene aquí.
  select string_agg(table_name || '.' || column_name, ', ') into v_missing
    from information_schema.columns
   where table_schema = 'public' and is_nullable = 'NO' and column_default is null
     and ((table_name = 'erp_stock_requests' and column_name not in ('id', 'store_id', 'number', 'from_point_id', 'to_point_id', 'status', 'origin'))
       or (table_name = 'erp_stock_request_items' and column_name not in ('id', 'request_id', 'product_id', 'qty_requested')));
  if v_missing is not null then
    raise exception 'No se puede crear el pedido de cada traslado: faltan datos obligatorios (%). Mándale este mensaje a soporte.', v_missing;
  end if;
end $$;

alter table public.erp_stock_requests add column if not exists origin text not null default 'request';
do $$ begin
  alter table public.erp_stock_requests add constraint erp_stock_requests_origin_check check (origin in ('request', 'transfer'));
exception when duplicate_object then null; end $$;

alter table public.erp_sr_box add column if not exists received_at timestamptz;
alter table public.erp_sr_box add column if not exists received_by_name text;

-- ---------------------------------------------------------------- número del pedido

-- El número sale igual que en «Nuevo pedido»: se lee cómo lo hace erp_stock_request_create en esta base.
do $$
declare v_def text; v_key text; v_body text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'erp_stock_request_create' limit 1;
  v_key := substring(coalesce(v_def, '') from 'erp_next_number\(\s*[a-zA-Z_.]+\s*,\s*''([^'']+)''');
  if v_key is not null then
    v_body := format('begin return public.erp_next_number(p_store, %L); end', v_key);
  else
    -- Sin contador propio: el siguiente después del mayor (bloqueando la tienda mientras se calcula).
    v_body := 'begin
      perform pg_advisory_xact_lock(hashtext(''erp_sr_number:'' || p_store::text));
      return coalesce((select max(number) from public.erp_stock_requests where store_id = p_store), 0) + 1;
    end';
  end if;
  execute format('create or replace function public.erp__sr_next_number(p_store uuid) returns bigint
    language plpgsql volatile security definer set search_path = public as $f$ %s $f$', v_body);
  execute 'revoke all on function public.erp__sr_next_number(uuid) from public, anon, authenticated';
end $$;

-- ---------------------------------------------------------------- 1. traslado → pedido

create or replace function public.erp__sr_from_transfer()
returns trigger language plpgsql security definer set search_path = public as $$
declare tr public.erp_transfers; v_id uuid; v_who text; v_from text; v_refs int; v_units int;
begin
  select * into tr from public.erp_transfers where id = new.id;
  if not found or tr.status <> 'in_transit' then return null; end if;
  -- Lo creó un pedido al enviarse (o ya tiene pedido): nada que hacer.
  if exists (select 1 from public.erp_stock_requests where transfer_id = tr.id) then return null; end if;
  select count(distinct product_id), coalesce(sum(qty), 0) into v_refs, v_units from public.erp_transfer_items where transfer_id = tr.id;
  if v_refs = 0 then return null; end if;
  begin
    v_who := coalesce(public.erp_actor_name(tr.store_id), 'Alguien');
    select name into v_from from public.erp_warehouses where id = tr.from_warehouse_id;
    insert into public.erp_stock_requests (store_id, number, from_point_id, to_point_id, status, origin, transfer_id, note,
                                           requested_by_name, handled_by_name, updated_at, last_message_at)
    values (tr.store_id, public.erp__sr_next_number(tr.store_id), tr.to_warehouse_id, tr.from_warehouse_id, 'dispatched', 'transfer', tr.id,
            left('🚚 Traslado #' || tr.number || ' hecho en Inventario' || coalesce(' · ' || nullif(btrim(tr.notes), ''), ''), 500),
            v_who, v_who, now(), now())
    returning id into v_id;
    begin
      execute 'update public.erp_stock_requests set requested_by = $1, handled_by = $1 where id = $2' using auth.uid(), v_id;
    exception when undefined_column then null;
    end;
    insert into public.erp_stock_request_items (request_id, product_id, qty_requested, qty_approved, source_qty_at_request, dest_qty_at_request)
    select v_id, x.product_id, x.q, x.q,
           coalesce((select l.qty from public.erp_stock_levels l where l.warehouse_id = tr.from_warehouse_id and l.product_id = x.product_id), 0) + x.q,
           coalesce((select l.qty from public.erp_stock_levels l where l.warehouse_id = tr.to_warehouse_id and l.product_id = x.product_id), 0)
      from (select product_id, sum(qty)::int q from public.erp_transfer_items where transfer_id = tr.id group by product_id) x;
    perform public.erp__sr_system(v_id, '🚚 ' || v_who || ' hizo el traslado #' || tr.number || ' en Inventario: ' || v_refs || ' ref. · '
      || v_units || ' und. Ya salió del inventario de ' || coalesce(v_from, 'el origen') || ' y entra al confirmar el recibido. Aquí pueden armar las cajas, chulear y recibir.');
    begin
      perform public.erp_audit(tr.store_id, 'stock_request.from_transfer', 'erp_stock_requests', v_id,
        jsonb_build_object('transfer', tr.number, 'transfer_id', tr.id, 'refs', v_refs, 'units', v_units));
    exception when undefined_function then null;
    end;
  exception when others then
    -- Nunca frena el traslado: queda constancia para revisarlo.
    begin
      perform public.erp_audit(tr.store_id, 'stock_request.from_transfer_failed', 'erp_transfers', tr.id,
        jsonb_build_object('transfer', tr.number, 'error', sqlerrm));
    exception when others then null;
    end;
  end;
  return null;
end $$;
revoke all on function public.erp__sr_from_transfer() from public, anon, authenticated;

drop trigger if exists erp_transfers_as_request on public.erp_transfers;
create constraint trigger erp_transfers_as_request after insert on public.erp_transfers
  deferrable initially deferred for each row execute function public.erp__sr_from_transfer();

-- ---------------------------------------------------------------- 2. corregir el traslado → su pedido

create or replace function public.erp__sr_sync_from_transfer()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_tr uuid := coalesce(new.transfer_id, old.transfer_id); tr public.erp_transfers; r public.erp_stock_requests; x record;
begin
  select * into tr from public.erp_transfers where id = v_tr;
  if not found or tr.status <> 'in_transit' then return null; end if;
  select * into r from public.erp_stock_requests where transfer_id = v_tr and origin = 'transfer' and status = 'dispatched' for update;
  if not found then return null; end if;
  begin
    for x in select product_id, sum(qty)::int q from public.erp_transfer_items where transfer_id = v_tr group by product_id loop
      if exists (select 1 from public.erp_stock_request_items where request_id = r.id and product_id = x.product_id) then
        update public.erp_stock_request_items set qty_requested = x.q, qty_approved = x.q
         where request_id = r.id and product_id = x.product_id and (qty_approved is distinct from x.q or qty_requested is distinct from x.q);
      else
        insert into public.erp_stock_request_items (request_id, product_id, qty_requested, qty_approved) values (r.id, x.product_id, x.q, x.q);
      end if;
    end loop;
    delete from public.erp_stock_request_items i
     where i.request_id = r.id and not exists (select 1 from public.erp_transfer_items ti where ti.transfer_id = v_tr and ti.product_id = i.product_id);
    update public.erp_stock_requests set updated_at = now() where id = r.id;
  exception when others then
    begin
      perform public.erp_audit(tr.store_id, 'stock_request.sync_failed', 'erp_transfers', tr.id, jsonb_build_object('transfer', tr.number, 'error', sqlerrm));
    exception when others then null;
    end;
  end;
  return null;
end $$;
revoke all on function public.erp__sr_sync_from_transfer() from public, anon, authenticated;

drop trigger if exists erp_transfer_items_sync_request on public.erp_transfer_items;
create constraint trigger erp_transfer_items_sync_request after insert or update or delete on public.erp_transfer_items
  deferrable initially deferred for each row execute function public.erp__sr_sync_from_transfer();

-- ---------------------------------------------------------------- 3. cajas mientras va en camino (solo pedidos de Inventario)

/** ¿Se pueden cambiar las cajas de este pedido? Antes de enviar; o, si nació de un traslado, mientras va en camino y nadie empezó a recibir. */
create or replace function public.erp__sr_box_editable(r public.erp_stock_requests)
returns boolean language sql stable security definer set search_path = public as $$
  select r.status in ('pending', 'preparing')
      or (r.origin = 'transfer' and r.status = 'dispatched'
          and not exists (select 1 from public.erp_sr_item_checks c where c.request_id = r.id and c.side = 'receive')
          and not exists (select 1 from public.erp_sr_box b where b.request_id = r.id and b.received_at is not null));
$$;
revoke all on function public.erp__sr_box_editable(public.erp_stock_requests) from public, anon, authenticated;

create or replace function public.erp__sr_box_lock(p_request uuid)
returns public.erp_stock_requests language plpgsql security definer set search_path = public as $$
declare r public.erp_stock_requests;
begin
  select * into r from public.erp_stock_requests where id = p_request for update;
  if not found then raise exception 'Pedido no encontrado.'; end if;
  if not coalesce((public.erp__sr_access(r.store_id, r.from_point_id, r.to_point_id) ->> 'attend')::boolean, false) then
    raise exception 'Solo quien despacha arma las cajas.';
  end if;
  if not public.erp__sr_box_editable(r) then
    raise exception 'El pedido #% ya salió o ya empezaron a recibirlo: las cajas ya no se cambian.', r.number;
  end if;
  return r;
end $$;
revoke all on function public.erp__sr_box_lock(uuid) from public, anon, authenticated;

create or replace function public.erp_sr_boxes(p_request uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r public.erp_stock_requests; v_acc jsonb;
begin
  if not public.erp__sr_visible(p_request) then return jsonb_build_object('boxes', '[]'::jsonb, 'can_edit', false, 'can_receive', false); end if;
  select * into r from public.erp_stock_requests where id = p_request;
  v_acc := public.erp__sr_access(r.store_id, r.from_point_id, r.to_point_id);
  return jsonb_build_object(
    'can_edit', public.erp__sr_box_editable(r) and coalesce((v_acc ->> 'attend')::boolean, false),
    'can_receive', r.status = 'dispatched' and coalesce((v_acc ->> 'request')::boolean, false),
    'origin', r.origin,
    'boxes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'number', b.number, 'name', b.name, 'color', b.color, 'notes', b.notes, 'fragile', b.fragile,
        'weight_kg', b.weight_kg, 'dims', b.dims, 'seal', b.seal, 'status', b.status, 'token', b.token,
        'created_by_name', b.created_by_name, 'created_at', b.created_at, 'updated_at', b.updated_at,
        'closed_at', b.closed_at, 'closed_by_name', b.closed_by_name, 'received_at', b.received_at, 'received_by_name', b.received_by_name,
        'items', coalesce((select jsonb_agg(jsonb_build_object('item_id', x.item_id, 'qty', x.qty) order by x.updated_at)
                             from public.erp_sr_box_items x where x.box_id = b.id), '[]'::jsonb)
      ) order by b.number)
      from public.erp_sr_box b where b.request_id = p_request), '[]'::jsonb));
end $$;
revoke all on function public.erp_sr_boxes(uuid) from public, anon;
grant execute on function public.erp_sr_boxes(uuid) to authenticated;

-- ---------------------------------------------------------------- 4. recibir por caja

/**
 * «Llegó esta caja» (quien recibe, mientras va en camino). Los productos que quedan completos con las cajas que
 * llegaron se chulean solos en «lo que llegó». No mueve inventario: el recibido se confirma una vez, como siempre.
 * Desmarcarla quita el chulo de sus productos que ya no quedan completos.
 */
create or replace function public.erp_sr_box_receive(p_box uuid, p_on boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_req uuid; r public.erp_stock_requests; b public.erp_sr_box; v_who text; v_refs int; v_units int; v_total int; v_got int; x record;
begin
  select request_id into v_req from public.erp_sr_box where id = p_box;
  if v_req is null then raise exception 'Caja no encontrada.'; end if;
  select * into r from public.erp_stock_requests where id = v_req for update;
  if not coalesce((public.erp__sr_access(r.store_id, r.from_point_id, r.to_point_id) ->> 'request')::boolean, false) then
    raise exception 'Solo quien recibe marca las cajas que llegaron.';
  end if;
  if r.status <> 'dispatched' then raise exception 'Las cajas se marcan mientras el pedido va en camino.'; end if;
  select * into b from public.erp_sr_box where id = p_box for update;
  if (b.received_at is not null) = coalesce(p_on, false) then return jsonb_build_object('ok', true, 'number', b.number, 'repeated', true); end if;
  v_who := public.erp_actor_name(r.store_id);
  update public.erp_sr_box set received_at = case when p_on then clock_timestamp() end, received_by_name = case when p_on then v_who end
   where id = b.id;

  -- Productos de esta caja: ¿quedan completos con las cajas que ya llegaron?
  for x in
    select i.id item_id, coalesce(i.qty_approved, i.qty_requested) to_send,
           coalesce((select sum(bi.qty) from public.erp_sr_box_items bi join public.erp_sr_box bb on bb.id = bi.box_id
                      where bi.item_id = i.id and bb.received_at is not null), 0) got
      from public.erp_stock_request_items i
     where i.id in (select item_id from public.erp_sr_box_items where box_id = b.id)
  loop
    if x.got >= x.to_send then
      insert into public.erp_sr_item_checks (item_id, request_id, side, checked_by, checked_by_name)
      values (x.item_id, r.id, 'receive', auth.uid(), v_who) on conflict (item_id, side) do nothing;
    else
      delete from public.erp_sr_item_checks where item_id = x.item_id and side = 'receive';
    end if;
  end loop;

  select count(*), coalesce(sum(qty), 0) into v_refs, v_units from public.erp_sr_box_items where box_id = b.id;
  select count(*), count(received_at) into v_total, v_got from public.erp_sr_box where request_id = r.id;
  perform public.erp__sr_system(r.id, case when p_on
    then '📥 ' || v_who || ' recibió la ' || public.erp__sr_box_label(b) || ' (' || v_refs || ' ref. · ' || v_units || ' und.)'
         || case when v_got = v_total then ' · ✅ llegaron las ' || v_total || ' cajas.' else ' · van ' || v_got || ' de ' || v_total || ' cajas.' end
    else '↩️ ' || v_who || ' desmarcó la ' || public.erp__sr_box_label(b) || ' como recibida.' end);
  update public.erp_stock_requests set updated_at = now() where id = r.id;
  begin
    perform public.erp_audit(r.store_id, case when p_on then 'stock_request.box_received' else 'stock_request.box_unreceived' end,
      'erp_stock_requests', r.id, jsonb_build_object('number', r.number, 'box', b.number, 'refs', v_refs, 'units', v_units));
  exception when undefined_function then null;
  end;
  return jsonb_build_object('ok', true, 'number', b.number, 'received', v_got, 'total', v_total);
end $$;
revoke all on function public.erp_sr_box_receive(uuid, boolean) from public, anon;
grant execute on function public.erp_sr_box_receive(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------- 5. cajas en el enlace del traslado

/** Las cajas del pedido de un traslado, para su enlace público (mismo enlace y vencimiento que el traslado). Sin costos. */
create or replace function public.erp_transfer_track_boxes(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tr public.erp_transfers; v_req uuid;
begin
  if p_token is null or char_length(p_token) < 8 then return '[]'::jsonb; end if;
  select * into tr from public.erp_transfers t
   where t.track_token::text = p_token
     and (t.track_expires_at is null or t.track_expires_at > now() or t.status <> 'in_transit');
  if not found then return '[]'::jsonb; end if;
  select id into v_req from public.erp_stock_requests where transfer_id = tr.id limit 1;
  if v_req is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'number', b.number, 'name', b.name, 'color', b.color, 'fragile', b.fragile, 'seal', b.seal, 'status', b.status,
      'received_at', b.received_at,
      'items', coalesce((select jsonb_agg(jsonb_build_object('name', p.name, 'sku', p.sku, 'qty', bi.qty) order by p.name)
                           from public.erp_sr_box_items bi join public.erp_stock_request_items i on i.id = bi.item_id
                           join public.products p on p.id = i.product_id where bi.box_id = b.id), '[]'::jsonb)
    ) order by b.number) from public.erp_sr_box b where b.request_id = v_req), '[]'::jsonb);
end $$;
revoke all on function public.erp_transfer_track_boxes(text) from public;
grant execute on function public.erp_transfer_track_boxes(text) to anon, authenticated;

-- ---------------------------------------------------------------- 6. novedades por producto

-- Los comentarios por producto (20261283) son las novedades: se suman «faltó», «llegó de más» y «producto equivocado»
-- a «dañado» y «cambiar por otro». Registrar una novedad no mueve inventario.
do $$
declare c text;
begin
  if to_regclass('public.erp_sr_item_comments') is null then return; end if;
  for c in select conname from pg_constraint where conrelid = 'public.erp_sr_item_comments'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) like '%tag%' loop
    execute format('alter table public.erp_sr_item_comments drop constraint %I', c);
  end loop;
  alter table public.erp_sr_item_comments add constraint erp_sr_item_comments_tag_check
    check (tag in ('note', 'more', 'variant', 'damaged', 'swap', 'photo', 'ok', 'missing', 'extra', 'wrong'));
end $$;

create or replace function public.erp_sr_item_comment_add(p_request uuid, p_item uuid, p_body text, p_tag text default 'note', p_qty integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.erp_stock_requests; it public.erp_stock_request_items; v_id uuid; v_body text := btrim(coalesce(p_body, ''));
begin
  if auth.uid() is null then raise exception 'Inicia sesión.'; end if;
  select * into r from public.erp_stock_requests where id = p_request;
  if not found or not public.erp__sr_visible(p_request) then raise exception 'Pedido no encontrado.'; end if;
  select * into it from public.erp_stock_request_items where id = p_item and request_id = r.id;
  if not found then raise exception 'Ese producto no está en el pedido.'; end if;
  if coalesce(p_tag, 'note') not in ('note', 'more', 'variant', 'damaged', 'swap', 'photo', 'ok', 'missing', 'extra', 'wrong') then raise exception 'Etiqueta no válida.'; end if;
  if v_body = '' then raise exception 'Escribe el comentario.'; end if;
  if length(v_body) > 600 then raise exception 'El comentario es muy largo (máximo 600 letras).'; end if;
  if p_qty is not null and (p_qty < 1 or p_qty > 100000) then raise exception 'La cantidad no es válida.'; end if;
  -- Freno contra envíos repetidos por error (doble toque).
  if exists (select 1 from public.erp_sr_item_comments c where c.item_id = p_item and c.user_id = auth.uid() and c.body = v_body and c.created_at > now() - interval '10 seconds') then
    raise exception 'Ese comentario ya se envió.';
  end if;
  insert into public.erp_sr_item_comments (request_id, item_id, product_id, store_id, user_id, user_name, body, tag, qty)
  values (r.id, p_item, it.product_id, r.store_id, auth.uid(), public.erp_actor_name(r.store_id), v_body, coalesce(p_tag, 'note'), p_qty)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function public.erp_sr_item_comment_add(uuid, uuid, text, text, integer) from public, anon;
grant execute on function public.erp_sr_item_comment_add(uuid, uuid, text, text, integer) to authenticated;

notify pgrst, 'reload schema';
