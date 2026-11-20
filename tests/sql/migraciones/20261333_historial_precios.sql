-- =====================================================================
-- REMHUB · Historial de precios y «precio de antes» real
--
--   · erp_product_price_history: desde ahora, cada vez que cambia un
--     precio 1-5 de un producto queda guardado (antes → después, cuándo
--     y quién). Lo llena un disparador; no cambia cómo se guardan los
--     productos ni bloquea nada (si falla, el cambio de precio sigue).
--   · product_price_before(p_store, p_product, p_level, p_catalog):
--     para la etiqueta «Bajó de precio», los precios que de verdad tuvo
--     el producto en ese nivel (del historial) y a cómo se vendió en ese
--     catálogo en los últimos 180 días (pedidos confirmados), solo los
--     mayores que el precio de hoy. Pide el permiso de productos.
--     Nunca entrega costos.
-- No borra datos. No cambia permisos. Es idempotente.
-- =====================================================================

create table if not exists public.erp_product_price_history (
  id bigint generated always as identity primary key,
  store_id uuid not null,
  product_id uuid not null references public.products(id) on delete cascade,
  level smallint not null check (level between 1 and 5),
  old_price numeric(14, 2),
  new_price numeric(14, 2),
  changed_at timestamptz not null default now(),
  changed_by uuid
);
create index if not exists erp_product_price_history_product on public.erp_product_price_history (product_id, level, changed_at desc);
alter table public.erp_product_price_history enable row level security;
revoke all on public.erp_product_price_history from public, anon, authenticated;

create or replace function public.erp__product_price_log()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old numeric[] := array[old.price_1, old.price_2, old.price_3, old.price_4, old.price_5];
  v_new numeric[] := array[new.price_1, new.price_2, new.price_3, new.price_4, new.price_5];
  i integer;
begin
  begin
    for i in 1..5 loop
      if v_old[i] is distinct from v_new[i] then
        insert into public.erp_product_price_history (store_id, product_id, level, old_price, new_price, changed_by)
        values (new.store_id, new.id, i, v_old[i], v_new[i], auth.uid());
      end if;
    end loop;
  exception when others then
    null; -- el historial nunca impide guardar el producto
  end;
  return new;
end $$;
revoke all on function public.erp__product_price_log() from public, anon, authenticated;

drop trigger if exists zz_erp_product_price_log on public.products;
create trigger zz_erp_product_price_log
  after update of price_1, price_2, price_3, price_4, price_5 on public.products
  for each row
  when (old.price_1 is distinct from new.price_1 or old.price_2 is distinct from new.price_2 or old.price_3 is distinct from new.price_3
        or old.price_4 is distinct from new.price_4 or old.price_5 is distinct from new.price_5)
  execute function public.erp__product_price_log();

create or replace function public.product_price_before(p_store uuid, p_product uuid, p_level integer default 3, p_catalog text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  p public.products;
  v_level integer := case when p_level between 1 and 5 then p_level else 3 end;
  v_now numeric;
  v_catalog uuid;
  v_history jsonb;
  v_sold jsonb;
begin
  if auth.uid() is null or not public.erp_can_any(p_store, array['products', 'products_prices']::text[]) then
    return jsonb_build_object('ok', false, 'message', 'Necesitas el permiso de productos.');
  end if;
  select * into p from public.products where id = p_product and store_id = p_store;
  if not found then return jsonb_build_object('ok', false, 'message', 'Producto no encontrado.'); end if;
  v_now := coalesce(public.catalog__price(p, v_level), 0);

  select coalesce(jsonb_agg(jsonb_build_object('price', h.old_price, 'until', h.changed_at) order by h.changed_at desc), '[]'::jsonb)
    into v_history
  from (
    select distinct on (x.old_price) x.old_price, x.changed_at
    from public.erp_product_price_history x
    where x.product_id = p_product and x.store_id = p_store and x.level = v_level and x.old_price > v_now
    order by x.old_price, x.changed_at desc
  ) h;
  select coalesce(jsonb_agg(v order by (v ->> 'until') desc), '[]'::jsonb) into v_history
  from (select v from jsonb_array_elements(v_history) v order by (v ->> 'until') desc limit 4) t;

  if p_catalog is not null and to_regclass('public.store_catalog_orders') is not null then
    begin
      execute $q$ select c.id from public.store_catalogs c where c.store_id = $1 and c.slug = $2 limit 1 $q$ into v_catalog using p_store, p_catalog;
    exception when others then v_catalog := null;
    end;
  end if;
  if v_catalog is not null then
    execute $q$
      select coalesce(jsonb_agg(jsonb_build_object('price', s.price, 'at', s.at) order by s.at desc), '[]'::jsonb)
      from (
        select distinct on (oi.price) oi.price, coalesce(o.confirmed_at, o.created_at) as at
        from public.order_items oi
        join public.orders o on o.id = oi.order_id
        join public.store_catalog_orders sco on sco.order_id = o.id and sco.catalog_id = $3
        where oi.product_id = $2 and o.store_id = $1 and o.status in ('confirmed', 'completed')
          and coalesce(o.confirmed_at, o.created_at) > now() - interval '180 days'
          and oi.price > $4
        order by oi.price, coalesce(o.confirmed_at, o.created_at) desc
      ) s $q$
      into v_sold using p_store, p_product, v_catalog, v_now;
    select coalesce(jsonb_agg(v order by (v ->> 'at') desc), '[]'::jsonb) into v_sold
    from (select v from jsonb_array_elements(coalesce(v_sold, '[]'::jsonb)) v order by (v ->> 'at') desc limit 3) t;
  end if;

  return jsonb_build_object('ok', true, 'now', v_now, 'level', v_level, 'history', v_history, 'sold', coalesce(v_sold, '[]'::jsonb),
    'tracking_since', (select min(changed_at) from public.erp_product_price_history where store_id = p_store));
end $$;

revoke all on function public.product_price_before(uuid, uuid, integer, text) from public, anon;
grant execute on function public.product_price_before(uuid, uuid, integer, text) to authenticated;

notify pgrst, 'reload schema';
