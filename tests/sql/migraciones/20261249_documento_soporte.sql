-- =====================================================================
-- REMHUB · Documento soporte electrónico (compras a quien no factura)
--
--   Cuando le compras a alguien que no está obligado a facturar (persona
--   natural, no responsable de IVA), la DIAN exige que TÚ emitas el
--   «documento soporte en adquisiciones a no obligados». Sale desde el
--   ingreso de factura (la compra) y viaja por el mismo motor fiscal.
--   1. fiscal_documents acepta source_type = 'purchase' y solo un documento
--      soporte vigente por compra.
--   2. erp_supplier_fiscal: datos fiscales del proveedor (dirección, código
--      DANE, código postal…) que se recuerdan para la próxima vez.
--   3. fiscal_support_prepare: lo que necesita la ventana (puntos listos,
--      datos del proveedor y documentos ya emitidos para esa compra).
--   4. fiscal_issue_support_document: crea y numera el documento soporte.
--   5. fiscal_create_support_adjustment: nota de ajuste a un documento soporte.
--   La numeración es la resolución de «Documento soporte» del punto
--   (Centro fiscal → Numeración). No borra datos. Es idempotente.
-- =====================================================================

-- ---------------------------------------------------------------- 1. origen «compra»
do $$
declare c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.fiscal_documents'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%source_type%'
  loop
    execute format('alter table public.fiscal_documents drop constraint %I', c);
  end loop;
end $$;
alter table public.fiscal_documents add constraint fiscal_documents_source_type_check
  check (source_type in ('pos_order', 'order', 'manual', 'note', 'purchase'));

create unique index if not exists fiscal_documents_purchase_unique
  on public.fiscal_documents (source_id)
  where source_id is not null and source_type = 'purchase' and document_type = 'support_document' and status not in ('VOID', 'CANCELLED');

-- ---------------------------------------------------------------- 2. datos fiscales del proveedor
create table if not exists public.erp_supplier_fiscal (
  supplier_id uuid primary key references public.erp_suppliers(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.erp_supplier_fiscal enable row level security;
-- Sin políticas: solo por las funciones de abajo.

-- ---------------------------------------------------------------- 3. preparar la ventana
create or replace function public.fiscal_support_prepare(p_store uuid, p_purchase uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  pu public.erp_purchases;
  s public.erp_suppliers;
  v_saved jsonb;
  v_third jsonb;
  v_points jsonb;
  v_docs jsonb;
begin
  if auth.uid() is null or not (public.erp_can(p_store, 'fiscal_send') or public.erp_can(p_store, 'fiscal')) then
    return public.fiscal__err('FORBIDDEN', 'Necesitas permiso de facturación electrónica.');
  end if;
  select * into pu from public.erp_purchases where id = p_purchase and store_id = p_store;
  if pu.id is null then return public.fiscal__err('NOT_FOUND', 'La compra no existe.'); end if;
  select * into s from public.erp_suppliers where id = pu.supplier_id;
  select data into v_saved from public.erp_supplier_fiscal where supplier_id = s.id;
  -- Si el proveedor está enlazado a un tercero, se usan sus datos (columna third_party_id de 20261209).
  if to_jsonb(s) ->> 'third_party_id' is not null then
    select jsonb_build_object('document_type', c.document_type, 'person_type', c.person_type, 'address', c.address, 'city', c.city,
             'department', c.department, 'email', c.email, 'phone', coalesce(c.mobile, c.phone), 'first_name', c.first_name, 'last_name', c.last_name)
      into v_third
    from public.billing_customers c where c.id = (to_jsonb(s) ->> 'third_party_id')::uuid and c.store_id = p_store;
  end if;

  -- Puntos con facturación electrónica activa y si ya tienen numeración de documento soporte.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', w.id, 'name', w.name, 'environment', cfg.environment,
           'has_range', public.fiscal__pick_range(w.id, cfg.fiscal_entity_id, 'support_document', cfg.environment) is not null,
           'is_purchase_point', w.id = pu.warehouse_id) order by (w.id = pu.warehouse_id) desc, w.name), '[]'::jsonb)
    into v_points
  from public.fiscal_point_configs cfg join public.erp_warehouses w on w.id = cfg.point_id
  where cfg.store_id = p_store and cfg.enabled and cfg.fiscal_entity_id is not null and cfg.provider_account_id is not null
    and public.erp_point_allowed(p_store, w.id);

  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'full_number', d.full_number, 'status', d.status, 'document_type', d.document_type,
           'total', d.total, 'issue_date', d.issue_date, 'dian_message', d.dian_message) order by d.created_at), '[]'::jsonb)
    into v_docs
  from public.fiscal_documents d
  where d.store_id = p_store and d.source_type = 'purchase' and d.source_id = pu.id;

  return jsonb_build_object('ok', true,
    'purchase', jsonb_build_object('id', pu.id, 'number', pu.number, 'invoice_ref', pu.invoice_ref, 'status', pu.status, 'subtotal', pu.subtotal,
      'tax', pu.tax, 'total', pu.total, 'payment_type', pu.payment_type, 'due_date', pu.due_date),
    'supplier', jsonb_build_object('id', s.id, 'name', s.name, 'nit', s.nit, 'address', s.address, 'phone', s.phone, 'email', s.email),
    'saved', coalesce(v_saved, '{}'::jsonb), 'third', coalesce(v_third, '{}'::jsonb),
    'points', v_points, 'documents', v_docs);
end;
$$;

-- ---------------------------------------------------------------- 4. emitir
create or replace function public.fiscal_issue_support_document(
  p_store uuid, p_purchase uuid, p_point uuid, p_supplier jsonb, p_note text, p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pu public.erp_purchases;
  s public.erp_suppliers;
  cfg public.fiscal_point_configs;
  v_existing public.fiscal_documents;
  v_doc_type text;
  v_doc text;
  v_saved_doc text;
  v_supplier jsonb;
  v_lines jsonb;
  v_res jsonb;
  v_city text := nullif(regexp_replace(coalesce(p_supplier ->> 'city_code', ''), '\D', '', 'g'), '');
  v_postal text := nullif(regexp_replace(coalesce(p_supplier ->> 'postal_code', ''), '\D', '', 'g'), '');
  v_origin text := case when p_supplier ->> 'origin' = '11' then '11' else '10' end;
  v_name text := upper(btrim(coalesce(p_supplier ->> 'name', '')));
  v_address text := btrim(coalesce(p_supplier ->> 'address', ''));
begin
  if auth.uid() is null then return public.fiscal__err('AUTH', 'Inicia sesión.'); end if;
  if not public.erp_can(p_store, 'fiscal_send') then
    return public.fiscal__err('FORBIDDEN', 'Necesitas el permiso de emitir documentos electrónicos.');
  end if;
  if nullif(p_idempotency_key, '') is not null then
    select * into v_existing from public.fiscal_documents where store_id = p_store and idempotency_key = p_idempotency_key;
    if v_existing.id is not null then
      return jsonb_build_object('ok', true, 'reused', true, 'document_id', v_existing.id, 'full_number', v_existing.full_number, 'status', v_existing.status);
    end if;
  end if;

  select * into pu from public.erp_purchases where id = p_purchase and store_id = p_store for update;
  if pu.id is null then return public.fiscal__err('NOT_FOUND', 'La compra no existe.'); end if;
  if pu.status <> 'received' then return public.fiscal__err('INVALID', 'La compra está anulada.'); end if;
  select * into v_existing from public.fiscal_documents d
  where d.source_type = 'purchase' and d.source_id = pu.id and d.document_type = 'support_document' and d.status not in ('VOID', 'CANCELLED')
  limit 1;
  if v_existing.id is not null then
    return jsonb_build_object('ok', true, 'reused', true, 'document_id', v_existing.id, 'full_number', v_existing.full_number, 'status', v_existing.status);
  end if;

  if p_point is null or not exists (select 1 from public.erp_warehouses w where w.id = p_point and w.store_id = p_store) then
    return public.fiscal__err('POINT_REQUIRED', 'Elige el punto que emite el documento.');
  end if;
  if not public.erp_point_allowed(p_store, p_point) then
    return public.fiscal__err('POINT_FORBIDDEN', 'No puedes emitir documentos de ese punto.');
  end if;
  select * into cfg from public.fiscal_point_configs where point_id = p_point;
  if cfg.point_id is null or not cfg.enabled or cfg.fiscal_entity_id is null or cfg.provider_account_id is null then
    return public.fiscal__err('NOT_READY', 'Ese punto no tiene la facturación electrónica configurada (Centro fiscal → Puntos).');
  end if;

  -- Proveedor: la identificación es la del proveedor de la compra (no se cambia aquí por otra persona).
  select * into s from public.erp_suppliers where id = pu.supplier_id;
  v_doc := nullif(regexp_replace(coalesce(s.nit, ''), '\D', '', 'g'), '');
  v_saved_doc := nullif(regexp_replace(coalesce(p_supplier ->> 'document_number', ''), '\D', '', 'g'), '');
  if v_doc is null then
    v_doc := v_saved_doc;
    if v_doc is null then return public.fiscal__err('INVALID', 'Escribe la cédula o el NIT del proveedor.'); end if;
    update public.erp_suppliers set nit = v_doc, updated_at = now() where id = s.id;
  elsif v_saved_doc is not null and v_saved_doc <> v_doc and v_saved_doc <> left(v_doc, length(v_doc) - 1) and v_doc <> left(v_saved_doc, length(v_saved_doc) - 1) then
    return public.fiscal__err('INVALID', 'La identificación no coincide con la del proveedor de la compra (' || v_doc || ').');
  end if;
  v_doc_type := coalesce(nullif(p_supplier ->> 'document_type', ''), case when length(v_doc) between 9 and 10 and left(v_doc, 1) in ('8', '9') then 'NIT' else 'CC' end);
  if v_doc_type not in ('NIT', 'CC', 'CE', 'PP', 'PAS', 'NIT_EXT', 'PEP', 'PPT', 'DIE') then
    return public.fiscal__err('INVALID', 'Tipo de identificación no válido para documento soporte.');
  end if;
  if v_name = '' then v_name := upper(coalesce(s.name, '')); end if;
  if v_address = '' then return public.fiscal__err('INVALID', 'Falta la dirección del proveedor.'); end if;
  if v_origin = '10' and (v_city is null or length(v_city) <> 5) then
    return public.fiscal__err('INVALID', 'Falta el código DANE del municipio del proveedor (5 dígitos, ej. 05001 Medellín).');
  end if;
  if v_origin = '10' and (v_postal is null or length(v_postal) <> 6) then
    return public.fiscal__err('INVALID', 'Falta el código postal del proveedor (6 dígitos).');
  end if;

  v_supplier := jsonb_build_object(
    'id', null, 'supplier_id', s.id, 'final_consumer', false,
    'person_type', case when p_supplier ->> 'person_type' = 'juridica' then 'juridica' else 'natural' end,
    'document_type', v_doc_type, 'document_number', v_doc,
    'verification_digit', case when v_doc_type in ('NIT', 'CC') then public.fiscal_nit_dv(v_doc) end,
    'name', left(v_name, 300), 'email', nullif(btrim(coalesce(p_supplier ->> 'email', s.email, '')), ''),
    'phone', nullif(btrim(coalesce(p_supplier ->> 'phone', s.phone, '')), ''),
    'address', left(v_address, 300), 'city', v_city, 'city_name', nullif(btrim(coalesce(p_supplier ->> 'city_name', '')), ''),
    'department', left(coalesce(v_city, ''), 2), 'postal_code', v_postal, 'country', coalesce(nullif(p_supplier ->> 'country', ''), 'CO'),
    'origin', v_origin, 'tax_regime', 'R-99-PN', 'is_tax_responsible', coalesce((p_supplier ->> 'is_tax_responsible')::boolean, false));

  select jsonb_agg(jsonb_build_object('product_id', i.product_id, 'sku', p.sku, 'description', coalesce(p.name, 'Producto'),
           'qty', i.qty, 'unit_price', i.unit_cost, 'tax_rate', coalesce(i.tax_rate, 0)) order by i.line_no nulls last, p.name)
    into v_lines
  from public.erp_purchase_items i left join public.products p on p.id = i.product_id
  where i.purchase_id = pu.id and i.qty > 0 and i.unit_cost >= 0;
  if v_lines is null then return public.fiscal__err('NO_LINES', 'La compra no tiene productos con costo.'); end if;

  v_res := public.fiscal__create_document(jsonb_build_object(
    'store_id', p_store, 'point_id', p_point, 'fiscal_entity_id', cfg.fiscal_entity_id, 'establishment_id', cfg.establishment_id,
    'provider_account_id', cfg.provider_account_id, 'document_type', 'support_document', 'environment', cfg.environment,
    'initial_status', 'QUEUED',
    'payment_form', case when pu.payment_type = 'credit' then 'credit' else 'cash' end,
    'due_date', pu.due_date, 'payment_method', coalesce(nullif(p_supplier ->> 'payment_method', ''), 'efectivo'),
    'customer', v_supplier, 'prices_include_tax', false,
    'source_type', 'purchase', 'source_id', pu.id, 'source_number', 'Compra #' || pu.number,
    'idempotency_key', p_idempotency_key, 'lines', v_lines,
    'metadata', jsonb_build_object('purchase_number', pu.number, 'invoice_ref', pu.invoice_ref, 'note', nullif(btrim(coalesce(p_note, '')), ''))));

  -- Para la próxima vez con este proveedor.
  insert into public.erp_supplier_fiscal (supplier_id, store_id, data, updated_by, updated_at)
  values (s.id, p_store, v_supplier - 'id' - 'supplier_id' - 'final_consumer', auth.uid(), now())
  on conflict (supplier_id) do update set data = excluded.data, updated_by = excluded.updated_by, updated_at = now();

  return v_res;
exception
  when sqlstate 'P0001' then
    return public.fiscal__err('VALIDATION', sqlerrm);
  when unique_violation then
    select * into v_existing from public.fiscal_documents d
    where d.store_id = p_store and (d.idempotency_key = p_idempotency_key
      or (d.source_type = 'purchase' and d.source_id = p_purchase and d.document_type = 'support_document' and d.status not in ('VOID', 'CANCELLED')))
    limit 1;
    if v_existing.id is not null then
      return jsonb_build_object('ok', true, 'reused', true, 'document_id', v_existing.id, 'full_number', v_existing.full_number, 'status', v_existing.status);
    end if;
    return public.fiscal__err('DUPLICATE', 'El documento ya se está creando. Revisa el Centro fiscal.');
end;
$$;

-- ---------------------------------------------------------------- 5. nota de ajuste
-- p_lines = [{"line_no": 1, "qty": 2}] (vacío = todo lo que queda del documento).
create or replace function public.fiscal_create_support_adjustment(
  p_document uuid, p_concept text, p_reason text, p_lines jsonb, p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.fiscal_documents;
  v_existing public.fiscal_documents;
  v_lines jsonb := '[]'::jsonb;
  l public.fiscal_document_lines;
  v_qty numeric;
  v_left numeric;
begin
  select * into o from public.fiscal_documents where id = p_document for update;
  if o.id is null then return public.fiscal__err('NOT_FOUND', 'El documento no existe.'); end if;
  if not (public.erp_can(o.store_id, 'fiscal_notes') and public.erp_point_allowed(o.store_id, o.point_id)) then
    return public.fiscal__err('FORBIDDEN', 'Necesitas el permiso de notas y anulaciones en este punto.');
  end if;
  if nullif(p_idempotency_key, '') is not null then
    select * into v_existing from public.fiscal_documents where store_id = o.store_id and idempotency_key = p_idempotency_key;
    if v_existing.id is not null then
      return jsonb_build_object('ok', true, 'reused', true, 'document_id', v_existing.id, 'full_number', v_existing.full_number, 'status', v_existing.status);
    end if;
  end if;
  if o.document_type <> 'support_document' then return public.fiscal__err('INVALID', 'La nota de ajuste es para documentos soporte.'); end if;
  if o.status <> 'ACCEPTED' then return public.fiscal__err('NOT_ACCEPTED', 'Solo se ajustan documentos soporte aceptados.'); end if;
  if coalesce(p_concept, '') not in ('1', '2', '3', '4', '5') then return public.fiscal__err('INVALID', 'Elige el concepto de la nota.'); end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then return public.fiscal__err('INVALID', 'Escribe el motivo de la nota.'); end if;

  for l in select * from public.fiscal_document_lines where document_id = o.id order by line_no loop
    -- Lo que ya se ajustó de esta línea en notas vigentes.
    select l.qty - coalesce(sum(nl.qty), 0) into v_left
    from public.fiscal_document_lines nl join public.fiscal_documents n on n.id = nl.document_id
    where n.related_document_id = o.id and n.document_type = 'support_adjustment' and n.status not in ('VOID', 'REJECTED') and nl.ref_line_no = l.line_no;
    if jsonb_typeof(coalesce(p_lines, 'null')) = 'array' and jsonb_array_length(p_lines) > 0 then
      select coalesce(sum((x ->> 'qty')::numeric), 0) into v_qty from jsonb_array_elements(p_lines) x where (x ->> 'line_no')::integer = l.line_no;
    else
      v_qty := v_left;
    end if;
    if v_qty <= 0 then continue; end if;
    if v_qty > v_left then return public.fiscal__err('INVALID', 'La línea ' || l.line_no || ' solo permite ajustar ' || v_left || '.'); end if;
    v_lines := v_lines || jsonb_build_object('product_id', l.product_id, 'sku', l.sku, 'description', l.description, 'unit_code', l.unit_code,
      'qty', v_qty, 'unit_price', l.unit_price, 'tax_rate', l.tax_rate, 'ref_line_no', l.line_no);
  end loop;
  if jsonb_array_length(v_lines) = 0 then return public.fiscal__err('INVALID', 'No queda nada por ajustar en ese documento.'); end if;

  return public.fiscal__create_document(jsonb_build_object(
    'store_id', o.store_id, 'point_id', o.point_id, 'fiscal_entity_id', o.fiscal_entity_id, 'establishment_id', o.establishment_id,
    'provider_account_id', o.provider_account_id, 'document_type', 'support_adjustment', 'environment', o.environment,
    'initial_status', 'QUEUED', 'payment_form', o.payment_form, 'due_date', o.due_date, 'payment_method', o.payment_method,
    'customer', o.customer, 'prices_include_tax', false,
    'source_type', 'note', 'source_id', o.id, 'source_number', o.full_number,
    'related_document_id', o.id, 'note_concept', p_concept, 'note_reason', btrim(p_reason),
    'idempotency_key', p_idempotency_key, 'lines', v_lines,
    'metadata', jsonb_build_object('adjusts', o.full_number)));
exception
  when sqlstate 'P0001' then
    return public.fiscal__err('VALIDATION', sqlerrm);
end;
$$;

revoke all on function public.fiscal_support_prepare(uuid, uuid) from public, anon;
revoke all on function public.fiscal_issue_support_document(uuid, uuid, uuid, jsonb, text, text) from public, anon;
revoke all on function public.fiscal_create_support_adjustment(uuid, text, text, jsonb, text) from public, anon;
grant execute on function public.fiscal_support_prepare(uuid, uuid) to authenticated;
grant execute on function public.fiscal_issue_support_document(uuid, uuid, uuid, jsonb, text, text) to authenticated;
grant execute on function public.fiscal_create_support_adjustment(uuid, text, text, jsonb, text) to authenticated;
