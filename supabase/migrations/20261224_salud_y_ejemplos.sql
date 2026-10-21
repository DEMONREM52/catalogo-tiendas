-- =====================================================================
-- REMHUB · Salud de las tiendas (para el administrador) y productos de ejemplo
--
--   · saas_admin_store_health(): cada tienda con su plan, cuándo entró el
--     dueño por última vez, ventas de 7 y 30 días, productos, usuarios y un
--     estado: 🔴 en riesgo, 🟡 sin arrancar, 🟢 saludable, con el motivo.
--     Solo el administrador de RemHub.
--   · store_seed_examples / store_clear_examples: la tienda nueva puede
--     cargar 8 productos de ejemplo (referencia EJEMPLO-…) para ver su
--     catálogo funcionando, y quitarlos con un clic (los que ya tuvieron
--     movimientos se desactivan en vez de borrarse).
-- No borra datos reales. Es idempotente.
-- =====================================================================

create or replace function public.saas_admin_store_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r jsonb;
begin
  if not public.erp_is_platform_admin() then return jsonb_build_object('ok', false, 'error', 'Solo el administrador de RemHub.'); end if;
  with base as (
    select s.id, s.name, s.slug, s.whatsapp, s.created_at, s.owner_id,
           sub.plan_id, sub.status, sub.trial_ends_at, sub.current_period_end,
           (select u.email::text from auth.users u where u.id = s.owner_id) as owner_email,
           (select (to_jsonb(u) ->> 'last_sign_in_at')::timestamptz from auth.users u where u.id = s.owner_id) as owner_seen,
           (select max(coalesce(o.confirmed_at, o.created_at)) from public.orders o where o.store_id = s.id and o.status in ('confirmed', 'completed')) as last_sale,
           (select count(*) from public.orders o where o.store_id = s.id and o.status in ('confirmed', 'completed') and coalesce(o.confirmed_at, o.created_at) >= now() - interval '7 days')::integer as sales_7,
           (select coalesce(sum(o.total), 0) from public.orders o where o.store_id = s.id and o.status in ('confirmed', 'completed') and coalesce(o.confirmed_at, o.created_at) >= now() - interval '30 days') as total_30,
           (select count(*) from public.products p where p.store_id = s.id and coalesce(p.active, true) and coalesce(p.sku, '') not like 'EJEMPLO-%')::integer as products,
           (select count(*) from public.store_users su where su.store_id = s.id and su.active)::integer as users
    from public.stores s
    left join public.saas_subscriptions sub on sub.store_id = s.id
  ),
  scored as (
    select b.*,
      case
        when b.status in ('suspended', 'expired', 'past_due') then 'risk'
        when b.status = 'trialing' and b.trial_ends_at is not null and b.trial_ends_at < now() + interval '3 days' then 'risk'
        when b.created_at > now() - interval '21 days' and (b.products < 5 or b.last_sale is null) then 'start'
        when b.owner_seen is not null and b.owner_seen < now() - interval '10 days' then 'risk'
        when b.last_sale is null or b.last_sale < now() - interval '14 days' then 'risk'
        else 'ok' end as health,
      case
        when b.status in ('suspended', 'expired', 'past_due') then 'Plan ' || b.status
        when b.status = 'trialing' and b.trial_ends_at is not null and b.trial_ends_at < now() + interval '3 days' then 'La prueba termina pronto'
        when b.created_at > now() - interval '21 days' and b.products < 5 then 'Nueva: casi no tiene productos'
        when b.created_at > now() - interval '21 days' and b.last_sale is null then 'Nueva: aún no vende'
        when b.owner_seen is not null and b.owner_seen < now() - interval '10 days' then 'El dueño no entra hace más de 10 días'
        when b.last_sale is null then 'Nunca ha vendido'
        when b.last_sale < now() - interval '14 days' then 'Sin ventas hace más de 14 días'
        else 'Vende y entra seguido' end as reason
    from base b
  )
  select jsonb_build_object('ok', true, 'stores', coalesce(jsonb_agg(jsonb_build_object(
      'store_id', x.id, 'name', x.name, 'slug', x.slug, 'whatsapp', x.whatsapp, 'created_at', x.created_at,
      'plan_id', x.plan_id, 'status', x.status, 'trial_ends_at', x.trial_ends_at, 'period_end', x.current_period_end,
      'owner_email', x.owner_email, 'owner_seen', x.owner_seen, 'last_sale', x.last_sale, 'sales_7', x.sales_7, 'total_30', round(x.total_30),
      'products', x.products, 'users', x.users, 'health', x.health, 'reason', x.reason)
    order by case x.health when 'risk' then 1 when 'start' then 2 else 3 end, x.total_30 desc), '[]'::jsonb))
  into r from scored x;
  return r;
end;
$$;
revoke all on function public.saas_admin_store_health() from public, anon;
grant execute on function public.saas_admin_store_health() to authenticated;

-- Productos de ejemplo para ver la tienda funcionando desde el primer minuto.
create or replace function public.store_seed_examples(p_store uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cat uuid;
  v_n integer := 0;
  it record;
begin
  if auth.uid() is null or not public.erp_can(p_store, 'products') then return jsonb_build_object('ok', false, 'error', 'No tienes permiso de productos.'); end if;
  if exists (select 1 from public.products where store_id = p_store and sku like 'EJEMPLO-%') then
    return jsonb_build_object('ok', false, 'error', 'Ya cargaste los productos de ejemplo.');
  end if;
  select id into v_cat from public.product_categories where store_id = p_store and name = 'EJEMPLOS' limit 1;
  if v_cat is null then
    insert into public.product_categories (store_id, name, active) values (p_store, 'EJEMPLOS', true) returning id into v_cat;
  end if;
  for it in select * from (values
    ('EJEMPLO-001', 'AUDÍFONOS INALÁMBRICOS (EJEMPLO)', 45000, 59000, 65000, 25000),
    ('EJEMPLO-002', 'CARGADOR RÁPIDO 25W (EJEMPLO)', 18000, 24000, 28000, 9000),
    ('EJEMPLO-003', 'CABLE USB TIPO C 1 M (EJEMPLO)', 6000, 9000, 12000, 2500),
    ('EJEMPLO-004', 'PARLANTE BLUETOOTH (EJEMPLO)', 55000, 72000, 79000, 32000),
    ('EJEMPLO-005', 'FORRO DE CELULAR (EJEMPLO)', 8000, 12000, 15000, 3000),
    ('EJEMPLO-006', 'VIDRIO TEMPLADO (EJEMPLO)', 5000, 8000, 10000, 1500),
    ('EJEMPLO-007', 'MOUSE INALÁMBRICO (EJEMPLO)', 22000, 30000, 35000, 12000),
    ('EJEMPLO-008', 'SOPORTE PARA CELULAR (EJEMPLO)', 12000, 17000, 20000, 5000)
  ) as t(sku, name, p2, p3, p1, cost) loop
    insert into public.products (store_id, name, sku, price_1, price_2, price_3, price_4, price_5, price_retail, price_wholesale, cost_price, stock, active, category_id)
    values (p_store, it.name, it.sku, it.p1, it.p2, it.p3, it.p3, it.p3, it.p3, it.p2, it.cost, 0, true, v_cat);
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'created', v_n);
end;
$$;
revoke all on function public.store_seed_examples(uuid) from public, anon;
grant execute on function public.store_seed_examples(uuid) to authenticated;

create or replace function public.store_clear_examples(p_store uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_del integer := 0;
  v_off integer := 0;
  v_id uuid;
begin
  if auth.uid() is null or not public.erp_can(p_store, 'products') then return jsonb_build_object('ok', false, 'error', 'No tienes permiso de productos.'); end if;
  -- Los que nunca se usaron se borran; los que ya tuvieron ventas, movimientos o están ligados a algo solo se desactivan.
  for v_id in select p.id from public.products p where p.store_id = p_store and p.sku like 'EJEMPLO-%' loop
    if exists (select 1 from public.order_items oi where oi.product_id = v_id)
       or exists (select 1 from public.inventory_movements m where m.product_id = v_id) then
      update public.products set active = false where id = v_id and active;
      v_off := v_off + 1;
    else
      begin
        delete from public.products where id = v_id;
        v_del := v_del + 1;
      exception when others then
        update public.products set active = false where id = v_id;
        v_off := v_off + 1;
      end;
    end if;
  end loop;
  delete from public.product_categories c where c.store_id = p_store and c.name = 'EJEMPLOS'
    and not exists (select 1 from public.products p where p.category_id = c.id);
  return jsonb_build_object('ok', true, 'deleted', v_del, 'deactivated', v_off);
end;
$$;
revoke all on function public.store_clear_examples(uuid) from public, anon;
grant execute on function public.store_clear_examples(uuid) to authenticated;

notify pgrst, 'reload schema';
