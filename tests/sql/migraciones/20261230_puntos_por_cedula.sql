-- =====================================================================
-- REMHUB · Cliente fiel: por cédula y con regla por punto de venta
--
--   · Los puntos ahora son del DOCUMENTO del cliente (cédula/NIT de la venta),
--     no del nombre: «María López» y «MARIA LOPEZ» con la misma cédula son la
--     misma persona; dos personas con el mismo nombre no se mezclan.
--     Ventas sin documento no suman puntos.
--   · Regla por punto de venta (como Puntos Colombia): cada sede puede dar
--     puntos con su propia tasa (ej. Zamora: 1 punto por cada $500) o no dar
--     puntos. Sin regla, usa la general. Se cuenta venta por venta.
--   · Ajustes manuales con motivo (regalar o quitar puntos) y la lista de
--     clientes con sus puntos e historial.
--   Requiere 20261229. No borra datos. Es idempotente.
-- =====================================================================

create or replace function public.erp__doc_key(p_doc text)
returns text language sql immutable as $$ select upper(regexp_replace(coalesce(p_doc, ''), '[^0-9A-Za-z]', '', 'g')); $$;

alter table public.erp_loyalty_redemptions add column if not exists customer_name text;

create table if not exists public.erp_loyalty_point_rules (
  store_id uuid not null references public.stores(id) on delete cascade,
  point_id uuid not null references public.erp_warehouses(id) on delete cascade,
  earns boolean not null default true,
  pesos_per_point integer check (pesos_per_point is null or pesos_per_point >= 50),
  updated_at timestamptz not null default now(),
  primary key (store_id, point_id)
);
create table if not exists public.erp_loyalty_adjustments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  customer_key text not null,
  customer_name text,
  points integer not null check (points <> 0),
  reason text not null check (char_length(btrim(reason)) >= 3),
  created_by_name text,
  created_at timestamptz not null default now()
);
alter table public.erp_loyalty_point_rules enable row level security;
alter table public.erp_loyalty_adjustments enable row level security;
revoke all on public.erp_loyalty_point_rules, public.erp_loyalty_adjustments from anon, authenticated;

create or replace function public.erp__loyalty_admin(p_store uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (public.erp_can(p_store, 'store') or public.erp_can(p_store, 'price_approve'));
$$;
grant execute on function public.erp__loyalty_admin(uuid) to authenticated;

-- Reglas por punto: leer (cualquiera de la tienda) y guardar (quien administra la tienda).
create or replace function public.erp_loyalty_point_rules_get(p_store uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.erp__is_store_member(p_store) then '[]'::jsonb else
    coalesce(jsonb_agg(jsonb_build_object('point_id', w.id, 'point', w.name, 'earns', coalesce(r.earns, true), 'pesos_per_point', r.pesos_per_point) order by w.name), '[]'::jsonb) end
  from public.erp_warehouses w
  left join public.erp_loyalty_point_rules r on r.store_id = p_store and r.point_id = w.id
  where w.store_id = p_store and w.active;
$$;
revoke all on function public.erp_loyalty_point_rules_get(uuid) from public, anon;
grant execute on function public.erp_loyalty_point_rules_get(uuid) to authenticated;

create or replace function public.erp_loyalty_point_rules_save(p_store uuid, p_rules jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare it jsonb;
begin
  if not public.erp__loyalty_admin(p_store) then return jsonb_build_object('ok', false, 'error', 'Sin permiso.'); end if;
  for it in select * from jsonb_array_elements(coalesce(p_rules, '[]'::jsonb)) loop
    if not exists (select 1 from public.erp_warehouses w where w.id = (it->>'point_id')::uuid and w.store_id = p_store) then continue; end if;
    insert into public.erp_loyalty_point_rules (store_id, point_id, earns, pesos_per_point)
    values (p_store, (it->>'point_id')::uuid, coalesce((it->>'earns')::boolean, true), nullif(it->>'pesos_per_point', '')::integer)
    on conflict (store_id, point_id) do update set earns = excluded.earns, pesos_per_point = excluded.pesos_per_point, updated_at = now();
  end loop;
  return jsonb_build_object('ok', true);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;
revoke all on function public.erp_loyalty_point_rules_save(uuid, jsonb) from public, anon;
grant execute on function public.erp_loyalty_point_rules_save(uuid, jsonb) to authenticated;

-- Puntos ganados por venta (con la regla del punto donde se vendió). Solo ventas con documento.
create or replace function public.erp__loyalty_earned(p_store uuid)
returns table (customer_key text, customer_name text, order_id uuid, at timestamptz, point_id uuid, total numeric, points integer)
language sql stable security definer set search_path = public as $$
  select public.erp__doc_key(coalesce(to_jsonb(m) ->> 'customer_doc', to_jsonb(o) ->> 'customer_doc')),
         upper(btrim(o.customer_name)), o.id, coalesce(o.confirmed_at, o.created_at), m.point_id, o.total,
         case when coalesce(r.earns, true) then floor(o.total / greatest(50, coalesce(r.pesos_per_point, s.pesos_per_point)))::integer else 0 end
  from public.orders o
  join public.erp_loyalty_settings s on s.store_id = o.store_id and s.enabled
  left join public.erp_order_meta m on m.order_id = o.id
  left join public.erp_loyalty_point_rules r on r.store_id = o.store_id and r.point_id = m.point_id
  where o.store_id = p_store and o.status in ('confirmed', 'completed') and coalesce(o.confirmed_at, o.created_at) >= s.since
    and char_length(public.erp__doc_key(coalesce(to_jsonb(m) ->> 'customer_doc', to_jsonb(o) ->> 'customer_doc'))) >= 5;
$$;
revoke all on function public.erp__loyalty_earned(uuid) from public, anon, authenticated;

-- Saldo de un cliente por su documento (reemplaza la versión por nombre de 20261229).
create or replace function public.erp_loyalty_balance(p_store uuid, p_customer text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.erp_loyalty_settings; v_key text := public.erp__doc_key(p_customer); v_earned integer; v_used integer; v_adj integer; v_name text; v_rate integer;
begin
  if auth.uid() is null or not public.erp__is_store_member(p_store) then return jsonb_build_object('ok', false); end if;
  select * into s from public.erp_loyalty_settings where store_id = p_store;
  if not found or not s.enabled then return jsonb_build_object('ok', true, 'enabled', false, 'points', 0); end if;
  if char_length(v_key) < 5 then return jsonb_build_object('ok', true, 'enabled', true, 'needs_doc', true, 'points', 0); end if;
  select coalesce(sum(e.points), 0)::integer, (array_agg(e.customer_name order by e.at desc))[1] into v_earned, v_name
  from public.erp__loyalty_earned(p_store) e where e.customer_key = v_key;
  select coalesce(sum(points), 0)::integer into v_used from public.erp_loyalty_redemptions where store_id = p_store and customer_key = v_key;
  select coalesce(sum(points), 0)::integer into v_adj from public.erp_loyalty_adjustments where store_id = p_store and customer_key = v_key;
  v_rate := s.pesos_per_point;
  return jsonb_build_object('ok', true, 'enabled', true, 'doc', v_key, 'name', v_name,
    'points', greatest(0, v_earned + v_adj - v_used), 'earned', v_earned, 'used', v_used, 'adjusted', v_adj,
    'value', round(greatest(0, v_earned + v_adj - v_used) * s.point_value), 'point_value', s.point_value, 'min_redeem', s.min_redeem, 'pesos_per_point', v_rate);
end;
$$;
revoke all on function public.erp_loyalty_balance(uuid, text) from public, anon;
grant execute on function public.erp_loyalty_balance(uuid, text) to authenticated;

-- Canje (reemplaza la versión por nombre): ahora el cliente se identifica con su documento.
create or replace function public.erp_loyalty_redeem(p_store uuid, p_point uuid, p_customer text, p_points integer, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b jsonb; s public.erp_loyalty_settings; v_value numeric; v_discount numeric; it jsonb; v_out jsonb := '{}'::jsonb; v_id uuid; v_name text; v_prod uuid;
begin
  if auth.uid() is null or not public.erp_can(p_store, 'pos') then return jsonb_build_object('ok', false, 'error', 'Sin permiso de POS.'); end if;
  b := public.erp_loyalty_balance(p_store, p_customer);
  select * into s from public.erp_loyalty_settings where store_id = p_store;
  if not coalesce((b->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'El programa de puntos está apagado.'); end if;
  if coalesce((b->>'needs_doc')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'Escribe la cédula o NIT del cliente.'); end if;
  if p_points < s.min_redeem then return jsonb_build_object('ok', false, 'error', format('Se canjean mínimo %s puntos.', s.min_redeem)); end if;
  if p_points > (b->>'points')::integer then return jsonb_build_object('ok', false, 'error', 'No tiene tantos puntos.'); end if;
  v_value := round(p_points * s.point_value);
  select coalesce(sum(((x->>'old')::numeric - (x->>'price')::numeric) * greatest(1, (x->>'qty')::integer)), 0) into v_discount from jsonb_array_elements(p_items) x;
  if abs(v_discount - v_value) > greatest(1, jsonb_array_length(p_items)) then return jsonb_build_object('ok', false, 'error', 'El descuento no coincide con los puntos.'); end if;
  v_name := case when to_regprocedure('public.erp_actor_name(uuid)') is not null then public.erp_actor_name(p_store) end;
  insert into public.erp_loyalty_redemptions (store_id, customer_key, customer_name, points, value, created_by_name)
  values (p_store, public.erp__doc_key(p_customer), b->>'name', p_points, v_value, v_name);
  if to_regclass('public.erp_price_approvals') is not null then
    for it in select * from jsonb_array_elements(p_items) loop
      v_prod := (it->>'product_id')::uuid;
      v_id := null;
      insert into public.erp_price_approvals (store_id, point_id, product_id, product_name, qty, list_price, floor_price, requested_price, note, status,
        requested_by, requested_by_name, expires_at, decided_by, decided_by_name, decided_at, decision_note)
      select p_store, p_point, p.id, p.name, greatest(1, coalesce((it->>'qty')::integer, 1)), (it->>'old')::numeric, (it->>'price')::numeric, round((it->>'price')::numeric, 2),
        'Canje de puntos', 'approved', auth.uid(), v_name, now() + interval '2 hours', auth.uid(), 'Automático · Canje de puntos', now(), format('%s puntos', p_points)
      from public.products p where p.id = v_prod and p.store_id = p_store
      returning id into v_id;
      if v_id is not null then v_out := v_out || jsonb_build_object(v_prod::text, jsonb_build_object('id', v_id, 'status', 'approved', 'price', round((it->>'price')::numeric, 2), 'by', 'Canje de puntos')); end if;
    end loop;
  end if;
  return jsonb_build_object('ok', true, 'value', v_value, 'passes', v_out);
end;
$$;
revoke all on function public.erp_loyalty_redeem(uuid, uuid, text, integer, jsonb) from public, anon;
grant execute on function public.erp_loyalty_redeem(uuid, uuid, text, integer, jsonb) to authenticated;

-- Regalar o quitar puntos (con motivo, queda en el historial).
create or replace function public.erp_loyalty_adjust(p_store uuid, p_doc text, p_points integer, p_reason text, p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_key text := public.erp__doc_key(p_doc); b jsonb;
begin
  if not public.erp__loyalty_admin(p_store) then return jsonb_build_object('ok', false, 'error', 'Sin permiso.'); end if;
  if char_length(v_key) < 5 then return jsonb_build_object('ok', false, 'error', 'Documento no válido.'); end if;
  if coalesce(p_points, 0) = 0 then return jsonb_build_object('ok', false, 'error', 'Escribe cuántos puntos.'); end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then return jsonb_build_object('ok', false, 'error', 'Escribe el motivo.'); end if;
  b := public.erp_loyalty_balance(p_store, v_key);
  if p_points < 0 and -p_points > coalesce((b->>'points')::integer, 0) then return jsonb_build_object('ok', false, 'error', 'No puede quedar con puntos negativos.'); end if;
  insert into public.erp_loyalty_adjustments (store_id, customer_key, customer_name, points, reason, created_by_name)
  values (p_store, v_key, coalesce(nullif(upper(btrim(coalesce(p_name, ''))), ''), b->>'name'), p_points, btrim(p_reason),
          case when to_regprocedure('public.erp_actor_name(uuid)') is not null then public.erp_actor_name(p_store) end);
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.erp_loyalty_adjust(uuid, text, integer, text, text) from public, anon;
grant execute on function public.erp_loyalty_adjust(uuid, text, integer, text, text) to authenticated;

-- Clientes con puntos (para administrarlos) e historial de uno.
create or replace function public.erp_loyalty_customers(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb; s public.erp_loyalty_settings;
begin
  if auth.uid() is null or not (public.erp__loyalty_admin(p_store) or public.erp_can(p_store, 'clients')) then return jsonb_build_object('ok', false, 'error', 'Sin permiso.'); end if;
  select * into s from public.erp_loyalty_settings where store_id = p_store;
  if not found then return jsonb_build_object('ok', true, 'enabled', false, 'customers', '[]'::jsonb); end if;
  with e as (select customer_key, (array_agg(customer_name order by at desc))[1] as name, sum(points)::integer as earned, count(*)::integer as orders, max(at) as last_at
             from public.erp__loyalty_earned(p_store) group by customer_key),
       u as (select customer_key, sum(points)::integer as used from public.erp_loyalty_redemptions where store_id = p_store group by 1),
       a as (select customer_key, sum(points)::integer as adj, (array_agg(customer_name order by created_at desc))[1] as name from public.erp_loyalty_adjustments where store_id = p_store group by 1),
       k as (select customer_key from e union select customer_key from a)
  select jsonb_build_object('ok', true, 'enabled', s.enabled, 'point_value', s.point_value, 'customers', coalesce(jsonb_agg(jsonb_build_object(
      'doc', k.customer_key, 'name', coalesce(e.name, a.name), 'orders', coalesce(e.orders, 0), 'last_at', e.last_at,
      'earned', coalesce(e.earned, 0), 'used', coalesce(u.used, 0), 'adjusted', coalesce(a.adj, 0),
      'points', greatest(0, coalesce(e.earned, 0) + coalesce(a.adj, 0) - coalesce(u.used, 0)))
      order by greatest(0, coalesce(e.earned, 0) + coalesce(a.adj, 0) - coalesce(u.used, 0)) desc), '[]'::jsonb))
  into r
  from k left join e on e.customer_key = k.customer_key left join u on u.customer_key = k.customer_key left join a on a.customer_key = k.customer_key;
  return r;
end;
$$;
revoke all on function public.erp_loyalty_customers(uuid) from public, anon;
grant execute on function public.erp_loyalty_customers(uuid) to authenticated;

create or replace function public.erp_loyalty_history(p_store uuid, p_doc text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_key text := public.erp__doc_key(p_doc); r jsonb;
begin
  if auth.uid() is null or not (public.erp__loyalty_admin(p_store) or public.erp_can(p_store, 'clients') or public.erp_can(p_store, 'pos')) then return jsonb_build_object('ok', false); end if;
  select jsonb_build_object('ok', true, 'balance', public.erp_loyalty_balance(p_store, v_key), 'items', coalesce(jsonb_agg(x order by x->>'at' desc), '[]'::jsonb))
  into r
  from (
    select jsonb_build_object('at', e.at, 'kind', 'earn', 'points', e.points, 'detail', format('Compra de $%s', to_char(e.total, 'FM999G999G999')), 'point', w.name) as x
    from public.erp__loyalty_earned(p_store) e left join public.erp_warehouses w on w.id = e.point_id where e.customer_key = v_key
    union all
    select jsonb_build_object('at', d.created_at, 'kind', 'redeem', 'points', -d.points, 'detail', format('Canje por $%s', to_char(d.value, 'FM999G999G999')), 'by', d.created_by_name)
    from public.erp_loyalty_redemptions d where d.store_id = p_store and d.customer_key = v_key
    union all
    select jsonb_build_object('at', a.created_at, 'kind', 'adjust', 'points', a.points, 'detail', a.reason, 'by', a.created_by_name)
    from public.erp_loyalty_adjustments a where a.store_id = p_store and a.customer_key = v_key
  ) h;
  return r;
end;
$$;
revoke all on function public.erp_loyalty_history(uuid, text) from public, anon;
grant execute on function public.erp_loyalty_history(uuid, text) to authenticated;

notify pgrst, 'reload schema';
