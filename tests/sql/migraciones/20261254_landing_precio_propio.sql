-- =====================================================================
-- REMHUB · Landing pages: precio propio de cada landing
--
--   config.sale_price: precio de venta de la landing para todas sus opciones
--   config.option_prices: { "<id del producto>": precio } por opción (manda
--   sobre sale_price). Vacío = el precio del catálogo. Puede ser más alto o
--   más bajo que el del catálogo; el precio de la tienda no se toca.
--   Los paquetes, el pago en línea y la oferta de salida se aplican encima.
--   Redefine landing_public y landing_order (de 20261252) solo para esto.
-- Requiere 20261252. No borra datos. Es idempotente.
-- =====================================================================

create or replace function public.erp__landing_price(p_cfg jsonb, p_id uuid)
returns numeric language sql immutable as $$
  select case
    when coalesce(p_cfg -> 'option_prices' ->> p_id::text, '') ~ '^\d+(\.\d+)?$' and (p_cfg -> 'option_prices' ->> p_id::text)::numeric > 0
      then round((p_cfg -> 'option_prices' ->> p_id::text)::numeric)
    when coalesce(p_cfg ->> 'sale_price', '') ~ '^\d+(\.\d+)?$' and (p_cfg ->> 'sale_price')::numeric > 0
      then round((p_cfg ->> 'sale_price')::numeric)
  end
$$;
revoke all on function public.erp__landing_price(jsonb, uuid) from public, anon;
grant execute on function public.erp__landing_price(jsonb, uuid) to authenticated, service_role;

create or replace function public.landing_public(p_store text, p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  f jsonb := public.erp__landing_find(p_store, p_slug);
  pg public.erp_landing_pages;
  v_up uuid;
  v_ids uuid[];
  v_items jsonb;
  v_upsell jsonb;
  v_pm jsonb;
  v_cfg jsonb;
begin
  if f is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  pg := jsonb_populate_record(null::public.erp_landing_pages, f -> 'page');
  v_cfg := pg.config;
  v_up := case when coalesce((v_cfg -> 'upsell' ->> 'enabled')::boolean, false) and (v_cfg -> 'upsell' ->> 'product_id') ~* '^[0-9a-f-]{36}$'
               then (v_cfg -> 'upsell' ->> 'product_id')::uuid end;
  v_ids := pg.product_ids || case when v_up is null then '{}'::uuid[] else array[v_up] end;
  with pr as (select * from public.erp__landing_prices(f ->> 'store_slug', f ->> 'catalog_slug', f ->> 'catalog_key', v_ids)),
  rows as (
    select p.id, jsonb_build_object(
             'id', p.id, 'name', p.name,
             'option', coalesce(nullif(v_cfg -> 'option_names' ->> p.id::text, ''), p.name),
             'image', p.image_url,
             'gallery', coalesce(p.product_details -> 'gallery_urls', '[]'::jsonb),
             'description', coalesce(nullif(p.product_details ->> 'long_description', ''), p.description),
             'highlights', coalesce(p.product_details -> 'highlights', '[]'::jsonb),
             'specifications', coalesce(p.product_details -> 'specifications', '[]'::jsonb),
             'video_url', p.product_details ->> 'video_url',
             -- Precio propio de la landing (el adicional siempre va con el del catálogo).
             'price', case when p.id = v_up then pr.price else coalesce(public.erp__landing_price(v_cfg, p.id), pr.price) end,
             'catalog_price', pr.price, 'stock', greatest(pr.stock, 0)) as j
    from public.products p join pr on pr.id = p.id
    where p.store_id = (f ->> 'store_id')::uuid and p.active and pr.price > 0
  )
  select coalesce(jsonb_agg(r.j order by array_position(pg.product_ids, r.id)) filter (where r.id = any(pg.product_ids)), '[]'::jsonb),
         (array_agg(r.j) filter (where r.id = v_up))[1]
    into v_items, v_upsell
  from rows r;
  v_pm := public.erp__landing_payments((f ->> 'store_id')::uuid);
  return jsonb_build_object('ok', true,
    'store', jsonb_build_object('id', f ->> 'store_id', 'slug', f ->> 'store_slug', 'name', f ->> 'store_name', 'logo_url', f ->> 'logo_url', 'whatsapp', f ->> 'whatsapp'),
    'page', jsonb_build_object('id', pg.id, 'slug', pg.slug, 'name', pg.name, 'config', v_cfg, 'catalog', f ->> 'catalog_slug'),
    'items', v_items,
    'upsell', v_upsell,
    'payments', jsonb_build_object(
      'cod', coalesce((v_cfg -> 'payments' ->> 'cod')::boolean, true),
      'online', coalesce((v_cfg -> 'payments' ->> 'online')::boolean, false) and (v_pm ->> 'wompi')::boolean,
      'addi', coalesce((v_cfg -> 'payments' ->> 'addi')::boolean, false) and (v_pm ->> 'addi')::boolean),
    'social', public.erp__landing_social(pg.id),
    'trust', public.erp__landing_trust((f ->> 'store_id')::uuid));
end;
$$;


create or replace function public.landing_order(p_store text, p_slug text, p_session text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  f jsonb := public.erp__landing_find(p_store, p_slug);
  pg public.erp_landing_pages;
  c jsonb := coalesce(p -> 'customer', '{}'::jsonb);
  v_units uuid[];
  v_n integer;
  v_pct numeric;
  v_pay text := coalesce(p ->> 'payment', 'cod');
  v_opct numeric := 0;
  v_pm jsonb;
  v_up uuid;
  v_up_pct numeric := 0;
  v_take_up boolean := coalesce((p ->> 'upsell')::boolean, false);
  v_xpct numeric := 0;
  v_items jsonb;
  v_name text := regexp_replace(btrim(coalesce(c ->> 'name', '')), '\s+', ' ', 'g');
  v_wa text := regexp_replace(coalesce(c ->> 'whatsapp', ''), '\D', '', 'g');
  v_doc text := regexp_replace(coalesce(c ->> 'document', ''), '[^0-9A-Za-z]', '', 'g');
  v_email text := lower(btrim(coalesce(c ->> 'email', '')));
  v_dept text := left(btrim(coalesce(c ->> 'department', '')), 60);
  v_city text := left(btrim(coalesce(c ->> 'city', '')), 80);
  v_addr text := left(btrim(coalesce(c ->> 'address', '')), 200);
  v_nb text := left(btrim(coalesce(c ->> 'neighborhood', '')), 80);
  v_notes text := left(btrim(coalesce(c ->> 'notes', '')), 300);
  v_note text;
  v_res jsonb;
  v_order uuid;
  v_total numeric;
  v_ref jsonb := coalesce(p -> 'ref', '{}'::jsonb);
  r record;
begin
  if f is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Esta oferta ya no está disponible.'); end if;
  if coalesce(p_session, '') !~ '^[A-Za-z0-9_-]{8,64}$' then return jsonb_build_object('ok', false, 'code', 'INVALID', 'message', 'Recarga la página e intenta de nuevo.'); end if;
  pg := jsonb_populate_record(null::public.erp_landing_pages, f -> 'page');

  -- Cliente
  v_wa := regexp_replace(v_wa, '^57(?=3\d{9}$)', '');
  if length(v_name) < 3 or v_name !~ '\s' then return jsonb_build_object('ok', false, 'code', 'VALIDATION', 'field', 'name', 'message', 'Escribe tu nombre y apellido.'); end if;
  if v_wa !~ '^3\d{9}$' then return jsonb_build_object('ok', false, 'code', 'VALIDATION', 'field', 'whatsapp', 'message', 'Escribe un WhatsApp de 10 dígitos que empiece por 3.'); end if;
  if coalesce((pg.config -> 'form' ->> 'ask_document')::boolean, true) and length(v_doc) not between 5 and 15 then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION', 'field', 'document', 'message', 'Escribe tu número de cédula.');
  end if;
  if v_email <> '' and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return jsonb_build_object('ok', false, 'code', 'VALIDATION', 'field', 'email', 'message', 'Revisa el correo.'); end if;
  if coalesce((pg.config -> 'form' ->> 'ask_email')::boolean, false) and v_email = '' then return jsonb_build_object('ok', false, 'code', 'VALIDATION', 'field', 'email', 'message', 'Escribe tu correo.'); end if;
  if v_dept = '' then return jsonb_build_object('ok', false, 'code', 'VALIDATION', 'field', 'department', 'message', 'Elige tu departamento.'); end if;
  if length(v_city) < 2 then return jsonb_build_object('ok', false, 'code', 'VALIDATION', 'field', 'city', 'message', 'Escribe tu ciudad o municipio.'); end if;
  if length(v_addr) < 5 then return jsonb_build_object('ok', false, 'code', 'VALIDATION', 'field', 'address', 'message', 'Escribe la dirección completa de entrega.'); end if;

  -- Freno a pedidos repetidos o automáticos
  if (select count(*) from public.erp_landing_orders where page_id = pg.id and session_id = p_session and created_at > now() - interval '1 hour') >= 3
     or (select count(*) from public.erp_landing_orders where store_id = pg.store_id and wa_hash = md5(v_wa) and created_at > now() - interval '1 day') >= 4 then
    return jsonb_build_object('ok', false, 'code', 'LIMIT', 'message', 'Ya recibimos tus pedidos. Escríbenos por WhatsApp si quieres agregar algo.');
  end if;

  -- Paquete (1, 2, 3 unidades…): cada unidad con su opción
  select coalesce(array_agg(x::uuid), '{}') into v_units
  from jsonb_array_elements_text(case when jsonb_typeof(p -> 'units') = 'array' then p -> 'units' else '[]'::jsonb end) x
  where x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_n := coalesce(array_length(v_units, 1), 0);
  if v_n = 0 or v_n <> jsonb_array_length(coalesce(p -> 'units', '[]'::jsonb)) then return jsonb_build_object('ok', false, 'code', 'VALIDATION', 'message', 'Elige las opciones de tu pedido.'); end if;
  if exists (select 1 from unnest(v_units) u where not (u = any(pg.product_ids))) then return jsonb_build_object('ok', false, 'code', 'VALIDATION', 'message', 'Una de las opciones ya no está disponible. Recarga la página.'); end if;
  select (b ->> 'pct')::numeric into v_pct from jsonb_array_elements(coalesce(pg.config -> 'bundles', '[]'::jsonb)) b where (b ->> 'qty')::integer = v_n limit 1;
  if v_pct is null then
    -- Sin paquete que coincida: solo se acepta 1 unidad si la landing no tiene paquetes (un pack x3 no se vende suelto).
    if v_n <> 1 or jsonb_array_length(coalesce(pg.config -> 'bundles', '[]'::jsonb)) > 0 then
      return jsonb_build_object('ok', false, 'code', 'VALIDATION', 'message', 'Ese paquete ya no está disponible. Recarga la página.');
    end if;
    v_pct := 0;
  end if;
  v_pct := least(greatest(v_pct, 0), 90);

  -- Forma de pago
  v_pm := public.erp__landing_payments(pg.store_id);
  if v_pay = 'cod' and not coalesce((pg.config -> 'payments' ->> 'cod')::boolean, true)
     or v_pay = 'online' and not (coalesce((pg.config -> 'payments' ->> 'online')::boolean, false) and (v_pm ->> 'wompi')::boolean)
     or v_pay = 'addi' and not (coalesce((pg.config -> 'payments' ->> 'addi')::boolean, false) and (v_pm ->> 'addi')::boolean)
     or v_pay not in ('cod', 'online', 'addi') then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION', 'field', 'payment', 'message', 'Elige otra forma de pago.');
  end if;
  -- Oferta de salida (descuento extra a las unidades del paquete, si la landing la tiene activa).
  if coalesce((p ->> 'exit')::boolean, false) and coalesce((pg.config -> 'exit_offer' ->> 'enabled')::boolean, false) then
    v_xpct := least(greatest(coalesce((pg.config -> 'exit_offer' ->> 'pct')::numeric, 0), 0), 30);
  end if;
  if v_pay = 'online' then v_opct := least(greatest(coalesce((pg.config -> 'payments' ->> 'online_pct')::numeric, 0), 0), 30); end if;

  -- Adicional de último momento
  if v_take_up and coalesce((pg.config -> 'upsell' ->> 'enabled')::boolean, false) and (pg.config -> 'upsell' ->> 'product_id') ~* '^[0-9a-f-]{36}$' then
    v_up := (pg.config -> 'upsell' ->> 'product_id')::uuid;
    v_up_pct := least(greatest(coalesce((pg.config -> 'upsell' ->> 'pct')::numeric, 0), 0), 90);
    if v_up = any(v_units) then v_up := null; end if;
  end if;

  -- Existencias reales del catálogo
  for r in
    select u.id, u.qty, pr.price, pr.stock, pd.name
    from (select x as id, count(*)::integer as qty from unnest(v_units || case when v_up is null then '{}'::uuid[] else array[v_up] end) x group by x) u
    left join public.erp__landing_prices(f ->> 'store_slug', f ->> 'catalog_slug', f ->> 'catalog_key',
                                         v_units || case when v_up is null then '{}'::uuid[] else array[v_up] end) pr on pr.id = u.id
    left join public.products pd on pd.id = u.id
  loop
    if r.price is null or r.price <= 0 then
      if r.id = v_up then v_up := null; continue; end if;
      return jsonb_build_object('ok', false, 'code', 'STOCK', 'message', format('«%s» ya no está disponible.', coalesce(r.name, 'Un producto')));
    end if;
    if r.stock is not null and r.stock < r.qty then
      if r.id = v_up then v_up := null; continue; end if;
      return jsonb_build_object('ok', false, 'code', 'STOCK', 'message',
        case when r.stock <= 0 then format('«%s» se agotó. Elige otra opción.', r.name) else format('De «%s» solo quedan %s.', r.name, r.stock::integer) end);
    end if;
  end loop;

  select jsonb_agg(jsonb_build_object('product_id', x, 'qty', n)) into v_items
  from (select x, count(*)::integer n from unnest(v_units || case when v_up is null then '{}'::uuid[] else array[v_up] end) x group by x) t;

  v_note := concat_ws(E'\n',
    '🛍️ Landing: ' || pg.name,
    '💳 Pago: ' || case v_pay when 'cod' then 'Contraentrega (paga al recibir)' when 'online' then 'En línea (Wompi)' || case when v_opct > 0 then format(' −%s%%', v_opct) else '' end else 'A cuotas con Addi' end,
    case when v_n > 1 then format('📦 Paquete: %s unidades%s', v_n, case when v_pct > 0 then format(' (−%s%%)', v_pct) else '' end) end,
    case when v_xpct > 0 then format('🎁 Oferta de salida: −%s%% adicional', v_xpct) end,
    case when v_up is not null then format('➕ Adicional de último momento%s', case when v_up_pct > 0 then format(' (−%s%%)', v_up_pct) else '' end) end,
    case when v_doc <> '' then '🪪 Cédula: ' || v_doc end,
    '📍 ' || v_addr || case when v_nb <> '' then ' · Barrio ' || v_nb else '' end,
    '🏙️ ' || v_city || ', ' || v_dept,
    case when v_email <> '' then '✉️ ' || v_email end,
    case when v_notes <> '' then '📝 ' || v_notes end,
    case when coalesce(v_ref ->> 'source', '') <> '' then '📣 Llegó por: ' || left(v_ref ->> 'source', 40) || coalesce(' / ' || left(nullif(v_ref ->> 'campaign', ''), 60), '') end);

  begin
    v_res := to_jsonb(public.catalog_create_order(
      p_store => f ->> 'store_slug', p_catalog => f ->> 'catalog_slug', p_key => f ->> 'catalog_key', p_items => v_items,
      p_customer_name => initcap(v_name), p_customer_note => v_note, p_customer_whatsapp => v_wa));
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'ORDER',
      'message', case when sqlerrm ~* 'stock|existencia|inventario' then 'Las existencias cambiaron. Recarga la página e intenta de nuevo.' else 'No se pudo crear el pedido. Intenta de nuevo en un momento.' end,
      'detail', left(sqlerrm, 200));
  end;
  if jsonb_typeof(v_res) = 'array' then v_res := v_res -> 0; end if;
  select o.id into v_order from public.orders o where o.token = v_res ->> 'token' and o.store_id = pg.store_id;
  if v_order is null then return jsonb_build_object('ok', false, 'code', 'ORDER', 'message', 'No se pudo crear el pedido. Intenta de nuevo.'); end if;

  -- Precio propio de la landing (si se puso): reemplaza el del catálogo antes de los descuentos.
  update public.order_items oi
     set price = public.erp__landing_price(pg.config, oi.product_id)
   where oi.order_id = v_order and oi.product_id is distinct from v_up
     and public.erp__landing_price(pg.config, oi.product_id) is not null;

  -- Paquete, pago en línea y adicional: sobre el precio que puso el catálogo.
  if v_pct > 0 or v_opct > 0 or v_xpct > 0 or (v_up is not null and v_up_pct > 0) then
    update public.order_items oi
       set price = public.erp__cop(oi.price * (1 - (case when oi.product_id = v_up then v_up_pct else v_pct end) / 100.0)
                                   * (1 - (case when oi.product_id = v_up then 0 else v_xpct end) / 100.0) * (1 - v_opct / 100.0))
     where oi.order_id = v_order
       -- Sin descuento para esa línea, el precio queda igual (no se redondea).
       and (v_opct > 0 or (case when oi.product_id = v_up then v_up_pct else v_pct + v_xpct end) > 0);
  end if;
  select coalesce(sum(oi.price * oi.quantity), 0) into v_total from public.order_items oi where oi.order_id = v_order;
  update public.orders set total = v_total where id = v_order;

  insert into public.erp_landing_orders (order_id, page_id, store_id, session_id, first_name, city, department, units, bundle_pct, payment, upsell, total, wa_hash, source, campaign)
  values (v_order, pg.id, pg.store_id, p_session, split_part(initcap(v_name), ' ', 1), initcap(v_city), v_dept, v_n, v_pct, v_pay, v_up is not null, v_total, md5(v_wa),
          left(lower(nullif(btrim(v_ref ->> 'source'), '')), 60), left(nullif(btrim(v_ref ->> 'campaign'), ''), 120))
  on conflict (order_id) do nothing;
  update public.erp_landing_visits set ordered = true, last_seen = now() where page_id = pg.id and session_id = p_session;
  update public.erp_landing_leads set status = 'ordered', updated_at = now() where page_id = pg.id and status = 'open' and (session_id = p_session or whatsapp = v_wa);

  return jsonb_build_object('ok', true, 'token', v_res ->> 'token', 'receipt_no', v_res ->> 'receipt_no', 'order_id', v_order,
    'total', v_total, 'payment', v_pay, 'store_id', pg.store_id, 'event_id', (f ->> 'store_slug') || '-' || coalesce(v_res ->> 'receipt_no', v_order::text),
    'items', (select jsonb_agg(jsonb_build_object('id', oi.product_id, 'name', pd.name, 'price', oi.price, 'quantity', oi.quantity))
              from public.order_items oi left join public.products pd on pd.id = oi.product_id where oi.order_id = v_order));
end;
$$;


grant execute on function public.landing_public(text, text) to anon, authenticated, service_role;
grant execute on function public.landing_order(text, text, text, jsonb) to anon, authenticated, service_role;
