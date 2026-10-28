-- =====================================================================
-- REMHUB · Firmar vales y préstamos con un enlace (sobre 20261240/1261)
--
--   · La tienda saca un enlace del vale y se lo manda al empleado (ej. por
--     WhatsApp). El empleado lo abre en su celular, lee lo que recibe, la
--     deuda, las cuotas y la autorización de descuento, escribe su nombre
--     y cédula, acepta y firma con el dedo.
--   · Quien entrega firma en el mismo enlace, pero solo con su sesión de
--     RemHub y permiso de nómina (el empleado no puede firmar por él).
--   · Cada firma guarda una copia de lo que se firmó y su huella. Si el
--     vale se edita después, las firmas anteriores quedan como historial y
--     se pide firmar otra vez.
--   · Se guarda fecha, hora, IP y navegador. Todo queda en la auditoría.
-- No borra datos. Es idempotente.
-- =====================================================================

alter table public.erp_employee_loans add column if not exists sign_token text;
create unique index if not exists erp_employee_loans_sign_token on public.erp_employee_loans (sign_token) where sign_token is not null;

create table if not exists public.erp_employee_loan_signatures (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  loan_id uuid not null references public.erp_employee_loans(id),
  role text not null check (role in ('employee', 'giver')),
  signer_name text not null,
  signer_doc text,
  signature text not null,          -- PNG (data:image/png;base64,…)
  terms jsonb not null,             -- copia de lo que se firmó
  terms_hash text not null,
  user_id uuid,
  ip text,
  user_agent text,
  signed_at timestamptz not null default now()
);
create index if not exists erp_employee_loan_signatures_loan on public.erp_employee_loan_signatures (loan_id, role);
alter table public.erp_employee_loan_signatures enable row level security;
revoke all on public.erp_employee_loan_signatures from anon, authenticated;

-- Lo que se firma: si cambia algo de esto, hay que firmar otra vez.
create or replace function public.erp__loan_terms(p_loan uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'number', l.number, 'employee', e.full_name, 'document', e.document, 'kind', l.kind, 'description', l.description,
    'items', (select coalesce(jsonb_agg(jsonb_build_object('name', x->>'name', 'qty', (x->>'qty')::integer, 'price', (x->>'price')::numeric)), '[]'::jsonb) from jsonb_array_elements(l.items) x),
    'principal', l.principal, 'interest', l.interest, 'interest_mode', l.interest_mode, 'interest_pct', l.interest_pct, 'total', l.total,
    'installments', l.installments, 'installment', l.installment, 'pay_frequency', e.pay_frequency, 'start_on', l.start_on)
  from public.erp_employee_loans l join public.erp_employees e on e.id = l.employee_id where l.id = p_loan;
$$;
revoke all on function public.erp__loan_terms(uuid) from public, anon, authenticated;

create or replace function public.erp__loan_can_give(p_store uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (public.erp_can(p_store, 'payroll') or public.erp_can(p_store, 'payroll_approve') or public.erp_can(p_store, 'payroll_pay'));
$$;
revoke all on function public.erp__loan_can_give(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- enlace (panel)
create or replace function public.erp_employee_loan_sign_link(p_loan uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.erp_employee_loans; e public.erp_employees; v_token text;
begin
  select * into l from public.erp_employee_loans where id = p_loan for update;
  if not found then raise exception 'Vale no encontrado.'; end if;
  if not public.erp__loan_can_give(l.store_id) then raise exception 'Necesitas un permiso de nómina.'; end if;
  select * into e from public.erp_employees where id = l.employee_id;
  if not public.erp__scope_ok(l.store_id, e.point_id) then raise exception 'Ese empleado no es de tus puntos.'; end if;
  if l.status = 'void' then raise exception 'El vale está anulado.'; end if;
  v_token := l.sign_token;
  if v_token is null then
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    update public.erp_employee_loans set sign_token = v_token where id = l.id;
  end if;
  return jsonb_build_object('ok', true, 'token', v_token, 'employee', e.full_name, 'phone', e.phone, 'number', l.number);
end $$;
revoke all on function public.erp_employee_loan_sign_link(uuid) from public, anon;
grant execute on function public.erp_employee_loan_sign_link(uuid) to authenticated;

-- Estado de las firmas de los vales de la tienda (para la lista del panel; sin las imágenes).
create or replace function public.erp_employee_loans_signs(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.erp__loan_can_give(p_store) then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true, 'signs', coalesce((
    select jsonb_object_agg(l.id, jsonb_build_object(
      'link', l.sign_token is not null,
      'employee', (select jsonb_build_object('name', s.signer_name, 'at', s.signed_at) from public.erp_employee_loan_signatures s
                   where s.loan_id = l.id and s.role = 'employee' and s.terms_hash = md5(public.erp__loan_terms(l.id)::text) order by s.signed_at desc limit 1),
      'giver', (select jsonb_build_object('name', s.signer_name, 'at', s.signed_at) from public.erp_employee_loan_signatures s
                where s.loan_id = l.id and s.role = 'giver' and s.terms_hash = md5(public.erp__loan_terms(l.id)::text) order by s.signed_at desc limit 1),
      'changed', exists (select 1 from public.erp_employee_loan_signatures s where s.loan_id = l.id and s.terms_hash <> md5(public.erp__loan_terms(l.id)::text))))
    from public.erp_employee_loans l
    where l.store_id = p_store and (l.sign_token is not null or exists (select 1 from public.erp_employee_loan_signatures s where s.loan_id = l.id))), '{}'::jsonb));
end $$;
revoke all on function public.erp_employee_loans_signs(uuid) from public, anon;
grant execute on function public.erp_employee_loans_signs(uuid) to authenticated;

-- ---------------------------------------------------------------- página pública del enlace
create or replace function public.loan_sign_get(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare l public.erp_employee_loans; v_terms jsonb; v_hash text;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{40,80}$' then return jsonb_build_object('ok', false); end if;
  select * into l from public.erp_employee_loans where sign_token = p_token;
  if not found then return jsonb_build_object('ok', false); end if;
  v_terms := public.erp__loan_terms(l.id);
  v_hash := md5(v_terms::text);
  return jsonb_build_object('ok', true, 'status', l.status, 'terms', v_terms, 'notes', l.notes, 'created_at', l.created_at, 'created_by_name', l.created_by_name,
    'store', (select jsonb_build_object('name', s.name, 'logo_url', to_jsonb(s)->>'logo_url') from public.stores s where s.id = l.store_id),
    'can_sign_giver', public.erp__loan_can_give(l.store_id),
    'actor_name', case when public.erp__loan_can_give(l.store_id) then public.erp_actor_name(l.store_id) end,
    'signatures', coalesce((select jsonb_agg(jsonb_build_object('role', s.role, 'name', s.signer_name, 'doc', s.signer_doc, 'signature', s.signature, 'at', s.signed_at)
        order by s.signed_at) from public.erp_employee_loan_signatures s where s.loan_id = l.id and s.terms_hash = v_hash), '[]'::jsonb),
    'changed', exists (select 1 from public.erp_employee_loan_signatures s where s.loan_id = l.id and s.terms_hash <> v_hash));
end $$;
revoke all on function public.loan_sign_get(text) from public;
grant execute on function public.loan_sign_get(text) to anon, authenticated;

create or replace function public.loan_sign(p_token text, p_role text, p_name text, p_doc text, p_signature text, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.erp_employee_loans; v_terms jsonb; v_hash text; h jsonb; v_name text := upper(btrim(coalesce(p_name, ''))); v_doc text := nullif(regexp_replace(coalesce(p_doc, ''), '[^0-9A-Za-z]', '', 'g'), '');
begin
  if p_token is null or p_token !~ '^[a-f0-9]{40,80}$' then raise exception 'El enlace no es válido.'; end if;
  select * into l from public.erp_employee_loans where sign_token = p_token for update;
  if not found then raise exception 'El enlace no es válido.'; end if;
  if l.status = 'void' then raise exception 'Este vale fue anulado: ya no se firma.'; end if;
  if p_role not in ('employee', 'giver') then raise exception 'Firma no válida.'; end if;
  if char_length(v_name) < 3 or char_length(v_name) > 120 then raise exception 'Escribe tu nombre completo.'; end if;
  if p_signature is null or p_signature !~ '^data:image/png;base64,[A-Za-z0-9+/=]+$' or char_length(p_signature) > 400000 then raise exception 'Dibuja tu firma.'; end if;
  if p_role = 'employee' then
    if not coalesce(p_accept, false) then raise exception 'Marca que estás de acuerdo para poder firmar.'; end if;
    if v_doc is null or char_length(v_doc) < 5 then raise exception 'Escribe tu número de cédula.'; end if;
  elsif not public.erp__loan_can_give(l.store_id) then
    raise exception 'Quien entrega firma con su sesión de RemHub (permiso de nómina).';
  end if;

  v_terms := public.erp__loan_terms(l.id);
  v_hash := md5(v_terms::text);
  if exists (select 1 from public.erp_employee_loan_signatures where loan_id = l.id and role = p_role and terms_hash = v_hash) then
    raise exception '%', case when p_role = 'employee' then 'El empleado ya firmó este vale.' else 'Quien entrega ya firmó este vale.' end;
  end if;
  begin h := nullif(current_setting('request.headers', true), '')::jsonb; exception when others then h := null; end;
  insert into public.erp_employee_loan_signatures (store_id, loan_id, role, signer_name, signer_doc, signature, terms, terms_hash, user_id, ip, user_agent)
  values (l.store_id, l.id, p_role, v_name, v_doc, p_signature, v_terms, v_hash, auth.uid(),
    nullif(btrim(split_part(coalesce(h->>'x-remhub-client-ip', h->>'x-forwarded-for', h->>'x-real-ip', ''), ',', 1)), ''), left(h->>'user-agent', 300));
  perform public.erp_audit(l.store_id, 'employee_loan.signed', 'erp_employee_loans', l.id, jsonb_build_object('number', l.number, 'role', p_role, 'name', v_name, 'doc', v_doc, 'total', v_terms->'total'));
  return public.loan_sign_get(p_token);
end $$;
revoke all on function public.loan_sign(text, text, text, text, text, boolean) from public;
grant execute on function public.loan_sign(text, text, text, text, text, boolean) to anon, authenticated;

notify pgrst, 'reload schema';
