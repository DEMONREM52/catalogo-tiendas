-- =====================================================================
-- REMHUB · Lista de traslados rápida (Inventario → Traslados)
--
--   La lista se armaba con una consulta directa a las tablas: los permisos (RLS) corrían
--   funciones por CADA traslado, por CADA producto de cada traslado y, para el total
--   («count exact»), por TODOS los traslados de la tienda; después iba otra consulta por
--   los pedidos. Con muchos traslados quedaba «Buscando…» un buen rato.
--
--   erp_transfers_page: una sola función que revisa tienda, permiso y punto UNA vez y
--   devuelve la página (30, 60…) con sus productos, firmas, enlace y pedido, y el total.
--   Mismo alcance que hoy: permiso de Traslados o de Inventario, y si tienes punto, solo
--   lo que sale o llega a tus puntos. No devuelve costos ni precios.
--
--   Antes de crearla revisa que los permisos de la tabla sean los conocidos; si en esta
--   base hay otra regla, se detiene y la muestra (para no dar ni quitar acceso).
-- No borra datos. Es idempotente.
-- =====================================================================

do $$
declare v_bad text;
begin
  select string_agg(policyname || ' = ' || coalesce(qual, '(sin condición)'), ' | ') into v_bad
    from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'erp_transfers' and p.permissive = 'PERMISSIVE' and p.cmd in ('SELECT', 'ALL')
     and (
       coalesce(p.qual, '') !~ 'erp_can\(store_id, ''(transfers|inventory)'''
       or exists (select 1 from regexp_matches(coalesce(p.qual, ''), 'erp_can\(store_id, ''([a-z_]+)''', 'g') m where m[1] not in ('transfers', 'inventory'))
       or coalesce(p.qual, '') ~ 'erp_can_any|owner_id|auth\.uid'
       or btrim(coalesce(p.qual, ''), '() ') = 'true'
     );
  if v_bad is not null then
    raise exception 'Los permisos de los traslados en esta base no son los esperados: %. Mándale este mensaje a soporte (no se cambió nada).', v_bad;
  end if;
end $$;

create or replace function public.erp_transfers_page(
  p_store uuid, p_status text default null, p_from timestamptz default null, p_to timestamptz default null,
  p_origin uuid default null, p_dest uuid default null, p_q text default null, p_limit int default 30
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_pts uuid[]; v_pt uuid; v_q text := nullif(btrim(coalesce(p_q, '')), ''); v_like text; v_num bigint;
  v_ids uuid[]; v_total int := 0; v_rows jsonb;
begin
  if auth.uid() is null then raise exception 'Inicia sesión.'; end if;
  if not (public.erp_can(p_store, 'transfers') or public.erp_can(p_store, 'inventory')) then
    raise exception 'No tienes permiso para ver los traslados.';
  end if;
  -- Puntos de la persona (null = ve todos), igual que los permisos de la tabla.
  v_pts := public.erp_my_points(p_store);
  begin
    v_pt := public.erp_my_point(p_store);
  exception when undefined_function then v_pt := null;
  end;
  if p_status is not null and p_status not in ('in_transit', 'received', 'cancelled') then raise exception 'Estado no válido.'; end if;
  if v_q is not null then
    v_q := left(v_q, 80);
    v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    if regexp_replace(v_q, '^#', '') ~ '^\d{1,9}$' then v_num := regexp_replace(v_q, '^#', '')::bigint; end if;
  end if;

  select coalesce(array_agg(x.id order by x.created_at desc), '{}'), coalesce(max(x.total), 0) into v_ids, v_total
    from (
      select t.id, t.created_at, count(*) over () as total
        from public.erp_transfers t
       where t.store_id = p_store
         and (v_pts is null or t.from_warehouse_id = any (v_pts) or t.to_warehouse_id = any (v_pts))
         and (v_pt is null or v_pt in (t.from_warehouse_id, t.to_warehouse_id))
         and (p_status is null or t.status = p_status)
         and (p_from is null or t.created_at >= p_from)
         and (p_to is null or t.created_at < p_to)
         and (p_origin is null or t.from_warehouse_id = p_origin)
         and (p_dest is null or t.to_warehouse_id = p_dest)
         and (v_q is null
              or t.number = v_num
              or to_jsonb(t) ->> 'created_by_name' ilike v_like or to_jsonb(t) ->> 'carrier_name' ilike v_like
              or to_jsonb(t) ->> 'checked_by_name' ilike v_like or to_jsonb(t) ->> 'received_by_name' ilike v_like
              or t.notes ilike v_like
              or exists (select 1 from public.erp_transfer_items i join public.products p on p.id = i.product_id
                          where i.transfer_id = t.id and (p.name ilike v_like or p.sku ilike v_like or p.barcode ilike v_like)))
       order by t.created_at desc
       limit greatest(1, least(coalesce(p_limit, 30), 500))
    ) x;

  select coalesce(jsonb_agg(r order by (r ->> 'created_at') desc), '[]'::jsonb) into v_rows
    from (
      select jsonb_build_object(
        'id', t.id, 'number', t.number, 'status', t.status, 'notes', t.notes, 'created_at', t.created_at,
        'received_at', j -> 'received_at', 'from_warehouse_id', t.from_warehouse_id, 'to_warehouse_id', t.to_warehouse_id,
        'created_by_name', j -> 'created_by_name', 'carrier_name', j -> 'carrier_name', 'checked_by_name', j -> 'checked_by_name',
        'received_by_name', j -> 'received_by_name', 'received_notes', j -> 'received_notes',
        'track_token', j -> 'track_token', 'track_expires_at', j -> 'track_expires_at',
        'erp_transfer_items', coalesce((
          select jsonb_agg(jsonb_build_object('product_id', i.product_id, 'qty', i.qty, 'received_qty', to_jsonb(i) -> 'received_qty',
                   'products', jsonb_build_object('name', p.name, 'sku', p.sku, 'image_url', p.image_url)) order by p.name)
            from public.erp_transfer_items i left join public.products p on p.id = i.product_id
           where i.transfer_id = t.id), '[]'::jsonb),
        'erp_transfer_signatures', coalesce((
          select jsonb_agg(jsonb_build_object('step', s.step, 'signer_name', s.signer_name, 'signed_at', s.signed_at) order by s.signed_at)
            from public.erp_transfer_signatures s where s.transfer_id = t.id), '[]'::jsonb),
        'request', (select jsonb_build_object('transfer_id', q.transfer_id, 'request_id', q.id, 'number', q.number, 'status', q.status)
                      from public.erp_stock_requests q where q.transfer_id = t.id and q.store_id = p_store limit 1)
      ) as r
        from public.erp_transfers t cross join lateral (select to_jsonb(t) as j) jj
       where t.id = any (v_ids)
    ) rows;

  return jsonb_build_object('total', v_total, 'rows', v_rows);
end $$;
revoke all on function public.erp_transfers_page(uuid, text, timestamptz, timestamptz, uuid, uuid, text, int) from public, anon;
grant execute on function public.erp_transfers_page(uuid, text, timestamptz, timestamptz, uuid, uuid, text, int) to authenticated;

notify pgrst, 'reload schema';
