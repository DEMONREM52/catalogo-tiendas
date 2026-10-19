-- =====================================================================
-- REMHUB · Productos activos según sus unidades
--
-- · Un producto NUEVO queda activo aunque todavía no tenga unidades
--   (los catálogos igual no muestran lo que no tiene unidades).
-- · Cuando un producto que SÍ tenía unidades se queda en 0 en TODAS las
--   bodegas y puntos (y no hay traslados en camino con él), se desactiva
--   solo y queda marcado «desactivado por falta de unidades».
-- · Si después le vuelven a entrar unidades (ingreso de factura, ajuste,
--   devolución), se vuelve a activar solo — pero SOLO si lo desactivó el
--   sistema. Si una persona lo desactivó a mano, se queda inactivo.
-- · Si una persona lo activa a mano, se quita la marca automática.
-- · Productos sin control de inventario (unidades ilimitadas) no se tocan.
--
-- No cambia los productos que ya existen. Es idempotente.
-- =====================================================================

alter table public.products add column if not exists auto_inactive boolean not null default false;
alter table public.products add column if not exists auto_inactive_at timestamptz;
grant select (auto_inactive, auto_inactive_at) on public.products to authenticated;

create or replace function public.erp__products_active_by_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tracked boolean := coalesce((to_jsonb(new) ->> 'track_inventory')::boolean, true);
begin
  -- Activado o desactivado a mano: manda la persona.
  if new.active is distinct from old.active then
    new.auto_inactive := false;
    new.auto_inactive_at := null;
    return new;
  end if;
  if new.stock is null or not v_tracked then return new; end if;

  -- Se quedó sin unidades en todos lados (antes tenía): se desactiva solo.
  if coalesce(old.stock, 0) > 0 and new.stock <= 0 and new.active
     and not exists (select 1 from public.erp_transfer_items i join public.erp_transfers t on t.id = i.transfer_id
                     where i.product_id = new.id and t.status = 'in_transit') then
    new.active := false;
    new.auto_inactive := true;
    new.auto_inactive_at := now();
  -- Le volvieron a entrar unidades y lo había desactivado el sistema: se activa solo.
  elsif new.stock > 0 and not new.active and new.auto_inactive then
    new.active := true;
    new.auto_inactive := false;
    new.auto_inactive_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists erp_products_active_by_stock on public.products;
create trigger erp_products_active_by_stock before update of stock, active on public.products
  for each row execute function public.erp__products_active_by_stock();

-- El buscador de productos del panel (ingreso de factura, POS, traslados, ajustes) también encuentra
-- los desactivados por falta de unidades: así se pueden volver a comprar (salen como agotados).
do $$
declare f record; v_def text; v_new text;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'erp_search_products' loop
    v_def := pg_get_functiondef(f.sig);
    if position('p.auto_inactive' in v_def) > 0 then continue; end if;
    v_new := replace(v_def, 'where p.store_id = p_store and coalesce(p.active, true)',
                            'where p.store_id = p_store and (coalesce(p.active, true) or p.auto_inactive)');
    if v_new = v_def then
      raise notice 'erp_search_products (%): no se encontró el filtro de activos; queda igual.', f.sig;
    else
      execute v_new;
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
