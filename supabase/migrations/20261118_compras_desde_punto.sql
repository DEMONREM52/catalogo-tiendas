-- =====================================================================
-- REMHUB · Ingreso de factura desde un punto
--
-- Antes: un usuario asignado a un punto NUNCA podía ingresar facturas,
-- aunque tuviera el permiso «Compras».
-- Ahora: si tiene «Compras», puede hacerlo, pero SOLO hacia su(s) punto(s):
--   · la factura y cada una de sus líneas deben ir a un punto suyo;
--   · no puede editar ni anular facturas de otros puntos o de la madre;
--   · en la lista solo ve las facturas de sus puntos.
-- La madre sigue igual (ve y hace todo). Lo valida la base, no la pantalla.
--
-- No borra datos. Es idempotente.
-- =====================================================================

-- ¿Este almacén es de los puntos del usuario? (null = usuario de la madre: todo).
create or replace function public.erp__my_point_ok(p_store uuid, p_wh uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.erp_my_points(p_store) is null or p_wh = any (public.erp_my_points(p_store));
$$;
revoke all on function public.erp__my_point_ok(uuid, uuid) from public, anon;
grant execute on function public.erp__my_point_ok(uuid, uuid) to authenticated;

-- Encabezado de la factura: al crearla o cambiarla, debe ser de un punto suyo.
create or replace function public.erp_guard_purchase()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.erp_my_points(new.store_id) is null then return new; end if;
  if not public.erp_can(new.store_id, 'purchases') then
    raise exception 'Necesitas el permiso «Compras» para ingresar facturas.';
  end if;
  if tg_op = 'UPDATE' and not public.erp__my_point_ok(old.store_id, old.warehouse_id) then
    raise exception 'Esa factura es de otro punto: solo la puede cambiar la tienda madre.';
  end if;
  if not public.erp__my_point_ok(new.store_id, new.warehouse_id) then
    raise exception 'Solo puedes ingresar facturas hacia tu punto.';
  end if;
  return new;
end $$;
drop trigger if exists erp_guard_purchase on public.erp_purchases;
create trigger erp_guard_purchase before insert or update on public.erp_purchases
  for each row execute function public.erp_guard_purchase();

-- Cada línea: también hacia su punto (la factura puede repartir líneas en varias bodegas).
create or replace function public.erp_guard_purchase_item()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_store uuid; v_head uuid;
begin
  select store_id, warehouse_id into v_store, v_head from public.erp_purchases where id = coalesce(new.purchase_id, old.purchase_id);
  if v_store is null or public.erp_my_points(v_store) is null then return coalesce(new, old); end if;
  if tg_op <> 'INSERT' and not public.erp__my_point_ok(v_store, coalesce(old.warehouse_id, v_head)) then
    raise exception 'Esa línea es de otro punto: solo la puede cambiar la tienda madre.';
  end if;
  if tg_op <> 'DELETE' and not public.erp__my_point_ok(v_store, coalesce(new.warehouse_id, v_head)) then
    raise exception 'Cada producto de la factura debe ir a tu punto.';
  end if;
  return coalesce(new, old);
end $$;
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'erp_purchase_items' and column_name = 'warehouse_id') then
    execute 'drop trigger if exists erp_guard_purchase_item on public.erp_purchase_items';
    execute 'create trigger erp_guard_purchase_item before insert or update or delete on public.erp_purchase_items
               for each row execute function public.erp_guard_purchase_item()';
  end if;
end $$;

-- Lista de facturas: la madre ve todas; un punto ve las de sus puntos.
drop policy if exists erp_pur_select on public.erp_purchases;
create policy erp_pur_select on public.erp_purchases for select to authenticated
  using (public.erp_can(store_id, 'purchases') and public.erp__my_point_ok(store_id, warehouse_id));

notify pgrst, 'reload schema';
