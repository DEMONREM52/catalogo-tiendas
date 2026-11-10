-- 1) Da a cada punto de LA VITRINA un prefijo PROPIO de remisión y de factura (hoy 5 puntos comparten «REM» y «FAC»,
--    y por eso la Bodega principal choca con REM-00001, que ya usó P. LA VITRINA 514).
-- 2) Pone el pedido #193 en «Bodega principal» con su número de remisión, usando la MISMA función del POS
--    (erp_tag_order) actuando como el dueño, con todas sus revisiones.
-- Todo o nada: si algo falla no se guarda ningún cambio y sale el motivo. Córrelo en Supabase → SQL Editor (todo junto).
--
-- Prefijos propuestos (cámbialos aquí si prefieres otras letras; deben ser distintos entre puntos):
--   Bodega principal        REMB  / FACB
--   P. LA VITRINA 514       REM   / FAC    (se queda igual: ya tiene REM-00001)
--   P. MIRA PUES STORE 205  REMMP / FACMP
--   SEDE CISNEROS           REMC  / FACC
--   SEDE SAN ROQUE          REMSR / FACSR
--   SEDE MANHATTAN y SEDE ZAMORA no cambian (ya tienen los suyos).
-- Los consecutivos de los puntos que cambian de prefijo arrancan en 1 con el prefijo nuevo.
--
-- Vendedor del #193: queda vacío. Para ponerlo, cambia null por el nombre entre comillas en v_seller_name.

begin;

do $$
declare
  v_seller_name text := null;          -- ← nombre del vendedor del #193 (opcional), p. ej. 'DANIEL RUIZ RODRIGUEZ'
  v_store  uuid;
  v_owner  uuid;
  v_token  text;
  v_point  uuid;
  v_seller uuid;
  v_res    jsonb;
  r        record;
  v_n      integer;
begin
  select s.id, s.owner_id into v_store, v_owner from public.stores s where s.name ilike 'la vitrina' limit 1;
  if v_store is null then raise exception 'No encontré la tienda LA VITRINA'; end if;

  -- 1) Prefijos propios.
  for r in select * from (values
      ('bodega principal',       'REMB',  'FACB'),
      ('p. mira pues store 205', 'REMMP', 'FACMP'),
      ('sede cisneros',          'REMC',  'FACC'),
      ('sede san roque',         'REMSR', 'FACSR')
    ) as t(punto, rem, fac)
  loop
    update public.erp_warehouses w
       set remision_prefix = r.rem, next_remision_number = 1,
           invoice_prefix  = r.fac, next_invoice_number  = 1
     where w.store_id = v_store and lower(trim(w.name)) = r.punto
       and not exists (select 1 from public.erp_order_meta m where m.point_id = w.id);   -- solo si ese punto aún no tiene documentos
    get diagnostics v_n = row_count;
    raise notice 'Prefijo % / % para «%»: %', r.rem, r.fac, r.punto, case when v_n = 1 then 'listo' else 'NO se cambió (no existe o ya tiene documentos)' end;
  end loop;

  -- Revisión: ningún prefijo repetido entre puntos de la tienda.
  if exists (select 1 from public.erp_warehouses where store_id = v_store group by remision_prefix having count(*) > 1)
     or exists (select 1 from public.erp_warehouses where store_id = v_store group by invoice_prefix having count(*) > 1) then
    raise exception 'Todavía hay prefijos repetidos entre puntos: revisa la lista de arriba antes de seguir.';
  end if;

  -- 2) Pedido #193 a Bodega principal.
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
  raise notice 'Pedido #193 listo: %', v_res;
end $$;

commit;

-- Revisión final: prefijos por punto y el #193 con su punto y remisión.
select w.name as punto, w.remision_prefix, w.next_remision_number, w.invoice_prefix, w.next_invoice_number
from public.erp_warehouses w join public.stores s on s.id = w.store_id
where s.name ilike 'la vitrina' order by w.kind desc, w.name;

select o.receipt_no, o.status, w.name as punto, m.seller_name as vendedor, m.doc_number as remision
from public.orders o
join public.erp_order_meta m on m.order_id = o.id
join public.erp_warehouses w on w.id = m.point_id
join public.stores s on s.id = o.store_id
where s.name ilike 'la vitrina' and o.receipt_no = 193;
