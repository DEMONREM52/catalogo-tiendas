-- =====================================================================
-- REMHUB · Trabajar sin conexión (ventas, pagos y facturas de contingencia)
--
-- 1. erp_pos_submit_offline_v2: registra una venta hecha sin internet TAL COMO SE
--    COBRÓ (precio cobrado, forma de pago y hora real), una sola vez por borrador.
--      · remision / factura interna: con el número del punto (igual que en línea).
--      · factura en un punto electrónico sin números de contingencia: se emite al volver.
--      · contingencia: factura de talonario/papel con un número que el equipo separó
--        antes de quedarse sin internet; se transmite como factura electrónica de
--        contingencia (Alanube «04») apenas vuelve la conexión.
--    Si no se puede registrar sola queda en erp_pos_offline_issues: el administrador
--    la ve aunque la venta esté guardada en otro equipo.
-- 2. fiscal_offline_reserve: cada equipo separa por adelantado unos números de la
--    numeración «Factura de contingencia» del punto (nunca se repiten entre equipos).
-- 3. fiscal_offline_blocks_list / fiscal_offline_release: ver y liberar esos números.
-- 4. fiscal_contingency_pending: facturas de contingencia y su plazo de 48 horas.
-- 5. erp_pos_offline_issues_list / erp_pos_offline_issue_resolve.
-- 6. erp_offline_alerts: avisos de la campana (contingencia por transmitir, ventas sin
--    conexión con problemas, puntos electrónicos sin numeración de contingencia).
-- 7. fiscal__create_document acepta un número ya separado y la fecha real de la venta.
--
-- Requiere 20261027 (fiscal), 20261108 (borradores) y 20261115 (forma de pago).
-- Las reglas de contingencia (Resolución DIAN 000165 de 2023) REQUIEREN VALIDACIÓN
-- con la contadora y el proveedor tecnológico. Idempotente.
-- =====================================================================

-- 1. Tablas ------------------------------------------------------------------
alter table public.erp_pos_offline_submissions add column if not exists kind text;
alter table public.erp_pos_offline_submissions add column if not exists payment jsonb;
alter table public.erp_pos_offline_submissions add column if not exists price_changes jsonb;
alter table public.erp_pos_offline_submissions add column if not exists fiscal_document_id uuid;
alter table public.erp_pos_offline_submissions add column if not exists device_id text;
alter table public.erp_pos_offline_submissions add column if not exists warnings jsonb;

-- Ventas sin conexión que no se registraron solas (inventario, precio, permisos…).
create table if not exists public.erp_pos_offline_issues (
  client_id uuid primary key,
  store_id uuid not null references public.stores(id) on delete cascade,
  point_id uuid,
  kind text,
  total numeric(14, 2),
  created_offline_at timestamptz,
  code text,
  message text,
  draft jsonb not null default '{}'::jsonb,
  attempts integer not null default 1,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  last_by uuid,
  last_by_name text,
  resolved_at timestamptz,
  resolved_by uuid,
  resolution text
);
create index if not exists erp_pos_offline_issues_open on public.erp_pos_offline_issues (store_id, last_at desc) where resolved_at is null;
alter table public.erp_pos_offline_issues enable row level security;
revoke all on public.erp_pos_offline_issues from anon, authenticated;

-- Números de contingencia separados por cada equipo del POS (cada número existe una sola
-- vez en fiscal_number_allocations desde que se separa; al usarlo se le asigna su documento).
create table if not exists public.fiscal_offline_blocks (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  point_id uuid not null references public.erp_warehouses(id) on delete restrict,
  range_id uuid not null references public.fiscal_numbering_ranges(id) on delete restrict,
  device_id text not null,
  prefix text not null default '',
  number_from bigint not null,
  number_to bigint not null,
  status text not null default 'active' check (status in ('active', 'closed')),
  reserved_by uuid,
  reserved_by_name text,
  reserved_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid,
  closed_by_name text,
  closed_reason text,
  constraint fiscal_offline_blocks_bounds check (number_to >= number_from),
  constraint fiscal_offline_blocks_device_len check (length(device_id) between 8 and 80)
);
create index if not exists fiscal_offline_blocks_by_device on public.fiscal_offline_blocks (store_id, point_id, device_id, status);
create index if not exists fiscal_offline_blocks_by_range on public.fiscal_offline_blocks (range_id, number_from);
alter table public.fiscal_offline_blocks enable row level security;
revoke all on public.fiscal_offline_blocks from anon, authenticated;

-- 2. Número separado: lo toma el documento (uso interno) -----------------------
create or replace function public.fiscal__use_reserved_number(
  p_range uuid, p_document uuid, p_point uuid, p_doc_type text, p_env text, p_entity uuid, p_number bigint, p_issued_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.fiscal_numbering_ranges;
  a public.fiscal_number_allocations;
  v_day date := (coalesce(p_issued_at, now()) at time zone 'America/Bogota')::date;
begin
  select * into r from public.fiscal_numbering_ranges where id = p_range for update;
  if r.id is null then
    raise exception 'La numeración de contingencia no existe.' using errcode = 'P0001', detail = 'FISCAL_RANGE_NOT_FOUND';
  end if;
  if r.fiscal_entity_id <> p_entity then
    raise exception 'La numeración pertenece a otro contribuyente.' using errcode = 'P0001', detail = 'FISCAL_RANGE_FOREIGN_ENTITY';
  end if;
  if r.document_type <> p_doc_type or r.environment <> p_env then
    raise exception 'La numeración es de otro tipo de documento o ambiente.' using errcode = 'P0001', detail = 'FISCAL_RANGE_MISMATCH';
  end if;
  if not exists (select 1 from public.fiscal_offline_blocks b
                 where b.range_id = r.id and b.point_id = p_point and p_number between b.number_from and b.number_to) then
    raise exception 'El número % no fue separado para este punto.', r.prefix || p_number
      using errcode = 'P0001', detail = 'FISCAL_NUMBER_NOT_RESERVED';
  end if;
  -- La factura en papel vale si la resolución estaba vigente el día de la venta (aunque ya haya vencido al volver).
  if r.valid_until is not null and r.valid_until < v_day then
    raise exception 'La resolución de contingencia ya había vencido (%) el día de la venta.', to_char(r.valid_until, 'DD/MM/YYYY')
      using errcode = 'P0001', detail = 'FISCAL_RANGE_EXPIRED';
  end if;
  if r.valid_from is not null and r.valid_from > v_day then
    raise exception 'La resolución de contingencia aún no estaba vigente (desde el %) el día de la venta.', to_char(r.valid_from, 'DD/MM/YYYY')
      using errcode = 'P0001', detail = 'FISCAL_RANGE_NOT_YET';
  end if;
  select * into a from public.fiscal_number_allocations where range_id = r.id and number = p_number for update;
  if a.id is null then
    raise exception 'El número % no fue separado para este punto.', r.prefix || p_number
      using errcode = 'P0001', detail = 'FISCAL_NUMBER_NOT_RESERVED';
  end if;
  if a.document_id is not null and a.document_id <> p_document then
    raise exception 'El número % ya se usó en otro documento.', r.prefix || p_number using errcode = 'P0001', detail = 'FISCAL_NUMBER_USED';
  end if;
  -- Si alguien liberó el número mientras el equipo estaba sin conexión, la factura en papel manda: se recupera.
  update public.fiscal_number_allocations set document_id = p_document, status = 'assigned' where id = a.id;
  return jsonb_build_object('prefix', r.prefix, 'number', p_number, 'range_id', r.id, 'remaining', greatest(r.range_to - r.next_number + 1, 0),
    'resolution_number', r.resolution_number, 'reserved', true, 'revived', a.status = 'voided_unsent');
end;
$$;
revoke all on function public.fiscal__use_reserved_number(uuid, uuid, uuid, text, text, uuid, bigint, timestamptz) from public, anon, authenticated;

-- Crea un documento fiscal completo: valida, toma el consecutivo (o el número ya separado)
-- y guarda líneas y eventos (uso interno). Igual a 20261027 más «reserved_number» e «issue_date».
create or replace function public.fiscal__create_document(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc uuid := gen_random_uuid();
  v_store uuid := (p ->> 'store_id')::uuid;
  v_point uuid := (p ->> 'point_id')::uuid;
  v_entity uuid := (p ->> 'fiscal_entity_id')::uuid;
  v_type text := p ->> 'document_type';
  v_env text := p ->> 'environment';
  v_range uuid;
  v_alloc jsonb;
  v_calc jsonb;
  v_status text := coalesce(p ->> 'initial_status', 'QUEUED');
  v_include boolean;
  ln jsonb;
  v_full text;
  v_reserved bigint := nullif(p ->> 'reserved_number', '')::bigint;
  v_issue timestamptz := coalesce(nullif(p ->> 'issue_date', '')::timestamptz, now());
begin
  select e.prices_include_tax into v_include from public.fiscal_entities e where e.id = v_entity;
  v_include := coalesce((p ->> 'prices_include_tax')::boolean, v_include, true);
  v_calc := public.fiscal__compute_lines(p -> 'lines', v_include);
  -- Factura de contingencia hecha sin conexión: su número ya estaba separado en esta numeración.
  if v_reserved is not null then
    v_range := (p ->> 'range_id')::uuid;
  else
    v_range := public.fiscal__pick_range(v_point, v_entity, v_type, v_env);
  end if;
  if v_range is null then
    raise exception 'No hay numeración activa y vigente para este documento en este punto.' using errcode = 'P0001', detail = 'FISCAL_NO_RANGE';
  end if;

  insert into public.fiscal_documents (
    id, store_id, point_id, fiscal_entity_id, establishment_id, provider_account_id, range_id, document_type, environment, status,
    issue_date, due_date, payment_form, payment_method, subtotal, discount_total, tax_total, total, issuer,
    customer_id, customer, customer_name, customer_doc, source_type, source_id, source_number,
    related_document_id, note_concept, note_reason, provider, idempotency_key, contingency_id, notes, metadata,
    created_by, created_by_name)
  values (
    v_doc, v_store, v_point, v_entity, (p ->> 'establishment_id')::uuid, (p ->> 'provider_account_id')::uuid, v_range, v_type, v_env, 'DRAFT',
    v_issue, (p ->> 'due_date')::date, coalesce(p ->> 'payment_form', 'cash'), p ->> 'payment_method',
    (v_calc ->> 'subtotal')::numeric, (v_calc ->> 'discount_total')::numeric, (v_calc ->> 'tax_total')::numeric, (v_calc ->> 'total')::numeric,
    public.fiscal__issuer_snapshot(v_entity, (p ->> 'establishment_id')::uuid, v_point),
    (p ->> 'customer_id')::uuid, coalesce(p -> 'customer', '{}'::jsonb), p -> 'customer' ->> 'name', p -> 'customer' ->> 'document_number',
    coalesce(p ->> 'source_type', 'manual'), (p ->> 'source_id')::uuid, p ->> 'source_number',
    (p ->> 'related_document_id')::uuid, p ->> 'note_concept', p ->> 'note_reason',
    (select a.provider from public.fiscal_provider_accounts a where a.id = (p ->> 'provider_account_id')::uuid),
    nullif(p ->> 'idempotency_key', ''), (p ->> 'contingency_id')::uuid, p ->> 'notes',
    coalesce(p -> 'metadata', '{}'::jsonb) || jsonb_build_object('prices_include_tax', v_include),
    public.erp__actor_id(), case when public.erp__actor_id() is null then 'Sistema' else public.erp__user_label(v_store, public.erp__actor_id()) end);

  if v_reserved is not null then
    v_alloc := public.fiscal__use_reserved_number(v_range, v_doc, v_point, v_type, v_env, v_entity, v_reserved, v_issue);
  else
    v_alloc := public.fiscal__allocate_number(v_range, v_doc, v_point, v_type, v_env, v_entity);
  end if;
  v_full := (v_alloc ->> 'prefix') || (v_alloc ->> 'number');
  update public.fiscal_documents
  set prefix = v_alloc ->> 'prefix', number = (v_alloc ->> 'number')::bigint, full_number = v_full, status = v_status
  where id = v_doc;

  for ln in select * from jsonb_array_elements(v_calc -> 'lines') loop
    insert into public.fiscal_document_lines
      (document_id, store_id, line_no, product_id, sku, description, unit_code, qty, unit_price, discount, tax_rate,
       line_subtotal, line_tax, line_total, ref_line_no)
    values
      (v_doc, v_store, (ln ->> 'line_no')::integer, nullif(ln ->> 'product_id', '')::uuid, ln ->> 'sku', ln ->> 'description',
       ln ->> 'unit_code', (ln ->> 'qty')::numeric, (ln ->> 'unit_price')::numeric, (ln ->> 'discount')::numeric,
       (ln ->> 'tax_rate')::numeric, (ln ->> 'line_subtotal')::numeric, (ln ->> 'line_tax')::numeric,
       (ln ->> 'line_total')::numeric, nullif(ln ->> 'ref_line_no', '')::integer);
  end loop;

  perform public.fiscal__event(v_doc, v_store, 'created', null, 'DRAFT', 'Documento creado', jsonb_build_object('source_type', p ->> 'source_type', 'source_number', p ->> 'source_number'));
  perform public.fiscal__event(v_doc, v_store, 'number_assigned', 'DRAFT', v_status,
    case when v_reserved is not null
      then 'Número ' || v_full || ' de contingencia (separado por el equipo antes de quedarse sin conexión) · resolución '
        || coalesce(v_alloc ->> 'resolution_number', '(sin resolución)')
      else 'Número ' || v_full || ' tomado de la resolución ' || coalesce(v_alloc ->> 'resolution_number', '(sin resolución)') end, v_alloc);
  perform public.erp__audit_insert(v_store, v_point, 'fiscal', 'info', 'fiscal.document_created', 'fiscal_documents', v_doc,
    null, jsonb_build_object('full_number', v_full, 'type', v_type, 'environment', v_env, 'total', v_calc ->> 'total',
      'customer', p -> 'customer' ->> 'name', 'source', p ->> 'source_number'), null, '{}'::jsonb);

  return jsonb_build_object('ok', true, 'document_id', v_doc, 'full_number', v_full, 'prefix', v_alloc ->> 'prefix',
    'number', (v_alloc ->> 'number')::bigint, 'status', v_status, 'environment', v_env, 'document_type', v_type,
    'total', (v_calc ->> 'total')::numeric, 'remaining', (v_alloc ->> 'remaining')::bigint);
end;
$$;
revoke all on function public.fiscal__create_document(jsonb) from public, anon, authenticated;

-- 3. Separar números de contingencia para un equipo --------------------------------
-- Devuelve los números libres del equipo y lo necesario para imprimir sin conexión
-- (emisor, resolución y consumidor final).
create or replace function public.fiscal_offline_reserve(p_point uuid, p_device text, p_count integer default 15)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  w public.erp_warehouses;
  cfg public.fiscal_point_configs;
  ent public.fiscal_entities;
  os public.erp_org_settings;
  r public.fiscal_numbering_ranges;
  v_dev text := left(btrim(coalesce(p_device, '')), 80);
  v_want integer := least(greatest(coalesce(p_count, 15), 1), 50);
  v_range uuid;
  v_free integer;
  v_n integer;
  v_from bigint;
  v_block uuid;
  v_today date := public.fiscal__today();
  v_blocks jsonb;
begin
  if auth.uid() is null then return public.fiscal__err('AUTH', 'Inicia sesión.'); end if;
  select * into w from public.erp_warehouses where id = p_point;
  if w.id is null then return public.fiscal__err('NOT_FOUND', 'El punto no existe.'); end if;
  if not public.erp_can(w.store_id, 'pos') or not public.erp_point_allowed(w.store_id, p_point) then
    return public.fiscal__err('FORBIDDEN', 'No puedes vender en este punto.');
  end if;
  if length(v_dev) < 8 then return public.fiscal__err('INVALID', 'Equipo no válido.'); end if;
  select * into cfg from public.fiscal_point_configs where point_id = p_point;
  select * into os from public.erp_org_settings where store_id = w.store_id;
  if not (coalesce(cfg.enabled, false) and coalesce(os.fiscal_enabled, false)) then
    return jsonb_build_object('ok', true, 'enabled', false, 'reason', 'Este punto no factura electrónicamente.');
  end if;
  select * into ent from public.fiscal_entities where id = cfg.fiscal_entity_id;

  -- Dos pestañas del mismo equipo pidiendo números al tiempo no duplican bloques.
  perform pg_advisory_xact_lock(hashtext('fiscal_offline:' || p_point::text || ':' || v_dev));

  select count(*) into v_free
  from public.fiscal_offline_blocks b
  join public.fiscal_numbering_ranges x on x.id = b.range_id
  join public.fiscal_number_allocations a on a.range_id = b.range_id and a.number between b.number_from and b.number_to
  where b.point_id = p_point and b.device_id = v_dev and b.status = 'active'
    and a.document_id is null and a.status = 'assigned'
    and x.environment = cfg.environment and x.fiscal_entity_id = cfg.fiscal_entity_id
    and (x.valid_until is null or x.valid_until >= v_today);

  v_range := public.fiscal__pick_range(p_point, cfg.fiscal_entity_id, 'contingency_invoice', cfg.environment);
  if v_range is not null and v_free < greatest(3, v_want / 3) then
    select * into r from public.fiscal_numbering_ranges where id = v_range for update;
    v_n := least(v_want, r.range_to - r.next_number + 1);
    if v_n > 0 then
      v_from := r.next_number;
      insert into public.fiscal_number_allocations (range_id, store_id, fiscal_entity_id, document_type, environment, prefix, number, document_id, allocated_by)
      select r.id, r.store_id, r.fiscal_entity_id, r.document_type, r.environment, r.prefix, g, null, auth.uid()
      from generate_series(v_from, v_from + v_n - 1) g;
      update public.fiscal_numbering_ranges set next_number = v_from + v_n where id = r.id;
      insert into public.fiscal_offline_blocks (store_id, point_id, range_id, device_id, prefix, number_from, number_to, reserved_by, reserved_by_name)
      values (w.store_id, p_point, r.id, v_dev, r.prefix, v_from, v_from + v_n - 1, auth.uid(), public.erp_actor_name(w.store_id))
      returning id into v_block;
      perform public.erp__audit_insert(w.store_id, p_point, 'fiscal', 'info', 'fiscal.offline_numbers_reserved', 'fiscal_offline_blocks', v_block,
        null, jsonb_build_object('prefix', r.prefix, 'from', v_from, 'to', v_from + v_n - 1, 'device', right(v_dev, 6)), null, '{}'::jsonb);
    end if;
  end if;

  select coalesce(jsonb_agg(t.z order by (t.z ->> 'from')::bigint), '[]'::jsonb) into v_blocks from (
    select jsonb_build_object('id', b.id, 'range_id', b.range_id, 'prefix', b.prefix, 'from', b.number_from, 'to', b.number_to,
      'free', (select coalesce(jsonb_agg(a.number order by a.number), '[]'::jsonb) from public.fiscal_number_allocations a
               where a.range_id = b.range_id and a.number between b.number_from and b.number_to
                 and a.document_id is null and a.status = 'assigned'),
      'resolution_number', x.resolution_number, 'resolution_date', x.resolution_date, 'valid_from', x.valid_from, 'valid_until', x.valid_until,
      'range_from', x.range_from, 'range_to', x.range_to) as z
    from public.fiscal_offline_blocks b
    join public.fiscal_numbering_ranges x on x.id = b.range_id
    where b.point_id = p_point and b.device_id = v_dev and b.status = 'active'
      and x.environment = cfg.environment and x.fiscal_entity_id = cfg.fiscal_entity_id
      and (x.valid_until is null or x.valid_until >= v_today)
  ) t
  where jsonb_array_length(t.z -> 'free') > 0;

  return jsonb_build_object('ok', true, 'enabled', true, 'environment', cfg.environment,
    'configured', v_range is not null or jsonb_array_length(v_blocks) > 0,
    'blocks', v_blocks,
    'issuer', public.fiscal__issuer_snapshot(cfg.fiscal_entity_id, cfg.establishment_id, p_point),
    'prices_include_tax', coalesce(ent.prices_include_tax, true),
    'final_consumer', jsonb_build_object('name', coalesce(os.final_consumer_name, 'CONSUMIDOR FINAL'), 'doc', coalesce(os.final_consumer_doc, '222222222222')),
    'reason', case when v_range is null and jsonb_array_length(v_blocks) = 0
      then 'Falta la numeración «Factura de contingencia» de este punto (Centro fiscal → Numeración).' end);
end;
$$;
revoke all on function public.fiscal_offline_reserve(uuid, text, integer) from public, anon;
grant execute on function public.fiscal_offline_reserve(uuid, text, integer) to authenticated;

-- Números separados por equipo (centro fiscal).
create or replace function public.fiscal_offline_blocks_list(p_store uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.erp_can_any(p_store, array['fiscal_send', 'fiscal_config', 'fiscal_numbering']::text[]) then
    return public.fiscal__err('FORBIDDEN', 'No tienes acceso a la numeración.');
  end if;
  return jsonb_build_object('ok', true, 'items', (
    select coalesce(jsonb_agg(t.x order by t.at desc), '[]'::jsonb) from (
      select b.reserved_at as at, jsonb_build_object('id', b.id, 'point_id', b.point_id, 'point_name', w.name, 'device', right(b.device_id, 6),
        'prefix', b.prefix, 'from', b.number_from, 'to', b.number_to, 'status', b.status,
        'reserved_by', b.reserved_by_name, 'reserved_at', b.reserved_at,
        'used', (select count(*) from public.fiscal_number_allocations a
                 where a.range_id = b.range_id and a.number between b.number_from and b.number_to and a.document_id is not null),
        'free', (select count(*) from public.fiscal_number_allocations a
                 where a.range_id = b.range_id and a.number between b.number_from and b.number_to and a.document_id is null and a.status = 'assigned'),
        'voided', (select count(*) from public.fiscal_number_allocations a
                   where a.range_id = b.range_id and a.number between b.number_from and b.number_to and a.document_id is null and a.status = 'voided_unsent'),
        'closed_at', b.closed_at, 'closed_by', b.closed_by_name, 'closed_reason', b.closed_reason) as x
      from public.fiscal_offline_blocks b
      join public.erp_warehouses w on w.id = b.point_id
      where b.store_id = p_store and public.erp_point_allowed(p_store, b.point_id)
        and (b.status = 'active' or b.closed_at > now() - interval '60 days')
      order by b.reserved_at desc
      limit 200) t));
end;
$$;
revoke all on function public.fiscal_offline_blocks_list(uuid) from public, anon;
grant execute on function public.fiscal_offline_blocks_list(uuid) to authenticated;

-- Liberar los números que un equipo no usó (equipo perdido, dañado o que ya no vende).
-- Quedan anulados sin transmitir (con su motivo) para que la numeración cuadre.
create or replace function public.fiscal_offline_release(p_block uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.fiscal_offline_blocks;
  v_n integer;
  v_reason text := left(btrim(coalesce(p_reason, '')), 300);
begin
  select * into b from public.fiscal_offline_blocks where id = p_block for update;
  if b.id is null then return public.fiscal__err('NOT_FOUND', 'Esos números no existen.'); end if;
  if not public.erp_can_any(b.store_id, array['fiscal_send', 'fiscal_config', 'fiscal_numbering']::text[])
     or not public.erp_point_allowed(b.store_id, b.point_id) then
    return public.fiscal__err('FORBIDDEN', 'No tienes permiso para liberar estos números.');
  end if;
  if b.status <> 'active' then return jsonb_build_object('ok', true, 'already', true, 'voided', 0); end if;
  if length(v_reason) < 5 then return public.fiscal__err('VALIDATION', 'Escribe el motivo (por ejemplo: equipo perdido o dañado).'); end if;
  update public.fiscal_number_allocations a set status = 'voided_unsent'
  where a.range_id = b.range_id and a.number between b.number_from and b.number_to and a.document_id is null and a.status = 'assigned';
  get diagnostics v_n = row_count;
  update public.fiscal_offline_blocks
  set status = 'closed', closed_at = now(), closed_by = auth.uid(), closed_by_name = public.erp_actor_name(b.store_id), closed_reason = v_reason
  where id = b.id;
  perform public.erp__audit_insert(b.store_id, b.point_id, 'fiscal', 'warning', 'fiscal.offline_numbers_released', 'fiscal_offline_blocks', b.id,
    null, jsonb_build_object('prefix', b.prefix, 'from', b.number_from, 'to', b.number_to, 'voided', v_n), v_reason, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'voided', v_n);
end;
$$;
revoke all on function public.fiscal_offline_release(uuid, text) from public, anon;
grant execute on function public.fiscal_offline_release(uuid, text) to authenticated;

-- 4. Piezas internas de la venta sin conexión ---------------------------------------
create or replace function public.erp__offline_issue(
  p_store uuid, p_point uuid, p_client uuid, p_kind text, p_total numeric, p_at timestamptz, p_code text, p_message text, p_draft jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.erp_pos_offline_issues as i
    (client_id, store_id, point_id, kind, total, created_offline_at, code, message, draft, last_by, last_by_name)
  values
    (p_client, p_store, p_point, p_kind, p_total, p_at, left(p_code, 60), left(p_message, 1000), coalesce(p_draft, '{}'::jsonb),
     auth.uid(), public.erp_actor_name(p_store))
  on conflict (client_id) do update
    set code = excluded.code, message = excluded.message, draft = excluded.draft, attempts = i.attempts + 1, last_at = now(),
        last_by = excluded.last_by, last_by_name = excluded.last_by_name, resolved_at = null, resolved_by = null, resolution = null
    where i.store_id = excluded.store_id;
end;
$$;
revoke all on function public.erp__offline_issue(uuid, uuid, uuid, text, numeric, timestamptz, text, text, jsonb) from public, anon, authenticated;

-- Registro de la contingencia (cerrada: no frena el envío) con las facturas en papel de ese corte.
create or replace function public.fiscal__offline_contingency_log(p_store uuid, p_point uuid, p_entity uuid, p_account uuid, p_device text, p_at timestamptz)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v uuid;
  v_name text := public.erp_actor_name(p_store);
begin
  select c.id into v from public.fiscal_contingencies c
  where c.store_id = p_store and c.point_id = p_point and c.status = 'closed'
    and c.metadata ->> 'auto' = 'offline_pos' and coalesce(c.metadata ->> 'device', '') = coalesce(right(p_device, 6), '')
    and c.ended_at > now() - interval '6 hours'
  order by c.ended_at desc
  limit 1
  for update;
  if v is null then
    insert into public.fiscal_contingencies (store_id, point_id, fiscal_entity_id, provider_account_id, kind, reason, status,
      started_at, started_by, started_by_name, ended_at, ended_by, ended_by_name, end_notes, metadata)
    values (p_store, p_point, p_entity, p_account, 'connectivity',
      'Sin conexión en el punto: facturas de contingencia expedidas en papel desde el POS.', 'closed',
      coalesce(p_at, now()), auth.uid(), v_name, now(), auth.uid(), v_name,
      'Volvió la conexión: las facturas de contingencia se registraron y se transmiten a la DIAN.',
      jsonb_build_object('auto', 'offline_pos', 'device', right(p_device, 6), 'documents', 1))
    returning id into v;
  else
    update public.fiscal_contingencies
    set started_at = least(started_at, coalesce(p_at, started_at)), ended_at = now(),
        metadata = metadata || jsonb_build_object('documents', coalesce((metadata ->> 'documents')::integer, 0) + 1)
    where id = v;
  end if;
  return v;
end;
$$;
revoke all on function public.fiscal__offline_contingency_log(uuid, uuid, uuid, uuid, text, timestamptz) from public, anon, authenticated;

-- Factura de contingencia de una venta ya creada: documento con el número separado + número de la venta.
create or replace function public.fiscal__offline_contingency(
  p_store uuid, p_point uuid, p_order uuid, p_seller uuid, p_customer uuid, p_customer_doc text,
  p_fiscal jsonb, p_at timestamptz, p_device text, p_client uuid, p_payment_method text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  cfg public.fiscal_point_configs;
  b public.fiscal_offline_blocks;
  v_number bigint := nullif(p_fiscal ->> 'number', '')::bigint;
  v_customer jsonb;
  v_lines jsonb;
  v_seller_name text;
  v_cont uuid;
  v_res jsonb;
  v_paper text;
begin
  select * into o from public.orders where id = p_order;
  select * into cfg from public.fiscal_point_configs where point_id = p_point;
  if cfg.point_id is null or cfg.fiscal_entity_id is null then
    raise exception 'El punto no tiene configurada la facturación electrónica.' using errcode = 'P0001', detail = 'FISCAL_CONFIG';
  end if;
  select * into b from public.fiscal_offline_blocks
  where id = nullif(p_fiscal ->> 'block_id', '')::uuid and store_id = p_store and point_id = p_point;
  if b.id is null or v_number is null or v_number not between b.number_from and b.number_to then
    raise exception 'El número de contingencia % no corresponde a los números separados de este punto.',
      coalesce(p_fiscal ->> 'full_number', v_number::text, '(sin número)') using errcode = 'P0001', detail = 'FISCAL_NUMBER_NOT_RESERVED';
  end if;
  v_paper := b.prefix || v_number;
  v_customer := coalesce(public.fiscal__customer_snapshot(p_store, p_customer, o.customer_name, p_customer_doc),
                         public.fiscal__customer_snapshot(p_store, null, o.customer_name, p_customer_doc));
  select jsonb_agg(jsonb_build_object('product_id', oi.product_id, 'sku', pr.sku, 'description', coalesce(pr.name, 'Producto'),
           'qty', oi.quantity, 'unit_price', oi.price, 'tax_rate', coalesce(pr.tax_rate, 0)) order by pr.name, oi.id)
  into v_lines
  from public.order_items oi left join public.products pr on pr.id = oi.product_id
  where oi.order_id = o.id;
  if p_seller is not null then
    select s.name into v_seller_name from public.erp_sellers(p_store) s where s.user_id = p_seller limit 1;
  end if;
  v_cont := public.fiscal__offline_contingency_log(p_store, p_point, cfg.fiscal_entity_id, cfg.provider_account_id, p_device, p_at);
  v_res := public.fiscal__create_document(jsonb_build_object(
    'store_id', p_store, 'point_id', p_point, 'fiscal_entity_id', cfg.fiscal_entity_id, 'establishment_id', cfg.establishment_id,
    'provider_account_id', cfg.provider_account_id, 'document_type', 'contingency_invoice', 'environment', cfg.environment,
    'initial_status', 'QUEUED', 'contingency_id', v_cont,
    'payment_form', 'cash', 'payment_method', p_payment_method,
    'customer_id', v_customer ->> 'id', 'customer', v_customer,
    'source_type', 'pos_order', 'source_id', o.id, 'source_number', v_paper,
    'idempotency_key', 'offline:' || p_client::text, 'lines', v_lines,
    'range_id', b.range_id, 'reserved_number', v_number, 'issue_date', p_at,
    'metadata', jsonb_build_object('order_token', o.token, 'seller', v_seller_name, 'offline', true, 'device', right(coalesce(p_device, ''), 6),
      'paper_number', v_paper, 'paper_issued_at', p_at, 'transmit_before', now() + interval '48 hours', 'block_id', b.id)));

  -- El número de la venta es el de la factura en papel (una sola numeración).
  perform set_config('remhub.fiscal_issue', 'on', true);
  insert into public.erp_order_meta
    (order_id, store_id, point_id, seller_id, seller_name, doc_kind, doc_prefix, doc_seq, doc_number, created_by, created_by_name, customer_doc)
  values
    (o.id, p_store, p_point, coalesce(p_seller, auth.uid()), coalesce(v_seller_name, public.erp_actor_name(p_store)), 'factura',
     v_res ->> 'prefix', (v_res ->> 'number')::bigint, v_res ->> 'full_number', auth.uid(), public.erp_actor_name(p_store),
     nullif(v_customer ->> 'document_number', ''));
  perform set_config('remhub.fiscal_issue', '', true);
  return v_res;
end;
$$;
revoke all on function public.fiscal__offline_contingency(uuid, uuid, uuid, uuid, uuid, text, jsonb, timestamptz, text, uuid, text) from public, anon, authenticated;

-- 5. Registrar una venta hecha sin conexión ----------------------------------------
-- p_draft: { id, point_id, seller_id, kind, created_at, total, device_id,
--            items: [{product_id, qty, price, level}],
--            customer: {client_id, name, doc, note, whatsapp},
--            payment: {method, parts: [{method, amount}], received, change},
--            fiscal: {block_id, number, full_number} }
create or replace function public.erp_pos_submit_offline_v2(p_store uuid, p_draft jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client uuid;
  v_point uuid;
  v_seller uuid;
  v_kind text;
  v_items jsonb;
  v_dev text;
  v_at timestamptz;
  v_draft_total numeric;
  done public.erp_pos_offline_submissions;
  s public.erp_profit_settings;
  it jsonb;
  p public.products;
  r public.erp_price_rules;
  v_level integer;
  v_qty integer;
  v_price numeric;
  v_list numeric;
  v_lines jsonb := '[]'::jsonb;
  v_changes jsonb := '[]'::jsonb;
  v_warn jsonb := '[]'::jsonb;
  v_res jsonb;
  v_token text;
  v_order uuid;
  v_total numeric;
  v_doc text;
  v_tag jsonb;
  v_name text;
  v_note text;
  v_wa text;
  v_cdoc text;
  v_cid text;
  v_customer uuid;
  v_method text;
  v_parts jsonb;
  v_pay jsonb;
  v_cash numeric := 0;
  v_fiscal jsonb;
  v_fiscal_on boolean;
  cfg public.fiscal_point_configs;
  v_org boolean;
  v_msg text;
  v_detail text;
  v_hint text;
  v_code text;
  v_friendly text;
  v_cash_no bigint;
begin
  if not public.erp_can(p_store, 'pos') then raise exception 'No tienes permiso de POS.'; end if;
  if p_draft is null or jsonb_typeof(p_draft) <> 'object' then raise exception 'Borrador no válido.'; end if;
  v_client := nullif(p_draft ->> 'id', '')::uuid;
  if v_client is null then raise exception 'Falta el identificador del borrador.'; end if;
  v_point := nullif(p_draft ->> 'point_id', '')::uuid;
  if v_point is null or not exists (select 1 from public.erp_warehouses w where w.id = v_point and w.store_id = p_store and w.active) then
    raise exception 'Elige un punto de venta válido.';
  end if;
  if not public.erp_point_allowed(p_store, v_point) then raise exception 'Solo puedes vender desde tus puntos.'; end if;
  v_kind := coalesce(nullif(p_draft ->> 'kind', ''), 'remision');
  if v_kind not in ('remision', 'factura', 'contingencia') then raise exception 'Tipo de documento no válido.'; end if;
  v_items := p_draft -> 'items';
  if v_items is null or jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 or jsonb_array_length(v_items) > 300 then
    raise exception 'El borrador no tiene productos válidos.';
  end if;
  v_seller := nullif(p_draft ->> 'seller_id', '')::uuid;
  v_dev := left(nullif(btrim(coalesce(p_draft ->> 'device_id', '')), ''), 80);
  v_draft_total := nullif(p_draft ->> 'total', '')::numeric;

  -- Una sola vez por borrador, aunque lleguen dos envíos al tiempo (también los de la versión anterior).
  perform pg_advisory_xact_lock(hashtext('pos_offline:' || v_client::text));
  select * into done from public.erp_pos_offline_submissions where client_id = v_client;
  if found then
    if done.store_id <> p_store then raise exception 'Borrador no válido.'; end if;
    return jsonb_build_object('ok', true, 'already', true, 'token', done.token, 'doc_number', done.doc_number, 'total', done.total,
      'kind', coalesce(done.kind, 'remision'), 'warnings', coalesce(done.warnings, '[]'::jsonb), 'price_changes', coalesce(done.price_changes, '[]'::jsonb),
      'fiscal', (select jsonb_build_object('document_id', d.id, 'full_number', d.full_number, 'status', d.status, 'document_type', d.document_type)
                 from public.fiscal_documents d where d.id = done.fiscal_document_id));
  end if;

  -- Hora real de la venta (si el reloj del equipo está muy mal, se usa la hora de llegada).
  v_at := nullif(p_draft ->> 'created_at', '')::timestamptz;
  if v_at is null or v_at > now() + interval '10 minutes' or v_at < now() - interval '45 days' then
    if v_at is not null then
      v_warn := v_warn || jsonb_build_array('La fecha del equipo no era correcta (' || to_char(v_at at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI')
        || '): se usó la hora en que llegó la venta.');
    end if;
    v_at := now();
  end if;

  select * into cfg from public.fiscal_point_configs where point_id = v_point;
  select os.fiscal_enabled into v_org from public.erp_org_settings os where os.store_id = p_store;
  v_fiscal_on := coalesce(cfg.enabled, false) and coalesce(v_org, false);

  -- Se registra el precio COBRADO (la venta ya pasó); las diferencias con la lista quedan anotadas.
  -- Los límites de descuento siguen mandando: la base los revisa al guardar cada producto.
  select * into s from public.erp_profit_settings where store_id = p_store;
  for it in select * from jsonb_array_elements(v_items) loop
    v_level := least(5, greatest(1, coalesce(nullif(it ->> 'level', '')::integer, 3)));
    v_qty := nullif(it ->> 'qty', '')::integer;
    v_price := round(nullif(it ->> 'price', '')::numeric, 2);
    select * into p from public.products where id = nullif(it ->> 'product_id', '')::uuid and store_id = p_store;
    -- Un producto borrado (o un dato dañado) mientras no había conexión: queda por revisar, a la vista del administrador.
    if v_qty is null or v_qty <= 0 or v_qty > 100000 or v_price is null or v_price < 0 or p.id is null then
      v_friendly := case when p.id is null then 'Un producto de la venta ya no existe en el sistema («' || coalesce(nullif(it ->> 'name', ''), 'sin nombre') || '»): créalo de nuevo o regístrala a mano.'
                         else 'La venta tiene una cantidad o un precio que no es válido: revísala y regístrala a mano.' end;
      perform public.erp__offline_issue(p_store, v_point, v_client, v_kind, v_draft_total, v_at, 'INVALID_ITEM', v_friendly, p_draft);
      return jsonb_build_object('ok', false, 'code', 'INVALID_ITEM', 'message', v_friendly);
    end if;
    v_list := null;
    begin
      select * into r from public.erp__rule_for(p_store, v_point, p.id, v_at);
      v_list := round(public.erp__point_price(p, v_level, r, coalesce(s.rounding_step, 0), coalesce(s.rounding_dir, 'nearest')), 2);
    exception when others then
      v_list := null;
    end;
    if v_list is not null and v_list is distinct from v_price then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object('product_id', p.id, 'name', p.name, 'charged', v_price, 'list', v_list));
    end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('product_id', p.id, 'qty', v_qty, 'price', v_price, 'description', p.name, 'sku', p.id));
  end loop;

  v_name := coalesce(nullif(btrim(p_draft -> 'customer' ->> 'name'), ''), 'CLIENTE GENERAL');
  v_note := left(btrim(coalesce(p_draft -> 'customer' ->> 'note', '') || ' [Venta sin conexión '
    || to_char(v_at at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI') || ']'), 500);
  v_wa := nullif(btrim(coalesce(p_draft -> 'customer' ->> 'whatsapp', '')), '');
  v_cdoc := nullif(btrim(coalesce(p_draft -> 'customer' ->> 'doc', '')), '');
  v_cid := p_draft -> 'customer' ->> 'client_id';
  v_customer := case when v_cid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v_cid::uuid end;
  if v_customer is not null and not exists (select 1 from public.billing_customers c where c.id = v_customer and c.store_id = p_store) then
    v_customer := null;
  end if;
  v_method := left(coalesce(nullif(p_draft -> 'payment' ->> 'method', ''), 'efectivo'), 30);

  begin
    v_res := to_jsonb(public.create_order_from_cart(p_store, 'retail', v_lines, v_name, v_note, v_wa));
    v_token := v_res ->> 'token';
    select o.id, o.total into v_order, v_total from public.orders o where o.token = v_token and o.store_id = p_store;

    if v_kind = 'contingencia' then
      v_fiscal := public.fiscal__offline_contingency(p_store, v_point, v_order, v_seller, v_customer, v_cdoc,
        p_draft -> 'fiscal', v_at, v_dev, v_client, v_method);
      v_doc := v_fiscal ->> 'full_number';
    elsif v_kind = 'factura' and v_fiscal_on then
      -- Punto electrónico sin números de contingencia: la factura electrónica se emite al volver.
      v_fiscal := public.fiscal_issue_from_order(p_store, v_token, v_point, v_seller, v_customer, v_cdoc, 'offline:' || v_client::text, 'cash', null);
      if coalesce((v_fiscal ->> 'ok')::boolean, false) then
        v_doc := v_fiscal ->> 'full_number';
      else
        v_warn := v_warn || jsonb_build_array('La factura electrónica no se pudo emitir (' || coalesce(v_fiscal ->> 'message', 'error')
          || '): la venta quedó como remisión en Centro fiscal → Por facturar.');
        v_fiscal := null;
        v_tag := public.erp_tag_order(p_store, v_token, v_point, v_seller, 'remision');
        v_doc := v_tag ->> 'doc_number';
      end if;
    else
      v_tag := public.erp_tag_order(p_store, v_token, v_point, v_seller, v_kind);
      v_doc := v_tag ->> 'doc_number';
    end if;

    if v_cdoc is not null and v_fiscal is null then
      begin
        perform public.erp_pos_set_customer_doc(v_token, v_cdoc);
      exception when others then
        null; -- es opcional (búsqueda por documento)
      end;
    end if;

    -- Forma de pago con la hora REAL de la venta: la caja la cuenta en el turno en que pasó.
    if jsonb_typeof(p_draft -> 'payment') = 'object' then
      if jsonb_typeof(p_draft -> 'payment' -> 'parts') = 'array' and jsonb_array_length(p_draft -> 'payment' -> 'parts') > 0 then
        select coalesce(jsonb_agg(jsonb_build_object('method', left(coalesce(x ->> 'method', ''), 30),
                 'amount', round(coalesce(nullif(x ->> 'amount', '')::numeric, 0), 2))), '[]'::jsonb)
        into v_parts from jsonb_array_elements(p_draft -> 'payment' -> 'parts') x;
      else
        v_parts := jsonb_build_array(jsonb_build_object('method', v_method, 'amount', v_total));
      end if;
      select coalesce(sum((x ->> 'amount')::numeric), 0) into v_cash from jsonb_array_elements(v_parts) x where x ->> 'method' = 'efectivo';
      v_pay := jsonb_build_object('method', v_method, 'parts', v_parts,
        'received', nullif(p_draft -> 'payment' ->> 'received', '')::numeric,
        'change', nullif(p_draft -> 'payment' ->> 'change', '')::numeric,
        'at', v_at, 'offline', true);
      update public.erp_order_meta set payment = v_pay where order_id = v_order;
    end if;
  exception when others then
    get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail, v_hint = pg_exception_hint;
    v_code := case
      when v_msg like '%OUT_OF_STOCK%' or v_msg ilike '%unidades suficientes%' or v_msg ilike '%stock insuficiente%' then 'OUT_OF_STOCK'
      when v_msg like '%PRICE_BELOW_LIMIT%' then 'PRICE_BELOW_LIMIT'
      when v_msg ilike '%remisiones de venta bloqueadas%' then 'REMISSION_BLOCKED'
      when left(coalesce(v_detail, ''), 7) = 'FISCAL_' then left(v_detail, 60)
      else 'ERROR' end;
    v_friendly := case v_code
      when 'OUT_OF_STOCK' then 'El inventario del sistema no tiene unidades suficientes'
        || coalesce(' de «' || nullif(v_detail, '') || '»', '') || '. Revisa el inventario (ingreso, traslado o ajuste) y vuelve a intentar.'
      when 'PRICE_BELOW_LIMIT' then 'El precio' || coalesce(' de «' || nullif(v_detail, '') || '»', '')
        || ' quedó por debajo del mínimo permitido. ' || coalesce(nullif(v_hint, ''), 'Pide la autorización.') || ' Luego vuelve a intentar.'
      when 'REMISSION_BLOCKED' then 'Este punto no permite remisiones: la venta debe registrarse como factura electrónica.'
      else v_msg end;
    perform public.erp__offline_issue(p_store, v_point, v_client, v_kind, v_draft_total, v_at, v_code, v_friendly, p_draft);
    return jsonb_build_object('ok', false, 'code', v_code, 'message', v_friendly);
  end;

  -- ¿La venta cae en una caja que ya se cerró? Se avisa: explica un sobrante de esa caja.
  if v_cash > 0 then
    begin
      select c.number into v_cash_no from public.erp_cash_sessions c
      where c.store_id = p_store and c.point_id = v_point and c.status <> 'open'
        and c.opened_at <= v_at and c.closed_at > v_at
      order by c.opened_at desc
      limit 1;
      if v_cash_no is not null then
        v_warn := v_warn || jsonb_build_array('La caja N.º ' || v_cash_no || ' ya estaba cerrada: esta venta ($'
          || replace(to_char(round(v_cash), 'FM999,999,999,990'), ',', '.') || ' en efectivo) explica un sobrante de esa caja.');
      end if;
    exception when undefined_table or undefined_column then
      null;
    end;
  end if;
  if v_draft_total is not null and abs(v_draft_total - coalesce(v_total, 0)) > 1 then
    v_warn := v_warn || jsonb_build_array('El total registrado ($' || replace(to_char(round(coalesce(v_total, 0)), 'FM999,999,999,990'), ',', '.')
      || ') es distinto al del borrador ($' || replace(to_char(round(v_draft_total), 'FM999,999,999,990'), ',', '.') || ').');
  end if;

  insert into public.erp_pos_offline_submissions (client_id, store_id, point_id, order_id, token, doc_number, total, created_offline_at,
    submitted_by, submitted_by_name, kind, payment, price_changes, fiscal_document_id, device_id, warnings)
  values (v_client, p_store, v_point, v_order, v_token, v_doc, v_total, v_at, auth.uid(), public.erp_actor_name(p_store),
    v_kind, v_pay, nullif(v_changes, '[]'::jsonb), nullif(v_fiscal ->> 'document_id', '')::uuid, v_dev, nullif(v_warn, '[]'::jsonb));
  update public.erp_pos_offline_issues set resolved_at = now(), resolved_by = auth.uid(), resolution = 'Se registró sola: ' || coalesce(v_doc, '')
  where client_id = v_client and resolved_at is null;
  perform public.erp_audit(p_store, 'sale.offline_submitted', 'orders', v_order, jsonb_build_object(
    'client_id', v_client, 'doc_number', v_doc, 'kind', v_kind, 'created_offline_at', v_at, 'total', v_total,
    'price_changes', v_changes, 'fiscal_document', v_fiscal ->> 'document_id', 'warnings', v_warn));
  return jsonb_build_object('ok', true, 'already', false, 'token', v_token, 'doc_number', v_doc, 'total', v_total, 'kind', v_kind,
    'fiscal', case when v_fiscal is null then null else jsonb_build_object('document_id', v_fiscal ->> 'document_id',
      'full_number', v_fiscal ->> 'full_number', 'status', v_fiscal ->> 'status', 'document_type', v_fiscal ->> 'document_type') end,
    'price_changes', v_changes, 'warnings', v_warn);
end;
$$;
revoke all on function public.erp_pos_submit_offline_v2(uuid, jsonb) from public, anon;
grant execute on function public.erp_pos_submit_offline_v2(uuid, jsonb) to authenticated;

-- 6. Ventas sin conexión por revisar (de todos los equipos) --------------------------
create or replace function public.erp_pos_offline_issues_list(p_store uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.erp_can(p_store, 'pos') then return jsonb_build_object('ok', false, 'message', 'Necesitas el permiso de POS.'); end if;
  return jsonb_build_object('ok', true, 'items', (
    select coalesce(jsonb_agg(t.x order by t.at desc), '[]'::jsonb) from (
      select i.last_at as at, jsonb_build_object('client_id', i.client_id, 'point_id', i.point_id, 'point_name', w.name, 'kind', i.kind,
        'total', i.total, 'created_offline_at', i.created_offline_at, 'code', i.code, 'message', i.message, 'attempts', i.attempts,
        'last_at', i.last_at, 'last_by', i.last_by_name, 'customer_name', i.draft -> 'customer' ->> 'name',
        'fiscal_number', i.draft -> 'fiscal' ->> 'full_number') as x
      from public.erp_pos_offline_issues i
      left join public.erp_warehouses w on w.id = i.point_id
      where i.store_id = p_store and i.resolved_at is null and public.erp_point_allowed(p_store, i.point_id)
      order by i.last_at desc
      limit 100) t));
end;
$$;
revoke all on function public.erp_pos_offline_issues_list(uuid) from public, anon;
grant execute on function public.erp_pos_offline_issues_list(uuid) to authenticated;

-- Cerrar a mano una venta por revisar (se registró a mano, se descartó o se resolvió de otra forma).
create or replace function public.erp_pos_offline_issue_resolve(p_client uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  i public.erp_pos_offline_issues;
  v_note text := left(btrim(coalesce(p_note, '')), 500);
begin
  select * into i from public.erp_pos_offline_issues where client_id = p_client for update;
  -- Lo que no está registrado en el panel no se cierra aquí (así nadie borra una factura en papel sin control).
  if i.client_id is null then return jsonb_build_object('ok', false, 'missing', true, 'message', 'Esta venta no está en el panel: reintenta el envío.'); end if;
  if not public.erp_can(i.store_id, 'pos') or not public.erp_point_allowed(i.store_id, i.point_id) then
    return jsonb_build_object('ok', false, 'message', 'No tienes permiso sobre esta venta.');
  end if;
  if i.kind = 'contingencia' and not public.erp_can_any(i.store_id, array['fiscal_send', 'fiscal_config']::text[]) then
    return jsonb_build_object('ok', false, 'message', 'Es una factura de contingencia ya entregada en papel: la cierra quien maneja la facturación electrónica.');
  end if;
  if length(v_note) < 3 then return jsonb_build_object('ok', false, 'message', 'Escribe qué se hizo con esta venta.'); end if;
  update public.erp_pos_offline_issues set resolved_at = now(), resolved_by = auth.uid(), resolution = v_note where client_id = p_client;
  perform public.erp_audit(i.store_id, 'sale.offline_issue_resolved', 'erp_pos_offline_issues', p_client,
    jsonb_build_object('note', v_note, 'kind', i.kind, 'total', i.total, 'code', i.code));
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.erp_pos_offline_issue_resolve(uuid, text) from public, anon;
grant execute on function public.erp_pos_offline_issue_resolve(uuid, text) to authenticated;

-- 7. Facturas de contingencia que faltan por aceptar (plazo DIAN: 48 horas) -----------
create or replace function public.fiscal_contingency_pending(p_store uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.erp_can_any(p_store, public.fiscal__view_perms() || array['pos']::text[]) then
    return public.fiscal__err('FORBIDDEN', 'No tienes acceso al centro fiscal.');
  end if;
  return jsonb_build_object('ok', true, 'items', (
    select coalesce(jsonb_agg(t.x order by t.at), '[]'::jsonb) from (
      select d.created_at as at, jsonb_build_object('id', d.id, 'full_number', d.full_number, 'point_id', d.point_id, 'point_name', w.name,
        'status', d.status, 'total', d.total, 'customer_name', d.customer_name, 'paper_issued_at', d.issue_date, 'synced_at', d.created_at,
        'deadline', d.created_at + interval '48 hours',
        'hours_left', round((extract(epoch from (d.created_at + interval '48 hours' - now())) / 3600)::numeric, 1),
        'attempts', d.attempts, 'last_error', d.last_error_message) as x
      from public.fiscal_documents d
      left join public.erp_warehouses w on w.id = d.point_id
      where d.store_id = p_store and d.document_type = 'contingency_invoice'
        and d.status not in ('ACCEPTED', 'VOID', 'CANCELLED', 'CANCEL_PENDING')
        and public.erp_point_allowed(p_store, d.point_id)
      order by d.created_at
      limit 200) t));
end;
$$;
revoke all on function public.fiscal_contingency_pending(uuid) from public, anon;
grant execute on function public.fiscal_contingency_pending(uuid) to authenticated;

-- 8. Avisos de la campana ---------------------------------------------------------
create or replace function public.erp_offline_alerts(p_store uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_fiscal boolean;
  v_pos boolean;
  v_n integer;
  v_hours numeric;
  v_issues integer;
  v_issues_c integer;
  r record;
begin
  if not public.erp__is_member(p_store) then return '[]'::jsonb; end if;
  v_fiscal := public.erp_can_any(p_store, public.fiscal__view_perms());
  v_pos := public.erp_can(p_store, 'pos');

  if v_fiscal or v_pos then
    select count(*), min(extract(epoch from (d.created_at + interval '48 hours' - now())) / 3600) into v_n, v_hours
    from public.fiscal_documents d
    where d.store_id = p_store and d.document_type = 'contingency_invoice'
      and d.status not in ('ACCEPTED', 'VOID', 'CANCELLED', 'CANCEL_PENDING')
      and public.erp_point_allowed(p_store, d.point_id);
    if v_n > 0 then
      v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'offline-contingency-pending',
        'severity', case when v_hours < 12 then 'critical' else 'serious' end, 'icon', 'alert', 'count', v_n,
        'title', v_n || case when v_n = 1 then ' factura de contingencia sin aceptar' else ' facturas de contingencia sin aceptar' end,
        'body', case when v_hours <= 0 then 'Ya pasó el plazo de 48 horas de la DIAN: revísalas ya en el Centro fiscal.'
                     else 'Quedan ' || greatest(floor(v_hours)::integer, 0) || ' horas del plazo de la DIAN. Revísalas en el Centro fiscal.' end,
        'href', '/dashboard/fiscal?tab=contingencias'));
    end if;
  end if;

  if v_pos then
    select count(*), count(*) filter (where i.kind = 'contingencia') into v_issues, v_issues_c
    from public.erp_pos_offline_issues i
    where i.store_id = p_store and i.resolved_at is null and public.erp_point_allowed(p_store, i.point_id);
    if v_issues > 0 then
      v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'offline-sale-issues',
        'severity', case when v_issues_c > 0 then 'critical' else 'serious' end, 'icon', 'alert', 'count', v_issues,
        'title', v_issues || case when v_issues = 1 then ' venta sin conexión por revisar' else ' ventas sin conexión por revisar' end,
        'body', case when v_issues_c > 0 then 'Hay facturas de contingencia entregadas en papel que aún no quedan registradas. Ábrelas en el POS.'
                     else 'No se pudieron registrar solas (inventario, precio o permisos). Ábrelas en el POS.' end,
        'href', '/dashboard/pos'));
    end if;
  end if;

  -- Puntos electrónicos sin numeración de contingencia: si se cae el internet no se puede facturar en papel.
  if v_fiscal then
    for r in
      select w.id, w.name
      from public.fiscal_point_configs c
      join public.erp_warehouses w on w.id = c.point_id
      join public.erp_org_settings os on os.store_id = c.store_id and os.fiscal_enabled
      where c.store_id = p_store and c.enabled and public.erp_point_allowed(p_store, c.point_id)
        and public.fiscal__pick_range(c.point_id, c.fiscal_entity_id, 'contingency_invoice', c.environment) is null
      order by w.name
      limit 5
    loop
      v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'fiscal-no-contingency-' || r.id, 'severity', 'warning', 'icon', 'hash',
        'title', 'Sin numeración de contingencia: ' || r.name,
        'body', 'Si se cae el internet no podrás facturar en papel. Pídela a la DIAN y cárgala en Centro fiscal → Numeración.',
        'href', '/dashboard/fiscal?tab=numeracion'));
    end loop;
  end if;
  return v_out;
end;
$$;
revoke all on function public.erp_offline_alerts(uuid) from public, anon;
grant execute on function public.erp_offline_alerts(uuid) to authenticated;

notify pgrst, 'reload schema';
