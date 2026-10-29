-- =====================================================================
-- REMHUB · Llamadas solo a los involucrados y mensajes directos (sobre 20261269)
--
-- 1. Llamadas de un pedido: ya no timbran a todo el punto. Por defecto a los
--    involucrados (quien pidió, quien atiende y quienes escribieron en el
--    pedido); o a las personas que se escojan de erp_call_candidates.
-- 2. Mensajes directos entre el equipo, sin necesidad de un pedido:
--    chats de dos personas y grupos, con fotos, videos y audios
--    (chat-media/<tienda>/dm/<chat>/…) y llamadas o videollamadas.
--    · erp_dm_threads / erp_dm_members / erp_dm_messages (cada uno solo ve
--      sus chats; mensajes en vivo con Realtime).
--    · erp_dm_people, erp_dm_open, erp_dm_group_create, erp_dm_list,
--      erp_dm_messages, erp_dm_send, erp_dm_read, erp_call_start_dm.
-- No borra datos. Es idempotente.
-- =====================================================================

-- ---------------------------------------------------------------- 1. llamadas del pedido
-- ¿Participa esta persona en el pedido? (lo pidió, lo atiende o escribió en él)
create or replace function public.erp__sr_involved(p_request uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.erp_stock_requests r, lateral (select to_jsonb(r) j) x
                 where r.id = p_request and (x.j ->> 'requested_by' = p_user::text or x.j ->> 'handled_by' = p_user::text))
      or exists (select 1 from public.erp_stock_request_messages m where m.request_id = p_request and m.user_id = p_user and m.kind = 'message');
$$;
revoke all on function public.erp__sr_involved(uuid, uuid) from public, anon, authenticated;

-- Punto del otro lado del pedido (al que se llama).
create or replace function public.erp__sr_other_point(p_request uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select case when public.erp__scope_ok(r.store_id, r.from_point_id) and not public.erp__scope_ok(r.store_id, r.to_point_id)
              then r.to_point_id else r.from_point_id end
  from public.erp_stock_requests r where r.id = p_request;
$$;
revoke all on function public.erp__sr_other_point(uuid) from public, anon, authenticated;

/** A quién se puede llamar desde un pedido: los involucrados primero y la gente del otro punto. */
create or replace function public.erp_call_candidates(p_request uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r public.erp_stock_requests; v_target uuid;
begin
  select * into r from public.erp_stock_requests where id = p_request;
  if r.id is null or not public.erp__sr_visible(p_request) then raise exception 'No tienes acceso a este pedido.'; end if;
  v_target := public.erp__sr_other_point(p_request);
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', m.u, 'name', public.erp__member_name(r.store_id, m.u),
             'point', (select w.name from public.store_users su join public.erp_warehouses w on w.id::text = to_jsonb(su) ->> 'point_id' where su.store_id = r.store_id and su.user_id = m.u),
             'involved', public.erp__sr_involved(p_request, m.u)) order by public.erp__sr_involved(p_request, m.u) desc, public.erp__member_name(r.store_id, m.u))
    from (select su.user_id u from public.store_users su where su.store_id = r.store_id
          union select s.owner_id from public.stores s where s.id = r.store_id) m
    where m.u <> auth.uid() and (public.erp__sr_involved(p_request, m.u) or public.erp__member_covers(r.store_id, m.u, v_target))
  ), '[]'::jsonb);
end $$;
revoke all on function public.erp_call_candidates(uuid) from public, anon;
grant execute on function public.erp_call_candidates(uuid) to authenticated;

drop function if exists public.erp_call_start(uuid, boolean, jsonb);
/** Llama desde un pedido. p_to = a quiénes (de erp_call_candidates); sin p_to, a los involucrados. */
create or replace function public.erp_call_start(p_request uuid, p_video boolean, p_offer jsonb, p_to uuid[] default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.erp_stock_requests; v_id uuid; v_target uuid; v_invited uuid[];
begin
  if auth.uid() is null then raise exception 'Inicia sesión.'; end if;
  select * into r from public.erp_stock_requests where id = p_request;
  if r.id is null or not public.erp__sr_visible(p_request) then raise exception 'No tienes acceso a este pedido.'; end if;
  if p_offer is null or p_offer ->> 'type' <> 'offer' or char_length(coalesce(p_offer ->> 'sdp', '')) < 20 then raise exception 'No se pudo preparar la llamada.'; end if;
  v_target := public.erp__sr_other_point(p_request);
  if coalesce(cardinality(p_to), 0) > 0 then
    -- Solo personas que se pueden llamar desde este pedido.
    select array_agg(distinct u) into v_invited from unnest(p_to) u
    where u <> auth.uid() and (public.erp__sr_involved(p_request, u) or public.erp__member_covers(r.store_id, u, v_target));
  else
    select array_agg(distinct u) into v_invited from (
      select su.user_id u from public.store_users su where su.store_id = r.store_id
      union select s.owner_id from public.stores s where s.id = r.store_id
    ) m where u <> auth.uid() and public.erp__sr_involved(p_request, u);
  end if;
  if coalesce(cardinality(v_invited), 0) = 0 then raise exception 'Escoge a quién llamar.'; end if;
  update public.erp_calls set status = 'missed', ended_at = now(), ended_reason = 'nueva llamada' where caller_id = auth.uid() and status = 'ringing';
  insert into public.erp_calls (store_id, request_id, caller_id, caller_name, video, offer)
  values (r.store_id, r.id, auth.uid(), public.erp__member_name(r.store_id, auth.uid()), coalesce(p_video, false), p_offer)
  returning id into v_id;
  insert into public.erp_call_invites (call_id, user_id) select v_id, unnest(v_invited);
  return jsonb_build_object('ok', true, 'id', v_id, 'invited', to_jsonb(v_invited));
end $$;
revoke all on function public.erp_call_start(uuid, boolean, jsonb, uuid[]) from public, anon;
grant execute on function public.erp_call_start(uuid, boolean, jsonb, uuid[]) to authenticated;

-- ---------------------------------------------------------------- 2. mensajes directos
create table if not exists public.erp_dm_threads (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  kind text not null default 'direct' check (kind in ('direct', 'group')),
  title text,
  direct_key text unique,
  created_by uuid,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create table if not exists public.erp_dm_members (
  thread_id uuid not null references public.erp_dm_threads(id) on delete cascade,
  user_id uuid not null,
  last_read_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);
create index if not exists erp_dm_members_user on public.erp_dm_members (user_id);
create table if not exists public.erp_dm_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.erp_dm_threads(id) on delete cascade,
  store_id uuid not null,
  user_id uuid,
  user_name text,
  body text not null,
  kind text not null default 'message' check (kind in ('message', 'system')),
  attachments jsonb,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists erp_dm_messages_thread on public.erp_dm_messages (thread_id, created_at desc);

alter table public.erp_calls add column if not exists thread_id uuid references public.erp_dm_threads(id) on delete set null;

-- ¿El usuario actual está en ese chat? (y sigue en la tienda)
create or replace function public.erp__dm_member(p_thread uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.erp_dm_members m join public.erp_dm_threads t on t.id = m.thread_id
                 where m.thread_id = p_thread and m.user_id = auth.uid() and public.erp__is_store_member(t.store_id));
$$;
revoke all on function public.erp__dm_member(uuid) from public, anon;
grant execute on function public.erp__dm_member(uuid) to authenticated;

-- ¿Ese usuario es de la tienda (activo o dueño)?
create or replace function public.erp__store_user_ok(p_store uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.stores s where s.id = p_store and s.owner_id = p_user)
      or exists (select 1 from public.store_users su where su.store_id = p_store and su.user_id = p_user and coalesce((to_jsonb(su) ->> 'active')::boolean, true));
$$;
revoke all on function public.erp__store_user_ok(uuid, uuid) from public, anon, authenticated;

alter table public.erp_dm_threads enable row level security;
alter table public.erp_dm_members enable row level security;
alter table public.erp_dm_messages enable row level security;
revoke all on public.erp_dm_threads, public.erp_dm_members, public.erp_dm_messages from anon, authenticated;
grant select on public.erp_dm_threads, public.erp_dm_members, public.erp_dm_messages to authenticated;
drop policy if exists erp_dm_threads_read on public.erp_dm_threads;
create policy erp_dm_threads_read on public.erp_dm_threads for select to authenticated using (public.erp__dm_member(id));
drop policy if exists erp_dm_members_read on public.erp_dm_members;
create policy erp_dm_members_read on public.erp_dm_members for select to authenticated using (public.erp__dm_member(thread_id));
drop policy if exists erp_dm_messages_read on public.erp_dm_messages;
create policy erp_dm_messages_read on public.erp_dm_messages for select to authenticated using (public.erp__dm_member(thread_id));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'erp_dm_messages') then
    execute 'alter publication supabase_realtime add table public.erp_dm_messages';
  end if;
end $$;

-- Archivos de los chats: chat-media/<tienda>/dm/<chat>/<archivo>.
create or replace function public.erp__dm_media_ok(p_store text, p_dm text, p_thread text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if p_dm is distinct from 'dm' or coalesce(p_store, '') !~* re or coalesce(p_thread, '') !~* re then return false; end if;
  return exists (select 1 from public.erp_dm_threads t where t.id = p_thread::uuid and t.store_id = p_store::uuid) and public.erp__dm_member(p_thread::uuid);
end $$;
revoke all on function public.erp__dm_media_ok(text, text, text) from public, anon;
grant execute on function public.erp__dm_media_ok(text, text, text) to authenticated;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    execute 'drop policy if exists chat_media_dm_select on storage.objects';
    execute 'drop policy if exists chat_media_dm_insert on storage.objects';
    execute $p$create policy chat_media_dm_select on storage.objects for select to authenticated using (
      bucket_id = 'chat-media' and public.erp__dm_media_ok((storage.foldername(name))[1], (storage.foldername(name))[2], (storage.foldername(name))[3]))$p$;
    execute $p$create policy chat_media_dm_insert on storage.objects for insert to authenticated with check (
      bucket_id = 'chat-media' and public.erp__dm_media_ok((storage.foldername(name))[1], (storage.foldername(name))[2], (storage.foldername(name))[3]))$p$;
  end if;
end $$;

/** El equipo de la tienda (para empezar un chat): nombre, punto y rol. */
create or replace function public.erp_dm_people(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.erp__is_store_member(p_store) then raise exception 'No tienes acceso a esta tienda.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', m.u, 'name', public.erp__member_name(p_store, m.u),
             'point', (select w.name from public.store_users su join public.erp_warehouses w on w.id::text = to_jsonb(su) ->> 'point_id' where su.store_id = p_store and su.user_id = m.u),
             'owner', exists (select 1 from public.stores s where s.id = p_store and s.owner_id = m.u)) order by public.erp__member_name(p_store, m.u))
    from (select su.user_id u from public.store_users su where su.store_id = p_store and coalesce((to_jsonb(su) ->> 'active')::boolean, true)
          union select s.owner_id from public.stores s where s.id = p_store) m
    where m.u <> auth.uid()
  ), '[]'::jsonb);
end $$;
revoke all on function public.erp_dm_people(uuid) from public, anon;
grant execute on function public.erp_dm_people(uuid) to authenticated;

/** Abre (o crea) el chat de dos personas. */
create or replace function public.erp_dm_open(p_store uuid, p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_key text; v_id uuid;
begin
  if not public.erp__is_store_member(p_store) then raise exception 'No tienes acceso a esta tienda.'; end if;
  if p_user is null or p_user = auth.uid() or not public.erp__store_user_ok(p_store, p_user) then raise exception 'Esa persona no es de la tienda.'; end if;
  v_key := p_store::text || ':' || least(auth.uid()::text, p_user::text) || ':' || greatest(auth.uid()::text, p_user::text);
  select id into v_id from public.erp_dm_threads where direct_key = v_key;
  if v_id is null then
    insert into public.erp_dm_threads (store_id, kind, direct_key, created_by) values (p_store, 'direct', v_key, auth.uid())
    on conflict (direct_key) do nothing returning id into v_id;
    if v_id is null then select id into v_id from public.erp_dm_threads where direct_key = v_key; end if;
    insert into public.erp_dm_members (thread_id, user_id) values (v_id, auth.uid()), (v_id, p_user) on conflict do nothing;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function public.erp_dm_open(uuid, uuid) from public, anon;
grant execute on function public.erp_dm_open(uuid, uuid) to authenticated;

/** Crea un grupo con varias personas de la tienda. */
create or replace function public.erp_dm_group_create(p_store uuid, p_title text, p_users uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_title text := left(nullif(btrim(coalesce(p_title, '')), ''), 60); v_users uuid[];
begin
  if not public.erp__is_store_member(p_store) then raise exception 'No tienes acceso a esta tienda.'; end if;
  select array_agg(distinct u) into v_users from unnest(p_users) u where u <> auth.uid() and public.erp__store_user_ok(p_store, u);
  if coalesce(cardinality(v_users), 0) < 2 then raise exception 'Escoge al menos dos personas para el grupo.'; end if;
  if v_title is null then raise exception 'Ponle un nombre al grupo.'; end if;
  insert into public.erp_dm_threads (store_id, kind, title, created_by) values (p_store, 'group', v_title, auth.uid()) returning id into v_id;
  insert into public.erp_dm_members (thread_id, user_id) select v_id, unnest(v_users || auth.uid());
  insert into public.erp_dm_messages (thread_id, store_id, user_id, user_name, body, kind)
  values (v_id, p_store, null, null, public.erp__member_name(p_store, auth.uid()) || ' creó el grupo «' || v_title || '»', 'system');
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function public.erp_dm_group_create(uuid, text, uuid[]) from public, anon;
grant execute on function public.erp_dm_group_create(uuid, text, uuid[]) to authenticated;

/** Mis chats de la tienda: con quién, último mensaje y cuántos sin leer. */
create or replace function public.erp_dm_list(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.erp__is_store_member(p_store) then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(x order by x ->> 'last_at' desc) from (
      select jsonb_build_object(
        'id', t.id, 'kind', t.kind, 'title', t.title, 'last_at', t.last_message_at,
        'members', (select jsonb_agg(jsonb_build_object('user_id', o.user_id, 'name', public.erp__member_name(p_store, o.user_id))) from public.erp_dm_members o where o.thread_id = t.id and o.user_id <> auth.uid()),
        'last', (select jsonb_build_object('body', m.body, 'user_name', m.user_name, 'mine', m.user_id = auth.uid(), 'created_at', m.created_at, 'kind', m.kind)
                 from public.erp_dm_messages m where m.thread_id = t.id order by m.created_at desc limit 1),
        'unread', (select count(*) from public.erp_dm_messages m where m.thread_id = t.id and m.created_at > me.last_read_at and m.user_id is distinct from auth.uid())
      ) x
      from public.erp_dm_threads t join public.erp_dm_members me on me.thread_id = t.id and me.user_id = auth.uid()
      where t.store_id = p_store
    ) s
  ), '[]'::jsonb);
end $$;
revoke all on function public.erp_dm_list(uuid) from public, anon;
grant execute on function public.erp_dm_list(uuid) to authenticated;

/** Mensajes de un chat (los más recientes; p_before para cargar más viejos), del más viejo al más nuevo. */
create or replace function public.erp_dm_messages(p_thread uuid, p_before timestamptz default null, p_limit int default 60)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.erp__dm_member(p_thread) then raise exception 'No estás en este chat.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', m.id, 'user_id', m.user_id, 'user_name', m.user_name, 'body', m.body, 'kind', m.kind,
             'attachments', m.attachments, 'created_at', m.created_at, 'mine', m.user_id = auth.uid()) order by m.created_at)
    from (select * from public.erp_dm_messages where thread_id = p_thread and (p_before is null or created_at < p_before)
          order by created_at desc limit least(greatest(coalesce(p_limit, 60), 1), 200)) m
  ), '[]'::jsonb);
end $$;
revoke all on function public.erp_dm_messages(uuid, timestamptz, int) from public, anon;
grant execute on function public.erp_dm_messages(uuid, timestamptz, int) to authenticated;

/** Envía un mensaje (texto y/o archivos). Devuelve a quiénes avisar. */
create or replace function public.erp_dm_send(p_thread uuid, p_body text, p_attachments jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.erp_dm_threads; v_clean jsonb := '[]'::jsonb; x jsonb; v_type text; v_path text; v_size numeric; v_body text; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Inicia sesión.'; end if;
  select * into t from public.erp_dm_threads where id = p_thread;
  if t.id is null or not public.erp__dm_member(p_thread) then raise exception 'No estás en este chat.'; end if;
  if jsonb_typeof(coalesce(p_attachments, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_attachments, '[]'::jsonb)) > 10 then raise exception 'Máximo 10 archivos por mensaje.'; end if;
  for x in select * from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb)) loop
    v_type := x ->> 'type';
    v_path := x ->> 'path';
    v_size := coalesce(nullif(x ->> 'size', '')::numeric, 0);
    if v_type not in ('image', 'video', 'audio') then raise exception 'Tipo de archivo no permitido.'; end if;
    if v_path is null or v_path not like t.store_id::text || '/dm/' || p_thread::text || '/%' or v_path like '%..%' then raise exception 'Archivo fuera de este chat.'; end if;
    if v_size > 52428800 then raise exception 'Cada archivo puede pesar hasta 50 MB.'; end if;
    v_clean := v_clean || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'type', v_type, 'path', v_path, 'mime', left(x ->> 'mime', 80), 'size', v_size,
      'duration', nullif(x ->> 'duration', '')::numeric, 'width', nullif(x ->> 'width', '')::int, 'height', nullif(x ->> 'height', '')::int)));
  end loop;
  v_body := left(nullif(btrim(coalesce(p_body, '')), ''), 4000);
  if v_body is null and jsonb_array_length(v_clean) = 0 then raise exception 'Escribe un mensaje o adjunta un archivo.'; end if;
  v_body := coalesce(v_body, public.erp__sr_media_label(v_clean));
  insert into public.erp_dm_messages (thread_id, store_id, user_id, user_name, body, attachments)
  values (p_thread, t.store_id, auth.uid(), public.erp__member_name(t.store_id, auth.uid()), v_body, nullif(v_clean, '[]'::jsonb))
  returning id into v_id;
  update public.erp_dm_threads set last_message_at = now() where id = p_thread;
  update public.erp_dm_members set last_read_at = now() where thread_id = p_thread and user_id = auth.uid();
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function public.erp_dm_send(uuid, text, jsonb) from public, anon;
grant execute on function public.erp_dm_send(uuid, text, jsonb) to authenticated;

create or replace function public.erp_dm_read(p_thread uuid)
returns void language sql security definer set search_path = public as $$
  update public.erp_dm_members set last_read_at = now() where thread_id = p_thread and user_id = auth.uid();
$$;
revoke all on function public.erp_dm_read(uuid) from public, anon;
grant execute on function public.erp_dm_read(uuid) to authenticated;

/** Llamada o videollamada desde un chat: a los demás del chat (o a los escogidos del grupo). */
create or replace function public.erp_call_start_dm(p_thread uuid, p_video boolean, p_offer jsonb, p_to uuid[] default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.erp_dm_threads; v_id uuid; v_invited uuid[];
begin
  if auth.uid() is null then raise exception 'Inicia sesión.'; end if;
  select * into t from public.erp_dm_threads where id = p_thread;
  if t.id is null or not public.erp__dm_member(p_thread) then raise exception 'No estás en este chat.'; end if;
  if p_offer is null or p_offer ->> 'type' <> 'offer' or char_length(coalesce(p_offer ->> 'sdp', '')) < 20 then raise exception 'No se pudo preparar la llamada.'; end if;
  select array_agg(m.user_id) into v_invited from public.erp_dm_members m
  where m.thread_id = p_thread and m.user_id <> auth.uid() and (coalesce(cardinality(p_to), 0) = 0 or m.user_id = any (p_to))
    and public.erp__store_user_ok(t.store_id, m.user_id);
  if coalesce(cardinality(v_invited), 0) = 0 then raise exception 'Escoge a quién llamar.'; end if;
  update public.erp_calls set status = 'missed', ended_at = now(), ended_reason = 'nueva llamada' where caller_id = auth.uid() and status = 'ringing';
  insert into public.erp_calls (store_id, thread_id, caller_id, caller_name, video, offer)
  values (t.store_id, t.id, auth.uid(), public.erp__member_name(t.store_id, auth.uid()), coalesce(p_video, false), p_offer)
  returning id into v_id;
  insert into public.erp_call_invites (call_id, user_id) select v_id, unnest(v_invited);
  return jsonb_build_object('ok', true, 'id', v_id, 'invited', to_jsonb(v_invited));
end $$;
revoke all on function public.erp_call_start_dm(uuid, boolean, jsonb, uuid[]) from public, anon;
grant execute on function public.erp_call_start_dm(uuid, boolean, jsonb, uuid[]) to authenticated;

-- Colgar: igual que 20261269, y la constancia va al pedido o al chat de donde salió la llamada.
create or replace function public.erp_call_end(p_call uuid, p_reason text default 'colgó')
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.erp_calls; v_status text; v_secs int; v_body text;
begin
  select * into c from public.erp_calls where id = p_call for update;
  if c.id is null then raise exception 'Llamada no encontrada.'; end if;
  if c.caller_id <> auth.uid() and c.answered_by is distinct from auth.uid()
     and not exists (select 1 from public.erp_call_invites where call_id = p_call and user_id = auth.uid()) then
    raise exception 'Esta llamada no es tuya.';
  end if;
  if c.status in ('ended', 'missed', 'declined') then return jsonb_build_object('ok', true, 'status', c.status); end if;
  if c.status = 'ringing' and c.caller_id <> auth.uid() then
    update public.erp_call_invites set status = 'declined' where call_id = p_call and user_id = auth.uid();
    v_status := 'declined';
  elsif c.status = 'ringing' then
    v_status := 'missed';
  else
    v_status := 'ended';
  end if;
  update public.erp_calls set status = v_status, ended_at = now(), ended_reason = left(coalesce(p_reason, ''), 60) where id = p_call;
  update public.erp_call_invites set status = 'missed' where call_id = p_call and status = 'ringing';

  v_secs := case when c.answered_at is not null then extract(epoch from now() - c.answered_at)::int end;
  v_body := case
    when v_status = 'ended' then (case when c.video then '🎥 Videollamada' else '📞 Llamada de voz' end) || ' · ' || (v_secs / 60) || ':' || lpad((v_secs % 60)::text, 2, '0')
      || ' (' || coalesce(c.caller_name, 'Alguien') || ' con ' || coalesce(c.answered_name, 'Alguien') || ')'
    when v_status = 'declined' then (case when c.video then '🎥 Videollamada' else '📞 Llamada' end) || ' de ' || coalesce(c.caller_name, 'Alguien') || ' rechazada por ' || public.erp__member_name(c.store_id, auth.uid())
    else (case when c.video then '🎥 Videollamada' else '📞 Llamada' end) || ' perdida de ' || coalesce(c.caller_name, 'Alguien') end;
  begin
    if c.request_id is not null then
      insert into public.erp_stock_request_messages (request_id, user_id, user_name, body, kind) values (c.request_id, null, null, v_body, 'system');
    elsif c.thread_id is not null then
      insert into public.erp_dm_messages (thread_id, store_id, user_id, user_name, body, kind) values (c.thread_id, c.store_id, null, null, v_body, 'system');
      update public.erp_dm_threads set last_message_at = now() where id = c.thread_id;
    end if;
  exception when others then null; -- la constancia es opcional
  end;
  return jsonb_build_object('ok', true, 'status', v_status);
end $$;
revoke all on function public.erp_call_end(uuid, text) from public, anon;
grant execute on function public.erp_call_end(uuid, text) to authenticated;

notify pgrst, 'reload schema';
