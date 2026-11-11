-- 20261317 · Números de documento sin choques, nombre del dueño y cartera al editar una venta.
--
-- 1) Prefijos únicos por punto (todas las tiendas):
--    · Cada punto nacía con «REM»/«FAC»: el segundo punto de una tienda chocaba con REM-00001 del primero y la venta
--      quedaba sin punto, sin vendedor y sin cartera (caso #193 de LA VITRINA).
--    · Se arreglan los prefijos repetidos de los puntos que todavía NO tienen documentos con ese prefijo (los que ya
--      tienen documentos se dejan igual). El nuevo prefijo lleva las iniciales del punto: «Bodega principal» → REMBP.
--    · Los puntos nuevos reciben solos un prefijo propio si el que traen ya lo usa otro punto (disparador).
--    · erp_tag_order salta un número que ya exista en la tienda en vez de fallar.
-- 2) El dueño sale con su nombre («¿Cómo quieres que te llamemos?») y no con su correo, en la lista de vendedores
--    y en «quién lo hizo» (erp_actor_name). Si no ha escrito un nombre, sigue saliendo el correo.
-- 3) Editar una venta a crédito ajusta su cuenta por cobrar: total y saldo suben o bajan con el nuevo total.
--    Si ya tiene abonos por más del nuevo total, no deja guardar.
-- Las funciones parten de su versión actual en producción (2026-11-11). Se puede correr dos veces.

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Prefijos
-- ---------------------------------------------------------------------------------------------------------------

-- Prefijo libre para un punto: base + iniciales del nombre (máx. 12), y un número si hace falta.
create or replace function public.erp__unique_prefix(p_store uuid, p_self uuid, p_base text, p_name text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_base text := upper(regexp_replace(coalesce(nullif(trim(p_base), ''), 'DOC'), '[^A-Za-z0-9]', '', 'g'));
  v_ini text;
  v_try text;
  i integer := 1;
begin
  select string_agg(left(w, 1), '') into v_ini
  from (select w from regexp_split_to_table(
          upper(translate(coalesce(p_name, ''), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN')), '[^A-Z0-9]+') w
        where w <> '' limit 3) x;
  v_ini := coalesce(nullif(v_ini, ''), 'P');
  loop
    v_try := left(v_base || v_ini || case when i = 1 then '' else i::text end, 12);
    exit when not exists (
      select 1 from public.erp_warehouses o
      where o.store_id = p_store and o.id is distinct from p_self
        and (upper(coalesce(o.remision_prefix, '')) = v_try or upper(coalesce(o.invoice_prefix, '')) = v_try))
      and not exists (select 1 from public.erp_order_meta m where m.store_id = p_store and upper(coalesce(m.doc_prefix, '')) = v_try);
    i := i + 1;
    if i > 99 then return v_try || to_char(clock_timestamp(), 'SS'); end if;
  end loop;
  return v_try;
end;
$$;
revoke all on function public.erp__unique_prefix(uuid, uuid, text, text) from public, anon, authenticated;

-- Arreglo de lo que ya existe: en cada tienda, el punto que ya usa el prefijo (con documentos, o el más antiguo) se
-- queda con él (si nadie lo ha usado, el punto principal y luego el más antiguo); los demás que lo repiten y no tienen documentos con ese prefijo reciben uno propio.
do $$
declare
  r record;
  v_new text;
  v_n integer := 0;
begin
  for r in
    with dup as (
      select w.id, w.store_id, w.name, w.remision_prefix as prefix, 'remision' as kind,
             exists (select 1 from public.erp_order_meta m where m.point_id = w.id and m.doc_kind = 'remision') as used,
             row_number() over (partition by w.store_id, upper(coalesce(w.remision_prefix, ''))
                                order by exists (select 1 from public.erp_order_meta m where m.point_id = w.id and m.doc_kind = 'remision') desc, w.is_default desc, w.created_at, w.id) as rk
      from public.erp_warehouses w
      where coalesce(w.remision_prefix, '') <> ''
      union all
      select w.id, w.store_id, w.name, w.invoice_prefix, 'factura',
             exists (select 1 from public.erp_order_meta m where m.point_id = w.id and m.doc_kind = 'factura'),
             row_number() over (partition by w.store_id, upper(coalesce(w.invoice_prefix, ''))
                                order by exists (select 1 from public.erp_order_meta m where m.point_id = w.id and m.doc_kind = 'factura') desc, w.is_default desc, w.created_at, w.id)
      from public.erp_warehouses w
      where coalesce(w.invoice_prefix, '') <> ''
    )
    select * from dup where rk > 1 and not used order by store_id, kind, name
  loop
    v_new := public.erp__unique_prefix(r.store_id, r.id, r.prefix, r.name);
    if r.kind = 'remision' then
      update public.erp_warehouses set remision_prefix = v_new, next_remision_number = 1 where id = r.id;
    else
      update public.erp_warehouses set invoice_prefix = v_new, next_invoice_number = 1 where id = r.id;
    end if;
    v_n := v_n + 1;
    raise notice '% «%»: % → %', r.kind, r.name, r.prefix, v_new;
  end loop;
  raise notice 'Prefijos corregidos: %', v_n;
end $$;

-- Puntos nuevos: si el prefijo que traen ya lo usa otro punto de la tienda, reciben uno propio.
create or replace function public.erp__warehouse_prefix_default()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.remision_prefix, '') <> '' and exists (
      select 1 from public.erp_warehouses o where o.store_id = new.store_id and o.id <> new.id
        and (upper(coalesce(o.remision_prefix, '')) = upper(new.remision_prefix) or upper(coalesce(o.invoice_prefix, '')) = upper(new.remision_prefix))) then
    new.remision_prefix := public.erp__unique_prefix(new.store_id, new.id, new.remision_prefix, new.name);
    new.next_remision_number := 1;
  end if;
  if coalesce(new.invoice_prefix, '') <> '' and (upper(new.invoice_prefix) = upper(coalesce(new.remision_prefix, '')) or exists (
      select 1 from public.erp_warehouses o where o.store_id = new.store_id and o.id <> new.id
        and (upper(coalesce(o.remision_prefix, '')) = upper(new.invoice_prefix) or upper(coalesce(o.invoice_prefix, '')) = upper(new.invoice_prefix)))) then
    new.invoice_prefix := public.erp__unique_prefix(new.store_id, new.id, new.invoice_prefix, new.name);
    new.next_invoice_number := 1;
  end if;
  return new;
end;
$$;
drop trigger if exists erp_warehouses_prefix_default on public.erp_warehouses;
create trigger erp_warehouses_prefix_default before insert on public.erp_warehouses
  for each row execute function public.erp__warehouse_prefix_default();

-- Número del documento: si ya existe en la tienda (por un prefijo que se repitió), se salta al siguiente libre.
create or replace function public.erp_tag_order(p_store uuid, p_token text, p_point uuid, p_seller uuid, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order uuid; v_meta public.erp_order_meta; v_prefix text; v_seq bigint; v_name text; v_num text; v_wh public.erp_warehouses;
  v_skipped integer := 0;
begin
  if not public.erp_can(p_store, 'pos') then raise exception 'No tienes permiso para facturar.'; end if;
  if p_kind not in ('factura', 'remision') then raise exception 'Tipo de documento inválido.'; end if;
  select id into v_order from public.orders where token = p_token and store_id = p_store;
  if not found then raise exception 'Pedido no encontrado.'; end if;

  select * into v_meta from public.erp_order_meta where order_id = v_order;
  if found then
    return jsonb_build_object('doc_number', v_meta.doc_number, 'seller_name', v_meta.seller_name);
  end if;

  select * into v_wh from public.erp_warehouses where id = p_point and store_id = p_store and active for update;
  if not found then raise exception 'Elige un punto de venta válido.'; end if;

  if p_seller is not null then
    select name into v_name from public.erp_sellers(p_store) where user_id = p_seller limit 1;
    if v_name is null then raise exception 'El vendedor elegido no es válido.'; end if;
  else
    v_name := public.erp_actor_name(p_store);
    p_seller := auth.uid();
  end if;

  if p_kind = 'factura' then
    v_prefix := v_wh.invoice_prefix; v_seq := v_wh.next_invoice_number;
  else
    v_prefix := v_wh.remision_prefix; v_seq := v_wh.next_remision_number;
  end if;
  loop
    v_num := case when coalesce(v_prefix, '') = '' then lpad(v_seq::text, 5, '0') else v_prefix || '-' || lpad(v_seq::text, 5, '0') end;
    exit when not exists (select 1 from public.erp_order_meta where store_id = p_store and doc_number = v_num);
    v_seq := v_seq + 1;
    v_skipped := v_skipped + 1;
    if v_skipped > 100000 then raise exception 'No hay números libres con el prefijo %: cámbialo en el punto.', v_prefix; end if;
  end loop;
  if p_kind = 'factura' then
    update public.erp_warehouses set next_invoice_number = v_seq + 1 where id = v_wh.id;
  else
    update public.erp_warehouses set next_remision_number = v_seq + 1 where id = v_wh.id;
  end if;

  insert into public.erp_order_meta
    (order_id, store_id, point_id, seller_id, seller_name, doc_kind, doc_prefix, doc_seq, doc_number, created_by, created_by_name)
  values
    (v_order, p_store, p_point, p_seller, v_name, p_kind, v_prefix, v_seq, v_num, auth.uid(), public.erp_actor_name(p_store));

  perform public.erp_audit(p_store, 'sale.tagged', 'orders', v_order,
    jsonb_build_object('doc_number', v_num, 'point', v_wh.name, 'seller', v_name, 'kind', p_kind, 'skipped', v_skipped));
  return jsonb_build_object('doc_number', v_num, 'seller_name', v_name);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Nombre del dueño
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.erp_sellers(p_store uuid)
returns table(user_id uuid, name text, role text, point_id uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.erp_can(p_store, 'pos') or public.erp_can(p_store, 'orders') or public.erp_can(p_store, 'billing')) then
    raise exception 'No tienes permiso para ver los vendedores.';
  end if;
  return query
    select s.owner_id,
           coalesce((select coalesce(nullif(trim(u.raw_user_meta_data->>'display_name'), ''), u.email::text) from auth.users u where u.id = s.owner_id), 'Dueño'),
           'owner'::text, null::uuid
    from public.stores s where s.id = p_store
    union all
    select su.user_id, coalesce(nullif(trim(su.display_name), ''), su.username, 'Usuario'), su.role, su.point_id
    from public.store_users su
    where su.store_id = p_store and su.active and su.user_id is distinct from (select s2.owner_id from public.stores s2 where s2.id = p_store)
      and (su.role in ('seller', 'store_admin') or 'pos' = any (su.permissions))
    order by 2;
end;
$$;

-- «Quién lo hizo»: mismo cambio sobre la versión de producción (solo si usa el correo de auth.users).
do $$
declare v_old text; v_new text;
begin
  if to_regprocedure('public.erp_actor_name(uuid)') is null then return; end if;
  v_old := pg_get_functiondef('public.erp_actor_name(uuid)'::regprocedure);
  v_new := regexp_replace(v_old,
    '\(\s*select\s+u\.email::text\s+from\s+auth\.users\s+u\s+where\s+u\.id\s*=\s*auth\.uid\(\)\s*\)',
    '(select coalesce(nullif(trim(u.raw_user_meta_data->>''display_name''), ''''), u.email::text) from auth.users u where u.id = auth.uid())', 'gi');
  if v_new <> v_old then execute v_new; raise notice '✔ erp_actor_name usa el nombre antes que el correo';
  else raise notice '· erp_actor_name sin cambio (no usa el correo de la misma forma)'; end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Editar una venta ajusta su cartera
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.erp_pos_order_set_items(p_order uuid, p_items jsonb, p_customer_name text, p_customer_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare o public.orders; v_point uuid; v_my uuid; it jsonb; v_total numeric; rc record; v_bal numeric;
begin
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'Documento no encontrado.'; end if;
  if not public.erp_can(o.store_id, 'pos') then raise exception 'No tienes permiso de POS.'; end if;
  select point_id into v_point from public.erp_order_meta where order_id = p_order;
  v_my := public.erp_my_point(o.store_id);
  if v_my is not null and v_point is distinct from v_my then raise exception 'Este documento pertenece a otro punto.'; end if;
  if o.status not in ('draft', 'sent') then
    raise exception 'El documento ya está confirmado y no se puede modificar. Crea un documento nuevo.';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Agrega al menos un producto.'; end if;

  for it in select * from jsonb_array_elements(p_items) loop
    if not exists (select 1 from public.products where id = (it->>'product_id')::uuid and store_id = o.store_id) then
      raise exception 'Un producto no pertenece a esta tienda.';
    end if;
    if coalesce((it->>'qty')::integer, 0) <= 0 then raise exception 'Cantidad inválida.'; end if;
    if coalesce((it->>'price')::numeric, -1) < 0 then raise exception 'Precio inválido.'; end if;
  end loop;

  delete from public.order_items where order_id = p_order;
  insert into public.order_items (order_id, product_id, quantity, price)
  select p_order, (e->>'product_id')::uuid, sum((e->>'qty')::integer), max((e->>'price')::numeric)
  from jsonb_array_elements(p_items) e
  group by (e->>'product_id')::uuid;

  select coalesce(sum(quantity * price), 0) into v_total from public.order_items where order_id = p_order;
  update public.orders
  set total = v_total,
      customer_name = coalesce(nullif(trim(p_customer_name), ''), customer_name),
      customer_note = coalesce(p_customer_note, customer_note),
      updated_at = now()
  where id = p_order;

  -- Venta a crédito: la cuenta por cobrar sigue al nuevo total (lo abonado se respeta).
  for rc in select * from public.erp_receivables where order_id = p_order and status <> 'void' for update loop
    v_bal := rc.balance + (v_total - rc.total);
    if v_bal < 0 then
      raise exception 'Esta venta ya tiene abonos por % y el nuevo total (%) queda por debajo. Anula un abono antes de bajar el total.',
        to_char(rc.total - rc.balance, 'FM999G999G999'), to_char(v_total, 'FM999G999G999');
    end if;
    update public.erp_receivables
       set total = v_total, balance = v_bal,
           status = case when status = 'paid' and v_bal > 0 then 'open' else status end
     where id = rc.id;
    if v_total <> rc.total then
      perform public.erp_audit(o.store_id, 'receivable.adjusted', 'erp_receivables', rc.id,
        jsonb_build_object('doc', rc.doc_number, 'total_before', rc.total, 'total_after', v_total, 'balance_after', v_bal));
    end if;
  end loop;

  perform public.erp_audit(o.store_id, 'sale.edited', 'orders', p_order,
    jsonb_build_object('receipt_no', o.receipt_no, 'items', jsonb_array_length(p_items), 'total', v_total));
  return jsonb_build_object('total', v_total, 'token', o.token);
end;
$$;
