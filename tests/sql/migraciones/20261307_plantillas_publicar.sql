-- 20261307 · Plantillas de mensajes para publicar productos («¡Publícame!» → kit para publicar)
--
--   · erp_publish_templates: plantillas propias de cada tienda (nombre y texto con variables como {nombre},
--     {precio}, {enlace}…). Una puede quedar como la de siempre (is_default).
--   · publish_templates_list(p_store), publish_template_save(p_store, p_id, p_name, p_body, p_default),
--     publish_template_delete(p_store, p_id).
-- Permiso: «products». Máximo 30 plantillas por tienda y 4.000 letras cada una.
-- No cambia productos, precios, existencias ni permisos. Se puede correr varias veces.

create table if not exists public.erp_publish_templates (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  body text not null,
  is_default boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists erp_publish_templates_store on public.erp_publish_templates (store_id, name);
create unique index if not exists erp_publish_templates_one_default on public.erp_publish_templates (store_id) where is_default;
alter table public.erp_publish_templates enable row level security;
revoke all on public.erp_publish_templates from anon, authenticated;

create or replace function public.publish_templates_list(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.erp_can(p_store, 'products') then
    return jsonb_build_object('ok', false, 'message', 'No tienes permiso de Productos.');
  end if;
  return jsonb_build_object('ok', true, 'templates', (
    select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'body', t.body, 'is_default', t.is_default, 'updated_at', t.updated_at)
                              order by t.is_default desc, t.name), '[]'::jsonb)
    from public.erp_publish_templates t where t.store_id = p_store));
end;
$$;

create or replace function public.publish_template_save(p_store uuid, p_id uuid, p_name text, p_body text, p_default boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null or not public.erp_can(p_store, 'products') then
    return jsonb_build_object('ok', false, 'message', 'No tienes permiso de Productos.');
  end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null then
    return jsonb_build_object('ok', false, 'message', 'Ponle un nombre a la plantilla.');
  end if;
  if nullif(btrim(coalesce(p_body, '')), '') is null then
    return jsonb_build_object('ok', false, 'message', 'Escribe el mensaje.');
  end if;
  if length(p_body) > 4000 then
    return jsonb_build_object('ok', false, 'message', 'El mensaje es muy largo (máximo 4.000 letras).');
  end if;
  if p_id is null and (select count(*) from public.erp_publish_templates t where t.store_id = p_store) >= 30 then
    return jsonb_build_object('ok', false, 'message', 'Máximo 30 plantillas. Borra alguna que no uses.');
  end if;
  if coalesce(p_default, false) then
    update public.erp_publish_templates set is_default = false where store_id = p_store and is_default and id is distinct from p_id;
  end if;
  if p_id is null then
    insert into public.erp_publish_templates (store_id, name, body, is_default, created_by)
    values (p_store, left(btrim(p_name), 60), p_body, coalesce(p_default, false), auth.uid())
    returning id into v_id;
  else
    update public.erp_publish_templates set name = left(btrim(p_name), 60), body = p_body, is_default = coalesce(p_default, false), updated_at = now()
    where id = p_id and store_id = p_store returning id into v_id;
    if v_id is null then return jsonb_build_object('ok', false, 'message', 'Esa plantilla no existe.'); end if;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.publish_template_delete(p_store uuid, p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.erp_can(p_store, 'products') then
    return jsonb_build_object('ok', false, 'message', 'No tienes permiso de Productos.');
  end if;
  delete from public.erp_publish_templates where id = p_id and store_id = p_store;
  if not found then return jsonb_build_object('ok', false, 'message', 'Esa plantilla no existe.'); end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.publish_templates_list(uuid) from public, anon;
revoke all on function public.publish_template_save(uuid, uuid, text, text, boolean) from public, anon;
revoke all on function public.publish_template_delete(uuid, uuid) from public, anon;
grant execute on function public.publish_templates_list(uuid) to authenticated;
grant execute on function public.publish_template_save(uuid, uuid, text, text, boolean) to authenticated;
grant execute on function public.publish_template_delete(uuid, uuid) to authenticated;
