-- 20261316 · Permisos «Catálogos» y «Landing» sin necesitar «Editar productos».
--
-- Antes, para manejar catálogos o landing pages, la base pedía el permiso «Productos» (editar productos).
-- Ahora acepta «Productos» O el permiso propio:
--   · Catálogos (store_catalogs, sus categorías, catalog_admin_*, imágenes de catálogo) → products o catalogs.
--   · Landing pages (erp_landing_*)                                                      → products o landing.
-- Así se puede dar marketing sin dejar editar productos. Nadie pierde nada: «Productos» sigue sirviendo, y
-- 20261285 ya les dio «Catálogos» y «Landing» a todos los que tenían «Productos».
--
-- Las funciones se toman TAL COMO ESTÁN en la base (pg_get_functiondef) y solo se cambia la revisión del permiso
-- «products» por «products o el permiso propio»; el resto de cada función queda igual. Si una función no tiene esa
-- revisión, no se toca y sale un aviso. Se puede correr dos veces.
-- Los productos y categorías ACTIVOS ya los puede leer cualquiera del equipo: para escoger productos no hace falta más.

do $$
declare
  r record;
  v_old text;
  v_new text;
  v_extra text;
  v_done integer := 0;
begin
  for r in
    select p.oid, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname like 'catalog\_admin\_%' escape '\'
           or p.proname like 'erp\_landing\_%' escape '\'
           or p.proname in ('catalog_can_manage_asset', 'can_manage_store_social'))
      and p.prokind = 'f'
    order by p.proname
  loop
    v_extra := case when r.proname like 'erp\_landing\_%' escape '\' then 'landing' else 'catalogs' end;
    v_old := pg_get_functiondef(r.oid);
    -- erp_can(x, 'products') → erp_can_any(x, array['products', '<propio>'])
    v_new := regexp_replace(v_old,
      'erp_can\((\s*[A-Za-z_][A-Za-z0-9_.]*\s*),\s*''products''(::text)?\s*\)',
      'erp_can_any(\1, array[''products'', ''' || v_extra || ''']::text[])', 'g');
    -- store_user_has_permission(x, '{products}') → store_user_has_permission(x, '{products,<propio>}')
    v_new := regexp_replace(v_new,
      'store_user_has_permission\((\s*[A-Za-z_][A-Za-z0-9_.]*\s*),\s*''\{products\}''::text\[\]\s*\)',
      'store_user_has_permission(\1, ''{products,' || v_extra || '}''::text[])', 'g');
    if v_new <> v_old then
      execute v_new;
      v_done := v_done + 1;
      raise notice '✔ % ahora acepta «products» o «%»', r.proname, v_extra;
    else
      raise notice '· % sin cambio (no pide «products» o ya estaba)', r.proname;
    end if;
  end loop;
  raise notice 'Funciones actualizadas: %', v_done;
end $$;

-- Reglas de catálogos: las mismas de antes, aceptando también «catalogs» (y «landing» para leer, porque la landing
-- escoge su catálogo).
drop policy if exists store_catalogs_read on public.store_catalogs;
create policy store_catalogs_read on public.store_catalogs for select to authenticated
  using ((public.erp_can_any(store_id, array['products', 'audit', 'orders', 'catalogs', 'landing']::text[]))
         and public.erp_catalog_visible(store_id, point_id));

drop policy if exists store_catalogs_write on public.store_catalogs;
create policy store_catalogs_write on public.store_catalogs for all to authenticated
  using (public.erp_can_any(store_id, array['products', 'catalogs']::text[]) and public.erp_catalog_visible(store_id, point_id))
  with check (public.erp_can_any(store_id, array['products', 'catalogs']::text[]) and public.erp_catalog_visible(store_id, point_id));

drop policy if exists store_catalog_categories_all on public.store_catalog_categories;
create policy store_catalog_categories_all on public.store_catalog_categories for all to authenticated
  using (public.erp_can_any(store_id, array['products', 'catalogs']::text[])
         and exists (select 1 from public.store_catalogs c where c.id = store_catalog_categories.catalog_id and public.erp_catalog_visible(c.store_id, c.point_id)))
  with check (public.erp_can_any(store_id, array['products', 'catalogs']::text[])
         and exists (select 1 from public.store_catalogs c where c.id = store_catalog_categories.catalog_id and public.erp_catalog_visible(c.store_id, c.point_id)));
