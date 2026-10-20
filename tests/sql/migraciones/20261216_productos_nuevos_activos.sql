-- =====================================================================
-- REMHUB · Los productos nuevos se quedan ACTIVOS (aunque no tengan unidades)
--
-- Algo en la base de producción desactiva productos recién creados que
-- todavía no tienen unidades. Esta migración lo impide sin importar qué sea:
--
--  1. Al CREAR: se guarda lo que eligió la persona (Activo sí/no) y, después
--     de todos los demás procesos, se vuelve a poner. Si lo creó activo,
--     queda activo.
--  2. Después: ningún proceso automático de la base puede desactivar un
--     producto que ya estaba en 0 unidades. Solo la persona (desde la app)
--     lo desactiva, o el sistema cuando SE QUEDA sin unidades después de
--     haber tenido (20261210).
--  3. Al final muestra qué activadores de la tabla products tocan «active»,
--     para saber cuál era el culpable.
--
-- Los catálogos siguen sin mostrar productos sin unidades.
-- No cambia productos existentes. Idempotente.
-- =====================================================================

-- 1. Se recuerda lo que pidió la persona al crear (corre primero: «aaa…»).
create or replace function public.products__remember_new_active()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform set_config('remhub.new_active', case when new.active is false then 'false' else 'true' end, true);
  return new;
end $$;
drop trigger if exists aaa_products_remember_new_active on public.products;
create trigger aaa_products_remember_new_active before insert on public.products
  for each row execute function public.products__remember_new_active();

-- 2. …y se respeta al final (corre de último: «zzz…»).
create or replace function public.products__keep_active()
returns trigger
language plpgsql
set search_path = public
as $$
declare v_wanted text;
begin
  if tg_op = 'INSERT' then
    v_wanted := current_setting('remhub.new_active', true);
    if v_wanted = 'true' then new.active := true; end if;
    perform set_config('remhub.new_active', '', true);
    return new;
  end if;
  -- Un proceso automático (no la persona desde la app) quiso desactivar un producto que ya estaba sin unidades: no se deja.
  if current_user <> 'authenticated' and coalesce(old.active, true) and new.active is false
     and coalesce(old.stock, 0) <= 0 and coalesce(new.stock, 0) <= 0 then
    new.active := true;
    if to_jsonb(new) ? 'auto_inactive' then
      new := jsonb_populate_record(new, jsonb_build_object('auto_inactive', false, 'auto_inactive_at', null));
    end if;
  end if;
  return new;
end $$;
drop trigger if exists zzz_products_keep_active on public.products;
create trigger zzz_products_keep_active before insert or update on public.products
  for each row execute function public.products__keep_active();

notify pgrst, 'reload schema';

-- 3. ¿Quién tocaba «active»? (lista para revisar; no cambia nada)
select t.tgname as activador,
       p.proname as funcion,
       case when t.tgtype & 2 = 2 then 'antes' else 'después' end as momento,
       position('active' in pg_get_functiondef(p.oid)) > 0 as menciona_active
from pg_trigger t
join pg_proc p on p.oid = t.tgfoid
where t.tgrelid = 'public.products'::regclass and not t.tgisinternal
order by t.tgname;
