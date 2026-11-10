-- 20261315 · Cambiar el vendedor de una remisión o factura del POS al editarla.
--
-- Antes «Guardar cambios» solo guardaba productos, nombre y nota: el vendedor que se escogía al editar se perdía.
--   · erp_pos_order_set_seller(p_order, p_seller): solo mientras el documento se puede editar (borrador o enviado),
--     con permiso de POS en el punto del documento, y el vendedor debe estar en la lista de vendedores de la tienda.
--   · Queda en la auditoría (antes → después).
-- No cambia permisos ni funciones existentes.

create or replace function public.erp_pos_order_set_seller(p_order uuid, p_seller uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  m public.erp_order_meta;
  v_name text;
begin
  if auth.uid() is null then raise exception 'Inicia sesión.'; end if;
  select * into o from public.orders where id = p_order;
  if o.id is null then raise exception 'El documento no existe.'; end if;
  select * into m from public.erp_order_meta where order_id = p_order for update;
  if m.order_id is null then raise exception 'Este pedido no tiene documento del POS.'; end if;
  if not public.erp_can(o.store_id, 'pos') or not public.erp_point_allowed(o.store_id, m.point_id) then
    raise exception 'No tienes permiso para cambiar el vendedor de este documento.';
  end if;
  if o.status not in ('draft', 'sent') then
    raise exception 'El documento ya está confirmado: el vendedor no se puede cambiar.';
  end if;
  if m.seller_id is not distinct from p_seller then
    return jsonb_build_object('ok', true, 'changed', false, 'seller_name', m.seller_name);
  end if;
  if p_seller is not null then
    select s.name into v_name from public.erp_sellers(o.store_id) s where s.user_id = p_seller limit 1;
    if v_name is null then raise exception 'Ese usuario no es vendedor de la tienda.'; end if;
  end if;

  update public.erp_order_meta set seller_id = p_seller, seller_name = v_name where order_id = p_order;
  perform public.erp_audit(o.store_id, 'pos.seller_changed', 'erp_order_meta', p_order,
    jsonb_build_object('doc', m.doc_number, 'before', m.seller_name, 'after', v_name));
  return jsonb_build_object('ok', true, 'changed', true, 'seller_name', v_name);
end;
$$;
revoke all on function public.erp_pos_order_set_seller(uuid, uuid) from public, anon;
grant execute on function public.erp_pos_order_set_seller(uuid, uuid) to authenticated;
