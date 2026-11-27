-- =====================================================================
-- REMHUB · Cajas en los pedidos internos (Logística, fase 4 — docs/LOGISTICA_REMHUB.md)
--
--   Quien despacha guarda los productos del pedido en cajas virtuales que son las
--   cajas físicas: Caja 1, Caja 2… Un mismo producto se puede repartir entre varias
--   cajas (30 en la 1, 40 en la 2, 10 sin caja).
--
--   · Las cajas NO mueven inventario: el inventario sigue saliendo al enviar y
--     entrando al recibir, como hoy. Una caja solo dice dónde va cada unidad.
--   · Nunca se pierde un producto: borrar una caja solo se puede si está vacía, y
--     vaciarla devuelve sus unidades a «sin caja». El pedido no cambia.
--   · Ninguna unidad queda en dos cajas: la suma de las cajas de un producto nunca
--     pasa de lo que se envía. Cada cambio bloquea el pedido mientras se guarda
--     (dos personas empacando a la vez no se pisan) y lleva llave para no repetirse.
--   · Solo quien despacha (mismo permiso que chulear el empaque) y solo antes de que
--     salga el pedido. Después, las cajas quedan como constancia (solo ver).
--   · Cada caja tiene un código propio (token) para su QR: el QR no lleva datos, se
--     resuelve con sesión y permisos (erp_sr_box_resolve).
--
--   erp_sr_boxes · erp_sr_box_put · erp_sr_box_take · erp_sr_box_move ·
--   erp_sr_box_update · erp_sr_box_close · erp_sr_box_delete · erp_sr_box_resolve
-- Requiere 20261345 (erp__sr_perms / erp__sr_access). No borra datos. Es idempotente.
-- =====================================================================

do $$
begin
  if to_regprocedure('public.erp__sr_access(uuid,uuid,uuid)') is null then
    raise exception 'Primero corre 20261345_funciones_rapidas.sql (falta erp__sr_access).';
  end if;
end $$;

create table if not exists public.erp_sr_box (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.erp_stock_requests(id) on delete cascade,
  store_id uuid not null,
  number integer not null,
  name text,
  color text,
  notes text,
  fragile boolean not null default false,
  weight_kg numeric(8,2),
  dims text,
  seal text,
  status text not null default 'open' check (status in ('open', 'closed')),
  token uuid not null default gen_random_uuid(),
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  closed_at timestamptz,
  closed_by_name text,
  unique (request_id, number),
  unique (token),
  check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  check (char_length(coalesce(name, '')) <= 60 and char_length(coalesce(notes, '')) <= 500
         and char_length(coalesce(dims, '')) <= 60 and char_length(coalesce(seal, '')) <= 60),
  check (weight_kg is null or (weight_kg >= 0 and weight_kg < 100000))
);
create index if not exists erp_sr_box_request on public.erp_sr_box (request_id);

create table if not exists public.erp_sr_box_items (
  box_id uuid not null references public.erp_sr_box(id) on delete cascade,
  item_id uuid not null references public.erp_stock_request_items(id) on delete cascade,
  request_id uuid not null references public.erp_stock_requests(id) on delete cascade,
  qty integer not null check (qty > 0 and qty <= 1000000),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (box_id, item_id)
);
create index if not exists erp_sr_box_items_request on public.erp_sr_box_items (request_id);
create index if not exists erp_sr_box_items_item on public.erp_sr_box_items (item_id);

-- Llaves de cada cambio (doble toque o reintento al volver la conexión: no se repite).
create table if not exists public.erp_sr_box_ops (
  key uuid primary key,
  request_id uuid not null references public.erp_stock_requests(id) on delete cascade,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);

-- Solo lectura con sesión, y solo quien ve el pedido. Se escribe únicamente por las funciones.
alter table public.erp_sr_box enable row level security;
alter table public.erp_sr_box_items enable row level security;
alter table public.erp_sr_box_ops enable row level security;
revoke all on public.erp_sr_box, public.erp_sr_box_items, public.erp_sr_box_ops from anon, authenticated;
grant select on public.erp_sr_box, public.erp_sr_box_items to authenticated;
drop policy if exists erp_sr_box_read on public.erp_sr_box;
create policy erp_sr_box_read on public.erp_sr_box for select to authenticated using (public.erp__sr_visible(request_id));
drop policy if exists erp_sr_box_items_read on public.erp_sr_box_items;
create policy erp_sr_box_items_read on public.erp_sr_box_items for select to authenticated using (public.erp__sr_visible(request_id));

-- ---------------------------------------------------------------- ayudas internas

/** Bloquea el pedido para cambiar sus cajas: debe existir, ser tuyo para despachar y no haber salido. */
create or replace function public.erp__sr_box_lock(p_request uuid)
returns public.erp_stock_requests language plpgsql security definer set search_path = public as $$
declare r public.erp_stock_requests;
begin
  select * into r from public.erp_stock_requests where id = p_request for update;
  if not found then raise exception 'Pedido no encontrado.'; end if;
  if not coalesce((public.erp__sr_access(r.store_id, r.from_point_id, r.to_point_id) ->> 'attend')::boolean, false) then
    raise exception 'Solo quien despacha arma las cajas.';
  end if;
  if r.status not in ('pending', 'preparing') then
    raise exception 'El pedido #% ya salió: las cajas ya no se cambian.', r.number;
  end if;
  return r;
end $$;
revoke all on function public.erp__sr_box_lock(uuid) from public, anon, authenticated;

/** Lo que llega en p_items ([{item_id, qty}]) limpio: productos del pedido, cantidades enteras > 0, sin repetidos (se suman). */
create or replace function public.erp__sr_box_lines(p_request uuid, p_items jsonb)
returns table (item_id uuid, qty integer, name text, to_send integer) language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare e jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Elige al menos un producto.';
  end if;
  if jsonb_array_length(p_items) > 2000 then raise exception 'Demasiados productos en un solo cambio.'; end if;
  for e in select * from jsonb_array_elements(p_items) loop
    if coalesce(e ->> 'item_id', '') !~ '^[0-9a-fA-F-]{36}$' then raise exception 'Producto no válido.'; end if;
    if coalesce(e ->> 'qty', '') !~ '^\d{1,7}$' or (e ->> 'qty')::int <= 0 or (e ->> 'qty')::int > 1000000 then
      raise exception 'Escribe una cantidad válida (entera, mayor que 0).';
    end if;
  end loop;
  if exists (select 1 from jsonb_array_elements(p_items) e3
              where not exists (select 1 from public.erp_stock_request_items i where i.id = (e3 ->> 'item_id')::uuid and i.request_id = p_request)) then
    raise exception 'Ese producto no está en el pedido.';
  end if;
  return query
    select i.id, sum((e2 ->> 'qty')::int)::int, coalesce(p.name, 'Producto'), coalesce(i.qty_approved, i.qty_requested)::int
      from jsonb_array_elements(p_items) e2
      join public.erp_stock_request_items i on i.id = (e2 ->> 'item_id')::uuid and i.request_id = p_request
      left join public.products p on p.id = i.product_id
     group by i.id, p.name, i.qty_approved, i.qty_requested;
end $$;
revoke all on function public.erp__sr_box_lines(uuid, jsonb) from public, anon, authenticated;

/** Deja constancia: el pedido «cambió» (lo ven todos en vivo) y la auditoría. */
create or replace function public.erp__sr_box_touch(r public.erp_stock_requests, p_action text, p_detail jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.erp_stock_requests set updated_at = now() where id = r.id;
  begin
    perform public.erp_audit(r.store_id, p_action, 'erp_stock_requests', r.id, p_detail || jsonb_build_object('number', r.number));
  exception when undefined_function then null;
  end;
end $$;
revoke all on function public.erp__sr_box_touch(public.erp_stock_requests, text, jsonb) from public, anon, authenticated;

/** ¿Ya se hizo este cambio (misma llave)? Devuelve lo que respondió la primera vez. */
create or replace function public.erp__sr_box_seen(p_key uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when p_key is null then null else (select result || jsonb_build_object('repeated', true) from public.erp_sr_box_ops where key = p_key) end;
$$;
revoke all on function public.erp__sr_box_seen(uuid) from public, anon, authenticated;

create or replace function public.erp__sr_box_label(b public.erp_sr_box)
returns text language sql immutable as $$
  select 'Caja ' || b.number || coalesce(' «' || nullif(btrim(b.name), '') || '»', '');
$$;

-- ---------------------------------------------------------------- consultar

/** Las cajas de un pedido con lo que lleva cada una. `can_edit`: si tú puedes cambiarlas ahora. */
create or replace function public.erp_sr_boxes(p_request uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r public.erp_stock_requests;
begin
  if not public.erp__sr_visible(p_request) then return jsonb_build_object('boxes', '[]'::jsonb, 'can_edit', false); end if;
  select * into r from public.erp_stock_requests where id = p_request;
  return jsonb_build_object(
    'can_edit', r.status in ('pending', 'preparing')
      and coalesce((public.erp__sr_access(r.store_id, r.from_point_id, r.to_point_id) ->> 'attend')::boolean, false),
    'boxes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'number', b.number, 'name', b.name, 'color', b.color, 'notes', b.notes, 'fragile', b.fragile,
        'weight_kg', b.weight_kg, 'dims', b.dims, 'seal', b.seal, 'status', b.status, 'token', b.token,
        'created_by_name', b.created_by_name, 'created_at', b.created_at, 'updated_at', b.updated_at,
        'closed_at', b.closed_at, 'closed_by_name', b.closed_by_name,
        'items', coalesce((select jsonb_agg(jsonb_build_object('item_id', x.item_id, 'qty', x.qty) order by x.updated_at)
                             from public.erp_sr_box_items x where x.box_id = b.id), '[]'::jsonb)
      ) order by b.number)
      from public.erp_sr_box b where b.request_id = p_request), '[]'::jsonb));
end $$;
revoke all on function public.erp_sr_boxes(uuid) from public, anon;
grant execute on function public.erp_sr_boxes(uuid) to authenticated;

-- ---------------------------------------------------------------- guardar en caja

/**
 * Guardar en caja: p_box = una caja abierta del pedido, o null para crear la siguiente (Caja N).
 * p_new (solo al crear): {name, color, notes, fragile}. Suma a lo que ya tenga la caja.
 * Nunca pasa de lo que se envía de cada producto contando todas las cajas.
 */
create or replace function public.erp_sr_box_put(p_request uuid, p_box uuid, p_items jsonb, p_new jsonb default null, p_key uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.erp_stock_requests; b public.erp_sr_box; l record; v_in int; v_seen jsonb; v_res jsonb;
  v_refs int := 0; v_units int := 0; v_color text;
begin
  r := public.erp__sr_box_lock(p_request);
  v_seen := public.erp__sr_box_seen(p_key);
  if v_seen is not null then return v_seen; end if;

  if p_box is null then
    if (select count(*) from public.erp_sr_box where request_id = r.id) >= 300 then raise exception 'Máximo 300 cajas por pedido.'; end if;
    v_color := nullif(btrim(coalesce(p_new ->> 'color', '')), '');
    if v_color is not null and v_color !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Color no válido.'; end if;
    insert into public.erp_sr_box (request_id, store_id, number, name, color, notes, fragile, created_by, created_by_name)
    values (r.id, r.store_id, coalesce((select max(number) from public.erp_sr_box where request_id = r.id), 0) + 1,
            nullif(btrim(left(coalesce(p_new ->> 'name', ''), 60)), ''), v_color,
            nullif(btrim(left(coalesce(p_new ->> 'notes', ''), 500)), ''), coalesce((p_new ->> 'fragile')::boolean, false),
            auth.uid(), public.erp_actor_name(r.store_id))
    returning * into b;
  else
    select * into b from public.erp_sr_box where id = p_box and request_id = r.id for update;
    if not found then raise exception 'Esa caja no es de este pedido.'; end if;
    if b.status = 'closed' then raise exception '% está cerrada: ábrela para agregar.', public.erp__sr_box_label(b); end if;
  end if;

  for l in select * from public.erp__sr_box_lines(r.id, p_items) loop
    select coalesce(sum(qty), 0) into v_in from public.erp_sr_box_items where item_id = l.item_id;
    if v_in + l.qty > l.to_send then
      raise exception 'De % solo quedan % sin caja (se envían %).', l.name, greatest(l.to_send - v_in, 0), l.to_send;
    end if;
    insert into public.erp_sr_box_items (box_id, item_id, request_id, qty) values (b.id, l.item_id, r.id, l.qty)
    on conflict (box_id, item_id) do update set qty = public.erp_sr_box_items.qty + excluded.qty, updated_at = clock_timestamp();
    v_refs := v_refs + 1; v_units := v_units + l.qty;
  end loop;
  update public.erp_sr_box set updated_at = clock_timestamp() where id = b.id;

  if p_box is null then
    perform public.erp__sr_system(r.id, '📦 ' || coalesce(b.created_by_name, 'Alguien') || ' armó la ' || public.erp__sr_box_label(b)
      || ': ' || v_refs || ' ref. · ' || v_units || ' und.');
  end if;
  perform public.erp__sr_box_touch(r, case when p_box is null then 'stock_request.box_create' else 'stock_request.box_put' end,
    jsonb_build_object('box', b.number, 'items', p_items));
  v_res := jsonb_build_object('ok', true, 'box_id', b.id, 'number', b.number, 'refs', v_refs, 'units', v_units);
  if p_key is not null then insert into public.erp_sr_box_ops (key, request_id, result) values (p_key, r.id, v_res); end if;
  return v_res;
end $$;
revoke all on function public.erp_sr_box_put(uuid, uuid, jsonb, jsonb, uuid) from public, anon;
grant execute on function public.erp_sr_box_put(uuid, uuid, jsonb, jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------- sacar de la caja

/** Sacar unidades de una caja (vuelven a «sin caja»). p_items null = vaciar la caja. */
create or replace function public.erp_sr_box_take(p_box uuid, p_items jsonb default null, p_key uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.erp_stock_requests; b public.erp_sr_box; l record; v_have int; v_seen jsonb; v_res jsonb; v_units int := 0; v_req uuid;
begin
  select request_id into v_req from public.erp_sr_box where id = p_box;
  if v_req is null then raise exception 'Caja no encontrada.'; end if;
  r := public.erp__sr_box_lock(v_req);
  v_seen := public.erp__sr_box_seen(p_key);
  if v_seen is not null then return v_seen; end if;
  select * into b from public.erp_sr_box where id = p_box for update;
  if b.status = 'closed' then raise exception '% está cerrada: ábrela para sacar productos.', public.erp__sr_box_label(b); end if;

  if p_items is null then
    select coalesce(sum(qty), 0) into v_units from public.erp_sr_box_items where box_id = b.id;
    delete from public.erp_sr_box_items where box_id = b.id;
  else
    for l in select * from public.erp__sr_box_lines(r.id, p_items) loop
      select qty into v_have from public.erp_sr_box_items where box_id = b.id and item_id = l.item_id for update;
      if coalesce(v_have, 0) < l.qty then
        raise exception 'En la % hay % de % (quieres sacar %).', public.erp__sr_box_label(b), coalesce(v_have, 0), l.name, l.qty;
      end if;
      if v_have = l.qty then delete from public.erp_sr_box_items where box_id = b.id and item_id = l.item_id;
      else update public.erp_sr_box_items set qty = qty - l.qty, updated_at = clock_timestamp() where box_id = b.id and item_id = l.item_id; end if;
      v_units := v_units + l.qty;
    end loop;
  end if;
  update public.erp_sr_box set updated_at = clock_timestamp() where id = b.id;
  perform public.erp__sr_box_touch(r, case when p_items is null then 'stock_request.box_empty' else 'stock_request.box_take' end,
    jsonb_build_object('box', b.number, 'items', p_items, 'units', v_units));
  v_res := jsonb_build_object('ok', true, 'box_id', b.id, 'number', b.number, 'units', v_units);
  if p_key is not null then insert into public.erp_sr_box_ops (key, request_id, result) values (p_key, r.id, v_res); end if;
  return v_res;
end $$;
revoke all on function public.erp_sr_box_take(uuid, jsonb, uuid) from public, anon;
grant execute on function public.erp_sr_box_take(uuid, jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------- mover entre cajas

/** Pasar unidades de una caja a otra (o a una nueva si p_to es null), todo o nada. */
create or replace function public.erp_sr_box_move(p_from uuid, p_to uuid, p_items jsonb, p_key uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_req uuid; r public.erp_stock_requests; a public.erp_sr_box; t jsonb; p jsonb; v_seen jsonb; v_res jsonb;
begin
  select request_id into v_req from public.erp_sr_box where id = p_from;
  if v_req is null then raise exception 'Caja no encontrada.'; end if;
  if p_to is not null and not exists (select 1 from public.erp_sr_box where id = p_to and request_id = v_req) then
    raise exception 'Las dos cajas deben ser del mismo pedido.';
  end if;
  if p_to = p_from then raise exception 'Elige otra caja.'; end if;
  r := public.erp__sr_box_lock(v_req);
  v_seen := public.erp__sr_box_seen(p_key);
  if v_seen is not null then return v_seen; end if;
  select * into a from public.erp_sr_box where id = p_from;
  t := public.erp_sr_box_take(p_from, p_items, null);
  p := public.erp_sr_box_put(v_req, p_to, p_items, null, null);
  v_res := jsonb_build_object('ok', true, 'from', a.number, 'to', p -> 'number', 'to_id', p -> 'box_id', 'units', t -> 'units');
  if p_key is not null then insert into public.erp_sr_box_ops (key, request_id, result) values (p_key, r.id, v_res); end if;
  return v_res;
end $$;
revoke all on function public.erp_sr_box_move(uuid, uuid, jsonb, uuid) from public, anon;
grant execute on function public.erp_sr_box_move(uuid, uuid, jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------- datos de la caja

/** Nombre, color, notas, frágil, peso, medidas y sello. Solo se cambian las claves que lleguen. */
create or replace function public.erp_sr_box_update(p_box uuid, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_req uuid; r public.erp_stock_requests; b public.erp_sr_box; v_color text; v_w numeric;
begin
  select request_id into v_req from public.erp_sr_box where id = p_box;
  if v_req is null then raise exception 'Caja no encontrada.'; end if;
  r := public.erp__sr_box_lock(v_req);
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'Nada que cambiar.'; end if;
  if p_patch ? 'color' then
    v_color := nullif(btrim(coalesce(p_patch ->> 'color', '')), '');
    if v_color is not null and v_color !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Color no válido.'; end if;
  end if;
  if p_patch ? 'weight_kg' and nullif(btrim(coalesce(p_patch ->> 'weight_kg', '')), '') is not null then
    if (p_patch ->> 'weight_kg') !~ '^\d{1,5}(\.\d{1,2})?$' then raise exception 'Peso no válido (kg, hasta 2 decimales).'; end if;
    v_w := (p_patch ->> 'weight_kg')::numeric;
  end if;
  update public.erp_sr_box set
    name = case when p_patch ? 'name' then nullif(btrim(left(coalesce(p_patch ->> 'name', ''), 60)), '') else name end,
    color = case when p_patch ? 'color' then v_color else color end,
    notes = case when p_patch ? 'notes' then nullif(btrim(left(coalesce(p_patch ->> 'notes', ''), 500)), '') else notes end,
    fragile = case when p_patch ? 'fragile' then coalesce((p_patch ->> 'fragile')::boolean, false) else fragile end,
    weight_kg = case when p_patch ? 'weight_kg' then v_w else weight_kg end,
    dims = case when p_patch ? 'dims' then nullif(btrim(left(coalesce(p_patch ->> 'dims', ''), 60)), '') else dims end,
    seal = case when p_patch ? 'seal' then nullif(btrim(left(coalesce(p_patch ->> 'seal', ''), 60)), '') else seal end,
    updated_at = clock_timestamp()
  where id = p_box returning * into b;
  perform public.erp__sr_box_touch(r, 'stock_request.box_update', jsonb_build_object('box', b.number, 'patch', p_patch));
  return jsonb_build_object('ok', true, 'box_id', b.id, 'number', b.number);
end $$;
revoke all on function public.erp_sr_box_update(uuid, jsonb) from public, anon;
grant execute on function public.erp_sr_box_update(uuid, jsonb) to authenticated;

/** Cerrar (lista y sellada) o volver a abrir una caja. Queda en el chat. */
create or replace function public.erp_sr_box_close(p_box uuid, p_close boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_req uuid; r public.erp_stock_requests; b public.erp_sr_box; v_who text; v_refs int; v_units int;
begin
  select request_id into v_req from public.erp_sr_box where id = p_box;
  if v_req is null then raise exception 'Caja no encontrada.'; end if;
  r := public.erp__sr_box_lock(v_req);
  select * into b from public.erp_sr_box where id = p_box for update;
  if (b.status = 'closed') = coalesce(p_close, false) then return jsonb_build_object('ok', true, 'number', b.number, 'status', b.status, 'repeated', true); end if;
  select count(*), coalesce(sum(qty), 0) into v_refs, v_units from public.erp_sr_box_items where box_id = b.id;
  if p_close and v_refs = 0 then raise exception '% está vacía: no se cierra una caja sin productos.', public.erp__sr_box_label(b); end if;
  v_who := public.erp_actor_name(r.store_id);
  update public.erp_sr_box set status = case when p_close then 'closed' else 'open' end,
    closed_at = case when p_close then clock_timestamp() else null end,
    closed_by_name = case when p_close then v_who else null end, updated_at = clock_timestamp()
  where id = p_box returning * into b;
  perform public.erp__sr_system(r.id, case when p_close
    then '🔒 ' || v_who || ' cerró la ' || public.erp__sr_box_label(b) || ': ' || v_refs || ' ref. · ' || v_units || ' und.' || coalesce(' · sello ' || b.seal, '')
    else '🔓 ' || v_who || ' volvió a abrir la ' || public.erp__sr_box_label(b) || '.' end);
  perform public.erp__sr_box_touch(r, case when p_close then 'stock_request.box_close' else 'stock_request.box_reopen' end,
    jsonb_build_object('box', b.number, 'refs', v_refs, 'units', v_units));
  return jsonb_build_object('ok', true, 'number', b.number, 'status', b.status);
end $$;
revoke all on function public.erp_sr_box_close(uuid, boolean) from public, anon;
grant execute on function public.erp_sr_box_close(uuid, boolean) to authenticated;

/** Borrar una caja: solo vacía (primero se vacía y sus productos vuelven a «sin caja»). Los números de las demás no cambian. */
create or replace function public.erp_sr_box_delete(p_box uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_req uuid; r public.erp_stock_requests; b public.erp_sr_box;
begin
  select request_id into v_req from public.erp_sr_box where id = p_box;
  if v_req is null then return jsonb_build_object('ok', true, 'repeated', true); end if;
  r := public.erp__sr_box_lock(v_req);
  select * into b from public.erp_sr_box where id = p_box for update;
  if exists (select 1 from public.erp_sr_box_items where box_id = b.id) then
    raise exception '% tiene productos: vacíala primero (vuelven a «sin caja»).', public.erp__sr_box_label(b);
  end if;
  delete from public.erp_sr_box where id = b.id;
  perform public.erp__sr_box_touch(r, 'stock_request.box_delete', jsonb_build_object('box', b.number));
  return jsonb_build_object('ok', true, 'number', b.number);
end $$;
revoke all on function public.erp_sr_box_delete(uuid) from public, anon;
grant execute on function public.erp_sr_box_delete(uuid) to authenticated;

/** QR de una caja → su pedido. Solo si tienes sesión y ves ese pedido; si no, nada (no dice si existe). */
create or replace function public.erp_sr_box_resolve(p_token uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b public.erp_sr_box;
begin
  select * into b from public.erp_sr_box where token = p_token;
  if not found or not public.erp__sr_visible(b.request_id) then return null; end if;
  return jsonb_build_object('request_id', b.request_id, 'box_id', b.id, 'number', b.number);
end $$;
revoke all on function public.erp_sr_box_resolve(uuid) from public, anon;
grant execute on function public.erp_sr_box_resolve(uuid) to authenticated;

notify pgrst, 'reload schema';
