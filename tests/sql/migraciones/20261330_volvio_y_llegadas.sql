-- =====================================================================
-- REMHUB · ¡Volvió! y productos que llegaron
--
-- Cada vez que un producto pasa de 0 unidades (en total) a tener unidades,
-- queda anotado una vez por día en erp_product_arrivals:
--   · back = «¡Volvió!»: ya se había comprado o vendido antes.
--   · new  = llegó por primera vez.
-- (Los traslados entre puntos no cuentan: no cambian el total.)
--
-- erp_product_arrivals_list(p_store, p_since, p_days): lo que llegó desde
-- una hora (p. ej. justo antes de registrar un ingreso) o en los últimos
-- días, con cuántos clientes lo esperaban en «Avísame», si le falta la
-- foto o la categoría y si ya se publicó después de llegar.
-- Lo usan el ingreso (aviso «¡Volvió!» al registrar) y el Radar.
--
-- No cambia productos, existencias ni permisos. Es idempotente.
-- =====================================================================

create table if not exists public.erp_product_arrivals (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  day date not null,
  kind text not null check (kind in ('new', 'back')),
  at timestamptz not null default now(),
  unique (product_id, day)
);
create index if not exists erp_product_arrivals_store on public.erp_product_arrivals (store_id, at desc);
alter table public.erp_product_arrivals enable row level security;
revoke all on public.erp_product_arrivals from anon, authenticated;

create or replace function public.erp__product_arrival()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_back boolean;
begin
  v_back := exists (select 1 from public.erp_product_arrivals a where a.product_id = new.id)
    or exists (select 1 from public.order_items oi where oi.product_id = new.id)
    or (select count(distinct it.purchase_id) from public.erp_purchase_items it where it.product_id = new.id) >= 2;
  insert into public.erp_product_arrivals (store_id, product_id, day, kind)
  values (new.store_id, new.id, (now() at time zone 'America/Bogota')::date, case when v_back then 'back' else 'new' end)
  on conflict (product_id, day) do nothing;
  return new;
exception when others then
  -- Nunca frena un ingreso, una devolución ni un ajuste por esto.
  return new;
end $$;
revoke all on function public.erp__product_arrival() from public, anon, authenticated;

drop trigger if exists zz_erp_product_arrival on public.products;
create trigger zz_erp_product_arrival after update of stock on public.products
  for each row when (coalesce(old.stock, 0) <= 0 and coalesce(new.stock, 0) > 0)
  execute function public.erp__product_arrival();

-- Clientes esperando ese producto en «Avísame» (0 si esa función no está instalada).
create or replace function public.erp__waitlist_waiting(p_product uuid)
returns integer language plpgsql stable security definer set search_path = public as $$
declare n integer := 0;
begin
  if to_regclass('public.erp_stock_waitlist') is null then return 0; end if;
  execute 'select count(*)::integer from public.erp_stock_waitlist where product_id = $1 and status = ''waiting''' into n using p_product;
  return coalesce(n, 0);
end $$;
revoke all on function public.erp__waitlist_waiting(uuid) from public, anon, authenticated;

create or replace function public.erp_product_arrivals_list(p_store uuid, p_since timestamptz default null, p_days integer default 7)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_since timestamptz := coalesce(p_since, now() - make_interval(days => least(greatest(coalesce(p_days, 7), 1), 90)));
begin
  if auth.uid() is null or not public.erp_can_any(p_store, array['products', 'purchases', 'inventory', 'products_view']::text[]) then
    return jsonb_build_object('ok', false, 'message', 'Necesitas el permiso de Productos o de Ingresos.');
  end if;
  return jsonb_build_object('ok', true, 'since', v_since, 'items', coalesce((
    select jsonb_agg(x order by x->>'at' desc)
    from (
      select jsonb_build_object(
        'product_id', p.id, 'name', p.name, 'sku', p.sku, 'image_url', p.image_url, 'kind', a.kind, 'at', a.at,
        'stock', coalesce(p.stock, 0), 'active', coalesce(p.active, true),
        'waiting', public.erp__waitlist_waiting(p.id),
        'no_photo', nullif(btrim(coalesce(p.image_url, '')), '') is null,
        'no_category', p.category_id is null and not exists (select 1 from public.product_category_links l where l.product_id = p.id),
        'published', exists (select 1 from public.erp_product_publish pp where pp.product_id = p.id and pp.last_published_at >= a.at)
      ) as x
      from (select distinct on (a.product_id) a.* from public.erp_product_arrivals a
            where a.store_id = p_store and a.at >= v_since order by a.product_id, a.at desc) a
      join public.products p on p.id = a.product_id
      limit 2000
    ) z), '[]'::jsonb));
end $$;

revoke all on function public.erp_product_arrivals_list(uuid, timestamptz, integer) from public, anon;
grant execute on function public.erp_product_arrivals_list(uuid, timestamptz, integer) to authenticated;

notify pgrst, 'reload schema';
