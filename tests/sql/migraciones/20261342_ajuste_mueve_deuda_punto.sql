-- =====================================================================
-- 20261342 · Los ajustes de inventario de un punto mueven su deuda con la bodega
--
-- Decisión del usuario (2026-11-24):
--   · Lo que FALTA en un punto con crédito BAJA su deuda: la pérdida la asume la bodega
--     (como la regla de daños y como hace «Cuadrar con el costo»).
--   · Lo que SOBRA la SUBE: el punto tiene más mercancía de la bodega.
--   · TODOS los ajustes del punto (conteo físico, daño, pérdida, vencido, sobrante, corrección, otro),
--     incluidos los conteos por zonas aprobados y la auditoría del conteo (todos pasan por erp_post_adjustment).
--
-- Cómo:
--   · Al terminar la operación (trigger diferido sobre erp_adjustments) se suma diferencia × precio de bodega
--     de cada producto. Precio de bodega = el mismo de «Cuadrar con el costo» (20261299): último costo × (1 + %),
--     redondeado; si no hay último costo, el precio de bodega registrado del punto; si no, el del traslado.
--   · UNA nota por ajuste con el neto: faltante neto → kind 'loss' (baja la deuda, cuenta como pérdida de la
--     bodega en la rentabilidad); sobrante neto → kind 'charge' (sube la deuda, con el plazo del punto).
--     El detalle (unidades y valor que faltan y sobran) queda en la nota, en adjustment_debt y en la auditoría.
--   · Esas notas no se anulan a mano (salen del inventario): para corregir se hace otro ajuste.
--   · Lo que sobra y el punto no tenía con precio de bodega queda registrado con ese precio (erp_point_costs),
--     así las revaluaciones por costo lo siguen.
--   · Solo puntos con crédito activo. Los ajustes de antes NO se tocan (para eso está «Cuadrar con el costo»).
--   · Vista previa antes de aplicar (erp_adjustment_debt_preview) y resultado después (erp_adjustment_debt).
--     Los valores en $ solo para quien ve la cuenta con puntos, costos o rentabilidad.
-- No borra datos. Idempotente. Requiere 20261124, 20261126, 20261293 y 20261299.
-- =====================================================================

alter table public.erp_internal_docs add column if not exists adjustment_id uuid references public.erp_adjustments(id);
alter table public.erp_internal_docs add column if not exists adjustment_detail jsonb;
create unique index if not exists erp_internal_docs_adjustment on public.erp_internal_docs (adjustment_id) where adjustment_id is not null;

-- ---------------------------------------------------------------- precio de bodega (igual que el cuadre)
create or replace function public.erp__internal_adjust_unit(p_store uuid, p_point uuid, p_product uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(
    (select case when coalesce(p.last_cost, 0) > 0
                 then public.erp__round_up(p.last_cost * (1 + public.erp__internal_pct(p_store, p_point, p.id) / 100),
                                           (public.erp__internal_settings(p_store)).round_step) end
     from public.products p where p.id = p_product and p.store_id = p_store),
    (select c.avg_cost from public.erp_point_costs c where c.point_id = p_point and c.product_id = p_product and c.avg_cost > 0),
    public.erp__internal_unit(p_store, p_point, p_product),
    0);
$$;
revoke all on function public.erp__internal_adjust_unit(uuid, uuid, uuid) from public, anon, authenticated;

-- Líneas valorizadas: (producto, diferencia) → faltante / sobrante a precio de bodega y a costo.
create or replace function public.erp__internal_adjust_sum(p_store uuid, p_point uuid, p_lines jsonb)
returns jsonb language sql stable security definer set search_path = public as $$
  with l as (
    select (x->>'product_id')::uuid as product_id, (x->>'diff')::numeric as diff
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) x
    where coalesce((x->>'diff')::numeric, 0) <> 0
  ), v as (
    select l.product_id, l.diff, public.erp__internal_adjust_unit(p_store, p_point, l.product_id) as unit,
           coalesce(p.cost_price, 0) as cost
    from l join public.products p on p.id = l.product_id and p.store_id = p_store
  )
  select jsonb_build_object(
    'short_units', coalesce(sum(-diff) filter (where diff < 0), 0),
    'short_value', round(coalesce(sum(-diff * unit) filter (where diff < 0), 0), 2),
    'over_units', coalesce(sum(diff) filter (where diff > 0), 0),
    'over_value', round(coalesce(sum(diff * unit) filter (where diff > 0), 0), 2),
    'net', round(coalesce(sum(diff * unit), 0), 2),
    'net_cost', round(coalesce(sum(diff * cost), 0), 2),
    'no_price', count(*) filter (where unit <= 0))
  from v;
$$;
revoke all on function public.erp__internal_adjust_sum(uuid, uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------- nota por ajuste
create or replace function public.erp__internal_from_adjustment(p_adjustment uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare a public.erp_adjustments; ip public.erp_internal_points; v_lines jsonb; s jsonb; v_net numeric; v_doc uuid; v_reason text;
begin
  select * into a from public.erp_adjustments where id = p_adjustment;
  if not found then return null; end if;
  select * into ip from public.erp_internal_points where store_id = a.store_id and point_id = a.warehouse_id and enabled;
  if not found then return null; end if;
  select id into v_doc from public.erp_internal_docs where adjustment_id = p_adjustment;
  if found then return v_doc; end if;

  select coalesce(jsonb_agg(jsonb_build_object('product_id', i.product_id, 'diff', i.diff)), '[]'::jsonb) into v_lines
  from public.erp_adjustment_items i where i.adjustment_id = p_adjustment and i.diff <> 0;
  s := public.erp__internal_adjust_sum(a.store_id, a.warehouse_id, v_lines);
  v_net := (s->>'net')::numeric;

  -- Lo que sobra sin precio de bodega en el punto queda registrado (las revaluaciones por costo lo siguen).
  insert into public.erp_point_costs (point_id, product_id, store_id, avg_cost)
  select a.warehouse_id, i.product_id, a.store_id, public.erp__internal_adjust_unit(a.store_id, a.warehouse_id, i.product_id)
  from public.erp_adjustment_items i
  where i.adjustment_id = p_adjustment and i.diff > 0
    and public.erp__internal_adjust_unit(a.store_id, a.warehouse_id, i.product_id) > 0
  on conflict (point_id, product_id) do nothing;

  if abs(v_net) < 1 then return null; end if;
  v_reason := case a.reason when 'count' then 'conteo físico' when 'damage' then 'producto dañado' when 'loss' then 'pérdida / faltante'
                when 'expired' then 'vencido' when 'found' then 'sobrante encontrado' when 'correction' then 'corrección' else 'otro' end;

  insert into public.erp_internal_docs (store_id, point_id, creditor_id, number, kind, sign, amount, cost_amount, due_date, note,
                                        adjustment_id, adjustment_detail, created_by, created_by_name)
  values (a.store_id, a.warehouse_id, public.erp__internal_default_creditor(a.store_id), public.erp_next_number(a.store_id, 'internal_doc'),
          case when v_net < 0 then 'loss' else 'charge' end, case when v_net < 0 then -1 else 1 end, abs(v_net), abs((s->>'net_cost')::numeric),
          case when v_net > 0 then public.erp__internal_today() + coalesce(ip.term_days, (public.erp__internal_settings(a.store_id)).default_term_days) end,
          left('Ajuste de inventario #' || a.number || ' (' || v_reason || ')'
               || case when (s->>'short_units')::numeric > 0 then ' · faltan ' || (s->>'short_units') || ' und. ($' || replace(to_char((s->>'short_value')::numeric, 'FM999,999,999,990'), ',', '.') || ')' else '' end
               || case when (s->>'over_units')::numeric > 0 then ' · sobran ' || (s->>'over_units') || ' und. ($' || replace(to_char((s->>'over_value')::numeric, 'FM999,999,999,990'), ',', '.') || ')' else '' end,
               300),
          p_adjustment, s, a.created_by, coalesce(public.erp_actor_name(a.store_id), 'Automático'))
  returning id into v_doc;
  perform public.erp_audit(a.store_id, 'internal.adjustment', 'erp_internal_docs', v_doc,
    s || jsonb_build_object('point_id', a.warehouse_id, 'adjustment_id', p_adjustment, 'adjustment_number', a.number, 'reason', a.reason));
  return v_doc;
end $$;
revoke all on function public.erp__internal_from_adjustment(uuid) from public, anon, authenticated;

-- Al terminar la operación (cuando ya están todos los productos del ajuste).
create or replace function public.erp__adjustment_debt_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.erp_internal_points ip where ip.store_id = new.store_id and ip.point_id = new.warehouse_id and ip.enabled) then
    -- Si algo falla, el ajuste del inventario no se cae: queda en la auditoría para arreglarlo con «Cuadrar con el costo».
    begin
      perform public.erp__internal_from_adjustment(new.id);
    exception when others then
      begin
        perform public.erp_audit(new.store_id, 'internal.adjustment_failed', 'erp_adjustments', new.id,
          jsonb_build_object('point_id', new.warehouse_id, 'error', left(sqlerrm, 300)));
      exception when others then null;
      end;
    end;
  end if;
  return null;
end $$;
revoke all on function public.erp__adjustment_debt_trigger() from public, anon, authenticated;
drop trigger if exists erp_adjustments_point_debt on public.erp_adjustments;
create constraint trigger erp_adjustments_point_debt after insert on public.erp_adjustments
  deferrable initially deferred for each row execute function public.erp__adjustment_debt_trigger();

-- Las notas de un ajuste no se anulan a mano: salen del inventario (para corregir, otro ajuste).
create or replace function public.erp__internal_doc_adjust_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.adjustment_id is not null and old.status = 'active' and new.status is distinct from old.status then
    raise exception 'Esta nota sale de un ajuste de inventario: no se anula a mano. Para corregirla haz otro ajuste.';
  end if;
  return new;
end $$;
revoke all on function public.erp__internal_doc_adjust_guard() from public, anon, authenticated;
drop trigger if exists erp_internal_docs_adjust_guard on public.erp_internal_docs;
create trigger erp_internal_docs_adjust_guard before update of status on public.erp_internal_docs
  for each row execute function public.erp__internal_doc_adjust_guard();

-- ---------------------------------------------------------------- vista previa y resultado (pantalla de ajustes)
create or replace function public.erp__adjust_money_ok(p_store uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.erp_can_any(p_store, array['internal_credit', 'internal_credit_manage', 'costs_view', 'profit_view']::text[]);
$$;
revoke all on function public.erp__adjust_money_ok(uuid) from public, anon, authenticated;

-- p_items: [{product_id, qty_after}] como se le mandan a erp_post_adjustment.
create or replace function public.erp_adjustment_debt_preview(p_store uuid, p_warehouse uuid, p_items jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_lines jsonb; s jsonb; v_bal numeric; v_name text;
begin
  if auth.uid() is null or not public.erp_can(p_store, 'inventory_adjust') then
    return jsonb_build_object('ok', false, 'message', 'Necesitas el permiso de ajustar inventario.');
  end if;
  if not exists (select 1 from public.erp_internal_points where store_id = p_store and point_id = p_warehouse and enabled) then
    return jsonb_build_object('ok', true, 'applies', false);
  end if;
  select name into v_name from public.erp_warehouses where id = p_warehouse and store_id = p_store;
  select coalesce(jsonb_agg(jsonb_build_object('product_id', x.product_id, 'diff', x.qty_after - coalesce(l.qty, 0))), '[]'::jsonb) into v_lines
  from (select (e->>'product_id')::uuid as product_id, (e->>'qty_after')::numeric as qty_after
        from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) e) x
  left join public.erp_stock_levels l on l.warehouse_id = p_warehouse and l.product_id = x.product_id
  where x.product_id is not null and x.qty_after is not null;
  s := public.erp__internal_adjust_sum(p_store, p_warehouse, v_lines);
  if not public.erp__adjust_money_ok(p_store) or not public.erp_point_allowed(p_store, p_warehouse) then
    return jsonb_build_object('ok', true, 'applies', true, 'money', false, 'point', v_name,
                              'short_units', s->'short_units', 'over_units', s->'over_units');
  end if;
  v_bal := public.erp__internal_balance(p_store, p_warehouse);
  return jsonb_build_object('ok', true, 'applies', true, 'money', true, 'point', v_name, 'balance_before', v_bal,
                            'balance_after', round(v_bal + (s->>'net')::numeric, 2)) || (s - 'net_cost');
end $$;
revoke all on function public.erp_adjustment_debt_preview(uuid, uuid, jsonb) from public, anon;
grant execute on function public.erp_adjustment_debt_preview(uuid, uuid, jsonb) to authenticated;

create or replace function public.erp_adjustment_debt(p_adjustment uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a public.erp_adjustments; d public.erp_internal_docs; v_name text;
begin
  select * into a from public.erp_adjustments where id = p_adjustment;
  if not found or auth.uid() is null
     or not public.erp_can_any(a.store_id, array['inventory_adjust', 'inventory', 'internal_credit', 'internal_credit_manage']::text[]) then
    return jsonb_build_object('ok', false, 'message', 'No encontrado.');
  end if;
  select * into d from public.erp_internal_docs where adjustment_id = p_adjustment;
  if not found then return jsonb_build_object('ok', true, 'applies', false); end if;
  select name into v_name from public.erp_warehouses where id = a.warehouse_id;
  if not public.erp__adjust_money_ok(a.store_id) or not public.erp_point_allowed(a.store_id, a.warehouse_id) then
    return jsonb_build_object('ok', true, 'applies', true, 'money', false, 'point', v_name, 'kind', d.kind, 'number', d.number);
  end if;
  return jsonb_build_object('ok', true, 'applies', true, 'money', true, 'point', v_name, 'kind', d.kind, 'number', d.number,
                            'amount', d.sign * d.amount, 'detail', d.adjustment_detail - 'net_cost',
                            'balance_after', public.erp__internal_balance(a.store_id, a.warehouse_id));
end $$;
revoke all on function public.erp_adjustment_debt(uuid) from public, anon;
grant execute on function public.erp_adjustment_debt(uuid) to authenticated;

notify pgrst, 'reload schema';
