-- =====================================================================
-- REMHUB · Píxel de Meta solo en las landing pages
--
--   store_tracking.landing_only: si está activo, el píxel de la tienda solo
--   se carga en las landing pages (/oferta/…); el catálogo y las fichas de
--   producto no envían eventos a Meta.
--   store_pixel_scope: lo que necesita la página pública para saberlo.
-- No borra datos. Es idempotente.
-- =====================================================================

alter table public.store_tracking add column if not exists landing_only boolean not null default false;

create or replace function public.store_pixel_scope(p_store text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('landing_only', coalesce(t.landing_only, false))
  from public.stores s
  left join public.store_tracking t on t.store_id = s.id
  where s.slug = btrim(p_store)
  limit 1
$$;

revoke all on function public.store_pixel_scope(text) from public;
grant execute on function public.store_pixel_scope(text) to anon, authenticated, service_role;
