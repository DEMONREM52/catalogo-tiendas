-- =====================================================================
-- REMHUB · Crecer: Google y videos de ayuda
--
--   1. store_public_seo(slug): lo público que ayuda a salir en Google —
--      frase del negocio, ciudad y dirección (de «Mi tienda»), categorías y
--      algunos productos con foto. Solo tiendas activas con catálogo público.
--      Nunca entrega costos ni existencias.
--   2. saas_help_videos: un video corto (YouTube, Vimeo o enlace .mp4) por
--      pantalla del panel. Lo carga el administrador de RemHub y lo ven todos
--      en el botón «?» de esa pantalla.
-- No borra datos. Es idempotente.
-- =====================================================================

create or replace function public.store_public_seo(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with s as (
    select st.id, st.name, st.slug, st.whatsapp, st.logo_url
    from public.stores st
    where lower(st.slug) = lower(btrim(p_slug)) and st.active and coalesce(st.catalog_retail, true)
    limit 1
  )
  select case when (select id from s) is null then null else jsonb_build_object(
    'name', (select name from s),
    'headline', (select nullif(btrim(sp.headline), '') from public.store_profiles sp where sp.store_id = (select id from s)),
    'city', (select nullif(btrim(sp.city), '') from public.store_profiles sp where sp.store_id = (select id from s)),
    'address', (select nullif(btrim(sp.address), '') from public.store_profiles sp where sp.store_id = (select id from s)),
    'categories', coalesce((
      select jsonb_agg(c.name order by c.n desc) from (
        select pc.name, count(*) as n
        from public.products p join public.product_categories pc on pc.id = p.category_id
        where p.store_id = (select id from s) and coalesce(p.active, true)
        group by pc.name order by count(*) desc limit 8) c), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'image', x.image_url, 'price', x.price_3)) from (
        select p.id, p.name, p.image_url, p.price_3
        from public.products p
        where p.store_id = (select id from s) and coalesce(p.active, true) and coalesce(p.image_url, '') like 'https://%'
        order by p.created_at desc limit 12) x), '[]'::jsonb),
    'count', (select count(*) from public.products p where p.store_id = (select id from s) and coalesce(p.active, true))
  ) end;
$$;
revoke all on function public.store_public_seo(text) from public;
grant execute on function public.store_public_seo(text) to anon, authenticated;

create table if not exists public.saas_help_videos (
  screen text primary key,
  title text not null,
  url text not null check (url ~* '^https://'),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.saas_help_videos enable row level security;
revoke all on public.saas_help_videos from anon, authenticated;
grant select on public.saas_help_videos to authenticated;
drop policy if exists saas_help_videos_read on public.saas_help_videos;
create policy saas_help_videos_read on public.saas_help_videos for select to authenticated using (true);

create or replace function public.saas_admin_help_video_save(p_screen text, p_title text, p_url text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.erp_is_platform_admin() then return jsonb_build_object('ok', false, 'error', 'Solo el administrador de RemHub.'); end if;
  if coalesce(btrim(p_url), '') = '' then
    delete from public.saas_help_videos where screen = p_screen;
    return jsonb_build_object('ok', true, 'deleted', true);
  end if;
  if p_url !~* '^https://' then return jsonb_build_object('ok', false, 'error', 'El enlace debe empezar por https://'); end if;
  insert into public.saas_help_videos (screen, title, url, updated_by, updated_at)
  values (p_screen, coalesce(nullif(btrim(p_title), ''), 'Video'), btrim(p_url), auth.uid(), now())
  on conflict (screen) do update set title = excluded.title, url = excluded.url, updated_by = excluded.updated_by, updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.saas_admin_help_video_save(text, text, text) from public, anon;
grant execute on function public.saas_admin_help_video_save(text, text, text) to authenticated;

notify pgrst, 'reload schema';
