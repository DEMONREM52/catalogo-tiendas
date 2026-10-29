-- =====================================================================
-- REMHUB · Chat de pedidos internos con fotos, videos y audios
--
--   · erp_stock_request_messages.attachments: lista de archivos del mensaje
--     [{ type: image|video|audio, path, mime, size, duration, width, height }].
--   · Almacenamiento privado «chat-media»: <tienda>/<pedido>/<archivo>.
--     Solo quien ve el pedido (miembro de la tienda y de uno de sus dos
--     puntos) puede subir o ver sus archivos (con enlaces firmados).
--   · erp_stock_request_message_media: guarda el mensaje con la función de
--     siempre (mismos permisos, mismo aviso al celular) y le pega los
--     archivos. Sin texto, el mensaje dice «📷 Foto», «🎥 Video», «🎤 Audio».
--   · erp_stock_request_media: los archivos de los mensajes de un pedido.
-- No borra datos. Es idempotente.
-- =====================================================================

alter table public.erp_stock_request_messages add column if not exists attachments jsonb;

-- ¿Puede el usuario ver este pedido? (miembro de la tienda y con alcance sobre el punto que pide o el que atiende)
create or replace function public.erp__sr_visible(p_request uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.erp_stock_requests r
    where r.id = p_request and public.erp__is_store_member(r.store_id)
      and (public.erp__scope_ok(r.store_id, r.from_point_id) or public.erp__scope_ok(r.store_id, r.to_point_id))
  );
$$;
revoke all on function public.erp__sr_visible(uuid) from public, anon;
grant execute on function public.erp__sr_visible(uuid) to authenticated;

-- Para las políticas del almacenamiento: la carpeta es <tienda>/<pedido>/ y el pedido es de esa tienda.
create or replace function public.erp__sr_media_ok(p_store text, p_request text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if coalesce(p_store, '') !~* re or coalesce(p_request, '') !~* re then return false; end if;
  return exists (select 1 from public.erp_stock_requests r where r.id = p_request::uuid and r.store_id = p_store::uuid)
    and public.erp__sr_visible(p_request::uuid);
end $$;
revoke all on function public.erp__sr_media_ok(text, text) from public, anon;
grant execute on function public.erp__sr_media_ok(text, text) to authenticated;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('chat-media', 'chat-media', false, 52428800, array['image/*', 'video/*', 'audio/*'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
    execute 'drop policy if exists chat_media_select on storage.objects';
    execute 'drop policy if exists chat_media_insert on storage.objects';
    execute 'drop policy if exists chat_media_delete on storage.objects';
    execute $p$create policy chat_media_select on storage.objects for select to authenticated using (
      bucket_id = 'chat-media' and public.erp__sr_media_ok((storage.foldername(name))[1], (storage.foldername(name))[2]))$p$;
    execute $p$create policy chat_media_insert on storage.objects for insert to authenticated with check (
      bucket_id = 'chat-media' and public.erp__sr_media_ok((storage.foldername(name))[1], (storage.foldername(name))[2]))$p$;
    execute $p$create policy chat_media_delete on storage.objects for delete to authenticated using (
      bucket_id = 'chat-media' and owner = auth.uid() and public.erp__sr_media_ok((storage.foldername(name))[1], (storage.foldername(name))[2]))$p$;
  end if;
end $$;

-- Texto del mensaje cuando solo trae archivos (también es lo que dice la notificación del celular).
create or replace function public.erp__sr_media_label(p jsonb)
returns text language sql immutable set search_path = public as $$
  with a as (select x ->> 'type' as t, nullif(x ->> 'duration', '')::numeric as d from jsonb_array_elements(coalesce(p, '[]'::jsonb)) x),
  c as (select count(*) filter (where t = 'image') i, count(*) filter (where t = 'video') v, count(*) filter (where t = 'audio') au,
               max(d) filter (where t = 'audio') ad from a)
  select concat_ws(' · ',
    case when i = 1 then '📷 Foto' when i > 1 then '📷 ' || i || ' fotos' end,
    case when v = 1 then '🎥 Video' when v > 1 then '🎥 ' || v || ' videos' end,
    case when au >= 1 then '🎤 Audio' || case when ad is not null then ' (' || floor(ad / 60)::int || ':' || lpad((floor(ad)::int % 60)::text, 2, '0') || ')' else '' end end)
  from c;
$$;

create or replace function public.erp_stock_request_message_media(p_request uuid, p_body text, p_attachments jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_store uuid; v_clean jsonb := '[]'::jsonb; x jsonb; v_type text; v_path text; v_size numeric; v_body text; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Inicia sesión.'; end if;
  select store_id into v_store from public.erp_stock_requests where id = p_request;
  if v_store is null or not public.erp__sr_visible(p_request) then raise exception 'No tienes acceso a este pedido.'; end if;
  if jsonb_typeof(coalesce(p_attachments, '[]'::jsonb)) <> 'array' then raise exception 'Archivos no válidos.'; end if;
  if jsonb_array_length(coalesce(p_attachments, '[]'::jsonb)) > 10 then raise exception 'Máximo 10 archivos por mensaje.'; end if;
  for x in select * from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb)) loop
    v_type := x ->> 'type';
    v_path := x ->> 'path';
    v_size := coalesce(nullif(x ->> 'size', '')::numeric, 0);
    if v_type not in ('image', 'video', 'audio') then raise exception 'Tipo de archivo no permitido.'; end if;
    if v_path is null or v_path not like v_store::text || '/' || p_request::text || '/%' or v_path like '%..%' then raise exception 'Archivo fuera de este pedido.'; end if;
    if v_size > 52428800 then raise exception 'Cada archivo puede pesar hasta 50 MB.'; end if;
    v_clean := v_clean || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'type', v_type, 'path', v_path, 'mime', left(x ->> 'mime', 80), 'size', v_size,
      'duration', nullif(x ->> 'duration', '')::numeric, 'width', nullif(x ->> 'width', '')::int, 'height', nullif(x ->> 'height', '')::int)));
  end loop;
  v_body := nullif(btrim(coalesce(p_body, '')), '');
  if v_body is null and jsonb_array_length(v_clean) = 0 then raise exception 'Escribe un mensaje o adjunta un archivo.'; end if;
  v_body := coalesce(v_body, public.erp__sr_media_label(v_clean));

  -- El mensaje se guarda con la función de siempre: mismos permisos, sistema y aviso al celular.
  perform public.erp_stock_request_message(p_request, v_body);
  select id into v_id from public.erp_stock_request_messages
  where request_id = p_request and user_id = auth.uid() and kind = 'message'
  order by created_at desc, id desc limit 1;
  if v_id is not null and jsonb_array_length(v_clean) > 0 then
    update public.erp_stock_request_messages set attachments = v_clean where id = v_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function public.erp_stock_request_message_media(uuid, text, jsonb) from public, anon;
grant execute on function public.erp_stock_request_message_media(uuid, text, jsonb) to authenticated;

create or replace function public.erp_stock_request_media(p_request uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.erp__sr_visible(p_request) then return '{}'::jsonb; end if;
  return coalesce((select jsonb_object_agg(id::text, attachments) from public.erp_stock_request_messages
                   where request_id = p_request and attachments is not null), '{}'::jsonb);
end $$;
revoke all on function public.erp_stock_request_media(uuid) from public, anon;
grant execute on function public.erp_stock_request_media(uuid) to authenticated;

notify pgrst, 'reload schema';
