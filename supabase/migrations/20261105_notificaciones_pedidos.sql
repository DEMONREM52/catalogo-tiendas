-- =====================================================================
-- REMHUB · Notificaciones y sonidos de pedidos internos
--
--   · Permiso nuevo «notifications_config»: configurar los sonidos y avisos
--     de la tienda (el dueño y los administradores de tienda ya lo tienen).
--   · erp_notification_prefs: qué tono suena en cada evento (pedido nuevo,
--     urgente, mensaje, en preparación, en camino, recibido, rechazado,
--     cancelado), por tienda y, si se quiere, distinto por punto.
--   · erp_push_subscriptions: celulares/computadores que aceptaron recibir
--     notificaciones (Web Push). Solo se guardan las llaves públicas que da
--     el navegador; nunca contraseñas.
--   · Cuando se crea un pedido, llega un mensaje o cambia el estado, la base
--     avisa a https://remhub.store/api/push/stock-requests (con pg_net) y el
--     servidor envía la notificación al otro punto. Si pg_net no está
--     disponible, todo sigue funcionando igual (solo sin notificación push).
--
-- No borra ni modifica datos existentes. Es idempotente.
-- =====================================================================

-- 1. Permisos (igual que src/lib/store-user-auth.ts).
create or replace function public.erp__known_permissions()
returns text[]
language sql
immutable
as $$
  select array[
    'store', 'billing', 'pos', 'sales_void', 'sales_return', 'clients', 'clients_delete', 'credit', 'receivables', 'users',
    'products', 'products_view', 'categories', 'orders', 'inventory', 'inventory_adjust', 'transfers', 'stock_requests',
    'stock_requests_manage', 'notifications_config', 'purchases', 'suppliers', 'payables', 'audit', 'points', 'fiscal', 'fiscal_send',
    'fiscal_notes', 'fiscal_download', 'fiscal_config', 'fiscal_numbering', 'fiscal_provider', 'fiscal_audit'
  ]::text[];
$$;

-- 2. Configuración de sonidos por tienda.
create table if not exists public.erp_notification_prefs (
  store_id uuid primary key references public.stores(id) on delete cascade,
  config jsonb not null default '{}'::jsonb,
  updated_by uuid,
  updated_by_name text,
  updated_at timestamptz not null default now()
);
alter table public.erp_notification_prefs enable row level security;
revoke all on public.erp_notification_prefs from anon, authenticated;

-- ¿Es usuario de la tienda (dueño o miembro activo)?
create or replace function public.erp__is_store_member(p_store uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
      or exists (select 1 from public.store_users su where su.store_id = p_store and su.user_id = auth.uid() and su.active);
$$;
revoke all on function public.erp__is_store_member(uuid) from public, anon;

create or replace function public.erp_notification_prefs_get(p_store uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when public.erp__is_store_member(p_store) then jsonb_build_object(
    'ok', true,
    'config', coalesce((select p.config from public.erp_notification_prefs p where p.store_id = p_store), '{}'::jsonb),
    'updated_at', (select p.updated_at from public.erp_notification_prefs p where p.store_id = p_store),
    'updated_by_name', (select p.updated_by_name from public.erp_notification_prefs p where p.store_id = p_store),
    'can_edit', public.erp_can(p_store, 'notifications_config'),
    'my_point', public.erp_my_point(p_store)
  ) else jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'No perteneces a esta tienda.') end;
$$;
grant execute on function public.erp_notification_prefs_get(uuid) to authenticated;

create or replace function public.erp_notification_prefs_save(p_store uuid, p_config jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_name text;
begin
  if not public.erp_can(p_store, 'notifications_config') then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Necesitas el permiso «Sonidos y avisos de pedidos internos».');
  end if;
  if jsonb_typeof(p_config) <> 'object' or length(p_config::text) > 40000 then
    return jsonb_build_object('ok', false, 'code', 'INVALID', 'message', 'La configuración no es válida.');
  end if;
  select coalesce(nullif(trim(su.display_name), ''), su.username) into v_name
  from public.store_users su where su.store_id = p_store and su.user_id = auth.uid();
  insert into public.erp_notification_prefs (store_id, config, updated_by, updated_by_name, updated_at)
  values (p_store, p_config, auth.uid(), coalesce(v_name, 'Dueño'), now())
  on conflict (store_id) do update set config = excluded.config, updated_by = excluded.updated_by,
    updated_by_name = excluded.updated_by_name, updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function public.erp_notification_prefs_save(uuid, jsonb) to authenticated;

-- 3. Equipos suscritos a notificaciones (Web Push).
create table if not exists public.erp_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  failures integer not null default 0,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists erp_push_subscriptions_user on public.erp_push_subscriptions (store_id, user_id);
alter table public.erp_push_subscriptions enable row level security;
revoke all on public.erp_push_subscriptions from anon, authenticated;

create or replace function public.erp_push_subscribe(p_store uuid, p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.erp__is_store_member(p_store) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'No perteneces a esta tienda.');
  end if;
  if coalesce(p_endpoint, '') !~ '^https://' or length(p_endpoint) > 1000 or length(coalesce(p_p256dh, '')) < 20 or length(coalesce(p_auth, '')) < 8 then
    return jsonb_build_object('ok', false, 'code', 'INVALID', 'message', 'Suscripción no válida.');
  end if;
  insert into public.erp_push_subscriptions (store_id, user_id, endpoint, p256dh, auth, user_agent)
  values (p_store, auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update set store_id = excluded.store_id, user_id = excluded.user_id, p256dh = excluded.p256dh,
    auth = excluded.auth, user_agent = excluded.user_agent, failures = 0;
  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function public.erp_push_subscribe(uuid, text, text, text, text) to authenticated;

create or replace function public.erp_push_unsubscribe(p_endpoint text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with d as (delete from public.erp_push_subscriptions where endpoint = p_endpoint and user_id = auth.uid() returning 1)
  select jsonb_build_object('ok', true, 'removed', (select count(*) from d));
$$;
grant execute on function public.erp_push_unsubscribe(text) to authenticated;

-- 4. Registro para no enviar dos veces la misma notificación.
create table if not exists public.erp_push_log (
  key text primary key,
  created_at timestamptz not null default now()
);
alter table public.erp_push_log enable row level security;
revoke all on public.erp_push_log from anon, authenticated;

-- 5. Aviso al servidor (pg_net) cuando pasa algo en un pedido interno.
create table if not exists public.app_private_config (
  key text primary key,
  value text not null
);
alter table public.app_private_config enable row level security;
revoke all on public.app_private_config from anon, authenticated;
insert into public.app_private_config (key, value)
values ('push_webhook_url', 'https://remhub.store/api/push/stock-requests')
on conflict (key) do nothing;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    begin
      create extension pg_net;
    exception when others then
      raise notice 'pg_net no está disponible: los sonidos dentro de la app funcionan, pero sin notificación push del celular.';
    end;
  end if;
end $$;

create or replace function public.erp__push_dispatch(p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_url text;
begin
  select value into v_url from public.app_private_config where key = 'push_webhook_url';
  if coalesce(v_url, '') = '' or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then return; end if;
  begin
    -- Asíncrono: no frena el pedido ni el mensaje. Si falla, el pedido sigue normal.
    execute 'select net.http_post(url := $1, body := $2, headers := $3)'
      using v_url, p_payload, jsonb_build_object('Content-Type', 'application/json');
  exception when others then
    null;
  end;
end;
$$;
revoke all on function public.erp__push_dispatch(jsonb) from public, anon, authenticated;

create or replace function public.erp_stock_requests__push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.erp__push_dispatch(jsonb_build_object('type', 'request', 'id', new.id));
  elsif new.status is distinct from old.status then
    perform public.erp__push_dispatch(jsonb_build_object('type', 'status', 'id', new.id, 'status', new.status));
  end if;
  return null;
end;
$$;
drop trigger if exists erp_stock_requests_push on public.erp_stock_requests;
create trigger erp_stock_requests_push after insert or update of status on public.erp_stock_requests
for each row execute function public.erp_stock_requests__push();

create or replace function public.erp_stock_request_messages__push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind = 'message' then
    perform public.erp__push_dispatch(jsonb_build_object('type', 'message', 'id', new.id));
  end if;
  return null;
end;
$$;
drop trigger if exists erp_stock_request_messages_push on public.erp_stock_request_messages;
create trigger erp_stock_request_messages_push after insert on public.erp_stock_request_messages
for each row execute function public.erp_stock_request_messages__push();

-- 6. Tiempo real para que el sonido suene al instante dentro de la app (si aún no estaba activo).
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['erp_stock_requests', 'erp_stock_request_messages'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

notify pgrst, 'reload schema';
