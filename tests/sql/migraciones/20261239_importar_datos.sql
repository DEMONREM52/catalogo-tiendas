-- =====================================================================
-- REMHUB · Importar y exportar (centro de datos)
--
--   1. erp_payables: referencia y nota opcionales, para las deudas con
--      proveedores que vienen de antes de usar RemHub (sin compra).
--   2. erp_payable_opening: crea una cuenta por pagar inicial (permiso
--      «Cuentas por pagar»). Revisa que el proveedor sea de la tienda y no
--      repite la misma referencia del mismo proveedor (importar dos veces el
--      mismo archivo no duplica). Queda en la auditoría.
-- No borra datos. Es idempotente.
-- =====================================================================

alter table public.erp_payables add column if not exists reference text;
alter table public.erp_payables add column if not exists notes text;

create or replace function public.erp_payable_opening(p_store uuid, p_supplier uuid, p_amount numeric, p_due date, p_reference text, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ref text := nullif(btrim(coalesce(p_reference, '')), '');
begin
  if auth.uid() is null or not public.erp_can(p_store, 'payables') then raise exception 'Necesitas el permiso «Cuentas por pagar».'; end if;
  if not exists (select 1 from public.erp_suppliers s where s.id = p_supplier and s.store_id = p_store) then raise exception 'Ese proveedor no es de tu tienda.'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'El valor debe ser mayor que cero.'; end if;
  if v_ref is not null then
    select id into v_id from public.erp_payables
    where store_id = p_store and supplier_id = p_supplier and reference = v_ref and status <> 'void' limit 1;
    if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'duplicate', true); end if;
  end if;
  insert into public.erp_payables (store_id, supplier_id, purchase_id, total, balance, due_date, status, reference, notes)
  values (p_store, p_supplier, null, round(p_amount, 2), round(p_amount, 2), p_due, 'open', v_ref, nullif(btrim(coalesce(p_notes, '')), ''))
  returning id into v_id;
  perform public.erp_audit(p_store, 'payable.opening', 'erp_payables', v_id,
    jsonb_build_object('supplier_id', p_supplier, 'amount', p_amount, 'due', p_due, 'reference', v_ref));
  return jsonb_build_object('ok', true, 'id', v_id, 'duplicate', false);
end $$;
revoke all on function public.erp_payable_opening(uuid, uuid, numeric, date, text, text) from public, anon;
grant execute on function public.erp_payable_opening(uuid, uuid, numeric, date, text, text) to authenticated;

notify pgrst, 'reload schema';
