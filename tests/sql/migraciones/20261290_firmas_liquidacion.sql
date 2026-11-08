-- =====================================================================
-- 20261290 · Firmas virtuales de las liquidaciones
--
-- Pedido del usuario (2026-11-08): que cada liquidación quede firmada para saber quiénes fueron los
-- responsables ante cualquier problema. Igual que los vales (20261262):
--   · La liquidación tiene un enlace. Ahí firman con el dedo:
--       - quien PREPARÓ   (con su sesión de RemHub y «Preparar liquidaciones»),
--       - quien APROBÓ    (con su sesión y «Aprobar liquidaciones»; solo ya aprobada),
--       - cada BENEFICIARIO (sin cuenta: nombre, cédula y «estoy de acuerdo con lo que me corresponde»).
--   · Cada firma guarda una copia exacta de lo que se firmó (números de la liquidación) y su huella,
--     fecha, hora, IP y navegador. Todo queda en la auditoría.
--   · Una liquidación rechazada o revertida ya no se firma (las firmas que tenía quedan como historial).
-- Además: quiénes pueden aprobar una liquidación (para «Enviar a revisión»).
-- No borra datos. Es idempotente.
-- =====================================================================

alter table public.erp_settlements add column if not exists sign_token text;
create unique index if not exists erp_settlements_sign_token on public.erp_settlements (sign_token) where sign_token is not null;

create table if not exists public.erp_settlement_signatures (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  settlement_id uuid not null references public.erp_settlements(id),
  role text not null check (role in ('prepared', 'approved', 'beneficiary')),
  beneficiary_id uuid references public.erp_beneficiaries(id),
  signer_name text not null,
  signer_doc text,
  signature text not null,          -- PNG (data:image/png;base64,…)
  terms jsonb not null,             -- copia de lo que se firmó
  terms_hash text not null,
  user_id uuid,
  ip text,
  user_agent text,
  signed_at timestamptz not null default now(),
  check ((role = 'beneficiary') = (beneficiary_id is not null))
);
create index if not exists erp_settlement_signatures_settlement on public.erp_settlement_signatures (settlement_id, role);
alter table public.erp_settlement_signatures enable row level security;
revoke all on public.erp_settlement_signatures from anon, authenticated;

-- Lo que se firma: los números de la liquidación (no cambian después de calcularla; los pagos van aparte).
create or replace function public.erp__settlement_terms(p_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'number', s.number, 'point', w.name, 'cutoff', s.cutoff, 'mode', s.mode,
    'gross_total', s.gross_total, 'expenses_total', s.expenses_total, 'pool_total', s.pool_total, 'carried_total', s.carried_total,
    'shared_expenses_total', s.advances_total, 'merch_cost', to_jsonb(s)->'merch_cost', 'cost_advances_total', to_jsonb(s)->'cost_advances_total', 'cost_due', to_jsonb(s)->'cost_due',
    'prepared_by', s.created_by_name,
    'lines', (select coalesce(jsonb_agg(jsonb_build_object('beneficiary_id', l.beneficiary_id, 'name', b.name, 'document', b.document, 'pct', l.pct,
                       'share_amount', l.share_amount, 'carried_amount', l.carried_amount, 'deductions', l.advance_amount, 'amount', l.amount) order by l.pct desc, b.name), '[]'::jsonb)
              from public.erp_settlement_lines l join public.erp_beneficiaries b on b.id = l.beneficiary_id where l.settlement_id = s.id))
  from public.erp_settlements s left join public.erp_warehouses w on w.id = s.point_id
  where s.id = p_id;
$$;
revoke all on function public.erp__settlement_terms(uuid) from public, anon, authenticated;

create or replace function public.erp__settlement_can_view(p_store uuid, p_point uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and (public.erp_can(p_store, 'profit_view') or public.erp_can(p_store, 'profit_settle') or public.erp_can(p_store, 'profit_settle_approve') or public.erp_can(p_store, 'profit_pay'))
     and public.erp__pool_allowed(p_store, p_point);
$$;
revoke all on function public.erp__settlement_can_view(uuid, uuid) from public, anon, authenticated;

-- Quiénes pueden aprobar esta liquidación (para mostrar a quién va la revisión y avisarles).
create or replace function public.erp__settlement_approvers(p_id uuid)
returns table (user_id uuid, name text)
language sql stable security definer set search_path = public as $$
  with s as (select * from public.erp_settlements where id = p_id)
  select st.owner_id, coalesce((select su.display_name from public.store_users su where su.store_id = st.id and su.user_id = st.owner_id), 'Dueño de la tienda')
  from s join public.stores st on st.id = s.store_id
  union
  select su.user_id, coalesce(nullif(su.display_name, ''), su.username, 'Usuario')
  from s join public.store_users su on su.store_id = s.store_id
  where su.active
    and (su.role = 'store_admin' or 'profit_settle_approve' = any (coalesce(su.permissions, '{}'::text[])))
    and (su.role = 'store_admin' or su.point_id is null or s.point_id is null or su.point_id = s.point_id or s.point_id = any (coalesce(su.point_ids, '{}'::uuid[])))
    and (s.point_id is not null or su.point_id is null or su.role = 'store_admin');
$$;
revoke all on function public.erp__settlement_approvers(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- panel
create or replace function public.erp_settlement_sign_link(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.erp_settlements; v_token text;
begin
  select * into s from public.erp_settlements where id = p_id for update;
  if not found then raise exception 'Liquidación no encontrada.'; end if;
  if not public.erp__settlement_can_view(s.store_id, s.point_id) then raise exception 'No tienes acceso a esta liquidación.'; end if;
  if s.status in ('rejected', 'reverted') then raise exception 'Esta liquidación fue rechazada o revertida: ya no se firma.'; end if;
  v_token := s.sign_token;
  if v_token is null then
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    update public.erp_settlements set sign_token = v_token where id = s.id;
  end if;
  return jsonb_build_object('ok', true, 'token', v_token, 'number', s.number);
end $$;
revoke all on function public.erp_settlement_sign_link(uuid) from public, anon;
grant execute on function public.erp_settlement_sign_link(uuid) to authenticated;

-- Estado de las firmas y quiénes aprueban (con las imágenes, para el detalle y el informe).
create or replace function public.erp_settlement_signs(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.erp_settlements; v_hash text;
begin
  select * into s from public.erp_settlements where id = p_id;
  if not found then raise exception 'Liquidación no encontrada.'; end if;
  if not public.erp__settlement_can_view(s.store_id, s.point_id) then raise exception 'No tienes acceso a esta liquidación.'; end if;
  v_hash := md5(public.erp__settlement_terms(s.id)::text);
  return jsonb_build_object('ok', true, 'has_link', s.sign_token is not null, 'token', s.sign_token,
    'signatures', coalesce((select jsonb_agg(jsonb_build_object('role', g.role, 'beneficiary_id', g.beneficiary_id, 'name', g.signer_name, 'doc', g.signer_doc,
                              'signature', g.signature, 'at', g.signed_at, 'ip', g.ip) order by g.signed_at)
                            from public.erp_settlement_signatures g where g.settlement_id = s.id and g.terms_hash = v_hash), '[]'::jsonb),
    'approvers', coalesce((select jsonb_agg(jsonb_build_object('user_id', a.user_id, 'name', a.name) order by a.name)
                           from public.erp__settlement_approvers(s.id) a where a.user_id is distinct from s.created_by), '[]'::jsonb));
end $$;
revoke all on function public.erp_settlement_signs(uuid) from public, anon;
grant execute on function public.erp_settlement_signs(uuid) to authenticated;

-- ---------------------------------------------------------------- página pública del enlace
create or replace function public.settlement_sign_get(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.erp_settlements; v_terms jsonb; v_hash text;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{40,80}$' then return jsonb_build_object('ok', false); end if;
  select * into s from public.erp_settlements where sign_token = p_token;
  if not found then return jsonb_build_object('ok', false); end if;
  v_terms := public.erp__settlement_terms(s.id);
  v_hash := md5(v_terms::text);
  return jsonb_build_object('ok', true, 'status', s.status, 'terms', v_terms, 'created_at', s.created_at, 'decided_by_name', s.decided_by_name, 'decided_at', s.decided_at,
    'store', (select jsonb_build_object('name', st.name, 'logo_url', to_jsonb(st)->>'logo_url') from public.stores st where st.id = s.store_id),
    'can_sign_prepared', auth.uid() is not null and public.erp_can(s.store_id, 'profit_settle') and public.erp__pool_allowed(s.store_id, s.point_id),
    'can_sign_approved', auth.uid() is not null and public.erp_can(s.store_id, 'profit_settle_approve') and public.erp__pool_allowed(s.store_id, s.point_id),
    'actor_name', case when auth.uid() is not null and public.erp__settlement_can_view(s.store_id, s.point_id) then public.erp_actor_name(s.store_id) end,
    'signatures', coalesce((select jsonb_agg(jsonb_build_object('role', g.role, 'beneficiary_id', g.beneficiary_id, 'name', g.signer_name, 'doc', g.signer_doc,
                              'signature', g.signature, 'at', g.signed_at) order by g.signed_at)
                            from public.erp_settlement_signatures g where g.settlement_id = s.id and g.terms_hash = v_hash), '[]'::jsonb));
end $$;
revoke all on function public.settlement_sign_get(text) from public;
grant execute on function public.settlement_sign_get(text) to anon, authenticated;

create or replace function public.settlement_sign(p_token text, p_role text, p_beneficiary uuid, p_name text, p_doc text, p_signature text, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.erp_settlements; v_terms jsonb; v_hash text; h jsonb;
        v_name text := upper(btrim(coalesce(p_name, ''))); v_doc text := nullif(regexp_replace(coalesce(p_doc, ''), '[^0-9A-Za-z]', '', 'g'), '');
begin
  if p_token is null or p_token !~ '^[a-f0-9]{40,80}$' then raise exception 'El enlace no es válido.'; end if;
  select * into s from public.erp_settlements where sign_token = p_token for update;
  if not found then raise exception 'El enlace no es válido.'; end if;
  if s.status in ('rejected', 'reverted') then raise exception 'Esta liquidación fue rechazada o revertida: ya no se firma.'; end if;
  if p_role not in ('prepared', 'approved', 'beneficiary') then raise exception 'Firma no válida.'; end if;
  if char_length(v_name) < 3 or char_length(v_name) > 120 then raise exception 'Escribe tu nombre completo.'; end if;
  if p_signature is null or p_signature !~ '^data:image/png;base64,[A-Za-z0-9+/=]+$' or char_length(p_signature) > 400000 then raise exception 'Dibuja tu firma.'; end if;
  if not coalesce(p_accept, false) then raise exception 'Marca que estás de acuerdo para poder firmar.'; end if;

  if p_role = 'prepared' then
    if not (auth.uid() is not null and public.erp_can(s.store_id, 'profit_settle') and public.erp__pool_allowed(s.store_id, s.point_id)) then
      raise exception 'Quien prepara firma con su sesión de RemHub («Preparar liquidaciones»).';
    end if;
    p_beneficiary := null;
  elsif p_role = 'approved' then
    if not (auth.uid() is not null and public.erp_can(s.store_id, 'profit_settle_approve') and public.erp__pool_allowed(s.store_id, s.point_id)) then
      raise exception 'Quien aprueba firma con su sesión de RemHub («Aprobar liquidaciones»).';
    end if;
    if s.status not in ('approved', 'partially_paid', 'paid') then raise exception 'Primero hay que aprobar la liquidación; después se firma la aprobación.'; end if;
    p_beneficiary := null;
  else
    if p_beneficiary is null or not exists (select 1 from public.erp_settlement_lines l where l.settlement_id = s.id and l.beneficiary_id = p_beneficiary) then
      raise exception 'Escoge a qué beneficiario corresponde la firma.';
    end if;
    if v_doc is null or char_length(v_doc) < 5 then raise exception 'Escribe el número de cédula o NIT.'; end if;
  end if;

  v_terms := public.erp__settlement_terms(s.id);
  v_hash := md5(v_terms::text);
  if exists (select 1 from public.erp_settlement_signatures g where g.settlement_id = s.id and g.role = p_role
             and g.beneficiary_id is not distinct from p_beneficiary and g.terms_hash = v_hash) then
    raise exception '%', case p_role when 'prepared' then 'Quien preparó ya firmó.' when 'approved' then 'Quien aprobó ya firmó.' else 'Ese beneficiario ya firmó.' end;
  end if;
  begin h := nullif(current_setting('request.headers', true), '')::jsonb; exception when others then h := null; end;
  insert into public.erp_settlement_signatures (store_id, settlement_id, role, beneficiary_id, signer_name, signer_doc, signature, terms, terms_hash, user_id, ip, user_agent)
  values (s.store_id, s.id, p_role, p_beneficiary, v_name, v_doc, p_signature, v_terms, v_hash, auth.uid(),
    nullif(btrim(split_part(coalesce(h->>'x-remhub-client-ip', h->>'x-forwarded-for', h->>'x-real-ip', ''), ',', 1)), ''), left(h->>'user-agent', 300));
  perform public.erp_audit(s.store_id, 'settlement.signed', 'erp_settlements', s.id,
    jsonb_build_object('number', s.number, 'role', p_role, 'beneficiary_id', p_beneficiary, 'name', v_name, 'doc', v_doc, 'hash', v_hash));
  return public.settlement_sign_get(p_token);
end $$;
revoke all on function public.settlement_sign(text, text, uuid, text, text, text, boolean) from public;
grant execute on function public.settlement_sign(text, text, uuid, text, text, text, boolean) to anon, authenticated;

-- Para el aviso al celular (solo el servidor): a quién avisar de una liquidación.
create or replace function public.erp_settlement_push_audience(p_id uuid, p_event text)
returns table (user_id uuid)
language sql stable security definer set search_path = public as $$
  select a.user_id from public.erp__settlement_approvers(p_id) a
  where p_event = 'submitted' and a.user_id is distinct from (select created_by from public.erp_settlements where id = p_id)
  union
  select x from (select unnest(array[s.created_by, s.submitted_by]) as x from public.erp_settlements s where s.id = p_id) q
  where p_event in ('approved', 'rejected') and x is not null;
$$;
revoke all on function public.erp_settlement_push_audience(uuid, text) from public, anon, authenticated;
grant execute on function public.erp_settlement_push_audience(uuid, text) to service_role;

notify pgrst, 'reload schema';
