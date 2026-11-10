-- Pone el pedido #193 de LA VITRINA en «Bodega principal» y le da su número de remisión.
-- Usa la MISMA función del POS (erp_tag_order) actuando como el dueño de la tienda, con todas sus revisiones.
-- Si algo falla, no se guarda nada y sale el motivo (es el mismo error que dejó la venta sin punto).
-- Córrelo en Supabase → SQL Editor (todo junto).
--
-- Vendedor: queda vacío. Si quieres ponerlo, cambia null por el nombre entre comillas en v_seller_name,
-- por ejemplo 'DANIEL RUIZ RODRIGUEZ'.

begin;

do $$
declare
  v_seller_name text := null;          -- ← nombre del vendedor (opcional)
  v_store  uuid;
  v_owner  uuid;
  v_token  text;
  v_point  uuid;
  v_seller uuid;
  v_res    jsonb;
begin
  select s.id, s.owner_id into v_store, v_owner from public.stores s where s.name ilike 'la vitrina' limit 1;
  if v_store is null then raise exception 'No encontré la tienda LA VITRINA'; end if;

  select o.token into v_token from public.orders o where o.store_id = v_store and o.receipt_no = 193;
  if v_token is null then raise exception 'No encontré el pedido #193'; end if;

  select w.id into v_point from public.erp_warehouses w where w.store_id = v_store and w.name ilike 'bodega principal' and w.active limit 1;
  if v_point is null then raise exception 'No encontré la Bodega principal activa'; end if;

  if v_seller_name is not null then
    select s.user_id into v_seller from public.erp_sellers(v_store) s where s.name ilike v_seller_name limit 1;
    if v_seller is null then raise exception 'No encontré el vendedor %', v_seller_name; end if;
  end if;

  -- Actuar como el dueño (igual que si lo hiciera desde el POS).
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('role', 'authenticated', true);

  v_res := to_jsonb(public.erp_tag_order(v_store, v_token, v_point, v_seller, 'remision'));
  raise notice 'Listo: %', v_res;
end $$;

commit;

-- Revisión: debe salir Bodega principal y el número de remisión.
select o.receipt_no, o.status, w.name as punto, m.seller_name as vendedor, m.doc_number as remision
from public.orders o
join public.erp_order_meta m on m.order_id = o.id
join public.erp_warehouses w on w.id = m.point_id
join public.stores s on s.id = o.store_id
where s.name ilike 'la vitrina' and o.receipt_no = 193;
