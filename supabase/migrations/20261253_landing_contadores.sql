-- =====================================================================
-- REMHUB · Landing pages: contadores configurables (siempre con datos reales)
--
--   Desde el panel se elige, por landing (config.urgency):
--     · viewers_window: 'now' (latido de 75 s) | '15m' | '1h' | 'today'
--     · viewers_min:    desde cuántas personas se muestra el 👁️
--     · sold_window:    'today' | 'week' | 'month' | 'all'
--     · recent_hours:   pedidos recientes de las últimas 24, 72, 168 o 720 h
--   erp_landing_pages.counters_from: «Reiniciar contadores». Lo que se ve en
--   la página cuenta desde ahí (las estadísticas y la ganancia no se tocan).
-- Requiere 20261252. No borra datos. Es idempotente.
-- =====================================================================

alter table public.erp_landing_pages add column if not exists counters_from timestamptz;

create or replace function public.erp__landing_social(p_page uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  pg public.erp_landing_pages;
  u jsonb;
  v_today timestamptz := ((now() at time zone 'America/Bogota')::date)::timestamp at time zone 'America/Bogota';
  v_vw text; v_sw text; v_hours integer;
  v_vsince timestamptz; v_ssince timestamptz; v_rsince timestamptz;
  v_live bigint; v_sold bigint; v_recent jsonb;
begin
  select * into pg from public.erp_landing_pages where id = p_page;
  if pg.id is null then return jsonb_build_object('live', 0, 'sold_week', 0, 'recent', '[]'::jsonb); end if;
  u := coalesce(pg.config -> 'urgency', '{}'::jsonb);
  v_vw := case when u ->> 'viewers_window' in ('now', '15m', '1h', 'today') then u ->> 'viewers_window' else 'now' end;
  v_sw := case when u ->> 'sold_window' in ('today', 'week', 'month', 'all') then u ->> 'sold_window' else 'week' end;
  v_hours := case when (u ->> 'recent_hours') ~ '^\d+$' then least(greatest((u ->> 'recent_hours')::integer, 1), 720) else 72 end;

  v_vsince := case v_vw when 'now' then now() - interval '75 seconds' when '15m' then now() - interval '15 minutes' when '1h' then now() - interval '1 hour' else v_today end;
  v_ssince := case v_sw when 'today' then v_today when 'week' then now() - interval '7 days' when 'month' then now() - interval '30 days' else '-infinity'::timestamptz end;
  v_rsince := now() - make_interval(hours => v_hours);
  -- «Reiniciar contadores»: lo público cuenta desde ese momento.
  if pg.counters_from is not null then
    v_vsince := greatest(v_vsince, pg.counters_from);
    v_ssince := greatest(v_ssince, pg.counters_from);
    v_rsince := greatest(v_rsince, pg.counters_from);
  end if;

  select count(*) into v_live from public.erp_landing_visits v where v.page_id = p_page and v.last_seen >= v_vsince;
  select coalesce(sum(lo.units), 0) into v_sold
  from public.erp_landing_orders lo join public.orders o on o.id = lo.order_id
  where lo.page_id = p_page and lo.created_at >= v_ssince and coalesce(o.status, '') <> 'cancelled';
  select coalesce(jsonb_agg(x order by x.at desc), '[]'::jsonb) into v_recent from (
    select initcap(lo.first_name) as name, initcap(lo.city) as city, lo.units, lo.created_at as at,
           floor(extract(epoch from now() - lo.created_at) / 60)::integer as minutes
    from public.erp_landing_orders lo join public.orders o on o.id = lo.order_id
    where lo.page_id = p_page and lo.created_at >= v_rsince and coalesce(o.status, '') <> 'cancelled' and coalesce(lo.first_name, '') <> ''
    order by lo.created_at desc limit 12) x;

  -- «sold_week» se conserva como nombre por compatibilidad con la página (ahora es «vendidos en el periodo elegido»).
  return jsonb_build_object('live', v_live, 'live_window', v_vw, 'sold_week', v_sold, 'sold_window', v_sw, 'recent', v_recent);
end $$;
revoke all on function public.erp__landing_social(uuid) from public, anon, authenticated;

create or replace function public.erp_landing_reset_counters(p_store uuid, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.erp_can(p_store, 'products') then return jsonb_build_object('ok', false, 'message', 'Sin permiso.'); end if;
  update public.erp_landing_pages set counters_from = now(), updated_by = auth.uid(), updated_at = now() where id = p_id and store_id = p_store;
  return jsonb_build_object('ok', found);
end;
$$;
revoke all on function public.erp_landing_reset_counters(uuid, uuid) from public, anon;
grant execute on function public.erp_landing_reset_counters(uuid, uuid) to authenticated;
