-- Registra el pedido #193 (REMB-00001) de LA VITRINA en la cartera de VARIEDADES HOGAR Y ESTILO SAS (NIT 902106752),
-- como venta a crédito. Quedó fuera de cartera porque el paso que marca la venta falló (prefijo repetido).
-- Usa la MISMA función del POS (erp_credit_register) actuando como el dueño, con todas sus revisiones (cupo, bloqueo).
-- Todo o nada: si algo falla no se guarda nada y sale el motivo. Córrelo en Supabase → SQL Editor (todo junto).
--
-- Días de crédito: por defecto los del cliente (o 30 si no tiene). Para otro plazo cambia null por el número.

begin;

do $$
declare
  v_days     integer := null;           -- ← días de crédito (opcional), p. ej. 30
  v_store    uuid;
  v_owner    uuid;
  v_token    text;
  v_order    uuid;
  v_customer uuid;
  v_res      jsonb;
begin
  select s.id, s.owner_id into v_store, v_owner from public.stores s where s.name ilike 'la vitrina' limit 1;
  if v_store is null then raise exception 'No encontré la tienda LA VITRINA'; end if;

  select o.id, o.token into v_order, v_token from public.orders o where o.store_id = v_store and o.receipt_no = 193;
  if v_token is null then raise exception 'No encontré el pedido #193'; end if;

  if exists (select 1 from public.erp_receivables r where r.order_id = v_order and r.status <> 'void') then
    raise exception 'El #193 ya está en cartera: no se registra dos veces.';
  end if;

  select c.id, coalesce(v_days, nullif(c.credit_days, 0), 30) into v_customer, v_days
  from public.billing_customers c
  where c.store_id = v_store and regexp_replace(coalesce(c.document_number, ''), '\D', '', 'g') = '902106752'
  limit 1;
  if v_customer is null then raise exception 'No encontré el cliente con NIT 902106752'; end if;

  -- Actuar como el dueño (igual que si lo hiciera desde el POS).
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('role', 'authenticated', true);

  v_res := to_jsonb(public.erp_credit_register(v_store, v_token, v_customer, v_days, false));
  raise notice 'Registrado en cartera (% días): %', v_days, v_res;
end $$;

commit;

-- Revisión: la cuenta por cobrar del #193.
select o.receipt_no, r.doc_number, r.total, r.balance, r.issue_date, r.due_date, r.status
from public.erp_receivables r
join public.orders o on o.id = r.order_id
join public.stores s on s.id = o.store_id
where s.name ilike 'la vitrina' and o.receipt_no = 193;
