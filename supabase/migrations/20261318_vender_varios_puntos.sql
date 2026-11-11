-- 20261318 · Un vendedor puede trabajar y vender en dos o más puntos.
--
-- Hasta ahora un usuario de punto vendía SOLO en su punto principal (store_users.point_id); los «puntos adicionales»
-- (point_ids) son solo para CONSULTAR (documentos e informes). Decisión: se separa
--   · «Trabaja y vende en»  → point_id (principal) + sell_point_ids (nuevo)
--   · «Solo consulta»       → point_ids (como antes)
-- Quien hoy tiene puntos de consulta NO gana ventas: sell_point_ids empieza vacío para todos.
-- El dueño, los administradores y quien no tiene punto siguen vendiendo en todos.
--
-- Qué cambia en la base (las funciones parten de su versión en producción, 2026-11-11; solo se cambia la revisión
-- del punto, el resto de cada función queda igual; si una no tiene la forma esperada, no se toca y sale un aviso):
--   · erp_my_sell_points / erp_is_my_sell_point / erp_can_sell_at: «¿en qué puntos vendo?».
--   · erp_my_points (ver) incluye también los puntos donde vende.
--   · Guardar el punto de una venta (erp_order_meta), numerarla (erp_tag_order), editarla (erp_pos_order_set_items),
--     buscar documentos en el POS (erp_pos_documents), facturar (fiscal_issue_from_order, fiscal_can_send,
--     fiscal_document_detail, fiscal_documents_search, regla fiscal_documents_read) y ver existencias en el POS
--     (regla erp_stock_select) aceptan cualquiera de sus puntos de venta.
--   · erp_sellers devuelve sell_point_ids para que el POS muestre al vendedor en todos sus puntos.
-- Se puede correr dos veces.

alter table public.store_users add column if not exists sell_point_ids uuid[] not null default '{}';

-- Limpieza: sin repetidos, sin el punto principal, solo puntos de la misma tienda; sin punto principal no aplica.
create or replace function public.erp__store_users_sell_points()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_bad integer;
begin
  if new.point_id is null or new.role = 'store_admin' then
    new.sell_point_ids := '{}';
    return new;
  end if;
  new.sell_point_ids := array(select distinct x from unnest(coalesce(new.sell_point_ids, '{}'::uuid[])) x
                              where x is not null and x <> new.point_id);
  select count(*) into v_bad from unnest(new.sell_point_ids) x
  where not exists (select 1 from public.erp_warehouses w where w.id = x and w.store_id = new.store_id);
  if v_bad > 0 then raise exception 'Alguno de los puntos de venta no pertenece a esta tienda.'; end if;
  return new;
end;
$$;
drop trigger if exists store_users_sell_points on public.store_users;
create trigger store_users_sell_points before insert or update of sell_point_ids, point_id, role on public.store_users
  for each row execute function public.erp__store_users_sell_points();

-- Puntos donde el usuario vende. NULL = todos (dueño, administradores, sin punto asignado).
create or replace function public.erp_my_sell_points(p_store uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select case
           when su.point_id is null then null
           else array(select distinct x from unnest(array_prepend(su.point_id, coalesce(su.sell_point_ids, '{}'::uuid[]))) as x where x is not null)
         end
  from public.store_users su
  where su.store_id = p_store and su.user_id = auth.uid() and su.active
    and not exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
    and su.role <> 'store_admin'
  limit 1;
$$;
grant execute on function public.erp_my_sell_points(uuid) to authenticated;
revoke execute on function public.erp_my_sell_points(uuid) from anon;

-- ¿Es uno de MIS puntos de venta? (falso para quien vende en todos: equivale a «= erp_my_point»).
create or replace function public.erp_is_my_sell_point(p_store uuid, p_point uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(p_point = any (public.erp_my_sell_points(p_store)), false);
$$;
grant execute on function public.erp_is_my_sell_point(uuid, uuid) to authenticated;
revoke execute on function public.erp_is_my_sell_point(uuid, uuid) from anon;

-- ¿Puede vender en este punto? (verdadero para quien vende en todos).
create or replace function public.erp_can_sell_at(p_store uuid, p_point uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.erp_my_sell_points(p_store) is null or public.erp_is_my_sell_point(p_store, p_point);
$$;
grant execute on function public.erp_can_sell_at(uuid, uuid) to authenticated;
revoke execute on function public.erp_can_sell_at(uuid, uuid) from anon;

-- Ver: el punto principal, los de consulta y los de venta.
create or replace function public.erp_my_points(p_store uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select case
           when su.point_id is null then null
           else array(select distinct x from unnest(array_cat(array_prepend(su.point_id, coalesce(su.point_ids, '{}'::uuid[])),
                                                              coalesce(su.sell_point_ids, '{}'::uuid[]))) as x where x is not null)
         end
  from public.store_users su
  where su.store_id = p_store and su.user_id = auth.uid() and su.active
    and su.role <> 'store_admin'
    and not exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
    and not exists (select 1 from public.user_profiles up where up.user_id = auth.uid() and up.role = 'admin')
  limit 1;
$$;

-- El punto de una venta debe ser uno de los puntos donde vende el usuario.
create or replace function public.erp_guard_order_meta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.erp_my_point(new.store_id) is not null and not public.erp_is_my_sell_point(new.store_id, new.point_id) then
    raise exception 'Tu usuario solo puede vender en sus puntos asignados.';
  end if;
  return new;
end $$;

-- Vendedores: con los puntos donde también venden.
drop function if exists public.erp_sellers(uuid);
create function public.erp_sellers(p_store uuid)
returns table(user_id uuid, name text, role text, point_id uuid, sell_point_ids uuid[])
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.erp_can(p_store, 'pos') or public.erp_can(p_store, 'orders') or public.erp_can(p_store, 'billing')) then
    raise exception 'No tienes permiso para ver los vendedores.';
  end if;
  return query
    select s.owner_id,
           coalesce((select coalesce(nullif(trim(u.raw_user_meta_data->>'display_name'), ''), u.email::text) from auth.users u where u.id = s.owner_id), 'Dueño'),
           'owner'::text, null::uuid, '{}'::uuid[]
    from public.stores s where s.id = p_store
    union all
    select su.user_id, coalesce(nullif(trim(su.display_name), ''), su.username, 'Usuario'), su.role, su.point_id,
           coalesce(su.sell_point_ids, '{}'::uuid[])
    from public.store_users su
    where su.store_id = p_store and su.active and su.user_id is distinct from (select s2.owner_id from public.stores s2 where s2.id = p_store)
      and (su.role in ('seller', 'store_admin') or 'pos' = any (su.permissions))
    order by 2;
end;
$$;
grant execute on function public.erp_sellers(uuid) to authenticated;
revoke execute on function public.erp_sellers(uuid) from anon;

-- Cambios sobre la versión actual de cada función.
do $$
declare
  p record;
  v_old text;
  v_new text;
  v_done integer := 0;
  v_sig text;
begin
  for p in
    select * from (values
      -- Numerar una venta: el punto debe ser uno de los suyos.
      ('public.erp_tag_order(uuid,text,uuid,uuid,text)',
       '(raise exception ''Elige un punto de venta válido\.'';\s*end if;)',
       E'\\1\n  if not public.erp_can_sell_at(p_store, p_point) then raise exception ''No vendes en este punto: pídele a la tienda madre que te lo asigne.''; end if;',
       'No vendes en este punto'),
      -- Editar una venta de cualquiera de sus puntos.
      ('public.erp_pos_order_set_items(uuid,jsonb,text,text)',
       'if v_my is not null and v_point is distinct from v_my then',
       'if v_my is not null and not public.erp_is_my_sell_point(o.store_id, v_point) then',
       'erp_is_my_sell_point'),
      -- Documentos del POS: los del punto elegido si vende ahí.
      ('public.erp_pos_documents(uuid,uuid,text,integer)',
       'coalesce\(public\.erp_my_point\(p_store\), p_point\) as pt',
       'case when p_point is not null and public.erp_can_sell_at(p_store, p_point) then p_point else coalesce(public.erp_my_point(p_store), p_point) end as pt',
       'erp_can_sell_at'),
      -- Facturar electrónicamente en cualquiera de sus puntos de venta.
      ('public.fiscal_issue_from_order(uuid,text,uuid)',
       'v_my is not null and v_point <> v_my and not',
       'v_my is not null and not public.erp_is_my_sell_point(p_store, v_point) and not',
       'erp_is_my_sell_point'),
      ('public.fiscal_can_send(uuid)',
       'd\.point_id = public\.erp_my_point\(d\.store_id\)',
       'public.erp_is_my_sell_point(d.store_id, d.point_id)',
       'erp_is_my_sell_point'),
      ('public.fiscal_document_detail(uuid)',
       'd\.point_id = public\.erp_my_point\(d\.store_id\)',
       'public.erp_is_my_sell_point(d.store_id, d.point_id)',
       'erp_is_my_sell_point'),
      ('public.fiscal_documents_search(uuid,jsonb,integer,jsonb)',
       'array\[public\.erp_my_point\(p_store\)\]',
       'public.erp_my_sell_points(p_store)',
       'erp_my_sell_points'),
      -- Para la interfaz: en qué puntos vende.
      ('public.erp_my_scope(uuid)',
       '(''point_ids'', to_jsonb\(v_points\),)',
       E'\\1\n    ''sell_point_ids'', to_jsonb(public.erp_my_sell_points(p_store)),',
       'sell_point_ids')
    ) as t(sig, pattern, repl, mark)
  loop
    v_sig := p.sig;
    if to_regprocedure(v_sig) is null then
      -- La firma puede variar: se busca por nombre.
      select oid::regprocedure::text into v_sig from pg_proc
      where pronamespace = 'public'::regnamespace and proname = split_part(split_part(p.sig, '(', 1), '.', 2) limit 1;
      if v_sig is null then raise notice '· % no existe en esta base', p.sig; continue; end if;
    end if;
    v_old := pg_get_functiondef(v_sig::regprocedure);
    if position(p.mark in v_old) > 0 then
      raise notice '· % ya estaba', v_sig;
      continue;
    end if;
    v_new := regexp_replace(v_old, p.pattern, p.repl);
    if v_new <> v_old then
      execute v_new;
      v_done := v_done + 1;
      raise notice '✔ % acepta todos los puntos de venta del usuario', v_sig;
    else
      raise notice '· % sin cambio (no tiene la forma esperada): revisar', v_sig;
    end if;
  end loop;
  raise notice 'Funciones actualizadas: %', v_done;
end $$;

-- Existencias: cada usuario de punto ve las de sus puntos de venta (antes, solo la de su punto principal).
drop policy if exists erp_stock_select on public.erp_stock_levels;
create policy erp_stock_select on public.erp_stock_levels for select to authenticated
  using ((public.erp_can(store_id, 'inventory') or public.erp_can(store_id, 'products') or public.erp_can(store_id, 'pos'))
         and (public.erp_my_point(store_id) is null or public.erp_is_my_sell_point(store_id, warehouse_id)));

-- Documentos electrónicos: el cajero ve los de sus puntos de venta.
do $$
begin
  if to_regclass('public.fiscal_documents') is null then return; end if;
  drop policy if exists fiscal_documents_read on public.fiscal_documents;
  create policy fiscal_documents_read on public.fiscal_documents for select to authenticated
    using ((public.erp_can_any(store_id, public.fiscal__view_perms()) and public.erp_point_allowed(store_id, point_id))
           or (public.erp_can(store_id, 'pos') and point_id is not null and public.erp_is_my_sell_point(store_id, point_id)));
end $$;
