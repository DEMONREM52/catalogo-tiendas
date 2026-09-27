create table if not exists public.store_addi_credentials (
  store_id uuid primary key references public.stores(id) on delete cascade,
  client_id text not null,
  client_secret text not null,
  environment text not null check (environment in ('staging', 'production')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.store_addi_credentials enable row level security;
revoke all on public.store_addi_credentials from public, anon, authenticated;
grant all on public.store_addi_credentials to service_role;

create table if not exists public.addi_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  order_token text not null,
  application_id text,
  redirect_url text,
  expected_amount numeric(14, 2) not null check (expected_amount > 0),
  approved_amount numeric(14, 2),
  currency text not null default 'COP' check (currency = 'COP'),
  status text not null check (
    status in ('initiated', 'pending', 'approved', 'rejected', 'declined', 'abandoned', 'failed')
  ),
  status_timestamp bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists addi_payment_attempts_order_lookup
  on public.addi_payment_attempts (store_id, order_token, created_at desc);

create index if not exists addi_payment_attempts_paid_lookup
  on public.addi_payment_attempts (store_id, order_token, status)
  where status = 'approved';

alter table public.addi_payment_attempts enable row level security;
revoke all on public.addi_payment_attempts from public, anon, authenticated;
grant all on public.addi_payment_attempts to service_role;

create or replace function public.process_addi_callback(
  p_store_id uuid,
  p_attempt_id uuid,
  p_application_id text,
  p_status text,
  p_approved_amount numeric,
  p_currency text,
  p_status_timestamp bigint
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt public.addi_payment_attempts%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'FORBIDDEN';
  end if;

  if p_status not in ('approved', 'rejected', 'declined', 'abandoned')
    or p_currency <> 'COP'
    or p_status_timestamp <= 0
    or p_approved_amount < 0 then
    raise exception 'INVALID_ADDI_CALLBACK';
  end if;

  select *
  into v_attempt
  from public.addi_payment_attempts
  where id = p_attempt_id
    and store_id = p_store_id
  for update;

  if not found then
    return false;
  end if;

  if v_attempt.status = 'approved'
    or (v_attempt.status_timestamp is not null and p_status_timestamp <= v_attempt.status_timestamp) then
    return true;
  end if;

  if p_status = 'approved' and p_approved_amount <> v_attempt.expected_amount then
    raise exception 'ADDI_AMOUNT_MISMATCH';
  end if;

  update public.addi_payment_attempts
  set application_id = p_application_id,
      status = p_status,
      approved_amount = p_approved_amount,
      status_timestamp = p_status_timestamp,
      updated_at = now()
  where id = p_attempt_id
    and store_id = p_store_id;

  if p_status = 'approved' then
    update public.orders
    set payment_status = 'paid'
    where store_id = p_store_id
      and token::text = v_attempt.order_token;

    if not found then
      raise exception 'ADDI_ORDER_NOT_FOUND';
    end if;
  end if;

  return true;
end;
$$;

revoke all on function public.process_addi_callback(uuid, uuid, text, text, numeric, text, bigint)
  from public, anon, authenticated;
grant execute on function public.process_addi_callback(uuid, uuid, text, text, numeric, text, bigint)
  to service_role;
