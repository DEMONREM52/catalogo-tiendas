-- =====================================================================
-- 20261285 · Permisos desglosados
--
-- Nueve permisos nuevos que antes venían dentro de uno grande (o eran de todos):
--   products  → products_create, products_import, products_delete, catalogs, landing
--   users     → users_passwords, users_delete, security
--   (todos)   → messages
--
-- Nadie pierde nada: a cada usuario que tenía el permiso grande se le agregan los de adentro, y a todos
-- «messages». La marca 'perm_v2' indica que la lista ya está desglosada (la app deja de heredar).
-- Las plantillas de roles de cada tienda se desglosan igual (una sola vez).
--
-- En la base: eliminar productos ahora exige «products_delete» (además de «products» y ser de la madre).
-- Contraseñas y eliminar usuarios los exige el servidor de la app (api/store-team/users).
--
-- No borra datos. Es idempotente (se puede correr dos veces).
-- =====================================================================

do $$
declare
  v_known text[] := public.erp__known_permissions();
  v_new text[] := array['products_create', 'products_import', 'products_delete', 'catalogs', 'landing',
                        'messages', 'security', 'users_passwords', 'users_delete', 'perm_v2'];
  v_first boolean := not ('products_create' = any (v_known));
begin
  -- 1. La base reconoce los permisos nuevos (permisos temporales, roles, puntos).
  if exists (select 1 from unnest(v_new) x where not (x = any (v_known))) then
    v_known := v_known || array(select x from unnest(v_new) x where not (x = any (v_known)));
    execute format('create or replace function public.erp__known_permissions() returns text[] language sql immutable as $f$ select %L::text[] $f$', v_known);
  end if;

  -- 2. Plantillas de roles: quien incluía el permiso grande incluye lo de adentro (solo la primera vez).
  if v_first and to_regclass('public.erp_role_templates') is not null then
    execute $u$
      update public.erp_role_templates t set permissions = array(select distinct x from unnest(
        t.permissions
        || case when 'products' = any (t.permissions) then array['products_create', 'products_import', 'products_delete', 'catalogs', 'landing'] else '{}'::text[] end
        || case when 'users' = any (t.permissions) then array['users_passwords', 'users_delete', 'security'] else '{}'::text[] end
        || array['messages']) x)
    $u$;
  end if;
end $$;

-- 3. Usuarios: se desglosa lo que tenían (una sola vez por usuario, gracias a la marca).
update public.store_users su
set permissions = array(select distinct x from unnest(
  coalesce(su.permissions, '{}'::text[])
  || case when 'products' = any (coalesce(su.permissions, '{}'::text[])) then array['products_create', 'products_import', 'products_delete', 'catalogs', 'landing'] else '{}'::text[] end
  || case when 'users' = any (coalesce(su.permissions, '{}'::text[])) then array['users_passwords', 'users_delete', 'security'] else '{}'::text[] end
  || array['messages', 'perm_v2']) x)
where not ('perm_v2' = any (coalesce(su.permissions, '{}'::text[])));

-- 4. Eliminar productos exige su propio permiso.
do $$
begin
  if to_regprocedure('public.erp__product_delete_allowed(uuid)') is not null then
    execute $f$
      create or replace function public.erp__product_delete_allowed(p_store uuid)
      returns boolean language sql stable security definer set search_path = public as $b$
        select auth.uid() is not null
           and public.erp_can(p_store, 'products')
           and public.erp_can(p_store, 'products_delete')
           and public.erp_my_points(p_store) is null;
      $b$
    $f$;
    execute 'revoke all on function public.erp__product_delete_allowed(uuid) from public, anon, authenticated';
  end if;
end $$;
