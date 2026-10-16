-- =====================================================================
-- REMHUB · Precio del punto en sus catálogos + envío de ventas sin internet
--
--   1. catalog__items: si el catálogo pertenece a un punto con reglas de
--      precio vigentes, muestra y cobra el precio de ese punto. Sin reglas
--      el resultado es exactamente el mismo de antes (único cambio: la
--      línea del precio). El precio especial del catálogo sigue mandando.
--   2. erp_pos_submit_offline: registra una venta guardada sin internet
--      UNA sola vez (aunque el celular reintente), con el precio calculado
--      en el servidor. Si el precio cambió desde que se guardó el borrador,
--      no la registra: avisa para que el cajero la revise.
--
-- Requiere 20261106. No borra ni cambia datos. Es idempotente.
-- =====================================================================

-- 1. Catálogos de punto con el precio del punto.
create or replace function public.catalog__items(p_catalog uuid, p_ids uuid[] default null::uuid[])
returns table(product_id uuid, category_key uuid, price numeric, base_price numeric, stock integer, featured boolean, sort_order integer, category_hidden boolean)
language sql
stable security definer
set search_path to 'public'
as $function$
  select
    p.id,
    coalesce(cp.catalog_category_id, ccat.id, p.category_id),
    case
      when cp.price_override is not null then cp.price_override
      when coalesce(case when r.id is null then public.catalog__price(p, c.price_level) else public.erp__point_price(p, c.price_level, r, coalesce(s.rounding_step, 0), coalesce(s.rounding_dir, 'nearest')) end, 0) > 0
        then case when r.id is null then public.catalog__price(p, c.price_level) else public.erp__point_price(p, c.price_level, r, coalesce(s.rounding_step, 0), coalesce(s.rounding_dir, 'nearest')) end
      when c.fallback_price_level is not null
        then case when r.id is null then public.catalog__price(p, c.fallback_price_level) else public.erp__point_price(p, c.fallback_price_level, r, coalesce(s.rounding_step, 0), coalesce(s.rounding_dir, 'nearest')) end
      else case when r.id is null then public.catalog__price(p, c.price_level) else public.erp__point_price(p, c.price_level, r, coalesce(s.rounding_step, 0), coalesce(s.rounding_dir, 'nearest')) end
    end,
    case when r.id is null then public.catalog__price(p, c.price_level) else public.erp__point_price(p, c.price_level, r, coalesce(s.rounding_step, 0), coalesce(s.rounding_dir, 'nearest')) end,
    case
      when c.point_id is not null then greatest(coalesce(sl.qty, 0), 0)
      when p.stock is null then null
      else p.stock
    end,
    coalesce(cp.featured, false),
    coalesce(cp.sort_order, 0),
    coalesce(not ecat.visible, false)
  from public.store_catalogs c
  join public.products p on p.store_id = c.store_id and p.active
  left join public.store_catalog_products cp on cp.catalog_id = c.id and cp.product_id = p.id
  left join public.store_catalog_categories ccat on ccat.catalog_id = c.id and ccat.category_id = p.category_id
  left join public.store_catalog_categories ecat on ecat.id = coalesce(cp.catalog_category_id, ccat.id)
  left join public.erp_stock_levels sl on c.point_id is not null and sl.warehouse_id = c.point_id and sl.product_id = p.id
  left join public.erp_profit_settings s on s.store_id = c.store_id
  left join lateral (
    select x.* from public.erp__rule_for(c.store_id, c.point_id, p.id) x
    where c.point_id is not null
      and exists (select 1 from public.erp_price_rules pr where pr.store_id = c.store_id and pr.point_id = c.point_id and pr.status = 'active')
  ) r on true
  where c.id = p_catalog
    and (p_ids is null or p.id = any (p_ids))
    and case when c.include_all_products then coalesce(cp.included, true) else coalesce(cp.included, false) end;
$function$;

-- 2. Ventas guardadas sin internet.
create table if not exists public.erp_pos_offline_submissions (
  client_id uuid primary key,
  store_id uuid not null references public.stores(id) on delete cascade,
  point_id uuid,
  order_id uuid,
  token text,
  doc_number text,
  total numeric(14, 2),
  created_offline_at timestamptz,
  submitted_at timestamptz not null default now(),
  submitted_by uuid,
  submitted_by_name text
);
create index if not exists erp_pos_offline_submissions_store on public.erp_pos_offline_submissions (store_id, submitted_at desc);
alter table public.erp_pos_offline_submissions enable row level security;
revoke all on public.erp_pos_offline_submissions from anon, authenticated;

create or replace function public.erp_pos_submit_offline(
  p_store uuid, p_client_id uuid, p_point uuid, p_seller uuid, p_items jsonb,
  p_customer_name text, p_customer_note text, p_customer_whatsapp text, p_customer_doc text, p_created_offline_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  done public.erp_pos_offline_submissions;
  s public.erp_profit_settings;
  it jsonb; p public.products; r public.erp_price_rules;
  v_level integer; v_qty integer; v_price numeric; v_draft numeric;
  v_items jsonb := '[]'::jsonb; v_changed jsonb := '[]'::jsonb;
  v_res jsonb; v_token text; v_tag jsonb; v_order uuid; v_total numeric;
begin
  if not public.erp_can(p_store, 'pos') then raise exception 'No tienes permiso de POS.'; end if;
  if p_client_id is null then raise exception 'Falta el identificador del borrador.'; end if;
  if p_point is null or not exists (select 1 from public.erp_warehouses w where w.id = p_point and w.store_id = p_store and w.active) then
    raise exception 'Elige un punto de venta válido.';
  end if;
  if not public.erp_point_allowed(p_store, p_point) then raise exception 'Solo puedes vender desde tus puntos.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 300 then
    raise exception 'El borrador no tiene productos válidos.';
  end if;

  -- Una sola vez por borrador, aunque lleguen dos envíos al mismo tiempo.
  perform pg_advisory_xact_lock(hashtext('pos_offline:' || p_client_id::text));
  select * into done from public.erp_pos_offline_submissions where client_id = p_client_id;
  if found then
    if done.store_id <> p_store then raise exception 'Borrador no válido.'; end if;
    return jsonb_build_object('ok', true, 'already', true, 'token', done.token, 'doc_number', done.doc_number, 'total', done.total);
  end if;

  select * into s from public.erp_profit_settings where store_id = p_store;
  for it in select * from jsonb_array_elements(p_items) loop
    v_level := least(5, greatest(1, coalesce((it->>'level')::integer, 3)));
    v_qty := (it->>'qty')::integer;
    v_draft := round((it->>'price')::numeric, 2);
    if v_qty is null or v_qty <= 0 or v_qty > 100000 then raise exception 'Cantidad inválida en el borrador.'; end if;
    select * into p from public.products where id = (it->>'product_id')::uuid and store_id = p_store;
    if not found then raise exception 'Un producto del borrador ya no existe.'; end if;
    select * into r from public.erp__rule_for(p_store, p_point, p.id, now());
    v_price := public.erp__point_price(p, v_level, r, coalesce(s.rounding_step, 0), coalesce(s.rounding_dir, 'nearest'));
    if v_draft is distinct from v_price then
      v_changed := v_changed || jsonb_build_array(jsonb_build_object('name', p.name, 'draft', v_draft, 'now', v_price));
    end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object('product_id', p.id, 'qty', v_qty, 'price', v_price, 'description', p.name, 'sku', p.id));
  end loop;

  if jsonb_array_length(v_changed) > 0 then
    return jsonb_build_object('ok', false, 'code', 'PRICE_CHANGED', 'changed', v_changed,
      'message', 'Algunos precios cambiaron desde que se guardó la venta. Revísala y regístrala a mano.');
  end if;

  v_res := to_jsonb(public.create_order_from_cart(p_store, 'retail', v_items,
    coalesce(nullif(btrim(p_customer_name), ''), 'CLIENTE GENERAL'),
    left(btrim(coalesce(p_customer_note, '') || case when p_created_offline_at is not null
      then ' [Venta sin internet ' || to_char(p_created_offline_at at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') || ']' else '' end), 500),
    nullif(btrim(coalesce(p_customer_whatsapp, '')), '')));
  v_token := v_res->>'token';
  v_tag := public.erp_tag_order(p_store, v_token, p_point, p_seller, 'remision');
  select id, total into v_order, v_total from public.orders where token = v_token and store_id = p_store;
  if nullif(btrim(coalesce(p_customer_doc, '')), '') is not null then
    begin
      perform public.erp_pos_set_customer_doc(v_token, btrim(p_customer_doc));
    exception when others then null; -- es opcional (búsqueda por documento)
    end;
  end if;

  insert into public.erp_pos_offline_submissions (client_id, store_id, point_id, order_id, token, doc_number, total, created_offline_at, submitted_by, submitted_by_name)
  values (p_client_id, p_store, p_point, v_order, v_token, v_tag->>'doc_number', v_total, p_created_offline_at, auth.uid(), public.erp_actor_name(p_store));
  perform public.erp_audit(p_store, 'sale.offline_submitted', 'orders', v_order,
    jsonb_build_object('client_id', p_client_id, 'doc_number', v_tag->>'doc_number', 'created_offline_at', p_created_offline_at, 'total', v_total));
  return jsonb_build_object('ok', true, 'already', false, 'token', v_token, 'doc_number', v_tag->>'doc_number', 'total', v_total);
end;
$$;
revoke all on function public.erp_pos_submit_offline(uuid, uuid, uuid, uuid, jsonb, text, text, text, text, timestamptz) from public, anon;
grant execute on function public.erp_pos_submit_offline(uuid, uuid, uuid, uuid, jsonb, text, text, text, text, timestamptz) to authenticated;

notify pgrst, 'reload schema';
