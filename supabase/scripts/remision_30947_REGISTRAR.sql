-- REMISIÓN 30947 · NEXT TECHNOLOGY · REGISTRAR DE VERDAD (v_aplicar := true).
-- Copia TODO este archivo en Supabase → SQL Editor y dale Run. Si algo falla, no queda nada guardado.
-- Si ya se registró, se detiene sin tocar nada.
-- =====================================================================
-- PARTE 2 · REGISTRO (viene en SIMULACIÓN; para guardar: v_aplicar := true)
-- Es un solo bloque: si algo falla, no queda nada guardado.
-- =====================================================================
do $$
declare
  -- ---------------------------------------------------------- parámetros
  v_aplicar              boolean := true;             -- ← REGISTRAR DE VERDAD
  v_tienda               text    := 'LA VITRINA';
  v_bodega               text    := 'Bodega principal';  -- destino (la columna «Bod.» de la remisión NO es esto)
  v_proveedor            text    := 'NEXT TECHNOLOGY';
  v_proveedor_id         uuid    := null;              -- solo si la Parte 1 muestra proveedores parecidos: el id del correcto
  v_reactivar_inactivos  boolean := false;             -- true = si un código existe pero está inactivo, se reactiva
  v_crear_aunque_parezca text[]  := '{}';              -- códigos que se crean NUEVOS aunque un producto tenga el código en el nombre, p. ej. '{88130}'
                                                       -- (sin esto, ese producto se usa en la factura)
  v_remision             text    := '30947';
  v_fecha                date    := '2026-11-03';
  v_vence                date    := '2026-12-03';
  v_plazo                integer := 30;
  v_pct                  numeric := 15;               -- ganancia % (recargo sobre el costo, como la app)
  v_codigos_esperados    integer := 44;
  v_unidades_esperadas   integer := 2832;
  v_total_esperado       numeric := 131074000;
  -- ---------------------------------------------------------- trabajo
  v_rows jsonb; v_store uuid; v_owner uuid; v_wh uuid; v_wh_name text; v_sup uuid; v_sup_new boolean := false;
  v_n integer; v_q bigint; v_t numeric; v_prob text[] := '{}'; r record; v_id uuid; v_items jsonb := '[]'::jsonb;
  v_ids jsonb := '{}'::jsonb; v_inactive jsonb := '{}'::jsonb; v_by_name jsonb := '{}'::jsonb; v_before jsonb := '{}'::jsonb; v_created integer := 0; v_reused integer := 0; v_reactivated integer := 0;
  v_purchase uuid; pu record; v_step integer; v_dir text; v_basis text; v_base numeric; v_exp numeric; pr record; v_ex text := '';
  v_fmt text;
begin
  select coalesce(jsonb_agg(jsonb_build_object('codigo', codigo, 'descripcion', descripcion, 'cantidad', cantidad, 'costo', costo) order by codigo), '[]'::jsonb)
  into v_rows
  from (values
    ('0036', 'ESTANTE 0036', 37, 48000),
    ('5652602-4', 'ORGANIZADORES 5652602-4', 12, 200000),
    ('5652604-3', 'CLOSET INFANTIL 4 NIVELES 160 CM 5652604-3', 12, 150000),
    ('88130', 'ORGANIZADOR DE ROPA 88130', 173, 30000),
    ('A55-102', 'ORGANIZADOR DE PLATOS A55-102', 77, 45000),
    ('CH009', 'MESAS CH009', 30, 80000),
    ('MP98-10', 'ORGANIZADOR DE ROPA MP98-10', 115, 70000),
    ('N1-H', 'ORGANIZADOR DE ALACENA N1-H', 48, 118000),
    ('N29', 'RACK ORGANIZADOR PARA PLATOS N29', 70, 70000),
    ('N3', 'ORGANIZADOR DE ALACENA N3', 23, 115000),
    ('N43', 'ORGANIZADOR MULTIFUNCIONAL 3 NIVELES N43', 45, 37000),
    ('N44', 'ORGANIZADOR MULTIFUNCIONAL 4 NIVELES N44', 36, 70000),
    ('N45', 'ORGANIZADOR MULTIFUNCIONAL 5 NIVELES N45', 52, 52000),
    ('N46', 'ROPERO DOBLE 160 CM N46', 28, 65000),
    ('N47', 'ROPERO 153CM N47', 40, 38000),
    ('N48', 'ROPERO DOBLE 153 CM N48', 27, 50000),
    ('N8', 'MESAS DE CAFÉ N8', 62, 25000),
    ('N9', 'MESAS DE CENTRO N9', 48, 25000),
    ('NSF-917-3', 'ORGANIZADOR PARA NIÑOS 3 CAJONES NSF-917-3', 11, 100000),
    ('WFB26206/N12', 'ZAPATERO MODULAR TRANSPARENTE 110 CM WFB26206/N12', 80, 38000),
    ('WFB26207/N11', 'ZAPATERO MODULAR TRANSPARENTE 128CM WFB26207/N11', 14, 38000),
    ('X6-5', 'ORGANIZADOR ZAPATOS X6-5', 197, 20000),
    ('X6-7', 'ORGANIZADOR DE COCINA X6-7', 98, 80000),
    ('XY024', 'ORGANIZADOR DE ROPA XY024', 48, 50000),
    ('XY025', 'MESAS XY025', 41, 30000),
    ('XY031', 'ORGANIZADOR DE ROPA XY031', 49, 100000),
    ('XY032', 'MESAS XY032', 23, 35000),
    ('XY037', 'MESAS XY037', 41, 35000),
    ('XY038', 'MESAS XY038', 24, 35000),
    ('XY044', 'MESAS XY044', 48, 70000),
    ('XY047', 'MESAS XY047', 49, 50000),
    ('XY048', 'MESAS XY048', 29, 50000),
    ('XY052', 'MESAS XY052', 59, 90000),
    ('XY062', 'MESAS XY062', 29, 55000),
    ('XY063', 'MESAS XY063', 47, 55000),
    ('XY064', 'MESAS XY064', 41, 70000),
    ('XY069', 'MESAS XY069', 29, 55000),
    ('XY073', 'MESAS XY073', 29, 50000),
    ('YG-10', 'ORGANIZADOR DE ROPA YG-10', 118, 40000),
    ('YH302', 'ORGANIZADOR ZAPATOS YH302', 358, 20000),
    ('YH5110', 'ORGANIZADORES DE BANO YH5110', 118, 30000),
    ('YH6005-3', 'ORGANIZADORES DE BANO YH6005-3', 151, 28000),
    ('YH607-3', 'ORGANIZADORES DE BANO YH607-3', 94, 40000),
    ('YH88131C', 'ORGANIZADOR DE ROPA YH88131C', 72, 60000)
  ) as d(codigo, descripcion, cantidad, costo);

  -- 1. Los datos de la remisión cuadran.
  select count(*), sum((x->>'cantidad')::bigint), sum((x->>'cantidad')::numeric * (x->>'costo')::numeric)
  into v_n, v_q, v_t
  from jsonb_array_elements(v_rows) x;
  if v_n <> v_codigos_esperados or (select count(distinct x->>'codigo') from jsonb_array_elements(v_rows) x) <> v_codigos_esperados then
    raise exception 'Los datos no tienen % códigos únicos (filas %).', v_codigos_esperados, v_n;
  end if;
  if v_q <> v_unidades_esperadas then raise exception 'Las unidades suman %, no %.', v_q, v_unidades_esperadas; end if;
  if v_t <> v_total_esperado then raise exception 'El total da %, no %.', v_t, v_total_esperado; end if;
  for r in select x->>'codigo' as codigo, x->>'descripcion' as descripcion, (x->>'cantidad')::integer as cantidad, (x->>'costo')::numeric as costo
           from jsonb_array_elements(v_rows) x loop
    if r.codigo is null or r.codigo <> upper(btrim(r.codigo)) or length(r.codigo) > 40 then v_prob := v_prob || ('Código no válido: «' || coalesce(r.codigo, '') || '»'); end if;
    if r.cantidad is null or r.cantidad <= 0 or r.costo is null or r.costo <= 0 then v_prob := v_prob || ('Cantidad o costo no válido en ' || r.codigo); end if;
    if right(r.descripcion, length(r.codigo) + 1) <> ' ' || r.codigo then v_prob := v_prob || ('La descripción de ' || r.codigo || ' no termina en el código'); end if;
  end loop;
  if v_fecha <> date '2026-11-03' or v_vence <> v_fecha + v_plazo then
    raise exception 'Fechas: documento %, vence %, plazo % días no cuadran.', v_fecha, v_vence, v_plazo;
  end if;

  -- 2. Tienda, dueño y bodega (sin adivinar).
  select count(*) into v_n from public.stores s where upper(btrim(s.name)) = upper(btrim(v_tienda));
  if v_n <> 1 then raise exception 'Tiendas con el nombre «%»: % (debe ser 1).', v_tienda, v_n; end if;
  select s.id, s.owner_id into v_store, v_owner from public.stores s where upper(btrim(s.name)) = upper(btrim(v_tienda));
  select count(*) into v_n from public.erp_warehouses w
  where w.store_id = v_store and upper(btrim(w.name)) = upper(btrim(v_bodega)) and w.active and coalesce(w.kind, 'warehouse') = 'warehouse';
  if v_n <> 1 then raise exception 'Bodegas activas con el nombre «%»: % (debe ser 1). Revisa la Parte 1.', v_bodega, v_n; end if;
  select w.id, w.name into v_wh, v_wh_name from public.erp_warehouses w
  where w.store_id = v_store and upper(btrim(w.name)) = upper(btrim(v_bodega)) and w.active and coalesce(w.kind, 'warehouse') = 'warehouse';

  -- 3. Proveedor: el elegido, el de nombre exacto o uno nuevo (nunca dos).
  if v_proveedor_id is not null then
    select id into v_sup from public.erp_suppliers where id = v_proveedor_id and store_id = v_store;
    if v_sup is null then raise exception 'v_proveedor_id no es un proveedor de esta tienda.'; end if;
  else
    select count(*) into v_n from public.erp_suppliers where store_id = v_store and upper(btrim(name)) = upper(btrim(v_proveedor));
    if v_n > 1 then raise exception 'Hay % proveedores llamados «%». Pon el id del correcto en v_proveedor_id.', v_n, v_proveedor; end if;
    select id into v_sup from public.erp_suppliers where store_id = v_store and upper(btrim(name)) = upper(btrim(v_proveedor));
    if v_sup is null and exists (
      select 1 from public.erp_suppliers where store_id = v_store and regexp_replace(upper(name), '[^A-Z0-9]', '', 'g') like '%' || regexp_replace(upper(v_proveedor), '[^A-Z0-9]', '', 'g') || '%') then
      raise exception 'No hay un proveedor llamado exactamente «%», pero hay parecidos (ver Parte 1). Si es uno de ellos, pon su id en v_proveedor_id; si no, cámbiale el nombre a ese y vuelve a correr.', v_proveedor;
    end if;
  end if;
  if v_sup is not null and not (select active from public.erp_suppliers where id = v_sup) then
    raise exception 'El proveedor «%» está inactivo. Actívalo en Inventario → Proveedores y vuelve a correr.', v_proveedor;
  end if;

  -- 4. Nunca dos veces la misma remisión.
  if v_sup is not null and exists (
    select 1 from public.erp_purchases where store_id = v_store and supplier_id = v_sup and lower(btrim(invoice_ref)) = lower(v_remision) and status <> 'cancelled') then
    raise exception 'La remisión % de este proveedor YA está registrada. No se hizo nada.', v_remision;
  end if;
  if exists (select 1 from public.erp_purchases where store_id = v_store and lower(btrim(invoice_ref)) = lower(v_remision) and status <> 'cancelled') then
    raise notice 'Ojo: otro proveedor tiene un documento %. Se sigue porque es de otro proveedor.', v_remision;
  end if;

  -- 5. Productos: primero por código; si ninguno lo tiene, el que tiene el código en el nombre
  --    (o en el código de barras), p. ej. «CLOSET ARMABLE DE TELA 88130» [código 529] para el 88130.
  for r in select x->>'codigo' as codigo, x->>'descripcion' as descripcion from jsonb_array_elements(v_rows) x loop
    v_id := null;
    select count(*), (array_agg(id))[1] into v_n, v_id from public.products where store_id = v_store and upper(btrim(sku)) = r.codigo;
    if v_n > 1 then
      v_prob := v_prob || (r.codigo || ': ' || v_n || ' productos con ese código');
      v_id := null;
    elsif v_n = 0 and not (r.codigo = any (v_crear_aunque_parezca)) then
      select count(*), (array_agg(id))[1], string_agg(name || ' [código ' || coalesce(sku, '—') || ']', ' · ')
      into v_n, v_id, v_ex from public.products
      where store_id = v_store and ((' ' || upper(name) || ' ') like ('% ' || r.codigo || ' %') or upper(btrim(coalesce(barcode, ''))) = r.codigo);
      if v_n > 1 then
        v_prob := v_prob || (r.codigo || ': ' || v_n || ' productos tienen ese código en el nombre (' || v_ex
                             || '). Ponle el código ' || r.codigo || ' al correcto en RemHub y vuelve a correr.');
        v_id := null;
      elsif v_n = 1 then
        v_by_name := v_by_name || jsonb_build_object(r.codigo, v_ex);
      end if;
    end if;
    if v_id is not null then
      if not coalesce((select active from public.products where id = v_id), true) then
        v_inactive := v_inactive || jsonb_build_object(r.codigo, true);
        if not v_reactivar_inactivos then
          v_prob := v_prob || (r.codigo || ': existe pero está inactivo (v_reactivar_inactivos := true para reactivarlo)');
        end if;
      end if;
      v_ids := v_ids || jsonb_build_object(r.codigo, v_id);
    end if;
  end loop;
  -- Un mismo producto no puede recibir dos códigos de la remisión.
  select string_agg(x.codigos, ' · ') into v_ex from (
    select string_agg(key, ' y ' order by key) || ' → ' || min(p.name) as codigos
    from jsonb_each(v_ids) j join public.products p on p.id = (j.value #>> '{}')::uuid
    group by p.id having count(*) > 1) x;
  if v_ex is not null then
    v_prob := v_prob || ('Varios códigos caen en el mismo producto: ' || v_ex || '. Ponle a cada producto su código en RemHub y vuelve a correr.');
  end if;
  if array_length(v_prob, 1) > 0 then
    raise exception 'No se hizo nada. Revisa:%', E'\n· ' || array_to_string(v_prob, E'\n· ');
  end if;

  -- Existencias antes (para comprobar que se SUMA y no se reemplaza).
  for r in select key as codigo, value #>> '{}' as id from jsonb_each(v_ids) loop
    v_before := v_before || jsonb_build_object(r.codigo, jsonb_build_object(
      'total', (select coalesce(stock, 0) from public.products where id = r.id::uuid),
      'bodega', coalesce((select qty from public.erp_stock_levels where warehouse_id = v_wh and product_id = r.id::uuid), 0)));
  end loop;

  -- 6. Actuar como el dueño (igual que si lo hiciera desde la app, con sus permisos y su auditoría).
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('role', 'authenticated', true);

  if v_sup is null then
    insert into public.erp_suppliers (store_id, name, payment_days, active, notes)
    values (v_store, upper(btrim(v_proveedor)), v_plazo, true,
            'Creado con la remisión ' || v_remision || '. NIT pendiente: en la remisión aparece 1041204773, falta confirmar a quién corresponde.')
    returning id into v_sup;
    v_sup_new := true;
  end if;

  for r in select x->>'codigo' as codigo, x->>'descripcion' as descripcion, (x->>'cantidad')::integer as cantidad, (x->>'costo')::numeric as costo
           from jsonb_array_elements(v_rows) x order by x->>'codigo' loop
    if v_ids ? r.codigo then
      v_id := (v_ids->>r.codigo)::uuid;
      v_reused := v_reused + 1;
      if v_inactive ? r.codigo then
        update public.products set active = true, updated_at = now() where id = v_id and store_id = v_store;
        v_reactivated := v_reactivated + 1;
      end if;
    else
      -- Igual que Productos → Crear: costo y precios en 0 (los pone el ingreso) y el % ya puesto.
      insert into public.products (store_id, name, sku, description, cost_price, price_1, price_2, price_3, price_4, price_5,
                                   price_retail, price_wholesale, min_wholesale, stock, active,
                                   markup_1, markup_2, markup_3, markup_4, markup_5)
      values (v_store, r.descripcion, r.codigo, '', 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, true, v_pct, v_pct, v_pct, v_pct, v_pct)
      returning id into v_id;
      v_ids := v_ids || jsonb_build_object(r.codigo, v_id);
      v_before := v_before || jsonb_build_object(r.codigo, jsonb_build_object('total', 0, 'bodega', 0));
      v_created := v_created + 1;
    end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object('product_id', v_id, 'qty', r.cantidad, 'unit_cost', r.costo, 'tax_rate', 0, 'warehouse_id', v_wh));
  end loop;

  v_purchase := public.erp_receive_invoice(
    p_store => v_store, p_supplier => v_sup, p_invoice_ref => v_remision, p_invoice_date => v_fecha,
    p_payment_type => 'credit', p_due_date => v_vence,
    p_notes => 'Remisión ' || v_remision || ' · 67 renglones consolidados en 44 referencias (la columna «Bod.» de la remisión no es la bodega de destino) · registrada por script',
    p_checked_by => null, p_items => v_items);

  -- Ganancia 15 % en los que ya existían (como la app al guardar el ingreso).
  update public.products set markup_1 = v_pct, markup_2 = v_pct, markup_3 = v_pct, markup_4 = v_pct, markup_5 = v_pct
  where store_id = v_store and id in (select (value #>> '{}')::uuid from jsonb_each(v_ids));

  -- Volver a ser el administrador de la base para revisar todo.
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);

  -- 7. Comprobar todo antes de dejarlo guardado.
  select * into pu from public.erp_purchases where id = v_purchase;
  if pu.id is null then raise exception 'No quedó la compra.'; end if;
  if pu.total <> v_total_esperado or coalesce(pu.tax, 0) <> 0 or pu.subtotal <> v_total_esperado then raise exception 'Total de la compra: % (esperado %).', pu.total, v_total_esperado; end if;
  if pu.payment_type <> 'credit' or pu.due_date <> v_vence or pu.invoice_date <> v_fecha or pu.supplier_id <> v_sup or pu.warehouse_id <> v_wh then
    raise exception 'La compra no quedó como se esperaba (pago %, vence %, fecha %).', pu.payment_type, pu.due_date, pu.invoice_date;
  end if;
  select count(*), sum(qty), count(distinct product_id) into v_n, v_q, v_t from public.erp_purchase_items where purchase_id = v_purchase;
  if v_n <> v_codigos_esperados or v_q <> v_unidades_esperadas or v_t <> v_codigos_esperados then raise exception 'Líneas: % con % und. (esperado % con %).', v_n, v_q, v_codigos_esperados, v_unidades_esperadas; end if;
  if exists (select 1 from public.erp_purchase_items where purchase_id = v_purchase and (line_total <> qty * unit_cost or warehouse_id <> v_wh)) then
    raise exception 'Alguna línea no da cantidad × costo o no va a la bodega elegida.';
  end if;
  if (select count(*) from public.erp_payables where purchase_id = v_purchase) <> 1
     or not exists (select 1 from public.erp_payables where purchase_id = v_purchase and supplier_id = v_sup and total = v_total_esperado
                    and balance = v_total_esperado and status = 'open' and due_date = v_vence) then
    raise exception 'La cuenta por pagar no quedó en $% abierta con vencimiento %.', v_total_esperado, v_vence;
  end if;
  if (select count(*) from public.inventory_movements where ref_type = 'purchase' and ref_id = v_purchase) <> v_codigos_esperados
     or (select sum(qty) from public.inventory_movements where ref_type = 'purchase' and ref_id = v_purchase) <> v_unidades_esperadas then
    raise exception 'El kardex no tiene las % entradas.', v_codigos_esperados;
  end if;

  select coalesce(ps.product_round_step, 100), coalesce(ps.product_round_dir, 'nearest'), coalesce(ps.price_cost_basis, 'last')
  into v_step, v_dir, v_basis from (select 1) x left join public.erp_profit_settings ps on ps.store_id = v_store;
  for r in select x->>'codigo' as codigo, (x->>'cantidad')::integer as cantidad, (x->>'costo')::numeric as costo from jsonb_array_elements(v_rows) x loop
    select p.* into pr from public.products p where p.id = (v_ids->>r.codigo)::uuid;
    if coalesce(pr.stock, 0) <> (v_before #>> array[r.codigo, 'total'])::integer + r.cantidad then
      raise exception '%: existencias totales % (esperado % + %).', r.codigo, pr.stock, v_before #>> array[r.codigo, 'total'], r.cantidad;
    end if;
    if (select qty from public.erp_stock_levels where warehouse_id = v_wh and product_id = pr.id) <> (v_before #>> array[r.codigo, 'bodega'])::integer + r.cantidad then
      raise exception '%: la bodega no sumó % unidades.', r.codigo, r.cantidad;
    end if;
    if coalesce(pr.last_cost, 0) <> r.costo then raise exception '%: último costo % (esperado %).', r.codigo, pr.last_cost, r.costo; end if;
    if (pr.markup_1, pr.markup_2, pr.markup_3, pr.markup_4, pr.markup_5) is distinct from (v_pct, v_pct, v_pct, v_pct, v_pct) then
      raise exception '%: el %% de ganancia no quedó en %.', r.codigo, v_pct;
    end if;
    v_base := case when v_basis = 'last' and coalesce(pr.last_cost, 0) > 0 then pr.last_cost else pr.cost_price end;
    v_exp := public.erp__round_step(round(v_base * (1 + v_pct / 100), 0), v_step, v_dir);
    if pr.price_1 <> v_exp or pr.price_2 <> v_exp or pr.price_3 <> v_exp or pr.price_4 <> v_exp or pr.price_5 <> v_exp then
      raise exception '%: precios % / % / % / % / % (esperado % = % × 1,%).', r.codigo, pr.price_1, pr.price_2, pr.price_3, pr.price_4, pr.price_5, v_exp, v_base, v_pct;
    end if;
  end loop;

  select 'CH009: costo $' || replace(to_char(pr2.last_cost, 'FM999,999,999'), ',', '.') || ' → precio $' || replace(to_char(pr2.price_1, 'FM999,999,999'), ',', '.')
  into v_ex from public.products pr2 where pr2.id = (v_ids->>'CH009')::uuid;

  v_fmt := format('Ingreso #%s · remisión %s de %s%s · %s referencias (%s nuevas, %s ya existían%s) · %s und. a %s · total $%s a crédito, vence %s · cuenta por pagar abierta $%s · ganancia %s %% (%s; precios por %s)',
    pu.number, v_remision, upper(btrim(v_proveedor)), case when v_sup_new then ' (proveedor nuevo, NIT pendiente)' else '' end,
    v_codigos_esperados, v_created, v_reused,
    case when v_by_name <> '{}'::jsonb then ', de ellas ' || (select count(*) from jsonb_object_keys(v_by_name)) || ' por el nombre: '
         || (select string_agg(key || ' = ' || (value #>> '{}'), ' · ' order by key) from jsonb_each(v_by_name)) else '' end
    || case when v_reactivated > 0 then ', ' || v_reactivated || ' reactivadas' else '' end,
    replace(to_char(v_unidades_esperadas, 'FM999,999'), ',', '.'), v_wh_name,
    replace(to_char(v_total_esperado, 'FM999,999,999'), ',', '.'), to_char(v_vence, 'DD/MM/YYYY'),
    replace(to_char(v_total_esperado, 'FM999,999,999'), ',', '.'), v_pct, v_ex, case v_basis when 'last' then 'último costo' else 'costo promedio' end);

  if not v_aplicar then
    raise exception 'SIMULACIÓN OK (no se guardó nada): %', v_fmt using hint = 'Si todo está bien, cambia v_aplicar a true y corre la Parte 2 otra vez.';
  end if;
  raise notice 'LISTO: %', v_fmt;
end $$;
