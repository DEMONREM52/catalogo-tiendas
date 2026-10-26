-- =====================================================================
-- REMHUB · Para el contador: configuración de la exportación contable
--
--   RemHub no lleva la contabilidad: arma los asientos del periodo (ventas,
--   compras, recibos, pagos, gastos y nómina) y los entrega en el formato del
--   programa del contador (Siigo, World Office, Alegra, Helisa, ContaPyme o
--   uno propio). Aquí se guarda, por tienda, lo que el contador configura una
--   vez: cuentas del PUC, medios de pago, centros de costo, códigos de
--   comprobante y formatos propios.
--   Lee y guarda quien tenga el permiso «exports» (o el dueño).
-- No borra datos. Es idempotente.
-- =====================================================================

create table if not exists public.erp_accounting_settings (
  store_id uuid primary key references public.stores(id) on delete cascade,
  config jsonb not null default '{}'::jsonb,
  updated_by uuid,
  updated_by_name text,
  updated_at timestamptz not null default now()
);
alter table public.erp_accounting_settings enable row level security;
-- Sin políticas: solo se usa por las funciones de abajo.

create or replace function public.erp__accounting_allowed(p_store uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (public.erp_can(p_store, 'exports') or exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid()))
$$;

create or replace function public.erp_accounting_settings_get(p_store uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r public.erp_accounting_settings;
begin
  if not public.erp__accounting_allowed(p_store) then
    return jsonb_build_object('ok', false, 'message', 'Necesitas el permiso de exportar datos.');
  end if;
  select * into r from public.erp_accounting_settings where store_id = p_store;
  return jsonb_build_object('ok', true, 'config', coalesce(r.config, '{}'::jsonb), 'updated_at', r.updated_at, 'updated_by_name', r.updated_by_name);
end;
$$;

create or replace function public.erp_accounting_settings_save(p_store uuid, p_config jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.erp__accounting_allowed(p_store) then
    return jsonb_build_object('ok', false, 'message', 'Necesitas el permiso de exportar datos.');
  end if;
  if jsonb_typeof(coalesce(p_config, 'null')) <> 'object' then
    return jsonb_build_object('ok', false, 'message', 'La configuración no es válida.');
  end if;
  if octet_length(p_config::text) > 200000 then
    return jsonb_build_object('ok', false, 'message', 'La configuración es demasiado grande.');
  end if;
  insert into public.erp_accounting_settings (store_id, config, updated_by, updated_by_name, updated_at)
  values (p_store, p_config, auth.uid(), public.erp_actor_name(p_store), now())
  on conflict (store_id) do update set config = excluded.config, updated_by = excluded.updated_by, updated_by_name = excluded.updated_by_name, updated_at = now();
  perform public.erp_audit(p_store, 'accounting.settings', 'erp_accounting_settings', null, jsonb_build_object('format', p_config->>'format'));
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.erp__accounting_allowed(uuid) from public, anon;
revoke all on function public.erp_accounting_settings_get(uuid) from public, anon;
revoke all on function public.erp_accounting_settings_save(uuid, jsonb) from public, anon;
grant execute on function public.erp__accounting_allowed(uuid) to authenticated;
grant execute on function public.erp_accounting_settings_get(uuid) to authenticated;
grant execute on function public.erp_accounting_settings_save(uuid, jsonb) to authenticated;
