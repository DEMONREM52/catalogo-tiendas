-- =====================================================================
-- 20261301 · Código de tienda para que el equipo entre desde la misma pantalla
--
-- Pedido del usuario (2026-11-08): un solo inicio de sesión. El dueño entra con correo; el equipo toca
-- «Equipo», escribe el CÓDIGO DE LA TIENDA (mínimo 4 dígitos) y luego su usuario y contraseña.
--   · stores.team_code: 4 a 8 dígitos, único en toda la plataforma.
--   · erp_team_code_save: lo pone o cambia el dueño o un administrador de tienda (o «Usuarios»).
--   · El código solo identifica la tienda (nombre y logo); para entrar siguen siendo necesarios el usuario
--     y la contraseña. La búsqueda por código la hace el servidor (/api/store-team/by-code) con límite
--     de intentos por minuto; no hay lectura pública directa.
-- No borra datos. Es idempotente.
-- =====================================================================

alter table public.stores add column if not exists team_code text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'stores_team_code_digits') then
    alter table public.stores add constraint stores_team_code_digits check (team_code is null or team_code ~ '^[0-9]{4,8}$');
  end if;
end $$;
create unique index if not exists stores_team_code_unique on public.stores (team_code) where team_code is not null;

-- Leer el código de mi tienda (para Mi tienda).
create or replace function public.erp_team_code_get(p_store uuid)
returns text language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then return null; end if;
  if not (exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
          or exists (select 1 from public.store_users su where su.store_id = p_store and su.user_id = auth.uid() and su.active
                     and (su.role = 'store_admin' or 'users' = any (su.permissions) or 'store' = any (su.permissions)))) then
    return null;
  end if;
  return (select team_code from public.stores where id = p_store);
end $$;
revoke all on function public.erp_team_code_get(uuid) from public, anon;
grant execute on function public.erp_team_code_get(uuid) to authenticated;

-- Poner o cambiar el código (vacío = quitarlo).
create or replace function public.erp_team_code_save(p_store uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_code text := nullif(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'), '');
begin
  if auth.uid() is null or not (
    exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
    or exists (select 1 from public.store_users su where su.store_id = p_store and su.user_id = auth.uid() and su.active
               and (su.role = 'store_admin' or 'users' = any (su.permissions)))) then
    raise exception 'Solo el dueño o un administrador de la tienda cambia el código.';
  end if;
  if v_code is not null and v_code !~ '^[0-9]{4,8}$' then
    raise exception 'El código debe tener de 4 a 8 números.';
  end if;
  if v_code is not null and v_code ~ '^(\d)\1+$' then
    raise exception 'Usa un código menos fácil (no todos los números iguales).';
  end if;
  if v_code is not null and v_code in ('1234', '12345', '123456', '1234567', '12345678', '4321', '0123') then
    raise exception 'Ese código es muy fácil de adivinar. Usa otro.';
  end if;
  if v_code is not null and exists (select 1 from public.stores where team_code = v_code and id <> p_store) then
    raise exception 'Ese código ya lo usa otra tienda. Prueba con otro (o toca «Generar»).';
  end if;
  update public.stores set team_code = v_code where id = p_store;
  perform public.erp_audit(p_store, 'store.team_code', 'stores', p_store, jsonb_build_object('set', v_code is not null));
  return jsonb_build_object('ok', true, 'code', v_code);
end $$;
revoke all on function public.erp_team_code_save(uuid, text) from public, anon;
grant execute on function public.erp_team_code_save(uuid, text) to authenticated;

notify pgrst, 'reload schema';
