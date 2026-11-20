-- =====================================================================
-- REMHUB · Nota crédito con devolución de productos (devolución parcial)
--
-- Requiere 20261334. Sobre una venta a crédito CONFIRMADA:
--   · Se eligen productos y cantidades del documento. Las unidades vuelven
--     a la bodega de donde salieron (kardex: «sale_return»).
--   · El documento baja esas cantidades y su total, así ventas, informes,
--     ganancia y liquidaciones dejan de contar lo devuelto.
--   · La cartera baja el valor devuelto (al precio al que se vendió) y queda
--     una nota crédito con número (NC-…), los productos y el motivo.
--   · No se puede devolver más de lo vendido, ni por más valor que el saldo
--     (si ya pagó, anula primero el abono), ni sobre factura electrónica
--     enviada (eso va por la DIAN), ni devolver TODO (para eso está
--     «Devolución» del documento, que lo anula).
--   · Pide los permisos que ya existen: «Créditos» y «Devolución de venta».
--   · Una devolución de productos no se anula (si se los lleva otra vez,
--     es una venta nueva).
--
-- Ajustes a reglas existentes (con el código de producción como base):
--   · prevent_confirmed_order_item_changes deja pasar SOLO esta devolución
--     (la marca erp.partial_return la pone únicamente esta función, igual que
--     erp.sale_void en 20261113). Todo lo demás sigue bloqueado.
--   · orders_sync_receivable respeta las notas crédito/débito de dinero
--     (antes, si cambiaba el total del pedido, se perdía su efecto).
-- No borra datos. No cambia permisos. Es idempotente.
-- =====================================================================

alter table public.erp_receivable_notes add column if not exists items jsonb;

-- ------------------------------------------------------------------ Reglas existentes
create or replace function public.prevent_confirmed_order_item_changes()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  affected_order_id uuid;
  order_status text;
begin
  -- ÚNICO CAMBIO: la devolución parcial (ya validada en erp_receivable_return_items) puede bajar cantidades.
  if coalesce(current_setting('erp.partial_return', true), '') = '1' and tg_op in ('UPDATE', 'DELETE') then
    if tg_op = 'DELETE' then return old; end if;
    if old.order_id = new.order_id and old.product_id = new.product_id and new.quantity < old.quantity
       and new.price is not distinct from old.price then
      return new;
    end if;
  end if;

  if tg_op = 'DELETE' then
    affected_order_id := old.order_id;
  else
    affected_order_id := new.order_id;
  end if;

  if tg_op = 'UPDATE' and old.order_id is distinct from new.order_id then
    select status::text
      into order_status
    from public.orders
    where id = old.order_id;

    if order_status in ('confirmed', 'completed') then
      raise exception 'ORDER_LOCKED: el pedido ya fue confirmado y no admite cambios.'
        using errcode = '55000';
    end if;
  end if;

  select status::text
    into order_status
  from public.orders
  where id = affected_order_id;

  if order_status in ('confirmed', 'completed') then
    raise exception 'ORDER_LOCKED: el pedido ya fue confirmado y no admite cambios.'
      using errcode = '55000';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

-- Si cambia el total del pedido, la cuenta por cobrar lo sigue, conservando las notas de dinero (20261334)
-- y lo abonado. Las devoluciones de productos ya bajaron el pedido: no se cuentan dos veces.
create or replace function public.orders_sync_receivable()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.total is distinct from old.total then
    update public.erp_receivables r
    set total = x.new_total,
        balance = greatest(x.new_total - (r.total - r.balance), 0),
        status = case when greatest(x.new_total - (r.total - r.balance), 0) <= 0 then 'paid' else 'open' end,
        updated_at = now()
    from (
      select r2.id, new.total + coalesce((
        select sum(case when n.kind = 'credit' then -n.amount else n.amount end)
        from public.erp_receivable_notes n
        where n.receivable_id = r2.id and not n.voided and n.items is null), 0) as new_total
      from public.erp_receivables r2
      where r2.order_id = new.id and r2.status <> 'void'
    ) x
    where r.id = x.id;
  end if;
  return new;
end;
$function$;

-- Una devolución de productos no se anula.
create or replace function public.erp_receivable_note_void(p_note uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n public.erp_receivable_notes;
  r public.erp_receivables;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_balance numeric;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'message', 'Inicia sesión.'); end if;
  select * into n from public.erp_receivable_notes where id = p_note for update;
  if n.id is null then return jsonb_build_object('ok', false, 'message', 'La nota no existe.'); end if;
  if not public.erp_can(n.store_id, 'credit') then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Necesitas el permiso «Créditos».');
  end if;
  if n.voided then return jsonb_build_object('ok', false, 'message', n.number || ' ya está anulada.'); end if;
  if n.items is not null then
    return jsonb_build_object('ok', false, 'code', 'HAS_ITEMS',
      'message', n.number || ' devolvió productos al inventario: no se anula. Si el cliente se los lleva otra vez, haz una venta nueva.');
  end if;
  if length(v_reason) < 5 then return jsonb_build_object('ok', false, 'message', 'Escribe el motivo (mínimo 5 letras).'); end if;
  select * into r from public.erp_receivables where id = n.receivable_id for update;
  if not public.erp_point_allowed(r.store_id, r.point_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Este documento es de un punto que no tienes asignado.');
  end if;
  if r.status = 'void' then return jsonb_build_object('ok', false, 'message', 'El documento ya está anulado.'); end if;
  if n.kind = 'debit' and r.balance < n.amount - 0.005 then
    return jsonb_build_object('ok', false, 'code', 'HAS_PAYMENTS',
      'message', 'Ya se abonó parte de ese cargo: anula primero un abono para poder anular la nota débito.');
  end if;

  v_balance := r.balance + case when n.kind = 'credit' then n.amount else -n.amount end;
  update public.erp_receivables
     set total = total + case when n.kind = 'credit' then n.amount else -n.amount end,
         balance = v_balance, status = case when v_balance <= 0 then 'paid' else 'open' end, updated_at = now()
   where id = r.id;
  update public.erp_receivable_notes
     set voided = true, voided_at = now(), voided_by = auth.uid(), voided_by_name = public.erp__actor_label(n.store_id), void_reason = v_reason
   where id = n.id;
  perform public.erp_audit(n.store_id, 'receivable.note_voided', 'erp_receivables', r.id,
    jsonb_build_object('note', n.number, 'amount', n.amount, 'kind', n.kind, 'reason', v_reason, 'balance_after', v_balance));
  return jsonb_build_object('ok', true, 'balance', v_balance);
end;
$$;
revoke all on function public.erp_receivable_note_void(uuid, text) from public, anon;
grant execute on function public.erp_receivable_note_void(uuid, text) to authenticated;

-- ------------------------------------------------------------------ Productos que se pueden devolver
create or replace function public.erp_receivable_return_lines(p_receivable uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare r public.erp_receivables;
begin
  select * into r from public.erp_receivables where id = p_receivable;
  if r.id is null or auth.uid() is null or not public.erp_can_any(r.store_id, array['credit', 'receivables']::text[])
     or not public.erp_point_allowed(r.store_id, r.point_id) then
    return jsonb_build_object('ok', false, 'message', 'No tienes acceso a este documento.');
  end if;
  if r.order_id is null then
    return jsonb_build_object('ok', false, 'message', 'Este saldo no viene de una venta: no tiene productos para devolver.');
  end if;
  return jsonb_build_object('ok', true, 'balance', r.balance,
    'can_return', public.erp_can(r.store_id, 'sales_return') and public.erp_can(r.store_id, 'credit'),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object('product_id', l.product_id, 'name', l.name, 'image_url', l.image_url, 'qty', l.qty, 'price', l.price)
                       order by l.name)
      from (
        select oi.product_id, coalesce(p.name, 'Producto') as name, p.image_url, sum(oi.quantity)::integer as qty, max(oi.price) as price
        from public.order_items oi left join public.products p on p.id = oi.product_id
        where oi.order_id = r.order_id
        group by oi.product_id, p.name, p.image_url
        having sum(oi.quantity) > 0
      ) l), '[]'::jsonb));
end;
$$;
revoke all on function public.erp_receivable_return_lines(uuid) from public, anon;
grant execute on function public.erp_receivable_return_lines(uuid) to authenticated;

-- ------------------------------------------------------------------ Devolver productos
create or replace function public.erp_receivable_return_items(p_receivable uuid, p_items jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.erp_receivables;
  o public.orders;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_doc text;
  it record;
  w record;
  ln record;
  v_left integer;
  v_take integer;
  v_value numeric := 0;
  v_units integer := 0;
  v_sold_units integer;
  v_items jsonb := '[]'::jsonb;
  v_number text;
  v_id uuid;
  v_after public.erp_receivables;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'message', 'Inicia sesión.'); end if;
  select * into r from public.erp_receivables where id = p_receivable for update;
  if r.id is null then return jsonb_build_object('ok', false, 'message', 'El documento de cartera no existe.'); end if;
  if not (public.erp_can(r.store_id, 'credit') and public.erp_can(r.store_id, 'sales_return')) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN',
      'message', 'Para devolver productos necesitas los permisos «Créditos» y «Devolución de venta».');
  end if;
  if not public.erp_point_allowed(r.store_id, r.point_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Este documento es de un punto que no tienes asignado.');
  end if;
  if r.status = 'void' then return jsonb_build_object('ok', false, 'message', 'El documento está anulado.'); end if;
  if r.order_id is null then return jsonb_build_object('ok', false, 'message', 'Este saldo no viene de una venta.'); end if;
  select * into o from public.orders where id = r.order_id for update;
  if o.status not in ('confirmed', 'completed') then
    return jsonb_build_object('ok', false, 'code', 'NOT_CONFIRMED',
      'message', 'El documento aún no está confirmado: quita los productos en el POS (Documentos → Editar).');
  end if;
  if to_regclass('public.fiscal_documents') is not null and exists (
       select 1 from public.fiscal_documents f where f.source_id = o.id
         and (f.status in ('ACCEPTED', 'SENT', 'PROCESSING', 'CANCEL_PENDING') or (f.status = 'ERROR' and f.sent_at is not null))) then
    return jsonb_build_object('ok', false, 'code', 'FISCAL',
      'message', 'Esta venta tiene factura electrónica enviada a la DIAN: la devolución se hace con nota crédito en Facturación electrónica.');
  end if;
  if length(v_reason) < 5 then return jsonb_build_object('ok', false, 'message', 'Describe el motivo (mínimo 5 letras).'); end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('ok', false, 'message', 'Elige al menos un producto y cuántas unidades devuelve.');
  end if;

  -- Validar cantidades y calcular el valor (al precio al que se vendió).
  for it in
    select (e->>'product_id')::uuid as product_id, sum(coalesce((e->>'qty')::integer, 0))::integer as qty
    from jsonb_array_elements(p_items) e group by 1
  loop
    continue when it.qty <= 0;
    select coalesce(sum(oi.quantity), 0)::integer as sold, max(oi.price) as price, max(p.name) as name
      into ln
    from public.order_items oi left join public.products p on p.id = oi.product_id
    where oi.order_id = o.id and oi.product_id = it.product_id;
    if ln.sold = 0 then return jsonb_build_object('ok', false, 'message', 'Un producto no está en este documento.'); end if;
    if it.qty > ln.sold then
      return jsonb_build_object('ok', false, 'code', 'OVER_QTY',
        'message', format('De «%s» se vendieron %s: no se pueden devolver %s.', ln.name, ln.sold, it.qty));
    end if;
    v_value := v_value + it.qty * ln.price;
    v_units := v_units + it.qty;
    v_items := v_items || jsonb_build_object('product_id', it.product_id, 'name', ln.name, 'qty', it.qty, 'price', ln.price);
  end loop;
  if v_units = 0 then return jsonb_build_object('ok', false, 'message', 'Elige cuántas unidades devuelve.'); end if;
  select coalesce(sum(quantity), 0)::integer into v_sold_units from public.order_items where order_id = o.id;
  if v_units >= v_sold_units then
    return jsonb_build_object('ok', false, 'code', 'ALL_ITEMS',
      'message', 'Devuelve todo el documento: usa «Devolución» del documento en el POS (lo anula y devuelve todo).');
  end if;
  v_value := round(v_value, 2);
  if v_value > r.balance + 0.005 then
    return jsonb_build_object('ok', false, 'code', 'OVER_BALANCE',
      'message', format('Lo devuelto vale %s y el saldo es %s. Si ya pagó, anula primero el abono.',
                        to_char(v_value, 'FM$999G999G999'), to_char(r.balance, 'FM$999G999G999')));
  end if;

  v_doc := coalesce(to_jsonb(r)->>'doc_number', '#' || o.receipt_no::text);
  perform pg_advisory_xact_lock(hashtext('erp_receivable_notes:' || r.store_id::text || ':credit'));
  select 'NC-' || lpad((coalesce(max(nullif(substring(n.number from '(\d+)$'), '')::integer), 0) + 1)::text, 5, '0')
    into v_number
  from public.erp_receivable_notes n where n.store_id = r.store_id and n.kind = 'credit';

  -- 1. Inventario: vuelve a la bodega de donde salió (según el kardex de esta venta).
  for it in select (e->>'product_id')::uuid as product_id, (e->>'qty')::integer as qty from jsonb_array_elements(v_items) e loop
    v_left := it.qty;
    for w in
      select im.warehouse_id, sum(case when im.kind = 'out' then im.qty else -im.qty end)::integer as net
      from public.inventory_movements im
      where im.store_id = o.store_id and im.product_id = it.product_id
        and (im.order_id = o.id or (im.ref_id = o.id and coalesce(im.ref_type, '') in ('order', 'sale', 'document')))
        and coalesce(im.movement_type, '') in ('sale', 'sale_return')
        and im.warehouse_id is not null
      group by im.warehouse_id
      having sum(case when im.kind = 'out' then im.qty else -im.qty end) > 0
      order by 2 desc
    loop
      exit when v_left <= 0;
      v_take := least(v_left, w.net);
      perform public.erp__move(o.store_id, w.warehouse_id, it.product_id, v_take, 'sale_return', 'order', o.id, null,
        'Devolución parcial ' || v_doc || ' (' || v_number || ')', v_reason, true);
      v_left := v_left - v_take;
    end loop;
    if v_left > 0 then
      raise exception 'No encontré la salida de inventario de un producto de %: revisa el kardex antes de devolver.', v_doc using errcode = 'P0001';
    end if;
  end loop;

  -- 2. El documento baja las cantidades (ventas, informes y liquidaciones dejan de contarlas).
  perform set_config('erp.partial_return', '1', true);
  for it in select (e->>'product_id')::uuid as product_id, (e->>'qty')::integer as qty from jsonb_array_elements(v_items) e loop
    v_left := it.qty;
    for ln in select ctid as rid, quantity from public.order_items where order_id = o.id and product_id = it.product_id order by quantity loop
      exit when v_left <= 0;
      v_take := least(v_left, ln.quantity);
      if v_take = ln.quantity then
        delete from public.order_items where ctid = ln.rid;
      else
        update public.order_items set quantity = quantity - v_take where ctid = ln.rid;
      end if;
      v_left := v_left - v_take;
    end loop;
  end loop;
  -- 3. El total del pedido baja; orders_sync_receivable baja la cartera (respetando abonos y notas).
  update public.orders set total = total - v_value where id = o.id;
  perform set_config('erp.partial_return', '', true);

  select * into v_after from public.erp_receivables where id = r.id;
  insert into public.erp_receivable_notes (store_id, receivable_id, customer_id, kind, number, amount, reason_code, reason,
                                          balance_before, balance_after, created_by, created_by_name, items)
  values (r.store_id, r.id, r.customer_id, 'credit', v_number, v_value, 'devolucion', v_reason, r.balance, v_after.balance,
          auth.uid(), public.erp__actor_label(r.store_id), v_items)
  returning id into v_id;

  perform public.erp_audit(r.store_id, 'receivable.return_note', 'erp_receivables', r.id,
    jsonb_build_object('note', v_number, 'doc', v_doc, 'amount', v_value, 'units', v_units, 'items', v_items, 'reason', v_reason,
                       'balance_before', r.balance, 'balance_after', v_after.balance));
  return jsonb_build_object('ok', true, 'id', v_id, 'number', v_number, 'amount', v_value, 'units', v_units, 'balance', v_after.balance);
end;
$$;
revoke all on function public.erp_receivable_return_items(uuid, jsonb, text) from public, anon;
grant execute on function public.erp_receivable_return_items(uuid, jsonb, text) to authenticated;

-- ------------------------------------------------------------------ Notas con sus productos
create or replace function public.erp_customer_receivable_notes(p_customer uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_store uuid;
begin
  select b.store_id into v_store from public.billing_customers b where b.id = p_customer;
  if v_store is null or auth.uid() is null or not public.erp_can_any(v_store, array['receivables', 'credit']::text[]) then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', n.id, 'receivable_id', n.receivable_id, 'kind', n.kind, 'number', n.number, 'amount', n.amount,
      'reason_code', n.reason_code, 'reason', n.reason, 'balance_before', n.balance_before, 'balance_after', n.balance_after,
      'created_at', n.created_at, 'created_by_name', n.created_by_name, 'items', n.items,
      'voided', n.voided, 'voided_at', n.voided_at, 'voided_by_name', n.voided_by_name, 'void_reason', n.void_reason,
      'doc_number', to_jsonb(r)->>'doc_number') order by n.created_at desc)
    from public.erp_receivable_notes n
    join public.erp_receivables r on r.id = n.receivable_id
    where n.customer_id = p_customer and n.store_id = v_store and public.erp_point_allowed(v_store, r.point_id)), '[]'::jsonb);
end;
$$;
revoke all on function public.erp_customer_receivable_notes(uuid) from public, anon;
grant execute on function public.erp_customer_receivable_notes(uuid) to authenticated;

-- El comprobante muestra también las notas del documento (por qué bajó el total o el saldo).
create or replace function public.erp_order_payment_by_token(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v jsonb; v_order uuid; v_credit jsonb; v_notes jsonb;
begin
  if p_token is null or length(p_token) < 8 then return null; end if;
  select o.id into v_order from public.orders o where o.token = p_token;
  if v_order is null then return null; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'erp_order_meta' and column_name = 'payment') then
    execute 'select m.payment from public.erp_order_meta m where m.order_id = $1' into v using v_order;
  end if;
  select jsonb_build_object(
           'total', sum(r.total), 'balance', sum(r.balance), 'paid', sum(r.total) - sum(r.balance),
           'issue_date', min(to_jsonb(r)->>'issue_date'), 'due_date', max(to_jsonb(r)->>'due_date'),
           'days', max(((to_jsonb(r)->>'due_date')::date - coalesce((to_jsonb(r)->>'issue_date')::date, (to_jsonb(r)->>'due_date')::date))),
           'status', case when sum(r.balance) <= 0 then 'paid'
                          when max((to_jsonb(r)->>'due_date')::date) < (now() at time zone 'America/Bogota')::date then 'overdue' else 'open' end)
    into v_credit
  from public.erp_receivables r
  where r.order_id = v_order and r.status <> 'void'
  having count(*) > 0;
  if v_credit is not null then
    select coalesce(jsonb_agg(jsonb_build_object('number', n.number, 'kind', n.kind, 'amount', n.amount, 'items', n.items, 'at', n.created_at)
                              order by n.created_at), '[]'::jsonb)
      into v_notes
    from public.erp_receivable_notes n join public.erp_receivables r on r.id = n.receivable_id
    where r.order_id = v_order and r.status <> 'void' and not n.voided;
    v_credit := v_credit || jsonb_build_object('notes', v_notes);
  end if;
  if v is null and v_credit is null then return null; end if;
  return jsonb_build_object(
    'method', coalesce(v->>'method', case when v_credit is not null then 'credito' end),
    'parts', coalesce(v->'parts', '[]'::jsonb), 'received', v->'received', 'change', v->'change',
    'credit', v_credit);
end;
$$;
revoke all on function public.erp_order_payment_by_token(text) from public;
grant execute on function public.erp_order_payment_by_token(text) to anon, authenticated;

notify pgrst, 'reload schema';
