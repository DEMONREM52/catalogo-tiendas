-- =====================================================================
-- REMHUB · Nombre propio para los puntos de Cliente fiel
--
--   Cada tienda le pone nombre a su programa («Puntos La Vitrina») y a la
--   unidad («puntos», «estrellas», «vitricoins»). Cada punto de venta puede
--   tener su propio nombre (vacío = el general). El saldo del cliente es el
--   mismo en todos los puntos: solo cambia cómo se llama.
--
--   · erp_loyalty_settings: program_name, unit_name.
--   · erp_loyalty_point_rules: program_name (opcional, por punto).
--   · erp_loyalty_brand(store, point): el nombre que se muestra en ese punto.
-- No borra datos. Es idempotente.
-- =====================================================================

alter table public.erp_loyalty_settings add column if not exists program_name text;
alter table public.erp_loyalty_settings add column if not exists unit_name text;
alter table public.erp_loyalty_point_rules add column if not exists program_name text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'erp_loyalty_settings_names_len') then
    alter table public.erp_loyalty_settings add constraint erp_loyalty_settings_names_len
      check (char_length(coalesce(program_name, '')) <= 40 and char_length(coalesce(unit_name, '')) <= 20);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'erp_loyalty_point_rules_name_len') then
    alter table public.erp_loyalty_point_rules add constraint erp_loyalty_point_rules_name_len
      check (char_length(coalesce(program_name, '')) <= 40);
  end if;
end $$;

-- Texto limpio: sin espacios de más; vacío = sin nombre propio.
create or replace function public.erp__loyalty_label(p text, p_max integer)
returns text language sql immutable as $$
  select nullif(left(btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g')), p_max), '');
$$;

create or replace function public.erp_loyalty_settings_get(p_store uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.erp__is_store_member(p_store) then null else
    coalesce((select to_jsonb(s) - 'store_id' from public.erp_loyalty_settings s where s.store_id = p_store),
             jsonb_build_object('enabled', false, 'pesos_per_point', 1000, 'point_value', 10, 'min_redeem', 100, 'program_name', null, 'unit_name', null)) end;
$$;
revoke all on function public.erp_loyalty_settings_get(uuid) from public, anon;
grant execute on function public.erp_loyalty_settings_get(uuid) to authenticated;

-- Igual que en 20261229, más el nombre del programa y de la unidad (si no vienen, se dejan como estaban).
create or replace function public.erp_loyalty_settings_save(p_store uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (public.erp_can(p_store, 'store') or public.erp_can(p_store, 'price_approve')) then return jsonb_build_object('ok', false, 'error', 'Sin permiso.'); end if;
  insert into public.erp_loyalty_settings (store_id, enabled, pesos_per_point, point_value, min_redeem, since, program_name, unit_name)
  values (p_store, coalesce((p->>'enabled')::boolean, false), coalesce((p->>'pesos_per_point')::integer, 1000), coalesce((p->>'point_value')::numeric, 10), coalesce((p->>'min_redeem')::integer, 100), now(),
          public.erp__loyalty_label(p->>'program_name', 40), public.erp__loyalty_label(p->>'unit_name', 20))
  on conflict (store_id) do update set enabled = excluded.enabled, pesos_per_point = excluded.pesos_per_point, point_value = excluded.point_value,
    min_redeem = excluded.min_redeem, updated_at = now(),
    program_name = case when p ? 'program_name' then excluded.program_name else public.erp_loyalty_settings.program_name end,
    unit_name = case when p ? 'unit_name' then excluded.unit_name else public.erp_loyalty_settings.unit_name end,
    since = case when not public.erp_loyalty_settings.enabled and excluded.enabled then now() else public.erp_loyalty_settings.since end;
  return jsonb_build_object('ok', true);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;
revoke all on function public.erp_loyalty_settings_save(uuid, jsonb) from public, anon;
grant execute on function public.erp_loyalty_settings_save(uuid, jsonb) to authenticated;

create or replace function public.erp_loyalty_point_rules_get(p_store uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.erp__is_store_member(p_store) then '[]'::jsonb else
    coalesce(jsonb_agg(jsonb_build_object('point_id', w.id, 'point', w.name, 'earns', coalesce(r.earns, true), 'pesos_per_point', r.pesos_per_point,
      'program_name', r.program_name) order by w.name), '[]'::jsonb) end
  from public.erp_warehouses w
  left join public.erp_loyalty_point_rules r on r.store_id = p_store and r.point_id = w.id
  where w.store_id = p_store and w.active;
$$;
revoke all on function public.erp_loyalty_point_rules_get(uuid) from public, anon;
grant execute on function public.erp_loyalty_point_rules_get(uuid) to authenticated;

create or replace function public.erp_loyalty_point_rules_save(p_store uuid, p_rules jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare it jsonb;
begin
  if not public.erp__loyalty_admin(p_store) then return jsonb_build_object('ok', false, 'error', 'Sin permiso.'); end if;
  for it in select * from jsonb_array_elements(coalesce(p_rules, '[]'::jsonb)) loop
    if not exists (select 1 from public.erp_warehouses w where w.id = (it->>'point_id')::uuid and w.store_id = p_store) then continue; end if;
    insert into public.erp_loyalty_point_rules (store_id, point_id, earns, pesos_per_point, program_name)
    values (p_store, (it->>'point_id')::uuid, coalesce((it->>'earns')::boolean, true), nullif(it->>'pesos_per_point', '')::integer, public.erp__loyalty_label(it->>'program_name', 40))
    on conflict (store_id, point_id) do update set earns = excluded.earns, pesos_per_point = excluded.pesos_per_point, updated_at = now(),
      program_name = case when it ? 'program_name' then excluded.program_name else public.erp_loyalty_point_rules.program_name end;
  end loop;
  return jsonb_build_object('ok', true);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;
revoke all on function public.erp_loyalty_point_rules_save(uuid, jsonb) from public, anon;
grant execute on function public.erp_loyalty_point_rules_save(uuid, jsonb) to authenticated;

-- Cómo se llama el programa en un punto: el nombre del punto, si no el general, si no «Puntos».
create or replace function public.erp_loyalty_brand(p_store uuid, p_point uuid default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.erp__is_store_member(p_store) then null else jsonb_build_object(
    'name', coalesce(
      (select r.program_name from public.erp_loyalty_point_rules r where r.store_id = p_store and r.point_id = p_point),
      (select s.program_name from public.erp_loyalty_settings s where s.store_id = p_store),
      'Puntos'),
    'unit', coalesce((select s.unit_name from public.erp_loyalty_settings s where s.store_id = p_store), 'puntos')) end;
$$;
revoke all on function public.erp_loyalty_brand(uuid, uuid) from public, anon;
grant execute on function public.erp_loyalty_brand(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
