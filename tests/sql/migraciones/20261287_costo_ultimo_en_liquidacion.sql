-- =====================================================================
-- 20261287 · Ganancia de las ventas con el ÚLTIMO costo (por punto)
--
-- Problema (SEDE ZAMORA, 2026-11-08): el precio de venta se calcula con el último costo (20261206),
-- pero la ganancia de cada venta usaba el costo PROMEDIO de toda la empresa. Con mercancía vieja más
-- cara en el promedio, una venta con precio correcto salía «con pérdida».
--   Ej.: CARRITO ORGANIZADOR · promedio $33.543 · último costo $20.000 · vendido a $23.000
--        antes: −$10.543 de pérdida · ahora: +$3.000 de ganancia.
--
-- Decisión del usuario: en los puntos que lo tengan activado, cada venta guarda como costo el ÚLTIMO
-- costo del producto (el mismo con que se calcula el precio). Al cambiar el costo en la madre, las
-- ventas siguientes ya usan el nuevo; lo vendido antes conserva el suyo.
-- Además se pueden corregir ventas ya hechas desde una fecha, SOLO si no están en una liquidación
-- aprobada (lo aprobado y pagado nunca se toca). Cada corrección queda en la auditoría.
--
-- Requiere 20261106, 20261206 y 20261208. No borra datos. Es idempotente.
-- =====================================================================

alter table public.erp_pool_settings add column if not exists cost_basis text not null default 'average';
alter table public.erp_pool_settings add column if not exists cost_basis_from timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.erp_pool_settings'::regclass and conname = 'erp_pool_settings_cost_basis') then
    alter table public.erp_pool_settings add constraint erp_pool_settings_cost_basis check (cost_basis in ('average', 'last'));
  end if;
end $$;

-- ¿Qué costo usa una venta de este punto hecha en este momento?
create or replace function public.erp__sale_cost_basis(p_store uuid, p_point uuid, p_at timestamptz)
returns text language sql stable security definer set search_path = public as $$
  select case when p_point is not null and exists (
    select 1 from public.erp_pool_settings s
    where s.store_id = p_store and s.point_id = p_point and s.cost_basis = 'last'
      and (s.cost_basis_from is null or p_at >= s.cost_basis_from)) then 'last' else 'average' end;
$$;
revoke all on function public.erp__sale_cost_basis(uuid, uuid, timestamptz) from public, anon, authenticated;

-- Último costo que tenía un producto en una fecha: el de su factura de compra más reciente hasta ese
-- momento (misma regla que erp__refresh_last_cost). Null si no tenía compras.
create or replace function public.erp__last_cost_at(p_product uuid, p_at timestamptz)
returns numeric language sql stable security definer set search_path = public as $$
  with last_purchase as (
    select p.id from public.erp_purchase_items i join public.erp_purchases p on p.id = i.purchase_id
    where i.product_id = p_product and i.unit_cost > 0 and p.created_at <= p_at
      and coalesce(p.status, 'received') not in ('cancelled', 'void', 'anulada', 'draft')
    order by p.created_at desc, p.id desc limit 1
  )
  select round(sum(i.qty * i.unit_cost) / nullif(sum(i.qty), 0), 4)
  from public.erp_purchase_items i
  where i.purchase_id = (select id from last_purchase) and i.product_id = p_product and i.unit_cost > 0;
$$;
revoke all on function public.erp__last_cost_at(uuid, timestamptz) from public, anon, authenticated;

-- La foto financiera de cada venta toma el último costo si su punto lo tiene activado.
-- (Se ajusta la función de la base sin reescribirla; si no se encuentra la línea, no cambia nada.)
do $$
declare r record; v_def text; v_new text; n integer := 0;
begin
  for r in select p.oid from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'erp__capture_sale_finance' loop
    n := n + 1;
    v_def := pg_get_functiondef(r.oid);
    if position('erp__sale_cost_basis' in v_def) > 0 then continue; end if;
    v_new := regexp_replace(v_def, '(v_cost\s*:=\s*coalesce\(p\.cost_price,\s*0\);)',
      '\1
      -- Último costo en los puntos que lo tienen activado (20261287).
      if public.erp__sale_cost_basis(o.store_id, v_point, now()) = ''last'' and coalesce(p.last_cost, 0) > 0 then v_cost := p.last_cost; end if;');
    if v_new = v_def then raise exception 'No pude ajustar erp__capture_sale_finance (no encontré la línea del costo). No se cambió nada.'; end if;
    execute v_new;
  end loop;
  if n = 0 then raise exception 'No existe erp__capture_sale_finance en esta base. No se cambió nada.'; end if;
end $$;

-- ---------------------------------------------------------------- configurar
create or replace function public.erp_pool_cost_basis_get(p_store uuid, p_point uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare ps public.erp_pool_settings; v_open public.erp_settlements;
begin
  if not (public.erp_can(p_store, 'profit_view') or public.erp_can(p_store, 'profit_settle') or public.erp_can(p_store, 'profit_settle_approve')) then
    raise exception 'No tienes permiso para ver la rentabilidad.';
  end if;
  if not public.erp__pool_allowed(p_store, p_point) then raise exception 'No tienes acceso a este pozo.'; end if;
  select * into ps from public.erp_pool_settings where store_id = p_store and point_id is not distinct from p_point;
  select * into v_open from public.erp_settlements where store_id = p_store and (point_id is not distinct from p_point or point_id is null)
    and status in ('calculated', 'review') order by created_at desc limit 1;
  return jsonb_build_object(
    'basis', coalesce(ps.cost_basis, 'average'), 'from', ps.cost_basis_from,
    'can_edit', p_point is not null and public.erp_my_points(p_store) is null
                and (public.erp_can(p_store, 'profit_beneficiaries') or public.erp_can(p_store, 'profit_settle')),
    'open_settlement', case when v_open.id is null then null else jsonb_build_object('id', v_open.id, 'number', v_open.number, 'point_id', v_open.point_id) end);
end $$;
revoke all on function public.erp_pool_cost_basis_get(uuid, uuid) from public, anon;
grant execute on function public.erp_pool_cost_basis_get(uuid, uuid) to authenticated;

-- Activar o apagar el último costo para las ventas que se hagan desde ya (solo la tienda madre).
create or replace function public.erp_pool_cost_basis_save(p_store uuid, p_point uuid, p_basis text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (public.erp_can(p_store, 'profit_beneficiaries') or public.erp_can(p_store, 'profit_settle')) or public.erp_my_points(p_store) is not null then
    raise exception 'Solo la tienda madre con «Beneficiarios y repartos» o «Preparar liquidaciones» cambia cómo se calcula la ganancia.';
  end if;
  if p_point is null then raise exception 'Se configura en cada punto.'; end if;
  if not exists (select 1 from public.erp_warehouses w where w.id = p_point and w.store_id = p_store) then raise exception 'Ese punto no es de la tienda.'; end if;
  if p_basis not in ('average', 'last') then raise exception 'Opción no válida.'; end if;
  insert into public.erp_pool_settings (store_id, point_id, cost_basis, cost_basis_from, updated_by, updated_by_name, updated_at)
  values (p_store, p_point, p_basis, now(), auth.uid(), public.erp_actor_name(p_store), now())
  on conflict (store_id, coalesce(point_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update
    set cost_basis = excluded.cost_basis,
        cost_basis_from = case when public.erp_pool_settings.cost_basis = excluded.cost_basis then public.erp_pool_settings.cost_basis_from else now() end,
        updated_by = excluded.updated_by, updated_by_name = excluded.updated_by_name, updated_at = now();
  perform public.erp_audit(p_store, 'profit.cost_basis', 'erp_pool_settings', p_point, jsonb_build_object('point_id', p_point, 'basis', p_basis));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.erp_pool_cost_basis_save(uuid, uuid, text) from public, anon;
grant execute on function public.erp_pool_cost_basis_save(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------- corregir ventas ya hechas
-- Recalcula con el último costo que había al momento de cada venta las ventas del punto desde p_from,
-- menos las que están en una liquidación aprobada (de cualquier pozo). p_apply = false solo muestra.
-- Si hay una liquidación abierta del punto (o de la madre) hay que descartarla antes: ya tomó los valores viejos.
create or replace function public.erp_sale_finance_recost_last(p_store uuid, p_point uuid, p_from timestamptz, p_apply boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_open bigint; v_rows jsonb; v_n integer; v_delta numeric; v_skipped integer; v_same integer;
begin
  if not public.erp_can(p_store, 'profit_settle') or public.erp_my_points(p_store) is not null then
    raise exception 'Solo la tienda madre con «Preparar liquidaciones» corrige ventas ya hechas.';
  end if;
  if p_point is null then raise exception 'Escoge el punto.'; end if;
  if p_from is null or p_from > now() then raise exception 'Escoge desde qué fecha.'; end if;
  if coalesce(p_apply, false) then
    select number into v_open from public.erp_settlements
    where store_id = p_store and (point_id = p_point or point_id is null) and status in ('calculated', 'review') order by created_at desc limit 1;
    if v_open is not null then raise exception 'Primero descarta la liquidación #% (está abierta con los costos viejos); después la vuelves a preparar.', v_open; end if;
    perform pg_advisory_xact_lock(hashtext('settle:' || p_store::text || ':' || p_point::text));
  end if;

  create temp table if not exists pg_temp.erp_recost (order_id uuid, product_id uuid, name text, sold_at timestamptz, qty numeric,
    revenue numeric, old_unit numeric, new_unit numeric, old_profit numeric, new_profit numeric, locked boolean) on commit drop;
  truncate pg_temp.erp_recost;
  insert into pg_temp.erp_recost
  select f.order_id, f.product_id, p.name, coalesce(o.confirmed_at, o.created_at), f.qty, f.revenue, f.unit_cost,
         public.erp__last_cost_at(f.product_id, coalesce(o.confirmed_at, o.created_at)), f.profit, null,
         exists (select 1 from public.erp_settlement_sources ss join public.erp_settlements st on st.id = ss.settlement_id
                 where ss.order_id = f.order_id and st.status in ('approved', 'partially_paid', 'paid'))
  from public.erp_sale_finance f
  join public.orders o on o.id = f.order_id
  join public.products p on p.id = f.product_id
  where f.store_id = p_store and f.point_id = p_point and coalesce(o.confirmed_at, o.created_at) >= p_from;
  update pg_temp.erp_recost set new_profit = revenue - round(qty * new_unit, 2) where new_unit > 0;

  select count(*) filter (where locked and new_unit > 0 and round(new_unit, 2) <> round(old_unit, 2)),
         count(*) filter (where not locked and (new_unit is null or new_unit <= 0 or round(new_unit, 2) = round(old_unit, 2)))
  into v_skipped, v_same from pg_temp.erp_recost;
  select count(*), coalesce(sum(new_profit - old_profit), 0),
         coalesce(jsonb_agg(jsonb_build_object('name', name, 'sold_at', sold_at, 'qty', qty, 'revenue', revenue, 'old_unit', old_unit, 'new_unit', new_unit,
                                               'old_profit', old_profit, 'new_profit', new_profit) order by abs(new_profit - old_profit) desc) filter (where rn <= 60), '[]'::jsonb)
  into v_n, v_delta, v_rows
  from (select *, row_number() over (order by abs(new_profit - old_profit) desc) rn from pg_temp.erp_recost
        where not locked and new_unit > 0 and round(new_unit, 2) <> round(old_unit, 2)) x;

  if coalesce(p_apply, false) and v_n > 0 then
    update public.erp_sale_finance f set
      unit_cost = r.new_unit,
      cost_total = round(f.qty * r.new_unit, 2),
      profit = f.revenue - round(f.qty * r.new_unit, 2),
      mother_amount = (f.revenue - round(f.qty * r.new_unit, 2)) - f.point_amount,
      cost_source = 'last_cost'
    from pg_temp.erp_recost r
    where f.order_id = r.order_id and f.product_id = r.product_id and f.point_id = p_point
      and not r.locked and r.new_unit > 0 and round(r.new_unit, 2) <> round(r.old_unit, 2);
    perform public.erp_audit(p_store, 'sale_finance.recost_last', 'erp_sale_finance', null,
      jsonb_build_object('point_id', p_point, 'from', p_from, 'lines', v_n, 'profit_change', v_delta, 'skipped_approved', v_skipped));
  end if;
  return jsonb_build_object('ok', true, 'applied', coalesce(p_apply, false), 'lines', v_n, 'profit_change', v_delta,
                            'skipped_approved', v_skipped, 'unchanged', v_same, 'rows', v_rows);
end $$;
revoke all on function public.erp_sale_finance_recost_last(uuid, uuid, timestamptz, boolean) from public, anon;
grant execute on function public.erp_sale_finance_recost_last(uuid, uuid, timestamptz, boolean) to authenticated;

notify pgrst, 'reload schema';
