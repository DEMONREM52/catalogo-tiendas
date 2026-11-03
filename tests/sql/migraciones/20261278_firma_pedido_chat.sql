-- =====================================================================
-- REMHUB · Enlace de firmas del pedido = traslado + conversación (sobre 20261277)
--
--   La página del enlace (/firma-pedido/<enlace>) se ve como el seguimiento de
--   un traslado: además del pedido, sus productos y sus firmas, trae la
--   conversación del pedido (solo lectura) y quién chuleó el empaque.
--   Cuando el pedido sale, la página pasa sola al seguimiento del traslado.
-- No borra datos. Es idempotente.
-- =====================================================================

create or replace function public.erp_sr_sign_link_get(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r public.erp_stock_requests;
begin
  r := public.erp__sr_by_link(p_token);
  return jsonb_build_object(
    'number', r.number, 'status', r.status, 'priority', r.priority, 'note', r.note, 'needed_by', r.needed_by,
    'requested_by_name', r.requested_by_name, 'handled_by_name', r.handled_by_name, 'created_at', r.created_at,
    'expires_at', (select expires_at from public.erp_sr_sign_links where token = p_token),
    'store', (select jsonb_build_object('name', s.name, 'logo_url', s.logo_url) from public.stores s where s.id = r.store_id),
    'from', (select jsonb_build_object('name', w.name, 'kind', w.kind) from public.erp_warehouses w where w.id = r.from_point_id),
    'to', (select jsonb_build_object('name', w.name, 'kind', w.kind) from public.erp_warehouses w where w.id = r.to_point_id),
    'items', coalesce((select jsonb_agg(jsonb_build_object('name', p.name, 'image_url', p.image_url, 'sku', p.sku,
                         'requested', i.qty_requested, 'approved', i.qty_approved, 'received', i.qty_received, 'note', i.note,
                         'packed_by', (select c.checked_by_name from public.erp_sr_item_checks c where c.item_id = i.id and c.side = 'pack')) order by p.name)
                       from public.erp_stock_request_items i join public.products p on p.id = i.product_id where i.request_id = r.id), '[]'::jsonb),
    'signatures', coalesce((select jsonb_agg(jsonb_build_object('step', s.step, 'signer_name', s.signer_name, 'signer_doc', s.signer_doc,
                              'signature', s.signature, 'notes', s.notes, 'via', s.via, 'signed_at', s.signed_at) order by s.signed_at)
                            from public.erp_stock_request_signatures s where s.request_id = r.id), '[]'::jsonb),
    -- La conversación del pedido (lo último), para que quien firma vea lo que se habló.
    'messages', coalesce((select jsonb_agg(jsonb_build_object('user_name', m.user_name, 'point_name', m.point_name, 'kind', m.kind,
                            'body', m.body, 'created_at', m.created_at) order by m.created_at)
                          from (select * from public.erp_stock_request_messages where request_id = r.id order by created_at desc limit 80) m), '[]'::jsonb),
    'transfer', (select jsonb_build_object('number', t.number, 'status', t.status, 'track_token', to_jsonb(t) ->> 'track_token')
                 from public.erp_transfers t where t.id = r.transfer_id)
  );
end $$;
revoke all on function public.erp_sr_sign_link_get(text) from public;
grant execute on function public.erp_sr_sign_link_get(text) to anon, authenticated;

notify pgrst, 'reload schema';
