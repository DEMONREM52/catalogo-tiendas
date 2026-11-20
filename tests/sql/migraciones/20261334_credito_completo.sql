-- =====================================================================
-- REMHUB · Crédito completo
--
--   1. Consumidor final (o un cliente sin cédula/NIT) no puede tener
--      crédito: ni cuenta por cobrar nueva ni «crédito activo» en su ficha.
--   2. El comprobante dice que la venta fue A CRÉDITO: plazo, vencimiento,
--      abonado y saldo (erp_order_payment_by_token ahora lo incluye).
--   3. erp_orders_credit: qué documentos del POS son a crédito y su saldo.
--   4. Notas crédito (bajan la deuda) y notas débito / ajustes (la suben)
--      sobre cada documento de cartera, con número propio (NC-00001,
--      ND-00001), motivo, quién y cuándo; se pueden anular con motivo.
--      Solo con el permiso «Créditos», en documentos confirmados y nunca
--      sobre facturas electrónicas ya enviadas (esas van por la DIAN).
--      La nota cambia total y saldo del documento juntos: lo abonado no
--      cambia, así cobros y liquidaciones siguen cuadrando.
--   5. Estado de cuenta para el cliente: enlace privado (vence a los 30
--      días) que abre una hoja con lo que debe, vencimientos, abonos y
--      notas. Se imprime o se guarda en PDF desde ahí.
-- No borra datos. No cambia permisos. Es idempotente.
-- =====================================================================

-- ------------------------------------------------------------------ 1. Consumidor final sin crédito
create or replace function public.erp__is_final_consumer(p_name text, p_doc text)
returns boolean
language sql
immutable
as $$
  select regexp_replace(coalesce(p_doc, ''), '\D', '', 'g') ~ '^(\d)\1*$'           -- vacío, 222222222222, 0, 1111…
      or regexp_replace(coalesce(p_doc, ''), '\D', '', 'g') = ''
      or btrim(coalesce(p_name, '')) = ''
      or lower(regexp_replace(p_name, '\s+', ' ', 'g')) ~ '(consumidor final|cliente general|cliente (de )?mostrador|cliente ocasional|sin nombre)';
$$;

create or replace function public.erp__receivable_no_final_consumer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare c jsonb;
begin
  if new.customer_id is null then return new; end if;
  select to_jsonb(b) into c from public.billing_customers b where b.id = new.customer_id;
  if c is not null and public.erp__is_final_consumer(c->>'name', coalesce(c->>'document_number', c->>'doc_number')) then
    raise exception 'No se puede dar crédito a «%»: el crédito es solo para clientes registrados con nombre y cédula o NIT (nunca Consumidor final).', coalesce(c->>'name', 'este cliente')
      using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.erp__receivable_no_final_consumer() from public, anon, authenticated;
drop trigger if exists erp_receivables_no_final_consumer on public.erp_receivables;
create trigger erp_receivables_no_final_consumer before insert on public.erp_receivables
  for each row execute function public.erp__receivable_no_final_consumer();

create or replace function public.erp__customer_credit_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare n jsonb := to_jsonb(new); o jsonb;
begin
  if coalesce((n->>'credit_enabled')::boolean, false) is not true then return new; end if;
  if tg_op = 'UPDATE' then
    o := to_jsonb(old);
    -- Solo al ENCENDER el crédito (si ya lo tenía, no se bloquea editar otros datos).
    if coalesce((o->>'credit_enabled')::boolean, false) then return new; end if;
  end if;
  if public.erp__is_final_consumer(n->>'name', coalesce(n->>'document_number', n->>'doc_number')) then
    raise exception 'Consumidor final no puede tener crédito. Para dar crédito el cliente necesita su nombre y su cédula o NIT.'
      using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.erp__customer_credit_guard() from public, anon, authenticated;
drop trigger if exists billing_customers_credit_guard on public.billing_customers;
create trigger billing_customers_credit_guard before insert or update on public.billing_customers
  for each row execute function public.erp__customer_credit_guard();

-- ------------------------------------------------------------------ 2. «A crédito» en el comprobante
-- Igual que 20261116 y además «credit»: plazo, vencimiento, abonado y saldo del documento.
create or replace function public.erp_order_payment_by_token(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v jsonb; v_order uuid; v_credit jsonb;
begin
  if p_token is null or length(p_token) < 8 then return null; end if;
  select o.id into v_order from public.orders o where o.token = p_token;
  if v_order is null then return null; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'erp_order_meta' and column_name = 'payment') then
    execute 'select m.payment from public.erp_order_meta m where m.order_id = $1' into v using v_order;
  end if;
  select jsonb_build_object(
           'total', sum(r.total), 'balance', sum(r.balance), 'paid', sum(r.total) - sum(r.balance),
           'issue_date', min(to_jsonb(r)->>'issue_date'), 'due_date', max(to_jsonb(r)->>'due_date'),
           'days', max(((to_jsonb(r)->>'due_date')::date - coalesce((to_jsonb(r)->>'issue_date')::date, (to_jsonb(r)->>'due_date')::date))),
           'status', case when sum(r.balance) <= 0 then 'paid'
                          when max((to_jsonb(r)->>'due_date')::date) < (now() at time zone 'America/Bogota')::date then 'overdue' else 'open' end)
    into v_credit
  from public.erp_receivables r
  where r.order_id = v_order and r.status <> 'void'
  having count(*) > 0;
  if v is null and v_credit is null then return null; end if;
  return jsonb_build_object(
    'method', coalesce(v->>'method', case when v_credit is not null then 'credito' end),
    'parts', coalesce(v->'parts', '[]'::jsonb), 'received', v->'received', 'change', v->'change',
    'credit', v_credit);
end;
$$;
revoke all on function public.erp_order_payment_by_token(text) from public;
grant execute on function public.erp_order_payment_by_token(text) to anon, authenticated;

-- ------------------------------------------------------------------ 3. Crédito de los documentos del POS
create or replace function public.erp_orders_credit(p_store uuid, p_orders uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.erp_can_any(p_store, array['pos', 'orders', 'receivables', 'credit']::text[]) then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('order_id', x.order_id, 'total', x.total, 'balance', x.balance, 'due_date', x.due_date,
                                        'overdue', x.balance > 0 and x.due_date < (now() at time zone 'America/Bogota')::date))
    from (
      select r.order_id, sum(r.total) as total, sum(r.balance) as balance, max((to_jsonb(r)->>'due_date')::date) as due_date
      from public.erp_receivables r
      where r.store_id = p_store and r.order_id = any (coalesce(p_orders[1:200], '{}'::uuid[])) and r.status <> 'void'
        and public.erp_point_allowed(p_store, r.point_id)
      group by r.order_id
    ) x), '[]'::jsonb);
end;
$$;
revoke all on function public.erp_orders_credit(uuid, uuid[]) from public, anon;
grant execute on function public.erp_orders_credit(uuid, uuid[]) to authenticated;

-- ------------------------------------------------------------------ 4. Notas crédito y débito
create table if not exists public.erp_receivable_notes (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  receivable_id uuid not null references public.erp_receivables(id) on delete cascade,
  customer_id uuid,
  kind text not null check (kind in ('credit', 'debit')),
  number text not null,
  amount numeric(14, 2) not null check (amount > 0),
  reason_code text not null,
  reason text not null,
  balance_before numeric(14, 2),
  balance_after numeric(14, 2),
  created_at timestamptz not null default now(),
  created_by uuid,
  created_by_name text,
  voided boolean not null default false,
  voided_at timestamptz,
  voided_by uuid,
  voided_by_name text,
  void_reason text
);
create unique index if not exists erp_receivable_notes_number on public.erp_receivable_notes (store_id, number);
create index if not exists erp_receivable_notes_receivable on public.erp_receivable_notes (receivable_id);
create index if not exists erp_receivable_notes_customer on public.erp_receivable_notes (customer_id, created_at desc);
alter table public.erp_receivable_notes enable row level security;
revoke all on public.erp_receivable_notes from public, anon, authenticated;

-- Motivos (los mismos que muestra la pantalla).
create or replace function public.erp__note_reasons(p_kind text)
returns text[]
language sql
immutable
as $$
  select case when p_kind = 'credit'
    then array['descuento', 'error_precio', 'pronto_pago', 'producto_defectuoso', 'acuerdo', 'otro']
    else array['interes_mora', 'flete', 'error_precio', 'cargo_adicional', 'otro'] end;
$$;

create or replace function public.erp__actor_label(p_store uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select coalesce(nullif(trim(su.display_name), ''), nullif(trim(su.username), '')) from public.store_users su
      where su.store_id = p_store and su.user_id = auth.uid() limit 1),
    (select 'Dueño' from public.stores s where s.id = p_store and s.owner_id = auth.uid()),
    'Usuario');
$$;
revoke all on function public.erp__actor_label(uuid) from public, anon, authenticated;

create or replace function public.erp_receivable_note(p_receivable uuid, p_kind text, p_amount numeric, p_reason_code text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.erp_receivables;
  v_amount numeric := round(coalesce(p_amount, 0), 2);
  v_reason text := btrim(coalesce(p_reason, ''));
  v_status text;
  v_balance numeric;
  v_number text;
  v_doc text;
  v_id uuid;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'message', 'Inicia sesión.'); end if;
  if p_kind not in ('credit', 'debit') then return jsonb_build_object('ok', false, 'message', 'Tipo de nota inválido.'); end if;
  select * into r from public.erp_receivables where id = p_receivable for update;
  if r.id is null then return jsonb_build_object('ok', false, 'message', 'El documento de cartera no existe.'); end if;
  if not public.erp_can(r.store_id, 'credit') then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Necesitas el permiso «Créditos» para hacer notas.');
  end if;
  if not public.erp_point_allowed(r.store_id, r.point_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Este documento es de un punto que no tienes asignado.');
  end if;
  if r.status = 'void' then return jsonb_build_object('ok', false, 'message', 'El documento está anulado.'); end if;
  if r.order_id is not null and not exists (select 1 from public.orders o where o.id = r.order_id and o.status in ('confirmed', 'completed')) then
    return jsonb_build_object('ok', false, 'code', 'NOT_CONFIRMED',
      'message', 'El documento aún no está confirmado: corrígelo en el POS (Documentos → Editar) en vez de hacerle una nota.');
  end if;
  if r.order_id is not null and to_regclass('public.fiscal_documents') is not null then
    if exists (select 1 from public.fiscal_documents f where f.source_id = r.order_id
               and (f.status in ('ACCEPTED', 'SENT', 'PROCESSING', 'CANCEL_PENDING') or (f.status = 'ERROR' and f.sent_at is not null))) then
      return jsonb_build_object('ok', false, 'code', 'FISCAL',
        'message', 'Esta venta tiene factura electrónica enviada a la DIAN: hazle la nota en Facturación electrónica para que la DIAN también la reciba.');
    end if;
  end if;
  if v_amount <= 0 then return jsonb_build_object('ok', false, 'message', 'Escribe un valor mayor a cero.'); end if;
  if not (coalesce(p_reason_code, '') = any (public.erp__note_reasons(p_kind))) then
    return jsonb_build_object('ok', false, 'message', 'Elige el motivo.');
  end if;
  if length(v_reason) < 5 then return jsonb_build_object('ok', false, 'message', 'Describe el motivo (mínimo 5 letras).'); end if;
  if p_kind = 'credit' and v_amount > r.balance + 0.005 then
    return jsonb_build_object('ok', false, 'code', 'OVER_BALANCE',
      'message', format('La nota crédito no puede ser mayor que el saldo (%s). Si ya pagó, anula primero el abono.', to_char(r.balance, 'FM$999G999G999')));
  end if;

  v_balance := r.balance + case when p_kind = 'credit' then -v_amount else v_amount end;
  v_status := case when v_balance <= 0 then 'paid' else 'open' end;
  update public.erp_receivables
     set total = total + case when p_kind = 'credit' then -v_amount else v_amount end,
         balance = v_balance, status = v_status, updated_at = now()
   where id = r.id;

  perform pg_advisory_xact_lock(hashtext('erp_receivable_notes:' || r.store_id::text || ':' || p_kind));
  select (case when p_kind = 'credit' then 'NC-' else 'ND-' end)
         || lpad((coalesce(max(nullif(substring(n.number from '(\d+)$'), '')::integer), 0) + 1)::text, 5, '0')
    into v_number
  from public.erp_receivable_notes n where n.store_id = r.store_id and n.kind = p_kind;

  insert into public.erp_receivable_notes (store_id, receivable_id, customer_id, kind, number, amount, reason_code, reason,
                                          balance_before, balance_after, created_by, created_by_name)
  values (r.store_id, r.id, r.customer_id, p_kind, v_number, v_amount, p_reason_code, v_reason, r.balance, v_balance,
          auth.uid(), public.erp__actor_label(r.store_id))
  returning id into v_id;

  v_doc := to_jsonb(r)->>'doc_number';
  perform public.erp_audit(r.store_id, case when p_kind = 'credit' then 'receivable.credit_note' else 'receivable.debit_note' end,
    'erp_receivables', r.id,
    jsonb_build_object('note', v_number, 'doc', v_doc, 'amount', v_amount, 'reason_code', p_reason_code, 'reason', v_reason,
                       'balance_before', r.balance, 'balance_after', v_balance));
  return jsonb_build_object('ok', true, 'id', v_id, 'number', v_number, 'balance', v_balance, 'status', v_status);
end;
$$;
revoke all on function public.erp_receivable_note(uuid, text, numeric, text, text) from public, anon;
grant execute on function public.erp_receivable_note(uuid, text, numeric, text, text) to authenticated;

create or replace function public.erp_receivable_note_void(p_note uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n public.erp_receivable_notes;
  r public.erp_receivables;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_balance numeric;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'message', 'Inicia sesión.'); end if;
  select * into n from public.erp_receivable_notes where id = p_note for update;
  if n.id is null then return jsonb_build_object('ok', false, 'message', 'La nota no existe.'); end if;
  if not public.erp_can(n.store_id, 'credit') then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Necesitas el permiso «Créditos».');
  end if;
  if n.voided then return jsonb_build_object('ok', false, 'message', n.number || ' ya está anulada.'); end if;
  if length(v_reason) < 5 then return jsonb_build_object('ok', false, 'message', 'Escribe el motivo (mínimo 5 letras).'); end if;
  select * into r from public.erp_receivables where id = n.receivable_id for update;
  if not public.erp_point_allowed(r.store_id, r.point_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Este documento es de un punto que no tienes asignado.');
  end if;
  if r.status = 'void' then return jsonb_build_object('ok', false, 'message', 'El documento ya está anulado.'); end if;
  if n.kind = 'debit' and r.balance < n.amount - 0.005 then
    return jsonb_build_object('ok', false, 'code', 'HAS_PAYMENTS',
      'message', 'Ya se abonó parte de ese cargo: anula primero un abono para poder anular la nota débito.');
  end if;

  v_balance := r.balance + case when n.kind = 'credit' then n.amount else -n.amount end;
  update public.erp_receivables
     set total = total + case when n.kind = 'credit' then n.amount else -n.amount end,
         balance = v_balance, status = case when v_balance <= 0 then 'paid' else 'open' end, updated_at = now()
   where id = r.id;
  update public.erp_receivable_notes
     set voided = true, voided_at = now(), voided_by = auth.uid(), voided_by_name = public.erp__actor_label(n.store_id), void_reason = v_reason
   where id = n.id;
  perform public.erp_audit(n.store_id, 'receivable.note_voided', 'erp_receivables', r.id,
    jsonb_build_object('note', n.number, 'amount', n.amount, 'kind', n.kind, 'reason', v_reason, 'balance_after', v_balance));
  return jsonb_build_object('ok', true, 'balance', v_balance);
end;
$$;
revoke all on function public.erp_receivable_note_void(uuid, text) from public, anon;
grant execute on function public.erp_receivable_note_void(uuid, text) to authenticated;

create or replace function public.erp_customer_receivable_notes(p_customer uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_store uuid;
begin
  select b.store_id into v_store from public.billing_customers b where b.id = p_customer;
  if v_store is null or auth.uid() is null or not public.erp_can_any(v_store, array['receivables', 'credit']::text[]) then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', n.id, 'receivable_id', n.receivable_id, 'kind', n.kind, 'number', n.number, 'amount', n.amount,
      'reason_code', n.reason_code, 'reason', n.reason, 'balance_before', n.balance_before, 'balance_after', n.balance_after,
      'created_at', n.created_at, 'created_by_name', n.created_by_name,
      'voided', n.voided, 'voided_at', n.voided_at, 'voided_by_name', n.voided_by_name, 'void_reason', n.void_reason,
      'doc_number', to_jsonb(r)->>'doc_number') order by n.created_at desc)
    from public.erp_receivable_notes n
    join public.erp_receivables r on r.id = n.receivable_id
    where n.customer_id = p_customer and n.store_id = v_store and public.erp_point_allowed(v_store, r.point_id)), '[]'::jsonb);
end;
$$;
revoke all on function public.erp_customer_receivable_notes(uuid) from public, anon;
grant execute on function public.erp_customer_receivable_notes(uuid) to authenticated;

-- ------------------------------------------------------------------ 5. Estado de cuenta por enlace
create table if not exists public.erp_statement_links (
  token text primary key,
  store_id uuid not null,
  customer_id uuid not null references public.billing_customers(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid,
  expires_at timestamptz not null,
  revoked boolean not null default false,
  opened_at timestamptz,
  open_count integer not null default 0
);
create index if not exists erp_statement_links_customer on public.erp_statement_links (customer_id, created_at desc);
alter table public.erp_statement_links enable row level security;
revoke all on public.erp_statement_links from public, anon, authenticated;

create or replace function public.erp_statement_link(p_customer uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_store uuid; v_token text; v_exp timestamptz;
begin
  select b.store_id into v_store from public.billing_customers b where b.id = p_customer;
  if v_store is null then return jsonb_build_object('ok', false, 'message', 'Cliente no encontrado.'); end if;
  if auth.uid() is null or not public.erp_can_any(v_store, array['receivables', 'credit']::text[]) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Necesitas el permiso de Cartera.');
  end if;
  -- Reutiliza el enlace vigente (más de 7 días de vida) para no llenar al cliente de enlaces distintos.
  select l.token, l.expires_at into v_token, v_exp from public.erp_statement_links l
  where l.customer_id = p_customer and not l.revoked and l.expires_at > now() + interval '7 days'
  order by l.created_at desc limit 1;
  if v_token is null then
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    v_exp := now() + interval '30 days';
    insert into public.erp_statement_links (token, store_id, customer_id, created_by, expires_at)
    values (v_token, v_store, p_customer, auth.uid(), v_exp);
  end if;
  return jsonb_build_object('ok', true, 'token', v_token, 'expires_at', v_exp);
end;
$$;
revoke all on function public.erp_statement_link(uuid) from public, anon;
grant execute on function public.erp_statement_link(uuid) to authenticated;

create or replace function public.erp_statement_link_revoke(p_customer uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_store uuid; v_n integer;
begin
  select b.store_id into v_store from public.billing_customers b where b.id = p_customer;
  if v_store is null or auth.uid() is null or not public.erp_can_any(v_store, array['receivables', 'credit']::text[]) then
    return jsonb_build_object('ok', false, 'message', 'Necesitas el permiso de Cartera.');
  end if;
  update public.erp_statement_links set revoked = true where customer_id = p_customer and not revoked;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'revoked', v_n);
end;
$$;
revoke all on function public.erp_statement_link_revoke(uuid) from public, anon;
grant execute on function public.erp_statement_link_revoke(uuid) to authenticated;

-- Lo que ve el cliente con el enlace. Sin costos ni datos de otros clientes.
create or replace function public.erp_statement_public(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.erp_statement_links;
  c jsonb;
  v_today date := (now() at time zone 'America/Bogota')::date;
  v_docs jsonb;
  v_moves jsonb;
  v_open numeric; v_overdue numeric; v_billed numeric; v_paid numeric;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then return jsonb_build_object('ok', false); end if;
  select * into l from public.erp_statement_links where token = p_token;
  if l.token is null or l.revoked or l.expires_at < now() then
    return jsonb_build_object('ok', false, 'expired', l.token is not null);
  end if;
  update public.erp_statement_links set opened_at = now(), open_count = open_count + 1 where token = l.token;
  select to_jsonb(b) into c from public.billing_customers b where b.id = l.customer_id;

  with rc as (
    select r.*, to_jsonb(r) as j from public.erp_receivables r
    where r.customer_id = l.customer_id and r.store_id = l.store_id and r.status <> 'void'
  )
  select coalesce(sum(rc.balance) filter (where rc.status = 'open'), 0),
         coalesce(sum(rc.balance) filter (where rc.status = 'open' and (rc.j->>'due_date')::date < v_today), 0),
         coalesce(sum(rc.total), 0),
         coalesce(jsonb_agg(jsonb_build_object(
            'doc_number', coalesce(rc.j->>'doc_number', rc.j->>'description', 'Saldo'),
            'issue_date', rc.j->>'issue_date', 'due_date', rc.j->>'due_date', 'total', rc.total, 'balance', rc.balance,
            'days_overdue', greatest(0, v_today - (rc.j->>'due_date')::date),
            'order_token', (select o.token from public.orders o where o.id = rc.order_id))
            order by rc.j->>'due_date') filter (where rc.status = 'open' and rc.balance > 0), '[]'::jsonb)
    into v_open, v_overdue, v_billed, v_docs
  from rc;

  select coalesce(sum((to_jsonb(p)->>'amount')::numeric), 0) into v_paid
  from public.erp_receivable_payments p join public.erp_receivables r on r.id = p.receivable_id
  where r.customer_id = l.customer_id and r.store_id = l.store_id and r.status <> 'void' and not coalesce((to_jsonb(p)->>'voided')::boolean, false);

  -- Movimientos (lo más reciente primero): compras a crédito, abonos y notas.
  select coalesce(jsonb_agg(m order by m->>'at' desc), '[]'::jsonb) into v_moves
  from (
    select m from (
      select jsonb_build_object('at', coalesce(to_jsonb(r)->>'issue_date', to_jsonb(r)->>'created_at'), 'kind', 'charge',
                                'label', coalesce(to_jsonb(r)->>'doc_number', to_jsonb(r)->>'description', 'Saldo'), 'amount', r.total
                                  + coalesce((select sum(case when n.kind = 'credit' then n.amount else -n.amount end) from public.erp_receivable_notes n
                                              where n.receivable_id = r.id and not n.voided), 0)) as m
      from public.erp_receivables r
      where r.customer_id = l.customer_id and r.store_id = l.store_id and r.status <> 'void'
      union all
      select jsonb_build_object('at', coalesce(to_jsonb(p)->>'paid_at', to_jsonb(p)->>'created_at'), 'kind', 'payment',
                                'label', coalesce(to_jsonb(r)->>'doc_number', 'Abono'), 'method', to_jsonb(p)->>'method',
                                'amount', (to_jsonb(p)->>'amount')::numeric)
      from public.erp_receivable_payments p join public.erp_receivables r on r.id = p.receivable_id
      where r.customer_id = l.customer_id and r.store_id = l.store_id and r.status <> 'void'
        and not coalesce((to_jsonb(p)->>'voided')::boolean, false)
      union all
      select jsonb_build_object('at', n.created_at, 'kind', n.kind || '_note', 'label', n.number || coalesce(' · ' || (to_jsonb(r)->>'doc_number'), ''),
                                'reason', n.reason, 'amount', n.amount)
      from public.erp_receivable_notes n join public.erp_receivables r on r.id = n.receivable_id
      where n.customer_id = l.customer_id and n.store_id = l.store_id and not n.voided and r.status <> 'void'
    ) x(m)
    order by m->>'at' desc
    limit 60
  ) y;

  return jsonb_build_object(
    'ok', true,
    'generated_at', now(),
    'expires_at', l.expires_at,
    'store', (select jsonb_build_object('name', s.name, 'logo_url', to_jsonb(s)->>'logo_url', 'whatsapp', to_jsonb(s)->>'whatsapp')
              from public.stores s where s.id = l.store_id),
    'customer', jsonb_build_object('name', c->>'name', 'document_type', coalesce(c->>'document_type', c->>'doc_type'),
                                   'document_number', coalesce(c->>'document_number', c->>'doc_number'),
                                   'credit_limit', (c->>'credit_limit')::numeric, 'credit_days', (c->>'credit_days')::integer),
    'totals', jsonb_build_object('open', v_open, 'overdue', v_overdue, 'billed', v_billed, 'paid', v_paid),
    'documents', v_docs,
    'movements', v_moves);
end;
$$;
revoke all on function public.erp_statement_public(text) from public;
grant execute on function public.erp_statement_public(text) to anon, authenticated;

notify pgrst, 'reload schema';
