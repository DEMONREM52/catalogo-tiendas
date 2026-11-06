-- =====================================================================
-- REMHUB · Comentarios por producto en los pedidos internos (sobre 20261277)
--
--   Cada producto del pedido tiene su propio hilo de comentarios: «necesito 5 más»,
--   «que sea el rojo», «viene dañado», «mándame foto»… con una etiqueta y un
--   «✓ Atendido» para que quien despacha sepa qué le falta por resolver.
--   La app además deja el comentario en el chat del pedido (con su aviso al celular).
--
--   Quién: cualquiera que vea el pedido (erp__sr_visible). Borrar: solo el autor y
--   solo mientras no esté atendido. Nada más se borra.
-- No borra datos. Es idempotente.
-- =====================================================================

create table if not exists public.erp_sr_item_comments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.erp_stock_requests(id) on delete cascade,
  item_id uuid not null,
  product_id uuid,
  store_id uuid not null,
  user_id uuid,
  user_name text,
  body text not null check (length(btrim(body)) between 1 and 600),
  tag text not null default 'note' check (tag in ('note', 'more', 'variant', 'damaged', 'swap', 'photo', 'ok')),
  qty integer check (qty is null or qty between 1 and 100000),
  resolved_at timestamptz,
  resolved_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists erp_sr_item_comments_request on public.erp_sr_item_comments (request_id, created_at);
alter table public.erp_sr_item_comments enable row level security;
-- Sin políticas: solo se usa por las funciones de abajo.
revoke all on public.erp_sr_item_comments from anon, authenticated;

/** Agregar un comentario a un producto del pedido. */
create or replace function public.erp_sr_item_comment_add(p_request uuid, p_item uuid, p_body text, p_tag text default 'note', p_qty integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.erp_stock_requests; it public.erp_stock_request_items; v_id uuid; v_body text := btrim(coalesce(p_body, ''));
begin
  if auth.uid() is null then raise exception 'Inicia sesión.'; end if;
  select * into r from public.erp_stock_requests where id = p_request;
  if not found or not public.erp__sr_visible(p_request) then raise exception 'Pedido no encontrado.'; end if;
  select * into it from public.erp_stock_request_items where id = p_item and request_id = r.id;
  if not found then raise exception 'Ese producto no está en el pedido.'; end if;
  if coalesce(p_tag, 'note') not in ('note', 'more', 'variant', 'damaged', 'swap', 'photo', 'ok') then raise exception 'Etiqueta no válida.'; end if;
  if v_body = '' then raise exception 'Escribe el comentario.'; end if;
  if length(v_body) > 600 then raise exception 'El comentario es muy largo (máximo 600 letras).'; end if;
  if p_qty is not null and (p_qty < 1 or p_qty > 100000) then raise exception 'La cantidad no es válida.'; end if;
  -- Freno contra envíos repetidos por error (doble toque).
  if exists (select 1 from public.erp_sr_item_comments c where c.item_id = p_item and c.user_id = auth.uid() and c.body = v_body and c.created_at > now() - interval '10 seconds') then
    raise exception 'Ese comentario ya se envió.';
  end if;
  insert into public.erp_sr_item_comments (request_id, item_id, product_id, store_id, user_id, user_name, body, tag, qty)
  values (r.id, p_item, it.product_id, r.store_id, auth.uid(), public.erp_actor_name(r.store_id), v_body, coalesce(p_tag, 'note'), p_qty)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function public.erp_sr_item_comment_add(uuid, uuid, text, text, integer) from public, anon;
grant execute on function public.erp_sr_item_comment_add(uuid, uuid, text, text, integer) to authenticated;

/** Los comentarios de todos los productos del pedido. */
create or replace function public.erp_sr_item_comments(p_request uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.erp__sr_visible(p_request) then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'item_id', c.item_id, 'by', c.user_name, 'mine', c.user_id = auth.uid(), 'body', c.body, 'tag', c.tag, 'qty', c.qty,
      'at', c.created_at, 'resolved_at', c.resolved_at, 'resolved_by', c.resolved_by_name) order by c.created_at)
    from public.erp_sr_item_comments c where c.request_id = p_request), '[]'::jsonb);
end $$;
revoke all on function public.erp_sr_item_comments(uuid) from public, anon;
grant execute on function public.erp_sr_item_comments(uuid) to authenticated;

/** Marcar (o desmarcar) un comentario como atendido. */
create or replace function public.erp_sr_item_comment_resolve(p_comment uuid, p_on boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.erp_sr_item_comments;
begin
  if auth.uid() is null then raise exception 'Inicia sesión.'; end if;
  select * into c from public.erp_sr_item_comments where id = p_comment for update;
  if not found or not public.erp__sr_visible(c.request_id) then raise exception 'Comentario no encontrado.'; end if;
  if p_on then
    update public.erp_sr_item_comments set resolved_at = coalesce(resolved_at, now()), resolved_by_name = coalesce(resolved_by_name, public.erp_actor_name(c.store_id)) where id = c.id;
  else
    update public.erp_sr_item_comments set resolved_at = null, resolved_by_name = null where id = c.id;
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.erp_sr_item_comment_resolve(uuid, boolean) from public, anon;
grant execute on function public.erp_sr_item_comment_resolve(uuid, boolean) to authenticated;

/** Borrar un comentario propio que aún no se ha atendido. */
create or replace function public.erp_sr_item_comment_delete(p_comment uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.erp_sr_item_comments;
begin
  if auth.uid() is null then raise exception 'Inicia sesión.'; end if;
  select * into c from public.erp_sr_item_comments where id = p_comment for update;
  if not found then raise exception 'Comentario no encontrado.'; end if;
  if c.user_id is distinct from auth.uid() then raise exception 'Solo quien lo escribió puede borrarlo.'; end if;
  if c.resolved_at is not null then raise exception 'Ya está atendido: no se puede borrar.'; end if;
  delete from public.erp_sr_item_comments where id = c.id;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.erp_sr_item_comment_delete(uuid) from public, anon;
grant execute on function public.erp_sr_item_comment_delete(uuid) to authenticated;

notify pgrst, 'reload schema';
