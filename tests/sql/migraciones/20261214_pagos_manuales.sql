-- =====================================================================
-- REMHUB · Pagos manuales y activación sin pasarela
--
-- Mientras no esté Wompi (o si un cliente paga por transferencia, Nequi
-- o efectivo), el administrador de RemHub registra el pago a mano:
--   saas_admin_manual_payment: crea el pago (provider = 'manual'),
--   lo aprueba con el mismo camino de Wompi (saas_payment_apply: una sola
--   vez, extiende el período y deja todo en el historial) y cuenta en
--   «Cobrado» y en el MRR igual que un pago en línea.
-- La activación «todo incluido» (sin cobro) se hace con
-- saas_admin_set_subscription (plan Fundador) desde la pantalla.
-- Requiere 20261211. Idempotente.
-- =====================================================================

do $$
begin
  if to_regprocedure('public.saas_payment_apply(text, text, text, text, text, bigint, text, text, text, jsonb)') is null then
    raise exception 'Primero ejecuta 20261211_saas_planes_suscripciones.sql.';
  end if;
end $$;

alter table public.saas_payments add column if not exists note text;
alter table public.saas_payments add column if not exists external_reference text;   -- nº de la transferencia, comprobante…

create or replace function public.saas_admin_manual_payment(p_store uuid, p_plan text, p_period text, p_amount integer, p_method text,
                                                            p_reference text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref text;
  v_res jsonb;
  v_method text := lower(btrim(coalesce(p_method, '')));
begin
  if not public.erp_is_platform_admin() then return jsonb_build_object('ok', false, 'error', 'Solo el administrador de RemHub.'); end if;
  if not exists (select 1 from public.stores where id = p_store) then return jsonb_build_object('ok', false, 'error', 'La tienda no existe.'); end if;
  if not exists (select 1 from public.saas_plans where id = p_plan) then return jsonb_build_object('ok', false, 'error', 'Ese plan no existe.'); end if;
  if p_period not in ('month', 'year') then return jsonb_build_object('ok', false, 'error', 'Periodo no válido.'); end if;
  if coalesce(p_amount, 0) <= 0 then return jsonb_build_object('ok', false, 'error', 'Escribe el valor recibido.'); end if;
  if v_method not in ('transferencia', 'nequi', 'daviplata', 'efectivo', 'tarjeta', 'otro') then return jsonb_build_object('ok', false, 'error', 'Elige cómo te pagaron.'); end if;
  if char_length(btrim(coalesce(p_note, ''))) < 3 then return jsonb_build_object('ok', false, 'error', 'Escribe una nota (quién pagó, a qué cuenta…).'); end if;

  v_ref := 'RH-M-' || to_char(now() at time zone 'America/Bogota', 'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.saas_payments (store_id, reference, provider, environment, plan_id, billing_period, amount_cents, status, created_by, note, external_reference)
  values (p_store, v_ref, 'manual', 'production', p_plan, p_period, p_amount::bigint * 100, 'created', auth.uid(), btrim(p_note), nullif(btrim(coalesce(p_reference, '')), ''));
  -- Mismo camino que un pago de Wompi aprobado (extiende el período una sola vez).
  v_res := public.saas_payment_apply('manual', 'manual:' || v_ref, v_ref, null, 'APPROVED', p_amount::bigint * 100, 'COP', v_method, 'production',
                                     jsonb_build_object('by', auth.uid(), 'method', v_method, 'reference', nullif(btrim(coalesce(p_reference, '')), '')));
  insert into public.saas_subscription_events (store_id, kind, after, reason, by_user)
  values (p_store, 'manual_payment', jsonb_build_object('reference', v_ref, 'amount', p_amount, 'plan', p_plan, 'period', p_period, 'method', v_method), btrim(p_note), auth.uid());
  return jsonb_build_object('ok', true, 'reference', v_ref, 'result', v_res);
end $$;
revoke all on function public.saas_admin_manual_payment(uuid, text, text, integer, text, text, text) from public, anon;
grant execute on function public.saas_admin_manual_payment(uuid, text, text, integer, text, text, text) to authenticated;

-- El listado de pagos del admin muestra también el método, la nota y la referencia externa.
create or replace function public.saas_admin_payments(p_q text, p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_q text := nullif(btrim(coalesce(p_q, '')), '');
begin
  if not public.erp_is_platform_admin() then return jsonb_build_object('ok', false, 'error', 'Solo el administrador de RemHub.'); end if;
  return jsonb_build_object('ok', true,
    'payments', coalesce((select jsonb_agg(r order by r->>'created_at' desc) from (
        select jsonb_build_object('reference', p.reference, 'store', s.name, 'store_id', p.store_id, 'plan_id', p.plan_id, 'period', p.billing_period,
                                  'amount', p.amount_cents / 100, 'status', p.status, 'provider', p.provider, 'provider_tx_id', coalesce(p.provider_tx_id, p.external_reference),
                                  'environment', p.environment, 'method', p.payment_method, 'note', p.note, 'created_at', p.created_at, 'approved_at', p.approved_at) as r
        from public.saas_payments p left join public.stores s on s.id = p.store_id
        where v_q is null or p.reference ilike '%' || v_q || '%' or s.name ilike '%' || v_q || '%' or p.provider_tx_id ilike '%' || v_q || '%'
           or p.external_reference ilike '%' || v_q || '%'
        order by p.created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500)) x), '[]'::jsonb),
    'webhooks', coalesce((select jsonb_agg(jsonb_build_object('at', w.received_at, 'result', w.result, 'detail', w.detail, 'valid', w.valid_signature, 'key', left(w.event_key, 40))
                                           order by w.received_at desc)
                          from (select * from public.saas_webhook_events where provider <> 'manual' order by received_at desc limit 50) w), '[]'::jsonb));
end $$;

notify pgrst, 'reload schema';
