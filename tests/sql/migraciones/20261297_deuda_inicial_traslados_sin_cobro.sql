-- =====================================================================
-- 20261297 · Deuda inicial: traslados que nunca se cobraron + recalcular
--
-- Caso real (2026-11-08): SEDE ZAMORA recibió su ingreso inicial (factura propia, 07-13/10) y el 14/10
-- un traslado de 806 unidades ANTES de activar su crédito, así que ese traslado no generó deuda.
-- 20261294 restaba todo traslado recibido después del ingreso suponiendo que ya estaba cobrado, y
-- dejó ~$26,9 M de mercancía sin cobrar.
-- Ahora, por producto:
--   · entró sin cobro = unidades del ingreso + unidades de traslados al punto que NO tienen documento
--     de cobro activo (menos lo de esos traslados que ya se cobró en otra deuda inicial);
--   · cobrado después = solo traslados con documento de cobro activo, recibidos después del ingreso;
--   · siguen = mínimo(entró sin cobro, existencias hoy − cobrado después).
-- Y «recalcular»: si ese ingreso ya se cobró, se anula el documento anterior y se crea el nuevo en un
-- solo paso (p_replace), con la vista previa mostrando la diferencia.
-- No borra datos. Es idempotente. Requiere 20261294.
-- =====================================================================

alter table public.erp_internal_opening_lines add column if not exists uncharged_in numeric not null default 0;

-- Traslados recibidos en el punto sin documento de cobro activo, por producto.
create or replace function public.erp__point_uncharged_transfers(p_store uuid, p_point uuid)
returns table (product_id uuid, qty numeric)
language sql stable security definer set search_path = public as $$
  select ti.product_id, sum(coalesce((to_jsonb(ti)->>'received_qty')::numeric, ti.qty))
  from public.erp_transfer_items ti join public.erp_transfers t on t.id = ti.transfer_id
  where t.store_id = p_store and t.to_warehouse_id = p_point and t.status = 'received'
    and not exists (select 1 from public.erp_internal_docs d where d.transfer_id = t.id and d.point_id = p_point and d.sign = 1 and d.status = 'active')
  group by ti.product_id;
$$;
revoke all on function public.erp__point_uncharged_transfers(uuid, uuid) from public, anon, authenticated;

drop function if exists public.erp__opening_from_purchase_lines(uuid, uuid, uuid);
create or replace function public.erp__opening_from_purchase_lines(p_store uuid, p_point uuid, p_purchase uuid, p_exclude_doc uuid default null)
returns table (product_id uuid, name text, sku text, purchased numeric, uncharged_in numeric, stock_now numeric, transferred_after numeric, qty numeric, unit numeric, last_cost numeric)
language sql stable security definer set search_path = public as $$
  with pu as (
    select * from public.erp_purchases where id = p_purchase and store_id = p_store and coalesce(status, 'received') not in ('cancelled', 'void', 'anulada', 'draft')
  ), items as (
    select i.product_id, sum(i.qty) as purchased
    from public.erp_purchase_items i join pu on pu.id = i.purchase_id
    where coalesce((to_jsonb(i)->>'warehouse_id')::uuid, pu.warehouse_id) = p_point
    group by i.product_id
  ), unch as (
    -- Traslados sin cobro, menos lo que de ellos ya se cobró en otra deuda inicial activa.
    select u.product_id,
           greatest(0, u.qty - coalesce((select sum(o.uncharged_in) from public.erp_internal_opening_lines o join public.erp_internal_docs d on d.id = o.doc_id
                                          where o.point_id = p_point and o.product_id = u.product_id and d.status = 'active'
                                            and d.id is distinct from p_exclude_doc), 0)) as qty
    from public.erp__point_uncharged_transfers(p_store, p_point) u
    where exists (select 1 from pu)
  ), prods as (
    select product_id from items union select product_id from unch where qty > 0
  ), calc as (
    select pr.product_id,
           coalesce((select it.purchased from items it where it.product_id = pr.product_id), 0) as purchased,
           coalesce((select un.qty from unch un where un.product_id = pr.product_id), 0) as uncharged_in,
           coalesce((select l.qty from public.erp_stock_levels l where l.warehouse_id = p_point and l.product_id = pr.product_id), 0) as stock_now,
           coalesce((select sum(coalesce((to_jsonb(ti)->>'received_qty')::numeric, ti.qty))
                     from public.erp_transfer_items ti join public.erp_transfers t on t.id = ti.transfer_id
                     where t.to_warehouse_id = p_point and t.status = 'received' and ti.product_id = pr.product_id
                       and coalesce(t.received_at, t.created_at) > (select created_at from pu)
                       and exists (select 1 from public.erp_internal_docs d where d.transfer_id = t.id and d.point_id = p_point and d.sign = 1 and d.status = 'active')), 0) as transferred_after
    from prods pr
  )
  select c.product_id, p.name, p.sku, c.purchased, c.uncharged_in, c.stock_now, c.transferred_after,
         greatest(0, least(c.purchased + c.uncharged_in, c.stock_now - c.transferred_after)) as qty,
         public.erp__round_up(coalesce(nullif(p.last_cost, 0), p.cost_price) * (1 + public.erp__internal_pct(p_store, p_point, c.product_id) / 100),
                              (public.erp__internal_settings(p_store)).round_step) as unit,
         coalesce(nullif(p.last_cost, 0), p.cost_price) as last_cost
  from calc c join public.products p on p.id = c.product_id;
$$;
revoke all on function public.erp__opening_from_purchase_lines(uuid, uuid, uuid, uuid) from public, anon, authenticated;

drop function if exists public.erp_internal_opening_from_purchase(uuid, uuid, uuid, boolean, text);
create or replace function public.erp_internal_opening_from_purchase(p_store uuid, p_point uuid, p_purchase uuid, p_apply boolean, p_note text default null, p_replace boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ip public.erp_internal_points; pu public.erp_purchases; v_rows jsonb; v_total numeric; v_cost numeric; v_n integer; v_id uuid;
        v_prev public.erp_internal_docs; v_old public.erp_internal_docs;
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
  -- Documento con el que ya se cobró este ingreso (si hay).
  select d.* into v_old from public.erp_internal_docs d
  where d.status = 'active' and d.point_id = p_point
    and exists (select 1 from public.erp_internal_opening_lines o where o.doc_id = d.id and o.purchase_id = p_purchase)
  order by d.created_at desc limit 1;
  if v_old.id is not null and coalesce(p_apply, false) and not coalesce(p_replace, false) then
    raise exception 'Ese ingreso ya se cobró como deuda inicial. Usa «Recalcular» para reemplazar ese cobro.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('product_id', l.product_id, 'name', l.name, 'sku', l.sku, 'purchased', l.purchased, 'uncharged_in', l.uncharged_in,
                                               'stock_now', l.stock_now, 'transferred_after', l.transferred_after, 'qty', l.qty, 'unit', l.unit, 'last_cost', l.last_cost,
                                               'total', round(l.qty * coalesce(l.unit, 0), 2)) order by l.qty * coalesce(l.unit, 0) desc), '[]'::jsonb),
         coalesce(sum(round(l.qty * coalesce(l.unit, 0), 2)), 0), coalesce(sum(l.qty * coalesce(l.last_cost, 0)), 0), count(*) filter (where l.qty > 0)
  into v_rows, v_total, v_cost, v_n
  from public.erp__opening_from_purchase_lines(p_store, p_point, p_purchase, v_old.id) l;
  select * into v_prev from public.erp_internal_docs where store_id = p_store and point_id = p_point and kind = 'opening' and status = 'active'
    and id is distinct from v_old.id order by created_at limit 1;

  if not coalesce(p_apply, false) then
    return jsonb_build_object('ok', true, 'applied', false, 'purchase', jsonb_build_object('id', pu.id, 'number', pu.number, 'invoice_ref', pu.invoice_ref, 'total', pu.total),
      'total', v_total, 'cost', v_cost, 'products', v_n, 'rows', v_rows,
      'replaces', case when v_old.id is null then null else jsonb_build_object('number', v_old.number, 'amount', v_old.amount) end,
      'existing_opening', case when v_prev.id is null then null else jsonb_build_object('number', v_prev.number, 'amount', v_prev.amount, 'note', v_prev.note) end);
  end if;

  if v_total <= 0 then raise exception 'De ese ingreso ya no queda mercancía con costo en el punto: no hay nada que cobrar.'; end if;
  if v_old.id is not null then
    update public.erp_internal_docs set status = 'void', void_reason = 'Recalculado: reemplazado por un nuevo cobro del ingreso #' || pu.number,
           voided_at = now(), voided_by = auth.uid() where id = v_old.id;
  end if;

  insert into public.erp_internal_docs (store_id, point_id, creditor_id, number, kind, sign, amount, cost_amount, due_date, note, created_by, created_by_name)
  values (p_store, p_point, public.erp__internal_default_creditor(p_store), public.erp_next_number(p_store, 'internal_doc'), 'opening', 1, round(v_total, 2), round(v_cost, 2),
          coalesce(v_old.due_date, public.erp__internal_today() + coalesce(ip.term_days, (public.erp__internal_settings(p_store)).default_term_days)),
          left(coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Deuda inicial: mercancía del ingreso #' || pu.number || coalesce(' (' || pu.invoice_ref || ')', '')
               || ' y traslados sin cobro que siguen en el punto') || ' · ' || v_n || ' producto(s)'
               || case when v_old.id is not null then ' · reemplaza #' || v_old.number else '' end, 300),
          auth.uid(), public.erp_actor_name(p_store))
  returning id into v_id;

  insert into public.erp_internal_opening_lines (store_id, doc_id, purchase_id, point_id, product_id, purchased, uncharged_in, stock_now, transferred_after, qty, unit, last_cost, total)
  select p_store, v_id, p_purchase, p_point, (r->>'product_id')::uuid, (r->>'purchased')::numeric, (r->>'uncharged_in')::numeric, (r->>'stock_now')::numeric,
         (r->>'transferred_after')::numeric, (r->>'qty')::numeric, coalesce((r->>'unit')::numeric, 0), (r->>'last_cost')::numeric, (r->>'total')::numeric
  from jsonb_array_elements(v_rows) r where (r->>'qty')::numeric > 0;

  insert into public.erp_point_costs (point_id, product_id, store_id, avg_cost)
  select p_point, (r->>'product_id')::uuid, p_store, (r->>'unit')::numeric
  from jsonb_array_elements(v_rows) r where (r->>'qty')::numeric > 0 and coalesce((r->>'unit')::numeric, 0) > 0
  on conflict (point_id, product_id) do update set avg_cost = excluded.avg_cost, updated_at = now();

  perform public.erp_audit(p_store, case when v_old.id is null then 'internal.opening_from_purchase' else 'internal.opening_recalculated' end, 'erp_internal_docs', v_id,
    jsonb_build_object('point_id', p_point, 'purchase_id', p_purchase, 'purchase_number', pu.number, 'amount', v_total, 'products', v_n,
                       'replaced_doc', v_old.id, 'replaced_amount', v_old.amount));
  return jsonb_build_object('ok', true, 'applied', true, 'doc_id', v_id, 'total', round(v_total, 2), 'products', v_n,
                            'replaced', case when v_old.id is null then null else jsonb_build_object('number', v_old.number, 'amount', v_old.amount) end);
end $$;
revoke all on function public.erp_internal_opening_from_purchase(uuid, uuid, uuid, boolean, text, boolean) from public, anon;
grant execute on function public.erp_internal_opening_from_purchase(uuid, uuid, uuid, boolean, text, boolean) to authenticated;

notify pgrst, 'reload schema';
