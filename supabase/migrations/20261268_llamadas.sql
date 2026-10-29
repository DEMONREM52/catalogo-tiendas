-- =====================================================================
-- REMHUB · Llamadas y videollamadas en los pedidos internos (sobre 20261267)
--
--   La voz y el video van directo entre los equipos (WebRTC). La base solo
--   guarda la llamada para conectarla:
--   · erp_calls: quién llama, de qué pedido, si es con video, la oferta y la
--     respuesta de conexión (SDP) y el estado (ringing → active → ended;
--     missed, declined).
--   · erp_call_invites: a quién le timbra (el equipo del otro punto del
--     pedido con permiso de pedidos internos, más dueño y administradores).
--     El primero que contesta se queda con la llamada.
--   · Cada uno solo lee sus llamadas (RLS) y se entera en vivo (Realtime).
--   · Al terminar queda en el chat: «📞 Llamada de voz · 3:12» o
--     «📞 Llamada perdida».
-- No borra datos. Es idempotente.
-- =====================================================================

create table if not exists public.erp_calls (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  request_id uuid references public.erp_stock_requests(id) on delete set null,
  caller_id uuid not null,
  caller_name text,
  video boolean not null default false,
  status text not null default 'ringing' check (status in ('ringing', 'active', 'ended', 'missed', 'declined')),
  offer jsonb,
  answer jsonb,
  answered_by uuid,
  answered_name text,
  ended_reason text,
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz
);
create index if not exists erp_calls_store_date on public.erp_calls (store_id, created_at desc);

create table if not exists public.erp_call_invites (
  call_id uuid not null references public.erp_calls(id) on delete cascade,
  user_id uuid not null,
  status text not null default 'ringing' check (status in ('ringing', 'answered', 'declined', 'elsewhere', 'missed')),
  created_at timestamptz not null default now(),
  primary key (call_id, user_id)
);
create index if not exists erp_call_invites_user on public.erp_call_invites (user_id, created_at desc);

alter table public.erp_calls enable row level security;
alter table public.erp_call_invites enable row level security;
revoke all on public.erp_calls, public.erp_call_invites from anon, authenticated;
grant select on public.erp_calls, public.erp_call_invites to authenticated;

drop policy if exists erp_calls_read on public.erp_calls;
create policy erp_calls_read on public.erp_calls for select to authenticated using (
  caller_id = auth.uid() or exists (select 1 from public.erp_call_invites i where i.call_id = id and i.user_id = auth.uid()));
drop policy if exists erp_call_invites_read on public.erp_call_invites;
create policy erp_call_invites_read on public.erp_call_invites for select to authenticated using (user_id = auth.uid());

-- En vivo (Realtime): timbre para quien recibe y cambios de estado para los dos.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'erp_calls') then
      execute 'alter publication supabase_realtime add table public.erp_calls';
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'erp_call_invites') then
      execute 'alter publication supabase_realtime add table public.erp_call_invites';
    end if;
  end if;
end $$;

-- Nombre del usuario en la tienda (para «Te llama Andrés»).
create or replace function public.erp__member_name(p_store uuid, p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select nullif(btrim(coalesce(to_jsonb(su) ->> 'display_name', to_jsonb(su) ->> 'username', '')), '') from public.store_users su where su.store_id = p_store and su.user_id = p_user),
    (select 'Dueño' from public.stores s where s.id = p_store and s.owner_id = p_user),
    'Alguien');
$$;

-- ¿Ese usuario (no el actual) atiende ese punto? Sin puntos asignados = todos.
create or replace function public.erp__member_covers(p_store uuid, p_user uuid, p_point uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.stores s where s.id = p_store and s.owner_id = p_user)
    or exists (
      select 1 from public.store_users su, lateral (select to_jsonb(su) j) x
      where su.store_id = p_store and su.user_id = p_user and coalesce((x.j ->> 'active')::boolean, true)
        and (su.role = 'store_admin' or su.permissions && array['stock_requests', 'stock_requests_manage', 'transfers'])
        and (
          (nullif(x.j ->> 'point_id', '') is null and coalesce(jsonb_array_length(case when jsonb_typeof(x.j -> 'point_ids') = 'array' then x.j -> 'point_ids' end), 0) = 0)
          or x.j ->> 'point_id' = p_point::text
          or (jsonb_typeof(x.j -> 'point_ids') = 'array' and (x.j -> 'point_ids') ? p_point::text)
        ));
$$;
revoke all on function public.erp__member_covers(uuid, uuid, uuid) from public, anon, authenticated;

/** Llama al otro punto del pedido. p_offer = oferta WebRTC (con sus candidatos). Devuelve a quiénes les timbra. */
create or replace function public.erp_call_start(p_request uuid, p_video boolean, p_offer jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.erp_stock_requests; v_id uuid; v_mine_from boolean; v_target uuid; v_invited uuid[];
begin
  if auth.uid() is null then raise exception 'Inicia sesión.'; end if;
  select * into r from public.erp_stock_requests where id = p_request;
  if r.id is null or not public.erp__sr_visible(p_request) then raise exception 'No tienes acceso a este pedido.'; end if;
  if p_offer is null or p_offer ->> 'type' <> 'offer' or char_length(coalesce(p_offer ->> 'sdp', '')) < 20 then raise exception 'No se pudo preparar la llamada.'; end if;
  -- Se llama al otro lado del pedido: si soy del punto que pide, al que atiende; si no, al que pide.
  v_mine_from := public.erp__scope_ok(r.store_id, r.from_point_id) and not public.erp__scope_ok(r.store_id, r.to_point_id);
  v_target := case when v_mine_from then r.to_point_id else r.from_point_id end;
  select array_agg(u) into v_invited from (
    select su.user_id u from public.store_users su where su.store_id = r.store_id and su.user_id <> auth.uid()
    union select s.owner_id from public.stores s where s.id = r.store_id and s.owner_id <> auth.uid()
  ) m where public.erp__member_covers(r.store_id, m.u, v_target);
  if coalesce(cardinality(v_invited), 0) = 0 then raise exception 'No hay nadie con acceso en el otro punto para contestar.'; end if;
  -- Llamadas viejas mías que quedaron timbrando: se cierran.
  update public.erp_calls set status = 'missed', ended_at = now(), ended_reason = 'nueva llamada' where caller_id = auth.uid() and status = 'ringing';
  insert into public.erp_calls (store_id, request_id, caller_id, caller_name, video, offer)
  values (r.store_id, r.id, auth.uid(), public.erp__member_name(r.store_id, auth.uid()), coalesce(p_video, false), p_offer)
  returning id into v_id;
  insert into public.erp_call_invites (call_id, user_id) select v_id, unnest(v_invited);
  return jsonb_build_object('ok', true, 'id', v_id, 'invited', to_jsonb(v_invited));
end $$;
revoke all on function public.erp_call_start(uuid, boolean, jsonb) from public, anon;
grant execute on function public.erp_call_start(uuid, boolean, jsonb) to authenticated;

/** Contestar: el primero se queda con la llamada; a los demás se les deja de timbrar. */
create or replace function public.erp_call_answer(p_call uuid, p_answer jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.erp_calls;
begin
  select * into c from public.erp_calls where id = p_call for update;
  if c.id is null or not exists (select 1 from public.erp_call_invites where call_id = p_call and user_id = auth.uid()) then raise exception 'Esta llamada no es para ti.'; end if;
  if c.status <> 'ringing' then raise exception '%', case when c.status = 'active' then 'Otra persona ya contestó.' else 'La llamada ya terminó.' end; end if;
  if p_answer is null or p_answer ->> 'type' <> 'answer' then raise exception 'No se pudo conectar la llamada.'; end if;
  update public.erp_calls set status = 'active', answer = p_answer, answered_by = auth.uid(), answered_name = public.erp__member_name(c.store_id, auth.uid()), answered_at = now() where id = p_call;
  update public.erp_call_invites set status = case when user_id = auth.uid() then 'answered' else 'elsewhere' end where call_id = p_call and status = 'ringing';
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.erp_call_answer(uuid, jsonb) from public, anon;
grant execute on function public.erp_call_answer(uuid, jsonb) to authenticated;

/** Colgar, rechazar o cancelar. Deja la constancia en el chat del pedido. */
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
    -- Quien recibe rechaza: deja de timbrarle; si ya nadie más puede contestar, la llamada queda rechazada.
    update public.erp_call_invites set status = 'declined' where call_id = p_call and user_id = auth.uid();
    if exists (select 1 from public.erp_call_invites where call_id = p_call and status = 'ringing') then return jsonb_build_object('ok', true, 'status', 'ringing'); end if;
    v_status := 'declined';
  elsif c.status = 'ringing' then
    v_status := 'missed';
  else
    v_status := 'ended';
  end if;
  update public.erp_calls set status = v_status, ended_at = now(), ended_reason = left(coalesce(p_reason, ''), 60) where id = p_call;
  update public.erp_call_invites set status = 'missed' where call_id = p_call and status = 'ringing';

  if c.request_id is not null then
    v_secs := case when c.answered_at is not null then extract(epoch from now() - c.answered_at)::int end;
    v_body := case
      when v_status = 'ended' then (case when c.video then '🎥 Videollamada' else '📞 Llamada de voz' end) || ' · ' || (v_secs / 60) || ':' || lpad((v_secs % 60)::text, 2, '0')
        || ' (' || coalesce(c.caller_name, 'Alguien') || ' con ' || coalesce(c.answered_name, 'Alguien') || ')'
      when v_status = 'declined' then (case when c.video then '🎥 Videollamada' else '📞 Llamada' end) || ' rechazada · llamó ' || coalesce(c.caller_name, 'Alguien')
      else (case when c.video then '🎥 Videollamada' else '📞 Llamada' end) || ' perdida de ' || coalesce(c.caller_name, 'Alguien') end;
    begin
      insert into public.erp_stock_request_messages (request_id, user_id, user_name, body, kind) values (c.request_id, null, null, v_body, 'system');
    exception when others then null; -- la constancia en el chat es opcional
    end;
  end if;
  return jsonb_build_object('ok', true, 'status', v_status);
end $$;
revoke all on function public.erp_call_end(uuid, text) from public, anon;
grant execute on function public.erp_call_end(uuid, text) to authenticated;

notify pgrst, 'reload schema';
