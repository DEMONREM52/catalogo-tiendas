-- =====================================================================
-- 20261293 · La deuda de los puntos sigue al último costo de la madre
--
-- Decisión del usuario (2026-11-08): cuando la madre cambia el costo de un producto (una factura más
-- barata o más cara), la deuda de los puntos por las unidades que TIENEN EN ESE MOMENTO se recalcula
-- sola, en las dos direcciones, y la madre no tiene que aprobarlo.
--   · Precio de bodega nuevo = último costo × (1 + % de la bodega del punto/producto), redondeado.
--   · Diferencia × unidades del punto → una nota por punto y por operación:
--       neto a favor del punto  → nota crédito (kind 'credit', le baja la deuda);
--       neto en contra          → cargo        (kind 'charge', le sube la deuda, con su plazo).
--   · El precio de bodega de esas unidades (erp_point_costs) queda en el nuevo valor.
--   · Cada producto queda en erp_internal_revaluations (unidades, precio anterior y nuevo, diferencia,
--     qué lo causó) y la nota queda en el estado de cuenta y en la auditoría.
--   · Automático: al cambiar products.last_cost (ingreso o anulación de factura) el producto entra en
--     cola y al terminar la operación se revalúan todos juntos (una nota por punto, no una por producto).
--   · Botón «Revaluar ahora» (con vista previa) para ponerse al día con lo que ya pasó.
-- Solo puntos con crédito activo y productos con precio de bodega registrado. No borra datos. Idempotente.
-- Requiere 20261124, 20261125, 20261126 y 20261206.
-- =====================================================================

create table if not exists public.erp_internal_revaluations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  point_id uuid not null references public.erp_warehouses(id),
  product_id uuid not null references public.products(id) on delete cascade,
  qty numeric not null,
  old_unit numeric not null,
  new_unit numeric not null,
  diff_total numeric not null,          -- (nuevo − anterior) × unidades: positivo sube la deuda
  last_cost numeric,
  doc_id uuid references public.erp_internal_docs(id),
  source text not null check (source in ('auto', 'manual')),
  created_by uuid, created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists erp_internal_revaluations_point on public.erp_internal_revaluations (store_id, point_id, created_at desc);
alter table public.erp_internal_revaluations enable row level security;
revoke all on public.erp_internal_revaluations from anon, authenticated;

-- Productos cuyo último costo cambió en la operación en curso.
create table if not exists public.erp_internal_reval_queue (
  store_id uuid not null,
  product_id uuid not null,
  queued_at timestamptz not null default now(),
  primary key (store_id, product_id)
);
alter table public.erp_internal_reval_queue enable row level security;
revoke all on public.erp_internal_reval_queue from anon, authenticated;

-- Lo que cambiaría: por punto y producto (puntos con crédito, unidades en stock, precio de bodega distinto).
create or replace function public.erp__internal_reval_lines(p_store uuid, p_products uuid[], p_point uuid)
returns table (point_id uuid, product_id uuid, qty numeric, old_unit numeric, new_unit numeric, last_cost numeric)
language sql stable security definer set search_path = public as $$
  select x.point_id, x.product_id, x.qty, x.old_unit, x.new_unit, x.last_cost
  from (
    select c.point_id, c.product_id, l.qty, c.avg_cost as old_unit, p.last_cost,
           public.erp__round_up(p.last_cost * (1 + public.erp__internal_pct(p_store, c.point_id, c.product_id) / 100),
                                (public.erp__internal_settings(p_store)).round_step) as new_unit
    from public.erp_point_costs c
    join public.erp_internal_points ip on ip.point_id = c.point_id and ip.store_id = p_store and ip.enabled
    join public.erp_stock_levels l on l.warehouse_id = c.point_id and l.product_id = c.product_id and l.qty > 0
    join public.products p on p.id = c.product_id and p.store_id = p_store
    where c.store_id = p_store and coalesce(p.last_cost, 0) > 0
      and (p_products is null or c.product_id = any (p_products))
      and (p_point is null or c.point_id = p_point)
  ) x
  where x.new_unit is not null and round(x.new_unit, 2) <> round(x.old_unit, 2);
$$;
revoke all on function public.erp__internal_reval_lines(uuid, uuid[], uuid) from public, anon, authenticated;

-- Aplica: una nota por punto con el neto, el detalle por producto y el nuevo precio de bodega.
create or replace function public.erp__internal_revalue(p_store uuid, p_products uuid[], p_point uuid, p_source text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v_doc uuid; ip public.erp_internal_points; v_net numeric; v_n integer; v_points integer := 0; v_total numeric := 0;
        v_name text := case when auth.uid() is null then 'Automático' else public.erp_actor_name(p_store) end;
begin
  create temp table if not exists pg_temp.erp_reval (point_id uuid, product_id uuid, qty numeric, old_unit numeric, new_unit numeric, last_cost numeric) on commit drop;
  truncate pg_temp.erp_reval;
  insert into pg_temp.erp_reval select * from public.erp__internal_reval_lines(p_store, p_products, p_point);

  for r in select point_id, sum((new_unit - old_unit) * qty) as net, count(*) as n from pg_temp.erp_reval group by point_id loop
    v_net := round(r.net, 2);
    v_doc := null;
    if abs(v_net) >= 1 then
      select * into ip from public.erp_internal_points where store_id = p_store and point_id = r.point_id;
      insert into public.erp_internal_docs (store_id, point_id, creditor_id, number, kind, sign, amount, cost_amount, due_date, note, created_by, created_by_name)
      values (p_store, r.point_id, public.erp__internal_default_creditor(p_store), public.erp_next_number(p_store, 'internal_doc'),
              case when v_net < 0 then 'credit' else 'charge' end, case when v_net < 0 then -1 else 1 end, abs(v_net), 0,
              case when v_net > 0 then public.erp__internal_today() + coalesce(ip.term_days, (public.erp__internal_settings(p_store)).default_term_days) end,
              left((case when v_net < 0 then 'Rebaja por baja de costo' else 'Ajuste por alza de costo' end) || ' · ' || r.n || ' producto(s)'
                   || coalesce(' · ' || nullif(btrim(p_reason), ''), ''), 300),
              auth.uid(), v_name)
      returning id into v_doc;
      perform public.erp_audit(p_store, 'internal.revaluation', 'erp_internal_docs', v_doc,
        jsonb_build_object('point_id', r.point_id, 'net', v_net, 'products', r.n, 'source', p_source, 'reason', p_reason));
    end if;
    insert into public.erp_internal_revaluations (store_id, point_id, product_id, qty, old_unit, new_unit, diff_total, last_cost, doc_id, source, created_by, created_by_name)
    select p_store, x.point_id, x.product_id, x.qty, x.old_unit, x.new_unit, round((x.new_unit - x.old_unit) * x.qty, 2), x.last_cost, v_doc, p_source, auth.uid(), v_name
    from pg_temp.erp_reval x where x.point_id = r.point_id;
    update public.erp_point_costs c set avg_cost = x.new_unit, updated_at = now()
    from pg_temp.erp_reval x where x.point_id = r.point_id and c.point_id = x.point_id and c.product_id = x.product_id;
    v_points := v_points + 1;
    v_total := v_total + v_net;
  end loop;
  select count(*) into v_n from pg_temp.erp_reval;
  return jsonb_build_object('ok', true, 'points', v_points, 'lines', v_n, 'net', v_total);
end $$;
revoke all on function public.erp__internal_revalue(uuid, uuid[], uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- automático
create or replace function public.erp__last_cost_queue()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.last_cost is distinct from old.last_cost and coalesce(new.last_cost, 0) > 0
     and exists (select 1 from public.erp_internal_points ip where ip.store_id = new.store_id and ip.enabled) then
    insert into public.erp_internal_reval_queue (store_id, product_id) values (new.store_id, new.id)
    on conflict (store_id, product_id) do update set queued_at = now();
  end if;
  return null;
end $$;
revoke all on function public.erp__last_cost_queue() from public, anon, authenticated;
drop trigger if exists products_last_cost_reval on public.products;
create trigger products_last_cost_reval after update of last_cost on public.products
  for each row execute function public.erp__last_cost_queue();

-- Al terminar la operación: todos los productos en cola de la tienda, juntos (el primero procesa, los demás no hallan nada).
create or replace function public.erp__reval_queue_flush()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_products uuid[];
begin
  with d as (delete from public.erp_internal_reval_queue where store_id = new.store_id returning product_id)
  select array_agg(product_id) into v_products from d;
  if v_products is not null and cardinality(v_products) > 0 then
    perform public.erp__internal_revalue(new.store_id, v_products, null, 'auto', 'cambió el último costo de factura');
  end if;
  return null;
end $$;
revoke all on function public.erp__reval_queue_flush() from public, anon, authenticated;
drop trigger if exists erp_internal_reval_queue_flush on public.erp_internal_reval_queue;
create constraint trigger erp_internal_reval_queue_flush after insert on public.erp_internal_reval_queue
  deferrable initially deferred for each row execute function public.erp__reval_queue_flush();

-- ---------------------------------------------------------------- manual (con vista previa)
create or replace function public.erp_internal_revalue_now(p_store uuid, p_point uuid, p_apply boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rows jsonb; v_points jsonb; r jsonb;
begin
  if not public.erp__internal_manager(p_store) then raise exception 'Solo la tienda madre con «Administrar cuenta con puntos» revalúa la deuda.'; end if;
  if coalesce(p_apply, false) then
    r := public.erp__internal_revalue(p_store, null, p_point, 'manual', 'revaluación con el último costo de factura');
    return r || jsonb_build_object('applied', true);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('point_id', x.point_id, 'point', w.name, 'product', p.name, 'sku', p.sku, 'qty', x.qty,
                                               'old_unit', x.old_unit, 'new_unit', x.new_unit, 'diff', round((x.new_unit - x.old_unit) * x.qty, 2))
                            order by abs((x.new_unit - x.old_unit) * x.qty) desc), '[]'::jsonb)
  into v_rows
  from public.erp__internal_reval_lines(p_store, null, p_point) x
  join public.erp_warehouses w on w.id = x.point_id join public.products p on p.id = x.product_id;
  select coalesce(jsonb_agg(jsonb_build_object('point_id', q.point_id, 'point', q.point, 'lines', q.n, 'net', q.net) order by q.point), '[]'::jsonb)
  into v_points
  from (select x->>'point_id' as point_id, x->>'point' as point, count(*) as n, sum((x->>'diff')::numeric) as net from jsonb_array_elements(v_rows) x group by 1, 2) q;
  return jsonb_build_object('ok', true, 'applied', false, 'points', v_points, 'lines', jsonb_array_length(v_rows),
                            'rows', (select coalesce(jsonb_agg(e), '[]'::jsonb) from (select e from jsonb_array_elements(v_rows) e limit 300) z));
end $$;
revoke all on function public.erp_internal_revalue_now(uuid, uuid, boolean) from public, anon;
grant execute on function public.erp_internal_revalue_now(uuid, uuid, boolean) to authenticated;

-- Historial de revaluaciones de un punto (para el estado de cuenta).
create or replace function public.erp_internal_revaluations_list(p_store uuid, p_point uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.erp_can_any(p_store, array['internal_credit', 'internal_credit_manage', 'profit_view']) then
    raise exception 'Necesitas «Cuenta con la bodega» o «Ver rentabilidad».';
  end if;
  if not public.erp_point_allowed(p_store, p_point) then raise exception 'Solo puedes ver tu punto.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('at', v.created_at, 'product', p.name, 'sku', p.sku, 'qty', v.qty, 'old_unit', v.old_unit,
                                                       'new_unit', v.new_unit, 'diff', v.diff_total, 'source', v.source, 'by', v.created_by_name,
                                                       'doc_number', d.number) order by v.created_at desc)
                   from (select * from public.erp_internal_revaluations where store_id = p_store and point_id = p_point order by created_at desc limit 500) v
                   join public.products p on p.id = v.product_id
                   left join public.erp_internal_docs d on d.id = v.doc_id), '[]'::jsonb);
end $$;
revoke all on function public.erp_internal_revaluations_list(uuid, uuid) from public, anon;
grant execute on function public.erp_internal_revaluations_list(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
