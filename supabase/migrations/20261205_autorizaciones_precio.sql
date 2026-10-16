-- =====================================================================
-- REMHUB · Las autorizaciones de precio no se pierden
--
--   · Editar una factura o remisión: la autorización que ESA venta ya usó
--     sigue valiendo para ese producto (mismo precio o mayor). Antes, al
--     guardar los cambios, había que pedirla otra vez.
--   · Editar sin bajar el precio de una línea siempre se puede guardar (aunque
--     la haya vendido el jefe o el dueño por debajo del mínimo del vendedor).
--     Bajarla más sigue pidiendo autorización.
--   · No se modifica el guardián de precios de producción (se agregan ayudantes).
--   · Una autorización aprobada dura 4 horas para usarse (antes 30 minutos):
--     alcanza para una venta en espera, una recarga o un corte de internet.
--     Sigue sirviendo UNA sola vez, solo a quien la pidió y solo a ese precio o más.
--   · El panel puede consultar las autorizaciones que usó una venta (para
--     mostrarlas como «Autorizado» al editarla) y sabe cuándo venció una aprobada.
-- Requiere 20261115. No borra datos. Es idempotente.
-- =====================================================================

create or replace function pg_temp.patch(p_fn regprocedure, p_marker text, p_pattern text, p_replacement text)
returns void language plpgsql as $$
declare v_def text := pg_get_functiondef(p_fn); v_new text;
begin
  if position(p_marker in v_def) > 0 then return; end if;
  v_new := regexp_replace(v_def, p_pattern, p_replacement);
  -- Si la versión de producción es distinta, no se detiene la migración: solo se avisa.
  if v_new = v_def then raise notice 'No se cambió % (versión distinta): revísala a mano.', p_fn; return; end if;
  execute v_new;
end $$;

-- 1. Al editar una venta, la autorización que ESA venta ya usó sigue valiendo (mismo precio o más).
--    No se modifica el guardián de precios de producción: un ayudante corre justo ANTES que él (los
--    disparadores van en orden alfabético: «…_a_reuse…» < «…_price_guard») y, solo para esa línea,
--    le avisa con erp.price_ok (la misma señal que el guardián ya respeta). Antes de la siguiente
--    línea, y al terminar la instrucción, la señal vuelve a como estaba: nunca queda abierta.
create or replace function public.erp__order_item_reuse_approval()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_store uuid; v_price numeric := round(new.price, 2);
begin
  -- Si se abrió para la línea anterior de esta misma instrucción, se cierra primero.
  if current_setting('remhub.reuse_set', true) = '1' then
    perform set_config('erp.price_ok', coalesce(current_setting('remhub.reuse_prev', true), ''), true);
    perform set_config('remhub.reuse_set', '', true);
  end if;
  if tg_op = 'UPDATE' and round(old.price, 2) = v_price then return new; end if;
  if current_setting('erp.price_ok', true) = '1' then return new; end if;
  select o.store_id into v_store from public.orders o where o.id = new.order_id;
  if exists (select 1 from public.erp_price_approvals u
             where u.store_id = v_store and u.product_id = new.product_id and u.status = 'used'
               and u.used_order_id = new.order_id and u.requested_price <= v_price)
     -- Editar sin bajar el precio: una línea que ya estaba en la venta a ese precio (o menos) se vuelve a guardar
     -- aunque la haya vendido alguien con otro límite (jefe, dueño). Bajarla más sí pasa por el guardián.
     or (tg_op = 'UPDATE' and v_price >= round(old.price, 2))
     or (tg_op = 'INSERT' and v_price >= coalesce((
           (coalesce(nullif(current_setting('remhub.prev_lines', true), ''), '{}')::jsonb ->> (new.order_id::text || ':' || new.product_id::text))::numeric),
           v_price + 1)) then
    perform set_config('remhub.reuse_prev', coalesce(current_setting('erp.price_ok', true), ''), true);
    perform set_config('erp.price_ok', '1', true);
    perform set_config('remhub.reuse_set', '1', true);
  end if;
  return new;
end $$;
revoke all on function public.erp__order_item_reuse_approval() from public, anon, authenticated;

create or replace function public.erp__order_item_reuse_reset()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('remhub.reuse_set', true) = '1' then
    perform set_config('erp.price_ok', coalesce(current_setting('remhub.reuse_prev', true), ''), true);
    perform set_config('remhub.reuse_set', '', true);
  end if;
  return null;
end $$;
revoke all on function public.erp__order_item_reuse_reset() from public, anon, authenticated;

-- Al editar, el POS borra y vuelve a escribir las líneas: se recuerda (solo durante esa misma operación)
-- a qué precio estaba cada producto, para reconocer las líneas a las que no se les bajó el precio.
create or replace function public.erp__order_item_remember()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_prev jsonb := coalesce(nullif(current_setting('remhub.prev_lines', true), ''), '{}')::jsonb; v_key text := old.order_id::text || ':' || old.product_id::text;
begin
  perform set_config('remhub.prev_lines',
    (v_prev || jsonb_build_object(v_key, least(coalesce((v_prev ->> v_key)::numeric, round(old.price, 2)), round(old.price, 2))))::text, true);
  return old;
end $$;
revoke all on function public.erp__order_item_remember() from public, anon, authenticated;
drop trigger if exists erp_order_items_a_remember on public.order_items;
create trigger erp_order_items_a_remember before delete on public.order_items
  for each row execute function public.erp__order_item_remember();

drop trigger if exists erp_order_items_a_reuse_approval on public.order_items;
create trigger erp_order_items_a_reuse_approval before insert or update of price on public.order_items
  for each row execute function public.erp__order_item_reuse_approval();
drop trigger if exists erp_order_items_z_reuse_reset on public.order_items;
create trigger erp_order_items_z_reuse_reset after insert or update of price on public.order_items
  for each statement execute function public.erp__order_item_reuse_reset();

-- 2. Aprobada: 4 horas para usarla (antes 30 minutos).
select pg_temp.patch('public.erp_price_approval_decide(uuid, boolean, text)'::regprocedure, 'remhub:aprobada_4_horas',
  'now\(\) \+ interval ''30 minutes''',
  'now() + interval ''4 hours'' /* remhub:aprobada_4_horas */');

-- 3. Estado de las solicitudes: también avisa cuando una aprobada ya venció.
create or replace function public.erp_price_approval_get(p_ids uuid[])
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'product_id', a.product_id, 'requested_price', a.requested_price,
           'status', case when a.status in ('pending', 'approved') and a.expires_at < now() then 'expired' else a.status end,
           'expires_at', a.expires_at, 'decided_by_name', a.decided_by_name, 'decision_note', a.decision_note)), '[]'::jsonb)
  from public.erp_price_approvals a
  where a.id = any (coalesce(p_ids[1:100], '{}'))
    and (a.requested_by = auth.uid() or public.erp_can(a.store_id, 'price_approve'));
$$;
revoke all on function public.erp_price_approval_get(uuid[]) from public, anon;
grant execute on function public.erp_price_approval_get(uuid[]) to authenticated;

-- 4. Autorizaciones que usó una venta (para mostrarlas al editarla).
create or replace function public.erp_price_approvals_for_order(p_order uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_store uuid;
begin
  select o.store_id into v_store from public.orders o where o.id = p_order;
  if v_store is null or not (public.erp_can(v_store, 'pos') or public.erp_can(v_store, 'price_approve') or public.erp_can(v_store, 'orders')) then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'product_id', a.product_id, 'requested_price', a.requested_price,
             'decided_by_name', a.decided_by_name, 'decision_note', a.decision_note) order by a.used_at)
    from public.erp_price_approvals a
    where a.store_id = v_store and a.used_order_id = p_order and a.status = 'used'), '[]'::jsonb);
end $$;
revoke all on function public.erp_price_approvals_for_order(uuid) from public, anon;
grant execute on function public.erp_price_approvals_for_order(uuid) to authenticated;

notify pgrst, 'reload schema';
