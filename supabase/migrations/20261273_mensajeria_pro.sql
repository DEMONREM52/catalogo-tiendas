-- =====================================================================
-- REMHUB · Mensajería como WhatsApp, para la tienda (sobre 20261272)
--
-- Para los dos chats (pedidos internos = 'sr' y mensajes del equipo = 'dm'):
--   · Responder a un mensaje (reply_to), reacciones (una por persona),
--     visto ✓✓ (erp_chat_reads), editar y borrar lo propio en los primeros
--     15 minutos (queda en la auditoría), fijar mensajes, guardar con ⭐,
--     silenciar un chat (las llamadas siguen sonando), @menciones (avisan
--     aunque el chat esté silenciado), tarjeta de producto con existencias
--     en vivo, reenviar y buscar en todos los chats.
--   · Anuncios de la tienda: el dueño o un administrador manda un comunicado
--     a todos o a ciertos puntos y ve quién lo leyó (erp_dm_threads.kind = 'announce').
--   · La constancia de una llamada guarda quién llamó, para devolverla.
--
--   erp_chat_send · erp_chat_extras · erp_chat_seen · erp_chat_edit · erp_chat_delete
--   erp_chat_react · erp_chat_pin · erp_chat_star · erp_chat_starred · erp_chat_mute
--   erp_chat_search · erp_chat_products · erp_dm_announce_create · erp_chat_muted_users (servidor)
-- No borra datos. Es idempotente.
-- =====================================================================

-- ---------------------------------------------------------------- columnas nuevas de los mensajes
do $$
declare t text;
begin
  foreach t in array array['erp_stock_request_messages', 'erp_dm_messages'] loop
    execute format('alter table public.%I add column if not exists reply_to uuid', t);
    execute format('alter table public.%I add column if not exists edited_at timestamptz', t);
    execute format('alter table public.%I add column if not exists deleted_at timestamptz', t);
    execute format('alter table public.%I add column if not exists pinned_at timestamptz', t);
    execute format('alter table public.%I add column if not exists pinned_by uuid', t);
    execute format('alter table public.%I add column if not exists mentions uuid[]', t);
    execute format('alter table public.%I add column if not exists meta jsonb', t);
  end loop;
end $$;

-- Anuncios: un tipo más de chat.
alter table public.erp_dm_threads drop constraint if exists erp_dm_threads_kind_check;
alter table public.erp_dm_threads add constraint erp_dm_threads_kind_check check (kind in ('direct', 'group', 'announce'));

-- ---------------------------------------------------------------- tablas nuevas
create table if not exists public.erp_chat_reactions (
  scope text not null check (scope in ('sr', 'dm')),
  chat_id uuid not null,
  message_id uuid not null,
  user_id uuid not null,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (scope, message_id, user_id)
);
create index if not exists erp_chat_reactions_chat on public.erp_chat_reactions (scope, chat_id);

create table if not exists public.erp_chat_reads (
  scope text not null check (scope in ('sr', 'dm')),
  chat_id uuid not null,
  user_id uuid not null,
  last_read_at timestamptz not null default now(),
  primary key (scope, chat_id, user_id)
);

create table if not exists public.erp_chat_stars (
  user_id uuid not null,
  scope text not null check (scope in ('sr', 'dm')),
  chat_id uuid not null,
  message_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, scope, message_id)
);

create table if not exists public.erp_chat_mutes (
  user_id uuid not null,
  scope text not null check (scope in ('sr', 'dm')),
  chat_id uuid not null,
  until timestamptz not null,
  primary key (user_id, scope, chat_id)
);

-- ---------------------------------------------------------------- ayudantes
-- ¿El usuario actual puede ver ese chat?
create or replace function public.erp__chat_access(p_scope text, p_chat uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case p_scope when 'sr' then public.erp__sr_visible(p_chat) when 'dm' then public.erp__dm_member(p_chat) else false end;
$$;
revoke all on function public.erp__chat_access(text, uuid) from public, anon;
grant execute on function public.erp__chat_access(text, uuid) to authenticated;

create or replace function public.erp__chat_store(p_scope text, p_chat uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select case p_scope
    when 'sr' then (select store_id from public.erp_stock_requests where id = p_chat)
    when 'dm' then (select store_id from public.erp_dm_threads where id = p_chat) end;
$$;
revoke all on function public.erp__chat_store(text, uuid) from public, anon, authenticated;

-- Un mensaje de cualquiera de los dos chats, con su chat.
create or replace function public.erp__chat_msg(p_scope text, p_msg uuid)
returns table (chat_id uuid, user_id uuid, user_name text, kind text, body text, attachments jsonb, created_at timestamptz, deleted_at timestamptz, pinned_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.request_id, m.user_id, m.user_name, m.kind, m.body, m.attachments, m.created_at, m.deleted_at, m.pinned_at from public.erp_stock_request_messages m where p_scope = 'sr' and m.id = p_msg
  union all
  select m.thread_id, m.user_id, m.user_name, m.kind, m.body, m.attachments, m.created_at, m.deleted_at, m.pinned_at from public.erp_dm_messages m where p_scope = 'dm' and m.id = p_msg;
$$;
revoke all on function public.erp__chat_msg(text, uuid) from public, anon, authenticated;

-- Todos los mensajes de un chat (para lo extra).
create or replace function public.erp__chat_rows(p_scope text, p_chat uuid)
returns table (id uuid, user_id uuid, user_name text, kind text, body text, created_at timestamptz, reply_to uuid, edited_at timestamptz,
  deleted_at timestamptz, pinned_at timestamptz, mentions uuid[], meta jsonb)
language sql stable security definer set search_path = public as $$
  select m.id, m.user_id, m.user_name, m.kind, m.body, m.created_at, m.reply_to, m.edited_at, m.deleted_at, m.pinned_at, m.mentions, m.meta
  from public.erp_stock_request_messages m where p_scope = 'sr' and m.request_id = p_chat
  union all
  select m.id, m.user_id, m.user_name, m.kind, m.body, m.created_at, m.reply_to, m.edited_at, m.deleted_at, m.pinned_at, m.mentions, m.meta
  from public.erp_dm_messages m where p_scope = 'dm' and m.thread_id = p_chat;
$$;
revoke all on function public.erp__chat_rows(text, uuid) from public, anon, authenticated;

-- ¿Dueño o administrador de la tienda?
create or replace function public.erp__store_admin(p_store uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
      or exists (select 1 from public.store_users su where su.store_id = p_store and su.user_id = auth.uid() and su.role = 'store_admin'
                 and coalesce((to_jsonb(su) ->> 'active')::boolean, true));
$$;
revoke all on function public.erp__store_admin(uuid) from public, anon, authenticated;

-- ¿Puede escribir en ese chat? (en un anuncio, solo quien lo creó y los administradores)
create or replace function public.erp__dm_can_post(p_thread uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select t.kind <> 'announce' or t.created_by = auth.uid() or public.erp__store_admin(t.store_id)
                   from public.erp_dm_threads t where t.id = p_thread), false);
$$;
revoke all on function public.erp__dm_can_post(uuid) from public, anon, authenticated;

-- Deja constancia en la auditoría si el módulo de auditoría está instalado.
create or replace function public.erp__chat_audit(p_store uuid, p_action text, p_msg uuid, p_detail jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  begin
    perform public.erp_audit(p_store, p_action, 'chat_message', p_msg, p_detail);
  exception when undefined_function then null;
  end;
end $$;
revoke all on function public.erp__chat_audit(uuid, text, uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------- permisos de lectura (para «en vivo»)
alter table public.erp_chat_reactions enable row level security;
alter table public.erp_chat_reads enable row level security;
alter table public.erp_chat_stars enable row level security;
alter table public.erp_chat_mutes enable row level security;
revoke all on public.erp_chat_reactions, public.erp_chat_reads, public.erp_chat_stars, public.erp_chat_mutes from anon, authenticated;
grant select on public.erp_chat_reactions, public.erp_chat_reads, public.erp_chat_stars, public.erp_chat_mutes to authenticated;
drop policy if exists erp_chat_reactions_read on public.erp_chat_reactions;
create policy erp_chat_reactions_read on public.erp_chat_reactions for select to authenticated using (public.erp__chat_access(scope, chat_id));
drop policy if exists erp_chat_reads_read on public.erp_chat_reads;
create policy erp_chat_reads_read on public.erp_chat_reads for select to authenticated using (public.erp__chat_access(scope, chat_id));
drop policy if exists erp_chat_stars_read on public.erp_chat_stars;
create policy erp_chat_stars_read on public.erp_chat_stars for select to authenticated using (user_id = auth.uid());
drop policy if exists erp_chat_mutes_read on public.erp_chat_mutes;
create policy erp_chat_mutes_read on public.erp_chat_mutes for select to authenticated using (user_id = auth.uid());

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['erp_chat_reactions', 'erp_chat_reads'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------- escribir en un anuncio: solo quien puede
create or replace function public.erp_dm_send(p_thread uuid, p_body text, p_attachments jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.erp_dm_threads; v_clean jsonb := '[]'::jsonb; x jsonb; v_type text; v_path text; v_size numeric; v_body text; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Inicia sesión.'; end if;
  select * into t from public.erp_dm_threads where id = p_thread;
  if t.id is null or not public.erp__dm_member(p_thread) then raise exception 'No estás en este chat.'; end if;
  if not public.erp__dm_can_post(p_thread) then raise exception 'En los anuncios solo escribe quien los manda o un administrador.'; end if;
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

-- ---------------------------------------------------------------- enviar (con respuesta, menciones y producto)
create or replace function public.erp_chat_send(p_scope text, p_chat uuid, p_body text, p_attachments jsonb default '[]'::jsonb,
  p_reply_to uuid default null, p_meta jsonb default null, p_mentions uuid[] default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_store uuid; v_res jsonb; v_id uuid; v_meta jsonb; v_body text := p_body; v_pname text; v_mentions uuid[]; v_reply uuid;
begin
  if auth.uid() is null then raise exception 'Inicia sesión.'; end if;
  if p_scope not in ('sr', 'dm') or not public.erp__chat_access(p_scope, p_chat) then raise exception 'No tienes acceso a este chat.'; end if;
  v_store := public.erp__chat_store(p_scope, p_chat);

  -- Tarjeta de producto: solo productos de la tienda.
  if p_meta is not null and p_meta ->> 'type' = 'product' then
    select name into v_pname from public.products where id = nullif(p_meta ->> 'product_id', '')::uuid and store_id = v_store;
    if v_pname is null then raise exception 'Ese producto no es de la tienda.'; end if;
    v_meta := jsonb_build_object('type', 'product', 'product_id', p_meta ->> 'product_id');
    if nullif(btrim(coalesce(v_body, '')), '') is null then v_body := '📦 ' || v_pname; end if;
  elsif p_meta is not null and (p_meta ->> 'forwarded')::boolean then
    v_meta := jsonb_build_object('forwarded', true);
  end if;

  -- Responder: el mensaje citado tiene que ser de este mismo chat.
  if p_reply_to is not null then
    select p_reply_to into v_reply from public.erp__chat_msg(p_scope, p_reply_to) m where m.chat_id = p_chat;
  end if;

  -- Menciones: solo personas que ven el chat.
  if coalesce(cardinality(p_mentions), 0) > 0 then
    if p_scope = 'sr' then
      select array_agg(distinct u) into v_mentions from unnest(p_mentions) u where u in (select user_id from public.erp__sr_people(p_chat)) and u <> auth.uid();
    else
      select array_agg(distinct u) into v_mentions from unnest(p_mentions) u where u in (select user_id from public.erp_dm_members where thread_id = p_chat) and u <> auth.uid();
    end if;
  end if;

  if p_scope = 'sr' then
    v_res := public.erp_stock_request_message_media(p_chat, v_body, coalesce(p_attachments, '[]'::jsonb));
  else
    v_res := public.erp_dm_send(p_chat, v_body, coalesce(p_attachments, '[]'::jsonb));
  end if;
  v_id := nullif(v_res ->> 'id', '')::uuid;
  if v_id is not null and (v_reply is not null or v_mentions is not null or v_meta is not null) then
    if p_scope = 'sr' then
      update public.erp_stock_request_messages set reply_to = v_reply, mentions = v_mentions, meta = v_meta where id = v_id;
    else
      update public.erp_dm_messages set reply_to = v_reply, mentions = v_mentions, meta = v_meta where id = v_id;
    end if;
  end if;
  insert into public.erp_chat_reads (scope, chat_id, user_id, last_read_at) values (p_scope, p_chat, auth.uid(), now())
  on conflict (scope, chat_id, user_id) do update set last_read_at = excluded.last_read_at;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function public.erp_chat_send(text, uuid, text, jsonb, uuid, jsonb, uuid[]) from public, anon;
grant execute on function public.erp_chat_send(text, uuid, text, jsonb, uuid, jsonb, uuid[]) to authenticated;

-- ---------------------------------------------------------------- lo extra de un chat (para pintar los mensajes)
create or replace function public.erp_chat_extras(p_scope text, p_chat uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_store uuid; v_msgs jsonb; v_reads jsonb; v_pinned jsonb; v_mute timestamptz; v_kind text; v_creator uuid; v_admin boolean;
begin
  if p_scope not in ('sr', 'dm') or not public.erp__chat_access(p_scope, p_chat) then raise exception 'No tienes acceso a este chat.'; end if;
  v_store := public.erp__chat_store(p_scope, p_chat);

  select coalesce(jsonb_object_agg(m.id::text, jsonb_strip_nulls(jsonb_build_object(
      'reply', (select jsonb_build_object('id', m.reply_to, 'user_name', coalesce(q.user_name, 'RemHub'), 'body', left(q.body, 160), 'deleted', q.deleted_at is not null)
                from public.erp__chat_msg(p_scope, m.reply_to) q where m.reply_to is not null),
      'edited', case when m.edited_at is not null then true end,
      'deleted', case when m.deleted_at is not null then true end,
      'pinned', case when m.pinned_at is not null then true end,
      'mentions', to_jsonb(m.mentions),
      'meta', m.meta,
      'reactions', (select jsonb_agg(jsonb_build_object('emoji', r.emoji, 'count', r.n, 'mine', r.mine, 'names', r.names) order by r.n desc, r.emoji)
                    from (select x.emoji, count(*) n, bool_or(x.user_id = auth.uid()) mine,
                                 jsonb_agg(public.erp__member_name(v_store, x.user_id)) names
                          from public.erp_chat_reactions x where x.scope = p_scope and x.message_id = m.id group by x.emoji) r),
      'starred', case when exists (select 1 from public.erp_chat_stars s where s.user_id = auth.uid() and s.scope = p_scope and s.message_id = m.id) then true end
    ))), '{}'::jsonb) into v_msgs
  from public.erp__chat_rows(p_scope, p_chat) m
  where m.reply_to is not null or m.edited_at is not null or m.deleted_at is not null or m.pinned_at is not null or m.mentions is not null or m.meta is not null
     or exists (select 1 from public.erp_chat_reactions x where x.scope = p_scope and x.message_id = m.id)
     or exists (select 1 from public.erp_chat_stars s where s.user_id = auth.uid() and s.scope = p_scope and s.message_id = m.id);

  -- Hasta dónde leyó cada uno (sin mí).
  if p_scope = 'dm' then
    select coalesce(jsonb_agg(jsonb_build_object('user_id', mb.user_id, 'name', public.erp__member_name(v_store, mb.user_id),
             'at', greatest(mb.last_read_at, r.last_read_at)) order by public.erp__member_name(v_store, mb.user_id)), '[]'::jsonb) into v_reads
    from public.erp_dm_members mb left join public.erp_chat_reads r on r.scope = 'dm' and r.chat_id = p_chat and r.user_id = mb.user_id
    where mb.thread_id = p_chat and mb.user_id <> auth.uid();
    select kind, created_by into v_kind, v_creator from public.erp_dm_threads where id = p_chat;
  else
    select coalesce(jsonb_agg(jsonb_build_object('user_id', r.user_id, 'name', public.erp__member_name(v_store, r.user_id), 'at', r.last_read_at)
             order by r.last_read_at desc), '[]'::jsonb) into v_reads
    from public.erp_chat_reads r where r.scope = 'sr' and r.chat_id = p_chat and r.user_id <> auth.uid();
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'user_name', coalesce(m.user_name, 'RemHub'), 'body', left(m.body, 200)) order by m.pinned_at desc), '[]'::jsonb)
  into v_pinned from public.erp__chat_rows(p_scope, p_chat) m where m.pinned_at is not null and m.deleted_at is null;

  select until into v_mute from public.erp_chat_mutes where user_id = auth.uid() and scope = p_scope and chat_id = p_chat and until > now();
  v_admin := public.erp__store_admin(v_store);

  return jsonb_build_object('msgs', v_msgs, 'reads', v_reads, 'pinned', v_pinned, 'muted_until', v_mute, 'me', auth.uid(),
    'kind', coalesce(v_kind, p_scope), 'can_post', p_scope = 'sr' or coalesce(v_kind, '') <> 'announce' or v_creator = auth.uid() or v_admin,
    'can_pin', p_scope = 'sr' or coalesce(v_kind, '') <> 'announce' or v_creator = auth.uid() or v_admin);
end $$;
revoke all on function public.erp_chat_extras(text, uuid) from public, anon;
grant execute on function public.erp_chat_extras(text, uuid) to authenticated;

/** Ya vi el chat (para el ✓✓ de los demás). */
create or replace function public.erp_chat_seen(p_scope text, p_chat uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or p_scope not in ('sr', 'dm') or not public.erp__chat_access(p_scope, p_chat) then return; end if;
  insert into public.erp_chat_reads (scope, chat_id, user_id, last_read_at) values (p_scope, p_chat, auth.uid(), now())
  on conflict (scope, chat_id, user_id) do update set last_read_at = excluded.last_read_at;
  if p_scope = 'dm' then update public.erp_dm_members set last_read_at = now() where thread_id = p_chat and user_id = auth.uid(); end if;
end $$;
revoke all on function public.erp_chat_seen(text, uuid) from public, anon;
grant execute on function public.erp_chat_seen(text, uuid) to authenticated;

-- ---------------------------------------------------------------- editar y borrar (solo lo propio, primeros 15 minutos)
create or replace function public.erp_chat_edit(p_scope text, p_msg uuid, p_body text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m record; v_body text := left(nullif(btrim(coalesce(p_body, '')), ''), 4000);
begin
  select * into m from public.erp__chat_msg(p_scope, p_msg);
  if m.chat_id is null or not public.erp__chat_access(p_scope, m.chat_id) then raise exception 'Mensaje no encontrado.'; end if;
  if m.user_id is distinct from auth.uid() or m.kind <> 'message' then raise exception 'Solo puedes editar tus mensajes.'; end if;
  if m.deleted_at is not null then raise exception 'Ese mensaje ya se borró.'; end if;
  if now() - m.created_at > interval '15 minutes' then raise exception 'Solo se puede editar en los primeros 15 minutos.'; end if;
  if v_body is null then raise exception 'El mensaje no puede quedar vacío.'; end if;
  if v_body = m.body then return jsonb_build_object('ok', true); end if;
  if p_scope = 'sr' then update public.erp_stock_request_messages set body = v_body, edited_at = now() where id = p_msg;
  else update public.erp_dm_messages set body = v_body, edited_at = now() where id = p_msg; end if;
  perform public.erp__chat_audit(public.erp__chat_store(p_scope, m.chat_id), 'chat.message_edited', p_msg,
    jsonb_build_object('chat', p_scope, 'chat_id', m.chat_id, 'before', m.body, 'after', v_body));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.erp_chat_edit(text, uuid, text) from public, anon;
grant execute on function public.erp_chat_edit(text, uuid, text) to authenticated;

create or replace function public.erp_chat_delete(p_scope text, p_msg uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m record;
begin
  select * into m from public.erp__chat_msg(p_scope, p_msg);
  if m.chat_id is null or not public.erp__chat_access(p_scope, m.chat_id) then raise exception 'Mensaje no encontrado.'; end if;
  if m.user_id is distinct from auth.uid() or m.kind <> 'message' then raise exception 'Solo puedes borrar tus mensajes.'; end if;
  if m.deleted_at is not null then return jsonb_build_object('ok', true); end if;
  if now() - m.created_at > interval '15 minutes' then raise exception 'Solo se puede borrar en los primeros 15 minutos.'; end if;
  if p_scope = 'sr' then
    update public.erp_stock_request_messages set body = '🚫 Se eliminó este mensaje', attachments = null, meta = null, deleted_at = now(), pinned_at = null where id = p_msg;
  else
    update public.erp_dm_messages set body = '🚫 Se eliminó este mensaje', attachments = null, meta = null, deleted_at = now(), pinned_at = null where id = p_msg;
  end if;
  delete from public.erp_chat_reactions where scope = p_scope and message_id = p_msg;
  -- Lo que decía queda en la auditoría.
  perform public.erp__chat_audit(public.erp__chat_store(p_scope, m.chat_id), 'chat.message_deleted', p_msg,
    jsonb_build_object('chat', p_scope, 'chat_id', m.chat_id, 'body', m.body, 'attachments', m.attachments));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.erp_chat_delete(text, uuid) from public, anon;
grant execute on function public.erp_chat_delete(text, uuid) to authenticated;

-- ---------------------------------------------------------------- reacciones, fijar, guardar
create or replace function public.erp_chat_react(p_scope text, p_msg uuid, p_emoji text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m record; v_emoji text := nullif(btrim(coalesce(p_emoji, '')), '');
begin
  select * into m from public.erp__chat_msg(p_scope, p_msg);
  if m.chat_id is null or not public.erp__chat_access(p_scope, m.chat_id) then raise exception 'Mensaje no encontrado.'; end if;
  if m.deleted_at is not null or m.kind <> 'message' then raise exception 'No se puede reaccionar a ese mensaje.'; end if;
  if v_emoji is null then
    delete from public.erp_chat_reactions where scope = p_scope and message_id = p_msg and user_id = auth.uid();
  else
    if char_length(v_emoji) > 16 then raise exception 'Reacción no válida.'; end if;
    insert into public.erp_chat_reactions (scope, chat_id, message_id, user_id, emoji) values (p_scope, m.chat_id, p_msg, auth.uid(), v_emoji)
    on conflict (scope, message_id, user_id) do update set emoji = excluded.emoji, created_at = now();
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.erp_chat_react(text, uuid, text) from public, anon;
grant execute on function public.erp_chat_react(text, uuid, text) to authenticated;

create or replace function public.erp_chat_pin(p_scope text, p_msg uuid, p_on boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m record;
begin
  select * into m from public.erp__chat_msg(p_scope, p_msg);
  if m.chat_id is null or not public.erp__chat_access(p_scope, m.chat_id) then raise exception 'Mensaje no encontrado.'; end if;
  if p_scope = 'dm' and not public.erp__dm_can_post(m.chat_id) then raise exception 'En los anuncios solo fija quien los manda o un administrador.'; end if;
  if m.deleted_at is not null then raise exception 'Ese mensaje se borró.'; end if;
  if p_scope = 'sr' then
    update public.erp_stock_request_messages set pinned_at = case when p_on then now() end, pinned_by = case when p_on then auth.uid() end where id = p_msg;
  else
    update public.erp_dm_messages set pinned_at = case when p_on then now() end, pinned_by = case when p_on then auth.uid() end where id = p_msg;
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.erp_chat_pin(text, uuid, boolean) from public, anon;
grant execute on function public.erp_chat_pin(text, uuid, boolean) to authenticated;

create or replace function public.erp_chat_star(p_scope text, p_msg uuid, p_on boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m record;
begin
  select * into m from public.erp__chat_msg(p_scope, p_msg);
  if m.chat_id is null or not public.erp__chat_access(p_scope, m.chat_id) then raise exception 'Mensaje no encontrado.'; end if;
  if p_on then
    insert into public.erp_chat_stars (user_id, scope, chat_id, message_id) values (auth.uid(), p_scope, m.chat_id, p_msg) on conflict do nothing;
  else
    delete from public.erp_chat_stars where user_id = auth.uid() and scope = p_scope and message_id = p_msg;
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.erp_chat_star(text, uuid, boolean) from public, anon;
grant execute on function public.erp_chat_star(text, uuid, boolean) to authenticated;

/** Mis mensajes guardados ⭐ de la tienda (de los chats que todavía puedo ver). */
create or replace function public.erp_chat_starred(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.erp__is_store_member(p_store) then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(x order by x ->> 'starred_at' desc) from (
      select jsonb_build_object('scope', s.scope, 'chat_id', s.chat_id, 'message_id', s.message_id, 'starred_at', s.created_at,
        'body', m.body, 'user_name', coalesce(m.user_name, 'RemHub'), 'created_at', m.created_at,
        'chat_name', case when s.scope = 'sr' then 'Pedido #' || (select (to_jsonb(r) ->> 'number') from public.erp_stock_requests r where r.id = s.chat_id)
                          else coalesce((select t.title from public.erp_dm_threads t where t.id = s.chat_id),
                                        (select string_agg(public.erp__member_name(p_store, o.user_id), ', ') from public.erp_dm_members o where o.thread_id = s.chat_id and o.user_id <> auth.uid())) end) x
      from public.erp_chat_stars s, lateral (select * from public.erp__chat_msg(s.scope, s.message_id)) m
      where s.user_id = auth.uid() and public.erp__chat_store(s.scope, s.chat_id) = p_store and public.erp__chat_access(s.scope, s.chat_id)
      limit 200
    ) q
  ), '[]'::jsonb);
end $$;
revoke all on function public.erp_chat_starred(uuid) from public, anon;
grant execute on function public.erp_chat_starred(uuid) to authenticated;

-- ---------------------------------------------------------------- silenciar
/** Silenciar un chat: p_hours = 8, 168…; null = siempre; 0 = quitar. Las llamadas y las @menciones siguen avisando. */
create or replace function public.erp_chat_mute(p_scope text, p_chat uuid, p_hours int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_until timestamptz;
begin
  if p_scope not in ('sr', 'dm') or not public.erp__chat_access(p_scope, p_chat) then raise exception 'No tienes acceso a este chat.'; end if;
  if p_hours = 0 then
    delete from public.erp_chat_mutes where user_id = auth.uid() and scope = p_scope and chat_id = p_chat;
    return jsonb_build_object('ok', true, 'until', null);
  end if;
  v_until := case when p_hours is null then 'infinity'::timestamptz else now() + make_interval(hours => least(greatest(p_hours, 1), 24 * 365)) end;
  insert into public.erp_chat_mutes (user_id, scope, chat_id, until) values (auth.uid(), p_scope, p_chat, v_until)
  on conflict (user_id, scope, chat_id) do update set until = excluded.until;
  return jsonb_build_object('ok', true, 'until', v_until);
end $$;
revoke all on function public.erp_chat_mute(text, uuid, int) from public, anon;
grant execute on function public.erp_chat_mute(text, uuid, int) to authenticated;

/** (Servidor) Quiénes tienen silenciado este chat ahora. */
create or replace function public.erp_chat_muted_users(p_scope text, p_chat uuid)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(user_id), '{}'::uuid[]) from public.erp_chat_mutes where scope = p_scope and chat_id = p_chat and until > now();
$$;
revoke all on function public.erp_chat_muted_users(text, uuid) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.erp_chat_muted_users(text, uuid) to service_role';
  end if;
end $$;

/** Para el sonido dentro de la app: de estos chats, ¿cuáles tengo silenciados? */
create or replace function public.erp_chat_my_mutes(p_scope text)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(chat_id), '{}'::uuid[]) from public.erp_chat_mutes where user_id = auth.uid() and scope = p_scope and until > now();
$$;
revoke all on function public.erp_chat_my_mutes(text) from public, anon;
grant execute on function public.erp_chat_my_mutes(text) to authenticated;

-- ---------------------------------------------------------------- buscar en todos los chats
create or replace function public.erp_chat_search(p_store uuid, p_q text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_q text := btrim(coalesce(p_q, ''));
begin
  if not public.erp__is_store_member(p_store) or char_length(v_q) < 2 then return '[]'::jsonb; end if;
  v_q := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return coalesce((
    select jsonb_agg(x order by x ->> 'created_at' desc) from (
      (select jsonb_build_object('scope', 'dm', 'chat_id', m.thread_id, 'message_id', m.id, 'body', left(m.body, 200),
               'user_name', coalesce(m.user_name, 'RemHub'), 'created_at', m.created_at,
               'chat_name', coalesce(t.title, (select string_agg(public.erp__member_name(p_store, o.user_id), ', ') from public.erp_dm_members o where o.thread_id = t.id and o.user_id <> auth.uid()))) x
       from public.erp_dm_messages m join public.erp_dm_threads t on t.id = m.thread_id
       join public.erp_dm_members me on me.thread_id = t.id and me.user_id = auth.uid()
       where t.store_id = p_store and m.deleted_at is null and m.body ilike v_q
       order by m.created_at desc limit 40)
      union all
      (select jsonb_build_object('scope', 'sr', 'chat_id', m.request_id, 'message_id', m.id, 'body', left(m.body, 200),
               'user_name', coalesce(m.user_name, 'RemHub'), 'created_at', m.created_at,
               'chat_name', 'Pedido #' || (to_jsonb(r) ->> 'number')) x
       from public.erp_stock_request_messages m join public.erp_stock_requests r on r.id = m.request_id
       where r.store_id = p_store and m.kind = 'message' and m.deleted_at is null and m.body ilike v_q and public.erp__sr_visible(r.id)
       order by m.created_at desc limit 40)
    ) q
  ), '[]'::jsonb);
end $$;
revoke all on function public.erp_chat_search(uuid, text) from public, anon;
grant execute on function public.erp_chat_search(uuid, text) to authenticated;

-- ---------------------------------------------------------------- tarjeta de producto
/** Productos para las tarjetas del chat: foto, precio y existencias de cada punto (en vivo). */
create or replace function public.erp_chat_products(p_store uuid, p_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.erp__is_store_member(p_store) then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'sku', p.sku, 'image_url', p.image_url, 'price', p.price_retail, 'active', p.active,
      'stock', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name, 'qty', coalesce(l.qty, 0)) order by w.name)
                         from public.erp_warehouses w left join public.erp_stock_levels l on l.warehouse_id = w.id and l.product_id = p.id
                         where w.store_id = p_store and w.active), '[]'::jsonb)))
    from public.products p where p.store_id = p_store and p.id = any (coalesce(p_ids, '{}'::uuid[]))
  ), '[]'::jsonb);
end $$;
revoke all on function public.erp_chat_products(uuid, uuid[]) from public, anon;
grant execute on function public.erp_chat_products(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------- anuncios
/** Comunicado de la tienda a todos o a ciertos puntos (solo dueño o administrador). Se ve quién lo leyó. */
create or replace function public.erp_dm_announce_create(p_store uuid, p_title text, p_body text, p_points uuid[] default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_title text := left(nullif(btrim(coalesce(p_title, '')), ''), 60); v_body text := left(nullif(btrim(coalesce(p_body, '')), ''), 4000); v_n int;
begin
  if not public.erp__store_admin(p_store) then raise exception 'Solo el dueño o un administrador manda anuncios.'; end if;
  if v_title is null then raise exception 'Ponle un título al anuncio.'; end if;
  if v_body is null then raise exception 'Escribe el anuncio.'; end if;
  insert into public.erp_dm_threads (store_id, kind, title, created_by) values (p_store, 'announce', v_title, auth.uid()) returning id into v_id;
  insert into public.erp_dm_members (thread_id, user_id)
  select distinct v_id, u from (
    select su.user_id u from public.store_users su, lateral (select to_jsonb(su) j) x
    where su.store_id = p_store and coalesce((x.j ->> 'active')::boolean, true)
      and (coalesce(cardinality(p_points), 0) = 0
           or nullif(x.j ->> 'point_id', '')::uuid = any (p_points)
           or (jsonb_typeof(x.j -> 'point_ids') = 'array' and exists (select 1 from jsonb_array_elements_text(x.j -> 'point_ids') e where e::uuid = any (p_points)))
           or su.role = 'store_admin')
    union select s.owner_id from public.stores s where s.id = p_store
    union select auth.uid()
  ) m where u is not null;
  get diagnostics v_n = row_count;
  insert into public.erp_dm_messages (thread_id, store_id, user_id, user_name, body, kind)
  values (v_id, p_store, auth.uid(), public.erp__member_name(p_store, auth.uid()), v_body, 'message');
  update public.erp_dm_members set last_read_at = now() where thread_id = v_id and user_id = auth.uid();
  perform public.erp__chat_audit(p_store, 'chat.announcement', v_id, jsonb_build_object('title', v_title, 'points', to_jsonb(p_points), 'people', v_n));
  return jsonb_build_object('ok', true, 'id', v_id, 'people', v_n);
end $$;
revoke all on function public.erp_dm_announce_create(uuid, text, text, uuid[]) from public, anon;
grant execute on function public.erp_dm_announce_create(uuid, text, text, uuid[]) to authenticated;

-- La lista de chats dice también si está silenciado y si alguien me mencionó sin leer.
create or replace function public.erp_dm_list(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.erp__is_store_member(p_store) then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(x order by x ->> 'last_at' desc) from (
      select jsonb_build_object(
        'id', t.id, 'kind', t.kind, 'title', t.title, 'last_at', t.last_message_at, 'created_by', t.created_by,
        'members', (select jsonb_agg(jsonb_build_object('user_id', o.user_id, 'name', public.erp__member_name(p_store, o.user_id))) from public.erp_dm_members o where o.thread_id = t.id and o.user_id <> auth.uid()),
        'last', (select jsonb_build_object('body', m.body, 'user_name', m.user_name, 'mine', m.user_id = auth.uid(), 'created_at', m.created_at, 'kind', m.kind)
                 from public.erp_dm_messages m where m.thread_id = t.id order by m.created_at desc limit 1),
        'unread', (select count(*) from public.erp_dm_messages m where m.thread_id = t.id and m.created_at > me.last_read_at and m.user_id is distinct from auth.uid()),
        'mentioned', exists (select 1 from public.erp_dm_messages m where m.thread_id = t.id and m.created_at > me.last_read_at and auth.uid() = any (m.mentions)),
        'muted', exists (select 1 from public.erp_chat_mutes mu where mu.user_id = auth.uid() and mu.scope = 'dm' and mu.chat_id = t.id and mu.until > now())
      ) x
      from public.erp_dm_threads t join public.erp_dm_members me on me.thread_id = t.id and me.user_id = auth.uid()
      where t.store_id = p_store
    ) s
  ), '[]'::jsonb);
end $$;
revoke all on function public.erp_dm_list(uuid) from public, anon;
grant execute on function public.erp_dm_list(uuid) to authenticated;

-- ---------------------------------------------------------------- constancia de llamadas: para devolverla
create or replace function public.erp_call_end(p_call uuid, p_reason text default 'colgó')
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.erp_calls; v_status text; v_secs int; v_body text; v_meta jsonb;
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
  v_meta := jsonb_build_object('type', 'call', 'call_id', c.id, 'caller_id', c.caller_id, 'caller_name', c.caller_name, 'video', c.video, 'status', v_status,
    'invited', (select coalesce(jsonb_agg(user_id), '[]'::jsonb) from public.erp_call_invites where call_id = c.id));
  begin
    if c.request_id is not null then
      insert into public.erp_stock_request_messages (request_id, user_id, user_name, body, kind, meta) values (c.request_id, null, null, v_body, 'system', v_meta);
    elsif c.thread_id is not null then
      insert into public.erp_dm_messages (thread_id, store_id, user_id, user_name, body, kind, meta) values (c.thread_id, c.store_id, null, null, v_body, 'system', v_meta);
      update public.erp_dm_threads set last_message_at = now() where id = c.thread_id;
    end if;
  exception when others then null; -- la constancia es opcional
  end;
  return jsonb_build_object('ok', true, 'status', v_status);
end $$;
revoke all on function public.erp_call_end(uuid, text) from public, anon;
grant execute on function public.erp_call_end(uuid, text) to authenticated;

notify pgrst, 'reload schema';
