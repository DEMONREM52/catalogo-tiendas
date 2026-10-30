-- =====================================================================
-- REMHUB · Pedidos internos: enlace para firmar sin iniciar sesión (sobre 20261275)
--
--   Un solo enlace por pedido (/firma-pedido/<enlace>) que sirve todo el recorrido:
--   · Antes de enviar: los bodegueros firman «Preparó» y «Revisó» desde su celular.
--   · Cuando sale: la misma página lleva al seguimiento del traslado, donde se
--     firma «En camino» y «Recibió» (como siempre).
--   · Cada firma por enlace queda en el chat del pedido y en la auditoría, y se
--     copia al traslado (erp__sr_push_signature).
--
--   erp_sr_sign_link (panel) · erp_sr_sign_link_get / erp_sr_sign_link_sign (público)
-- No borra datos. Es idempotente.
-- =====================================================================

create table if not exists public.erp_sr_sign_links (
  token text primary key default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  request_id uuid not null references public.erp_stock_requests(id) on delete cascade,
  store_id uuid not null,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 days'
);
create index if not exists erp_sr_sign_links_request on public.erp_sr_sign_links (request_id);
alter table public.erp_sr_sign_links enable row level security;
revoke all on public.erp_sr_sign_links from anon, authenticated;

/** El enlace de firmas del pedido (lo crea o renueva). Lo puede pedir quien atiende o quien pidió. */
create or replace function public.erp_sr_sign_link(p_request uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.erp_stock_requests; v_acc jsonb; l public.erp_sr_sign_links; v_new boolean := false;
begin
  select * into r from public.erp_stock_requests where id = p_request;
  if not found then raise exception 'Pedido no encontrado.'; end if;
  v_acc := public.erp__sr_access(r.store_id, r.from_point_id, r.to_point_id);
  if not (coalesce((v_acc ->> 'attend')::boolean, false) or coalesce((v_acc ->> 'request')::boolean, false)) then
    raise exception 'No puedes compartir las firmas de este pedido.';
  end if;
  if r.status in ('rejected', 'cancelled') then raise exception 'El pedido está cerrado.'; end if;
  select * into l from public.erp_sr_sign_links where request_id = r.id and expires_at > now() order by created_at desc limit 1;
  if l.token is null then
    insert into public.erp_sr_sign_links (request_id, store_id, created_by, created_by_name)
    values (r.id, r.store_id, auth.uid(), public.erp_actor_name(r.store_id)) returning * into l;
    v_new := true;
  else
    update public.erp_sr_sign_links set expires_at = now() + interval '15 days' where token = l.token returning * into l;
  end if;
  if v_new then
    perform public.erp__sr_system(r.id, '🔗 ' || public.erp_actor_name(r.store_id) || ' creó el enlace de firmas del pedido (vale 15 días).');
  end if;
  return jsonb_build_object('token', l.token, 'expires_at', l.expires_at,
    'transfer_token', (select to_jsonb(t) ->> 'track_token' from public.erp_transfers t where t.id = r.transfer_id));
end $$;
revoke all on function public.erp_sr_sign_link(uuid) from public, anon;
grant execute on function public.erp_sr_sign_link(uuid) to authenticated;

-- El pedido de un enlace (vigente).
create or replace function public.erp__sr_by_link(p_token text)
returns public.erp_stock_requests language plpgsql stable security definer set search_path = public as $$
declare r public.erp_stock_requests;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception 'El enlace no es válido.'; end if;
  select q.* into r from public.erp_sr_sign_links l join public.erp_stock_requests q on q.id = l.request_id where l.token = p_token;
  if r.id is null then raise exception 'El enlace no es válido.'; end if;
  if (select expires_at from public.erp_sr_sign_links where token = p_token) < now() and r.status in ('pending', 'preparing') then
    raise exception 'El enlace venció. Pide uno nuevo a quien te lo mandó.';
  end if;
  return r;
end $$;
revoke all on function public.erp__sr_by_link(text) from public, anon, authenticated;

/** (Público) Lo que se ve al abrir el enlace: el pedido, sus productos y sus firmas. */
create or replace function public.erp_sr_sign_link_get(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r public.erp_stock_requests;
begin
  r := public.erp__sr_by_link(p_token);
  return jsonb_build_object(
    'number', r.number, 'status', r.status, 'priority', r.priority, 'note', r.note, 'needed_by', r.needed_by,
    'requested_by_name', r.requested_by_name, 'handled_by_name', r.handled_by_name, 'created_at', r.created_at,
    'expires_at', (select expires_at from public.erp_sr_sign_links where token = p_token),
    'store', (select jsonb_build_object('name', s.name, 'logo_url', s.logo_url) from public.stores s where s.id = r.store_id),
    'from', (select jsonb_build_object('name', w.name, 'kind', w.kind) from public.erp_warehouses w where w.id = r.from_point_id),
    'to', (select jsonb_build_object('name', w.name, 'kind', w.kind) from public.erp_warehouses w where w.id = r.to_point_id),
    'items', coalesce((select jsonb_agg(jsonb_build_object('name', p.name, 'image_url', p.image_url, 'sku', p.sku,
                         'requested', i.qty_requested, 'approved', i.qty_approved, 'received', i.qty_received, 'note', i.note) order by p.name)
                       from public.erp_stock_request_items i join public.products p on p.id = i.product_id where i.request_id = r.id), '[]'::jsonb),
    'signatures', coalesce((select jsonb_agg(jsonb_build_object('step', s.step, 'signer_name', s.signer_name, 'signer_doc', s.signer_doc,
                              'signature', s.signature, 'notes', s.notes, 'via', s.via, 'signed_at', s.signed_at) order by s.signed_at)
                            from public.erp_stock_request_signatures s where s.request_id = r.id), '[]'::jsonb),
    'transfer', (select jsonb_build_object('number', t.number, 'status', t.status, 'track_token', to_jsonb(t) ->> 'track_token')
                 from public.erp_transfers t where t.id = r.transfer_id)
  );
end $$;
revoke all on function public.erp_sr_sign_link_get(text) from public;
grant execute on function public.erp_sr_sign_link_get(text) to anon, authenticated;

/** (Público) Firmar «Preparó» o «Revisó» desde el enlace, antes de que el pedido salga. */
create or replace function public.erp_sr_sign_link_sign(p_token text, p_step text, p_name text, p_doc text, p_signature text, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.erp_stock_requests; v_name text := upper(left(btrim(coalesce(p_name, '')), 80)); v_label text;
begin
  r := public.erp__sr_by_link(p_token);
  select * into r from public.erp_stock_requests where id = r.id for update;
  if p_step not in ('packed', 'sent') then
    raise exception 'Desde aquí se firma «Preparó» y «Revisó». «En camino» y «Recibió» se firman en el seguimiento del envío.';
  end if;
  if r.status not in ('pending', 'preparing') then raise exception 'El pedido ya salió o está cerrado.'; end if;
  if exists (select 1 from public.erp_stock_request_signatures where request_id = r.id and step = p_step) then
    raise exception 'Ese paso ya está firmado.';
  end if;
  if p_step = 'sent' and not exists (select 1 from public.erp_stock_request_signatures where request_id = r.id and step = 'packed') then
    raise exception 'Primero se firma «Preparó».';
  end if;
  if char_length(v_name) < 3 then raise exception 'Escribe tu nombre completo.'; end if;
  if p_signature is null or p_signature !~ '^data:image/(png|jpeg|webp);base64,' or char_length(p_signature) > 400000 then
    raise exception 'Dibuja tu firma.';
  end if;

  insert into public.erp_stock_request_signatures (request_id, store_id, step, signer_name, signer_doc, signature, notes, via, user_id)
  values (r.id, r.store_id, p_step, v_name, left(nullif(btrim(coalesce(p_doc, '')), ''), 30), p_signature,
          left(nullif(btrim(coalesce(p_notes, '')), ''), 500), 'link', null);
  v_label := public.erp__sr_step_label(p_step);

  -- Firmar «Preparó» es empezar a preparar.
  if r.status = 'pending' then
    update public.erp_stock_requests set status = 'preparing', handled_by_name = coalesce(handled_by_name, v_name), updated_at = now() where id = r.id;
  end if;
  insert into public.erp_stock_request_messages (request_id, store_id, user_id, user_name, kind, body)
  values (r.id, r.store_id, null, null, 'system',
          '✍️ ' || v_name || ' firmó «' || v_label || '» desde el enlace' || case when nullif(btrim(coalesce(p_notes, '')), '') is not null then ': ' || btrim(p_notes) else '' end || '.');
  update public.erp_stock_requests set last_message_at = now(), updated_at = now() where id = r.id;
  perform public.erp__sr_push_signature(r.id, p_step);
  begin
    perform public.erp_audit(r.store_id, 'stock_request.signed_by_link', 'erp_stock_requests', r.id,
      jsonb_build_object('number', r.number, 'step', p_step, 'signer', v_name, 'doc', nullif(btrim(coalesce(p_doc, '')), '')));
  exception when undefined_function then null;
  end;
  return public.erp_sr_sign_link_get(p_token);
end $$;
revoke all on function public.erp_sr_sign_link_sign(text, text, text, text, text, text) from public;
grant execute on function public.erp_sr_sign_link_sign(text, text, text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
