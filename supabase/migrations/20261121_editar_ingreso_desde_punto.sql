-- =====================================================================
-- REMHUB · Editar ingresos de factura desde un punto
--
-- Antes: «Los usuarios de punto no pueden editar ingresos de factura»,
-- aunque tuvieran el permiso «Compras».
-- Ahora: un usuario de punto con «Compras» puede editar los ingresos de
-- SU punto (cantidades, costos, IVA, proveedor, pago y bodega), pero:
--   · no puede editar ingresos de otro punto ni de la madre;
--   · cada producto editado debe seguir yendo a su punto
--     (lo exigen los controles de 20261118 sobre la factura y cada línea).
-- La madre sigue igual.
--
-- Cómo: NO se reescribe la función. Se toma la versión que hay en la base
-- y solo se cambia esa regla, para no perder nada de lo que ya tiene.
--
-- Requiere 20261118_compras_desde_punto.sql. No borra datos. Es idempotente.
-- =====================================================================

do $$
declare
  v_oid oid;
  v_def text;
  v_new text;
  v_n integer := 0;
begin
  if not exists (select 1 from pg_trigger where tgname = 'erp_guard_purchase' and not tgisinternal)
     or not exists (select 1 from pg_proc where proname = 'erp__my_point_ok') then
    raise exception 'Primero ejecuta 20261118_compras_desde_punto.sql (protege que cada punto solo toque lo suyo).';
  end if;

  for v_oid in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'erp_update_purchase'
  loop
    v_n := v_n + 1;
    v_def := pg_get_functiondef(v_oid);
    if position('Este ingreso es de otro punto' in v_def) > 0 then
      raise notice 'erp_update_purchase ya permitía editar desde el punto: sin cambios.';
      continue;
    end if;
    v_new := regexp_replace(v_def,
      'if\s+public\.erp_my_point\(\s*pu\.store_id\s*\)\s+is\s+not\s+null\s+then\s+raise\s+exception\s+''Los usuarios de punto no pueden editar ingresos de factura\.'';\s*end\s+if;',
      'if not coalesce(public.erp__my_point_ok(pu.store_id, pu.warehouse_id), false)
     or exists (select 1 from public.erp_purchase_items i
                where i.purchase_id = pu.id
                  and not coalesce(public.erp__my_point_ok(pu.store_id, coalesce(i.warehouse_id, pu.warehouse_id)), false)) then
    raise exception ''Este ingreso es de otro punto: solo lo puede editar la tienda madre.'';
  end if;',
      'i');
    if v_new = v_def then
      raise exception 'No encontré en erp_update_purchase la regla que bloquea a los puntos. No cambié nada; comparte el resultado de supabase/scripts/consulta_permisos.sql.';
    end if;
    execute v_new;
    raise notice 'erp_update_purchase: ahora los puntos pueden editar sus ingresos.';
  end loop;

  if v_n = 0 then
    raise exception 'No existe erp_update_purchase en esta base (migración 20261016). No cambié nada.';
  end if;
end $$;

notify pgrst, 'reload schema';
