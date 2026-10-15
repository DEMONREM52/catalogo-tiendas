-- Copia de erp_update_purchase tal como la dejó 20261016 (la que está en producción) para probar 20261121.
alter table public.erp_purchases add column if not exists edited_at timestamptz;
alter table public.erp_purchases add column if not exists checked_by_name text;
alter table public.erp_purchases add column if not exists edited_by_name text;
alter table public.erp_purchases add column if not exists edit_count integer not null default 0;

create or replace function public.erp_update_purchase(
  p_purchase uuid,
  p_supplier uuid,
  p_invoice_ref text,
  p_invoice_date date,
  p_payment_type text,
  p_due_date date,
  p_notes text,
  p_checked_by text,
  p_items jsonb,
  p_reason text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  pu public.erp_purchases;
  ap public.erp_payables;
  it jsonb;
  r record;
  v_ref text := nullif(btrim(coalesce(p_invoice_ref, '')), '');
  v_days integer;
  v_paid numeric := 0;
  v_sub numeric := 0;
  v_taxt numeric := 0;
  v_total numeric;
  v_due date;
  v_first_wh uuid;
  v_stock integer;
  v_cost numeric;
  v_base_q numeric;
  v_base_v numeric;
  v_new_cost numeric;
  v_before jsonb;
  v_note text;
  v_new jsonb := '[]'::jsonb;
  v_old jsonb;
begin
  select * into pu from public.erp_purchases where id = p_purchase for update;
  if not found then raise exception 'Ingreso no encontrado.'; end if;
  if not public.erp_can(pu.store_id, 'purchases') then raise exception 'No tienes permiso para editar compras.'; end if;
  if public.erp_my_point(pu.store_id) is not null then raise exception 'Los usuarios de punto no pueden editar ingresos de factura.'; end if;
  if pu.status <> 'received' then raise exception 'Solo se pueden editar ingresos vigentes (este está anulado).'; end if;
  if p_payment_type not in ('cash', 'credit') then raise exception 'Tipo de pago inválido.'; end if;
  if v_ref is null then raise exception 'Escribe el número de la factura del proveedor.'; end if;
  if nullif(btrim(coalesce(p_checked_by, '')), '') is null then raise exception 'Indica quién revisó la mercancía.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'La factura no tiene productos.'; end if;

  select payment_days into v_days from public.erp_suppliers where id = p_supplier and store_id = pu.store_id and active;
  if not found then raise exception 'Proveedor no válido.'; end if;
  if exists (select 1 from public.erp_purchases
             where store_id = pu.store_id and supplier_id = p_supplier and lower(invoice_ref) = lower(v_ref)
               and status = 'received' and id <> pu.id) then
    raise exception 'Ya registraste la factura % de este proveedor.', v_ref;
  end if;

  select coalesce(sum(pp.amount), 0) into v_paid
  from public.erp_payable_payments pp join public.erp_payables a on a.id = pp.payable_id
  where a.purchase_id = pu.id;
  if v_paid > 0 and p_supplier is distinct from pu.supplier_id then
    raise exception 'Esta compra ya tiene pagos registrados; no se puede cambiar el proveedor.';
  end if;

  -- Validar y normalizar las líneas nuevas.
  for it in select e.value from jsonb_array_elements(p_items) with ordinality as e(value, ord) order by e.ord loop
    if nullif(it->>'warehouse_id', '') is null then raise exception 'Elige la bodega destino de cada producto.'; end if;
    if nullif(it->>'qty', '') is null or (it->>'qty')::numeric <= 0 or (it->>'qty')::numeric <> trunc((it->>'qty')::numeric)
       or nullif(it->>'unit_cost', '') is null or (it->>'unit_cost')::numeric < 0 then
      raise exception 'Cantidad o costo inválido.';
    end if;
    if not exists (select 1 from public.products where id = (it->>'product_id')::uuid and store_id = pu.store_id) then
      raise exception 'Un producto no pertenece a esta tienda.';
    end if;
    if not exists (select 1 from public.erp_warehouses where id = (it->>'warehouse_id')::uuid and store_id = pu.store_id and active) then
      raise exception 'Una bodega destino no es válida o está inactiva.';
    end if;
    v_new := v_new || jsonb_build_array(jsonb_build_object(
      'product_id', (it->>'product_id')::uuid,
      'warehouse_id', (it->>'warehouse_id')::uuid,
      'qty', (it->>'qty')::integer,
      'unit_cost', (it->>'unit_cost')::numeric,
      'tax_rate', least(100, greatest(0, coalesce(nullif(it->>'tax_rate', '')::numeric, 0))),
      'ord', jsonb_array_length(v_new)));
  end loop;
  v_first_wh := (v_new->0->>'warehouse_id')::uuid;

  select coalesce(jsonb_agg(jsonb_build_object('product_id', i.product_id, 'warehouse_id', coalesce(i.warehouse_id, pu.warehouse_id),
           'qty', i.qty, 'unit_cost', i.unit_cost, 'tax_rate', i.tax_rate)), '[]'::jsonb)
  into v_old
  from public.erp_purchase_items i where i.purchase_id = pu.id;

  v_before := jsonb_build_object(
    'supplier_id', pu.supplier_id, 'invoice_ref', pu.invoice_ref, 'invoice_date', pu.invoice_date,
    'payment_type', pu.payment_type, 'due_date', pu.due_date, 'total', pu.total, 'items', v_old);

  -- 1) Costo promedio: se quita lo que aportó la versión anterior y se suma la nueva.
  for r in
    with o as (select x.product_id, sum(x.qty) as q, sum(x.qty * x.unit_cost) as val
               from jsonb_to_recordset(v_old) as x(product_id uuid, qty integer, unit_cost numeric) group by x.product_id),
         n as (select x.product_id, sum(x.qty) as q, sum(x.qty * x.unit_cost) as val
               from jsonb_to_recordset(v_new) as x(product_id uuid, qty integer, unit_cost numeric) group by x.product_id)
    select coalesce(o.product_id, n.product_id) as product_id,
           coalesce(o.q, 0) as old_q, coalesce(o.val, 0) as old_v,
           coalesce(n.q, 0) as new_q, coalesce(n.val, 0) as new_v
    from o full join n on n.product_id = o.product_id
  loop
    if r.old_q = r.new_q and r.old_v = r.new_v then continue; end if;
    select coalesce(stock, 0), coalesce(cost_price, 0) into v_stock, v_cost
    from public.products where id = r.product_id for update;
    v_base_q := greatest(v_stock, 0) - r.old_q;
    v_base_v := greatest(v_stock, 0) * v_cost - r.old_v;
    if v_base_q <= 0 or v_base_v < 0 then
      v_new_cost := case when r.new_q > 0 then r.new_v / r.new_q else v_cost end;
    elsif v_base_q + r.new_q > 0 then
      v_new_cost := (v_base_v + r.new_v) / (v_base_q + r.new_q);
    else
      v_new_cost := v_cost;
    end if;
    update public.products set cost_price = round(greatest(v_new_cost, 0), 4), updated_at = now() where id = r.product_id;
  end loop;

  -- 2) Inventario: solo se mueve la diferencia por producto y bodega (primero las entradas).
  v_note := 'Edición de la compra #' || pu.number || ' (factura ' || v_ref || ')';
  for r in
    with o as (select x.product_id, x.warehouse_id, sum(x.qty) as q, max(x.unit_cost) as c
               from jsonb_to_recordset(v_old) as x(product_id uuid, warehouse_id uuid, qty integer, unit_cost numeric) group by 1, 2),
         n as (select x.product_id, x.warehouse_id, sum(x.qty) as q, max(x.unit_cost) as c
               from jsonb_to_recordset(v_new) as x(product_id uuid, warehouse_id uuid, qty integer, unit_cost numeric) group by 1, 2)
    select coalesce(o.product_id, n.product_id) as product_id, coalesce(o.warehouse_id, n.warehouse_id) as warehouse_id,
           coalesce(n.q, 0) - coalesce(o.q, 0) as delta, coalesce(n.c, o.c, 0) as cost
    from o full join n on n.product_id = o.product_id and n.warehouse_id = o.warehouse_id
    order by 3 desc
  loop
    if r.delta = 0 then continue; end if;
    perform public.erp__move(pu.store_id, r.warehouse_id, r.product_id, r.delta::integer,
      case when r.delta > 0 then 'purchase' else 'purchase_void' end,
      'purchase', pu.id, r.cost, v_note, nullif(btrim(coalesce(p_reason, '')), ''), true);
  end loop;

  -- 3) Líneas y totales.
  delete from public.erp_purchase_items where purchase_id = pu.id;
  insert into public.erp_purchase_items (purchase_id, product_id, qty, unit_cost, tax_rate, line_total, warehouse_id)
  select pu.id, x.product_id, x.qty, x.unit_cost, x.tax_rate, round(x.qty * x.unit_cost * (1 + x.tax_rate / 100), 2), x.warehouse_id
  from jsonb_to_recordset(v_new) as x(product_id uuid, warehouse_id uuid, qty integer, unit_cost numeric, tax_rate numeric, ord integer)
  order by x.ord;

  select coalesce(sum(x.qty * x.unit_cost), 0), coalesce(sum(x.qty * x.unit_cost * x.tax_rate / 100), 0)
  into v_sub, v_taxt
  from jsonb_to_recordset(v_new) as x(qty integer, unit_cost numeric, tax_rate numeric);
  v_total := round(v_sub + v_taxt, 2);
  v_due := case when p_payment_type = 'credit'
    then coalesce(p_due_date, pu.due_date, pu.created_at::date + coalesce(v_days, 0)) else null end;

  update public.erp_purchases
  set supplier_id = p_supplier,
      warehouse_id = coalesce(v_first_wh, warehouse_id),
      invoice_ref = v_ref,
      invoice_date = coalesce(p_invoice_date, invoice_date),
      payment_type = p_payment_type,
      due_date = v_due,
      notes = nullif(btrim(coalesce(p_notes, '')), ''),
      checked_by_name = nullif(btrim(coalesce(p_checked_by, '')), ''),
      subtotal = round(v_sub, 2), tax = round(v_taxt, 2), total = v_total,
      edited_at = now(), edited_by_name = public.erp_actor_name(pu.store_id), edit_count = coalesce(edit_count, 0) + 1
  where id = pu.id;

  -- 4) Cuenta por pagar.
  select * into ap from public.erp_payables where purchase_id = pu.id and status <> 'void' order by created_at desc limit 1;
  if p_payment_type = 'credit' then
    if v_paid > v_total then
      raise exception 'Ya se pagaron % a este proveedor y el nuevo total (%) es menor. Ajusta los valores.', v_paid, v_total;
    end if;
    if ap.id is not null then
      update public.erp_payables
      set supplier_id = p_supplier, total = v_total, balance = round(v_total - v_paid, 2), due_date = v_due,
          status = case when v_total - v_paid <= 0 then 'paid' else 'open' end, updated_at = now()
      where id = ap.id;
    else
      insert into public.erp_payables (store_id, supplier_id, purchase_id, total, balance, due_date)
      values (pu.store_id, p_supplier, pu.id, v_total, v_total, v_due);
    end if;
  elsif ap.id is not null then
    if v_paid > 0 then
      raise exception 'Esta compra a crédito ya tiene pagos; no se puede cambiar a contado.';
    end if;
    update public.erp_payables set status = 'void', balance = 0, updated_at = now() where id = ap.id;
  end if;

  perform public.erp_audit(pu.store_id, 'purchase.edited', 'erp_purchases', pu.id,
    jsonb_build_object('number', pu.number, 'reason', nullif(btrim(coalesce(p_reason, '')), ''), 'before', v_before,
      'after', jsonb_build_object('supplier_id', p_supplier, 'invoice_ref', v_ref, 'invoice_date', p_invoice_date,
        'payment_type', p_payment_type, 'due_date', v_due, 'total', v_total, 'items', p_items)));
  return pu.id;
end;
$$;
grant execute on function public.erp_update_purchase(uuid, uuid, text, date, text, date, text, text, jsonb, text) to authenticated;
