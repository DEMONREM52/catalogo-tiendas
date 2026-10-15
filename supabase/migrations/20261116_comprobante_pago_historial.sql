-- =====================================================================
-- REMHUB · Comprobante: forma de pago y otros pedidos del mismo cliente
--
--   1. erp_order_payment_by_token: la forma de pago y el vuelto que guardó
--      el POS (20261115), para mostrarlos e imprimirlos en el comprobante.
--   2. erp_customer_orders_by_token: los otros pedidos del MISMO cliente en
--      la MISMA tienda, para verlos desde el enlace de su comprobante.
--      Se identifica al cliente por su documento (cédula/NIT) o su WhatsApp.
--      Nunca para «Consumidor final», documentos genéricos o vacíos.
--      Solo devuelve número, fecha, total y estado (sin productos ni datos
--      de otros clientes). Máximo 20, los más recientes.
--
-- Quien tiene el enlace de un comprobante ya puede verlo: estas funciones
-- usan el mismo enlace (token) como llave. No borra datos. Es idempotente.
-- =====================================================================

create or replace function public.erp_order_payment_by_token(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v jsonb;
begin
  if p_token is null or length(p_token) < 8 then return null; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'erp_order_meta' and column_name = 'payment') then
    return null;
  end if;
  execute 'select m.payment from public.erp_order_meta m join public.orders o on o.id = m.order_id where o.token = $1'
    into v using p_token;
  if v is null then return null; end if;
  return jsonb_build_object('method', v->>'method', 'parts', coalesce(v->'parts', '[]'::jsonb),
    'received', v->'received', 'change', v->'change');
end;
$$;
revoke all on function public.erp_order_payment_by_token(text) from public;
grant execute on function public.erp_order_payment_by_token(text) to anon, authenticated;

create or replace function public.erp_customer_orders_by_token(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  o public.orders;
  v_doc text;
  v_phone text;
  v_has_doc boolean;
  v_rows jsonb;
begin
  if p_token is null or length(p_token) < 8 then return jsonb_build_object('ok', false); end if;
  select * into o from public.orders where token = p_token;
  if o.id is null then return jsonb_build_object('ok', false); end if;
  if upper(btrim(coalesce(o.customer_name, ''))) in ('', 'CONSUMIDOR FINAL', 'CLIENTE', 'CLIENTE GENERAL') then
    return jsonb_build_object('ok', true, 'rows', '[]'::jsonb, 'reason', 'generic');
  end if;

  v_has_doc := exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'erp_order_meta' and column_name = 'customer_doc');
  if v_has_doc then
    execute 'select regexp_replace(coalesce(customer_doc, ''''), ''\D'', '''', ''g'') from public.erp_order_meta where order_id = $1' into v_doc using o.id;
  end if;
  -- Documentos genéricos (consumidor final) no identifican a nadie.
  if v_doc is not null and (length(v_doc) < 5 or v_doc ~ '^(2{6,}|0+|1{6,}|9{6,})$') then v_doc := null; end if;
  v_phone := nullif(right(regexp_replace(coalesce(o.customer_whatsapp, ''), '\D', '', 'g'), 10), '');
  if v_phone is not null and length(v_phone) < 7 then v_phone := null; end if;
  if v_doc is null and v_phone is null then return jsonb_build_object('ok', true, 'rows', '[]'::jsonb, 'reason', 'unknown'); end if;

  execute format($q$
    select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
      select o2.token, o2.created_at, o2.total, o2.status, o2.receipt_no, %s as doc_number
      from public.orders o2
      %s
      where o2.store_id = $1 and o2.id <> $2
        and (%s or ($4::text is not null and right(regexp_replace(coalesce(o2.customer_whatsapp, ''), '\D', '', 'g'), 10) = $4))
      order by o2.created_at desc
      limit 20) x
  $q$,
    case when v_has_doc then 'm2.doc_number' else 'null::text' end,
    case when v_has_doc then 'left join public.erp_order_meta m2 on m2.order_id = o2.id' else '' end,
    case when v_has_doc then '($3::text is not null and regexp_replace(coalesce(m2.customer_doc, ''''), ''\D'', '''', ''g'') = $3)' else 'false' end)
  into v_rows using o.store_id, o.id, v_doc, v_phone;

  return jsonb_build_object('ok', true, 'rows', coalesce(v_rows, '[]'::jsonb));
end;
$$;
revoke all on function public.erp_customer_orders_by_token(text) from public;
grant execute on function public.erp_customer_orders_by_token(text) to anon, authenticated;

notify pgrst, 'reload schema';
