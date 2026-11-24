-- Activa TODOS los productos inactivos de LA VITRINA (solo esa tienda).
-- Córrelo en Supabase → SQL Editor. Es UNA sola instrucción: se hace completa o no se hace nada.
--
-- · Activa los desactivados a mano y los que el sistema desactivó por quedar sin unidades.
-- · Al activarlos se quita la marca «desactivado por falta de unidades» (igual que al activarlo desde la app).
--   Si después un producto que tenía unidades se queda en 0 en todos lados, el sistema lo vuelve a desactivar solo.
-- · Los catálogos siguen sin mostrar lo que no tiene unidades.
-- · No cambia precios, existencias ni permisos. Cada producto queda en la auditoría de la tienda (la base lo registra sola).
-- · Si no hay exactamente una tienda llamada LA VITRINA, no cambia nada (tienda_encontrada = false).
-- Al final muestra cuántos se activaron.

with tienda as (
  select id from public.stores where name ilike 'la vitrina'
  and (select count(*) from public.stores where name ilike 'la vitrina') = 1
),
antes as (
  select p.id, coalesce(p.auto_inactive, false) as era_automatico, coalesce(p.stock, 0) as unidades
  from public.products p
  join tienda t on t.id = p.store_id
  where p.active is false
),
activados as (
  update public.products p set active = true
  from antes a
  where p.id = a.id and p.active is false
  returning p.id
)
select exists (select 1 from tienda) as tienda_encontrada,
       count(*) as activados,
       count(*) filter (where not a.era_automatico) as estaban_inactivos_a_mano,
       count(*) filter (where a.era_automatico) as los_habia_desactivado_el_sistema,
       count(*) filter (where a.unidades <= 0) as sin_unidades_no_salen_en_catalogos
from activados x
join antes a on a.id = x.id;
