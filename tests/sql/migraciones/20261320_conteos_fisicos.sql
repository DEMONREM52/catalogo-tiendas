-- 20261320 · Permiso «Conteos físicos» (inventory_counts), que antes venía dentro de «Inventario».
--
--   Contar por zonas, guardar líneas, enviar, volver a abrir y borrar el propio conteo pide
--   «Inventario» y además «Conteos físicos» (o «Ajustes de inventario», que ya puede mover existencias).
--   Aprobar o rechazar sigue pidiendo «Ajustes de inventario» (count_decide no cambia).
--
-- Nadie pierde nada: a quien tiene «inventory» se le agrega «inventory_counts» una sola vez
-- (marca 'perm_cnt'), y también a las plantillas de roles con «inventory». Desde ahí se quita a quien no deba contar.
-- Se puede correr dos veces.

do $$
declare
  v_known text[] := public.erp__known_permissions();
  v_new text[] := array['inventory_counts', 'perm_cnt'];
  v_first boolean := not ('inventory_counts' = any (v_known));
begin
  -- 1. La base reconoce el permiso nuevo.
  if exists (select 1 from unnest(v_new) x where not (x = any (v_known))) then
    v_known := v_known || array(select x from unnest(v_new) x where not (x = any (v_known)));
    execute format('create or replace function public.erp__known_permissions() returns text[] language sql immutable as $f$ select %L::text[] $f$', v_known);
  end if;

  -- 2. Plantillas de roles con «inventory» (solo la primera vez).
  if v_first and to_regclass('public.erp_role_templates') is not null then
    execute $u$
      update public.erp_role_templates t set permissions = array(select distinct x from unnest(t.permissions || array['inventory_counts']) x)
      where 'inventory' = any (t.permissions) and not ('inventory_counts' = any (t.permissions))
    $u$;
  end if;
end $$;

-- 3. Usuarios: quien tiene «inventory» sigue contando (una sola vez por usuario, gracias a la marca).
update public.store_users su
set permissions = array(select distinct x from unnest(
  coalesce(su.permissions, '{}'::text[])
  || case when 'inventory' = any (coalesce(su.permissions, '{}'::text[])) then array['inventory_counts'] else '{}'::text[] end
  || array['perm_cnt']) x)
where not ('perm_cnt' = any (coalesce(su.permissions, '{}'::text[])));

-- 4. ¿Puede contar? «Inventario» y además «Conteos físicos» o «Ajustes de inventario».
create or replace function public.vm__can_count(p_store uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and public.erp_can(p_store, 'inventory')
     and (public.erp_can(p_store, 'inventory_counts') or public.erp_can(p_store, 'inventory_adjust'))
$$;
revoke all on function public.vm__can_count(uuid) from public, anon, authenticated;

-- 5. Acceso a un conteo (usado por guardar, ver, enviar, volver a abrir, borrar y decidir).
create or replace function public.vm__count_access(p_count uuid, p_perm text)
returns public.erp_stock_counts language plpgsql stable security definer set search_path = public as $$
declare c public.erp_stock_counts; v uuid[];
begin
  select * into c from public.erp_stock_counts where id = p_count;
  if c.id is null then raise exception 'No encontré ese conteo.'; end if;
  if auth.uid() is null
     or (p_perm = 'inventory' and not public.vm__can_count(c.store_id))
     or (p_perm <> 'inventory' and not public.erp_can(c.store_id, p_perm)) then
    raise exception '%', case when p_perm = 'inventory_adjust' then 'Aprobar un conteo pide «Ajustar inventario».' else 'Necesitas el permiso «Conteos físicos».' end;
  end if;
  v := public.erp_my_points(c.store_id);
  if v is not null and not (c.warehouse_id = any (v)) then raise exception 'Ese conteo es de otro punto.'; end if;
  return c;
end;
$$;
revoke all on function public.vm__count_access(uuid, text) from public, anon, authenticated;

-- 6. Empezar y listar: se cambia solo la revisión del permiso en la definición que haya en la base.
do $$
declare
  r record;
  v_old text;
  v_new text;
begin
  for r in
    select p.oid, p.proname from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname in ('count_start', 'count_list')
    order by p.proname
  loop
    v_old := pg_get_functiondef(r.oid);
    if position('vm__can_count' in v_old) > 0 then
      raise notice '· % ya estaba', r.proname;
      continue;
    end if;
    v_new := regexp_replace(v_old,
      'not public\.erp_can\(p_store, ''inventory''\) then\s*return jsonb_build_object\(''ok'', false, ''message'', ''Necesitas el permiso «Inventario»\.''\)',
      'not public.vm__can_count(p_store) then
    return jsonb_build_object(''ok'', false, ''message'', ''Necesitas el permiso «Conteos físicos».'')');
    if v_new <> v_old then
      execute v_new;
      raise notice '✔ % ahora pide «Conteos físicos»', r.proname;
    else
      raise notice '· % sin cambio (no pide «Inventario» de la forma esperada)', r.proname;
    end if;
  end loop;
end $$;
