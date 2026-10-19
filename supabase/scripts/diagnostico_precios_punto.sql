-- Diagnóstico: ¿por qué el POS de un punto muestra los precios de la madre y no los de su regla?
-- Solo lee: hace la misma consulta que el POS (erp_point_prices) como cada usuario de la tienda y muestra qué le devuelve.
-- Cambia los tres valores de abajo si hace falta: tienda, nombre del punto y código del producto de prueba.

create temp table if not exists diag_precios_punto (
  usuario text, rol text, punto_del_usuario text, puntos_extra int, es_miembro boolean, punto_permitido boolean,
  productos_con_precio int, precios_producto text, error text
);
truncate diag_precios_punto;

do $$
declare
  v_store uuid;
  v_point uuid;
  v_prod uuid;
  u record;
  v_n int;
  v_price text;
  v_err text;
  v_member boolean;
  v_ok boolean;
begin
  select id into v_store from public.stores where slug = 'lavitrina';
  select id into v_point from public.erp_warehouses where store_id = v_store and name ilike '%zamora%' order by name limit 1;
  select id into v_prod from public.products where store_id = v_store and (sku ilike 'BXMJ6204' or name ilike '%BXMJ6204%') limit 1;

  -- Referencia: lo que da la regla sin mirar quién pregunta.
  insert into diag_precios_punto (usuario, precios_producto, error)
  select '(regla directa)',
         string_agg(public.erp__point_price(p, l, x.r, coalesce(s.rounding_step, 0), coalesce(s.rounding_dir, 'nearest'))::text, ' / ' order by l),
         case when (x.r).id is null then 'El punto no tiene regla vigente para este producto' end
  from public.products p
  cross join lateral (select public.erp__rule_for(v_store, v_point, p.id) as r) x
  left join public.erp_profit_settings s on s.store_id = v_store
  cross join generate_series(1, 5) l
  where p.id = v_prod
  group by (x.r).id;

  for u in
    select su.user_id, su.role, au.email, w.name as pname, coalesce(array_length(su.point_ids, 1), 0) as extra
    from public.store_users su
    left join auth.users au on au.id = su.user_id
    left join public.erp_warehouses w on w.id = su.point_id
    where su.store_id = v_store and su.active
  loop
    v_err := null; v_n := null; v_price := null;
    perform set_config('request.jwt.claims', json_build_object('sub', u.user_id, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', u.user_id::text, true);
    v_member := public.erp__is_store_member(v_store);
    v_ok := public.erp_point_allowed(v_store, v_point);
    begin
      select count(*)::int,
             max(case when pp.product_id = v_prod then concat_ws(' / ', pp.price_1, pp.price_2, pp.price_3, pp.price_4, pp.price_5) end)
        into v_n, v_price
      from public.erp_point_prices(v_store, v_point) pp;
    exception when others then
      v_err := sqlerrm;
    end;
    insert into diag_precios_punto values (u.email, u.role, u.pname, u.extra, v_member, v_ok, v_n, v_price, v_err);
  end loop;
end $$;

select * from diag_precios_punto order by usuario = '(regla directa)' desc, usuario;
