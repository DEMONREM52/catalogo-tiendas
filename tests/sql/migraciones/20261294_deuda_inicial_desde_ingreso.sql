-- =====================================================================
-- 20261294 · Deuda inicial de un punto desde su ingreso inicial de inventario
--
-- Decisión del usuario (2026-11-08): SEDE ZAMORA recibió su inventario inicial como factura de compra
-- propia («INGRESO INICIAL DE INVENTARIO»), así que NO quedó como deuda con la bodega. Se cobra como
-- DEUDA INICIAL, pero solo las unidades de ese ingreso que el punto TODAVÍA TIENE:
--   · Se asume que lo primero que se vende es lo más viejo (el inventario inicial). Lo que llegó después
--     por traslado ya está cobrado, así que por producto:
--       siguen = mínimo(unidades del ingreso, existencias hoy − unidades recibidas por traslado después).
--   · Precio = último costo de factura + % de la bodega (igual que la revaluación de 20261293).
--   · Un documento «Deuda inicial» con el detalle por producto; el precio de bodega de esos productos
--     queda en ese valor (y desde ahí sigue al último costo).
--   · Vista previa antes de aplicar. No se aplica dos veces el mismo ingreso. Solo la madre con
--     «Administrar cuenta con puntos». Queda en la auditoría.
-- No borra datos. Es idempotente. Requiere 20261124-20261126, 20261206 y 20261293.
-- =====================================================================

create table if not exists public.erp_internal_opening_lines (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  doc_id uuid not null references public.erp_internal_docs(id),
  purchase_id uuid not null references public.erp_purchases(id),
  point_id uuid not null references public.erp_warehouses(id),
  product_id uuid not null references public.products(id) on delete cascade,
  purchased numeric not null,      -- unidades del ingreso en ese punto
  stock_now numeric not null,      -- existencias al cobrar
  transferred_after numeric not null,
  qty numeric not null,            -- unidades cobradas (las que siguen)
  unit numeric not null,
  last_cost numeric,
  total numeric not null
);
create index if not exists erp_internal_opening_lines_purchase on public.erp_internal_opening_lines (purchase_id);
alter table public.erp_internal_opening_lines enable row level security;
revoke all on public.erp_internal_opening_lines from anon, authenticated;

-- Lo que se cobraría de un ingreso: por producto.
create or replace function public.erp__opening_from_purchase_lines(p_store uuid, p_point uuid, p_purchase uuid)
returns table (product_id uuid, name text, sku text, purchased numeric, stock_now numeric, transferred_after numeric, qty numeric, unit numeric, last_cost numeric)
language sql stable security definer set search_path = public as $$
  with pu as (
    select * from public.erp_purchases where id = p_purchase and store_id = p_store and coalesce(status, 'received') not in ('cancelled', 'void', 'anulada', 'draft')
  ), items as (
    select i.product_id, sum(i.qty) as purchased
    from public.erp_purchase_items i join pu on pu.id = i.purchase_id
    where coalesce((to_jsonb(i)->>'warehouse_id')::uuid, pu.warehouse_id) = p_point
    group by i.product_id
  ), calc as (
    select it.product_id, it.purchased,
           coalesce((select l.qty from public.erp_stock_levels l where l.warehouse_id = p_point and l.product_id = it.product_id), 0) as stock_now,
           coalesce((select sum(coalesce((to_jsonb(ti)->>'received_qty')::numeric, ti.qty))
                     from public.erp_transfer_items ti join public.erp_transfers t on t.id = ti.transfer_id
                     where t.to_warehouse_id = p_point and t.status = 'received' and ti.product_id = it.product_id
                       and coalesce(t.received_at, t.created_at) > (select created_at from pu)), 0) as transferred_after
    from items it
  )
  select c.product_id, p.name, p.sku, c.purchased, c.stock_now, c.transferred_after,
         greatest(0, least(c.purchased, c.stock_now - c.transferred_after)) as qty,
         public.erp__round_up(coalesce(nullif(p.last_cost, 0), p.cost_price) * (1 + public.erp__internal_pct(p_store, p_point, c.product_id) / 100),
                              (public.erp__internal_settings(p_store)).round_step) as unit,
         coalesce(nullif(p.last_cost, 0), p.cost_price) as last_cost
  from calc c join public.products p on p.id = c.product_id;
$$;
revoke all on function public.erp__opening_from_purchase_lines(uuid, uuid, uuid) from public, anon, authenticated;

-- Vista previa (p_apply = false) o aplicar. Sin ingreso escogido: muestra los ingresos del punto para escoger.
create or replace function public.erp_internal_opening_from_purchase(p_store uuid, p_point uuid, p_purchase uuid, p_apply boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ip public.erp_internal_points; pu public.erp_purchases; v_rows jsonb; v_total numeric; v_cost numeric; v_n integer; v_id uuid; v_prev public.erp_internal_docs;
begin
  if not public.erp__internal_manager(p_store) then raise exception 'Solo la tienda madre con «Administrar cuenta con puntos» registra esto.'; end if;
  select * into ip from public.erp_internal_points where store_id = p_store and point_id = p_point;
  if not found or not ip.enabled then raise exception 'Primero activa el crédito para ese punto.'; end if;

  if p_purchase is null then
    return jsonb_build_object('ok', true, 'purchases', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'number', x.number, 'invoice_ref', x.invoice_ref, 'notes', x.notes, 'total', x.total, 'created_at', x.created_at,
        'charged', exists (select 1 from public.erp_internal_opening_lines o join public.erp_internal_docs d on d.id = o.doc_id
                           where o.purchase_id = x.id and o.point_id = p_point and d.status = 'active')) order by x.created_at)
      from (select pu2.* from public.erp_purchases pu2
            where pu2.store_id = p_store and coalesce(pu2.status, 'received') not in ('cancelled', 'void', 'anulada', 'draft')
              and (pu2.warehouse_id = p_point or exists (select 1 from public.erp_purchase_items i where i.purchase_id = pu2.id and (to_jsonb(i)->>'warehouse_id')::uuid = p_point))
            order by pu2.created_at limit 50) x), '[]'::jsonb));
  end if;

  select * into pu from public.erp_purchases where id = p_purchase and store_id = p_store;
  if not found then raise exception 'Ese ingreso no es de la tienda.'; end if;
  if exists (select 1 from public.erp_internal_opening_lines o join public.erp_internal_docs d on d.id = o.doc_id
             where o.purchase_id = p_purchase and o.point_id = p_point and d.status = 'active') then
    raise exception 'Ese ingreso ya se cobró como deuda inicial. Anula ese documento si quieres recalcularlo.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('product_id', l.product_id, 'name', l.name, 'sku', l.sku, 'purchased', l.purchased, 'stock_now', l.stock_now,
                                               'transferred_after', l.transferred_after, 'qty', l.qty, 'unit', l.unit, 'last_cost', l.last_cost,
                                               'total', round(l.qty * coalesce(l.unit, 0), 2)) order by l.qty * coalesce(l.unit, 0) desc), '[]'::jsonb),
         coalesce(sum(round(l.qty * coalesce(l.unit, 0), 2)), 0), coalesce(sum(l.qty * coalesce(l.last_cost, 0)), 0), count(*) filter (where l.qty > 0)
  into v_rows, v_total, v_cost, v_n
  from public.erp__opening_from_purchase_lines(p_store, p_point, p_purchase) l;
  select * into v_prev from public.erp_internal_docs where store_id = p_store and point_id = p_point and kind = 'opening' and status = 'active' order by created_at limit 1;

  if not coalesce(p_apply, false) then
    return jsonb_build_object('ok', true, 'applied', false, 'purchase', jsonb_build_object('id', pu.id, 'number', pu.number, 'invoice_ref', pu.invoice_ref, 'total', pu.total),
      'total', v_total, 'cost', v_cost, 'products', v_n, 'rows', v_rows,
      'existing_opening', case when v_prev.id is null then null else jsonb_build_object('number', v_prev.number, 'amount', v_prev.amount, 'note', v_prev.note) end);
  end if;

  if v_total <= 0 then raise exception 'De ese ingreso ya no queda mercancía con costo en el punto: no hay nada que cobrar.'; end if;
  insert into public.erp_internal_docs (store_id, point_id, creditor_id, number, kind, sign, amount, cost_amount, due_date, note, created_by, created_by_name)
  values (p_store, p_point, public.erp__internal_default_creditor(p_store), public.erp_next_number(p_store, 'internal_doc'), 'opening', 1, round(v_total, 2), round(v_cost, 2),
          public.erp__internal_today() + coalesce(ip.term_days, (public.erp__internal_settings(p_store)).default_term_days),
          left(coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Deuda inicial: mercancía del ingreso #' || pu.number || coalesce(' (' || pu.invoice_ref || ')', '') || ' que sigue en el punto')
               || ' · ' || v_n || ' producto(s)', 300),
          auth.uid(), public.erp_actor_name(p_store))
  returning id into v_id;

  insert into public.erp_internal_opening_lines (store_id, doc_id, purchase_id, point_id, product_id, purchased, stock_now, transferred_after, qty, unit, last_cost, total)
  select p_store, v_id, p_purchase, p_point, (r->>'product_id')::uuid, (r->>'purchased')::numeric, (r->>'stock_now')::numeric, (r->>'transferred_after')::numeric,
         (r->>'qty')::numeric, coalesce((r->>'unit')::numeric, 0), (r->>'last_cost')::numeric, (r->>'total')::numeric
  from jsonb_array_elements(v_rows) r where (r->>'qty')::numeric > 0;

  -- El precio de bodega de esos productos queda con el último costo (desde aquí sigue la revaluación automática).
  insert into public.erp_point_costs (point_id, product_id, store_id, avg_cost)
  select p_point, (r->>'product_id')::uuid, p_store, (r->>'unit')::numeric
  from jsonb_array_elements(v_rows) r where (r->>'qty')::numeric > 0 and coalesce((r->>'unit')::numeric, 0) > 0
  on conflict (point_id, product_id) do update set avg_cost = excluded.avg_cost, updated_at = now();

  perform public.erp_audit(p_store, 'internal.opening_from_purchase', 'erp_internal_docs', v_id,
    jsonb_build_object('point_id', p_point, 'purchase_id', p_purchase, 'purchase_number', pu.number, 'amount', v_total, 'products', v_n));
  return jsonb_build_object('ok', true, 'applied', true, 'doc_id', v_id, 'total', round(v_total, 2), 'products', v_n);
end $$;
revoke all on function public.erp_internal_opening_from_purchase(uuid, uuid, uuid, boolean, text) from public, anon;
grant execute on function public.erp_internal_opening_from_purchase(uuid, uuid, uuid, boolean, text) to authenticated;

notify pgrst, 'reload schema';
