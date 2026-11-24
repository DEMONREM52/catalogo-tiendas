-- Activa TODOS los productos inactivos de LA VITRINA (solo esa tienda).
-- Córrelo en Supabase → SQL Editor (todo junto). Todo o nada: si algo falla no se guarda nada.
--
-- · Activa los desactivados a mano y los que el sistema desactivó por quedar sin unidades.
-- · Al activarlos se quita la marca «desactivado por falta de unidades» (igual que al activarlo desde la app).
--   Si después un producto que tenía unidades se queda en 0 en todos lados, el sistema lo vuelve a desactivar solo.
-- · Los catálogos siguen sin mostrar lo que no tiene unidades.
-- · No cambia precios, existencias ni permisos. Queda en la auditoría de la tienda.
-- Al final muestra cuántos se activaron.

begin;

create temp table _activados on commit drop as
select p.id, p.name, coalesce(p.auto_inactive, false) as era_automatico, coalesce(p.stock, 0) as unidades
from public.products p
where p.store_id = (select id from public.stores where name ilike 'la vitrina')
  and p.active is false;

do $$
declare
  v_store uuid;
  v_n integer;
begin
  if (select count(*) from public.stores where name ilike 'la vitrina') <> 1 then
    raise exception 'No encontré una sola tienda llamada LA VITRINA: no se cambió nada.';
  end if;
  select id into v_store from public.stores where name ilike 'la vitrina';

  update public.products p set active = true
  from _activados a
  where p.id = a.id and p.store_id = v_store and p.active is false;
  get diagnostics v_n = row_count;

  begin
    perform public.erp_audit(v_store, 'products.bulk_activate', 'products', null,
      jsonb_build_object('activados', v_n, 'origen', 'script activar_productos_inactivos.sql'));
  exception when others then null;
  end;
  raise notice 'Productos activados: %', v_n;
end $$;

select count(*) as activados,
       count(*) filter (where not era_automatico) as estaban_inactivos_a_mano,
       count(*) filter (where era_automatico) as los_habia_desactivado_el_sistema,
       count(*) filter (where unidades <= 0) as sin_unidades_no_salen_en_catalogos,
       (select count(*) from public.products p
         where p.store_id = (select id from public.stores where name ilike 'la vitrina') and p.active is false) as siguen_inactivos
from _activados;

commit;
