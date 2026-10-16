-- Funciones de PRODUCCIÓN (consulta_traslados.sql, 2026-10-15) para probar el crédito en traslados.
CREATE OR REPLACE FUNCTION public.erp__capture_sale_finance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  o public.orders; v_point uuid; it record; p public.products; r public.erp_price_rules; s public.erp_profit_settings;
  v_lvl integer; v_ref numeric; v_src text; v_cost numeric; v_rev numeric; v_ref_total numeric; v_cost_total numeric;
begin
  begin
    select * into o from public.orders where id = new.order_id;
    select m.point_id into v_point from public.erp_order_meta m where m.order_id = new.order_id;
    select * into s from public.erp_profit_settings where store_id = o.store_id;
    for it in
      select oi.product_id, sum(oi.quantity)::integer as qty, sum(oi.quantity * oi.price) as revenue,
             (array_agg(oi.price order by oi.quantity desc))[1] as unit_price
      from public.order_items oi where oi.order_id = new.order_id group by oi.product_id
    loop
      select * into p from public.products where id = it.product_id;
      r := null; v_lvl := null; v_ref := null; v_src := 'sold_price';
      if v_point is not null then
        select * into r from public.erp__rule_for(o.store_id, v_point, it.product_id, coalesce(o.created_at, now()));
      end if;
      for l in 1..5 loop
        if round(it.unit_price, 2) = public.erp__point_price(p, l, r, coalesce(s.rounding_step, 0), coalesce(s.rounding_dir, 'nearest')) then
          v_lvl := l;
          v_ref := round(coalesce(public.catalog__price(p, l), 0), 2);
          v_src := case when r.id is null or r.kind = 'none' then 'level' else 'point_rule' end;
          exit;
        end if;
      end loop;
      if v_lvl is null then v_ref := round(it.unit_price, 2); r := null; end if;
      v_cost := coalesce(p.cost_price, 0);
      v_rev := round(it.revenue, 2);
      v_cost_total := round(it.qty * v_cost, 2);
      v_ref_total := round(it.qty * v_ref, 2);
      insert into public.erp_sale_finance (order_id, product_id, store_id, point_id, qty, revenue, unit_cost, cost_total, ref_level, ref_unit,
                                           ref_total, mother_amount, point_amount, profit, rule_id, rule_kind, rule_value, ref_source)
      values (new.order_id, it.product_id, o.store_id, v_point, it.qty, v_rev, v_cost, v_cost_total, v_lvl, v_ref,
              v_ref_total, v_ref_total - v_cost_total, v_rev - v_ref_total, v_rev - v_cost_total,
              case when v_src = 'point_rule' then r.id end, case when v_src = 'point_rule' then r.kind end,
              case when v_src = 'point_rule' then r.value end, v_src)
      on conflict (order_id, product_id) do nothing;
    end loop;
  exception when others then
    -- Nunca frena la venta; queda registrado para revisarlo.
    insert into public.erp_finance_capture_errors (order_id, message) values (new.order_id, left(sqlerrm, 500));
  end;
  return null;
end;
$function$;
