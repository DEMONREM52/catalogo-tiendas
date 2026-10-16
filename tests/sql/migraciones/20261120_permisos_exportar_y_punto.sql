-- =====================================================================
-- REMHUB · Permisos: «Exportar» y alcance de punto en cuentas por pagar
--
--   1. Permiso nuevo «exports» (Exportar a Excel/CSV). Para no quitarle nada
--      a nadie de golpe, se agrega a los usuarios activos que hoy ya podían
--      descargar algún listado (auditoría/informes, cartera, cuentas por pagar,
--      gastos, nómina, rentabilidad, inventario). Desde ahí, quítalo a quien
--      no deba descargar. Cada descarga queda en la auditoría.
--   2. Cuentas por pagar: un usuario de punto con el permiso las ve, pero
--      solo las de facturas que entraron a SU punto (antes no veía ninguna).
--
-- Requiere 20261115 y 20261118. No borra datos. Es idempotente.
-- =====================================================================

-- 0. Permisos (igual que src/lib/store-user-auth.ts).
create or replace function public.erp__known_permissions()
returns text[]
language sql
immutable
as $$
  select array[
    'store', 'billing', 'pos', 'sales_void', 'sales_return', 'price_approve', 'exports', 'clients', 'clients_delete', 'credit', 'receivables', 'users',
    'products', 'products_view', 'categories', 'orders', 'inventory', 'inventory_adjust', 'inventory_alerts', 'transfers', 'stock_requests',
    'stock_requests_manage', 'notifications_config', 'purchases', 'suppliers', 'payables', 'audit', 'points', 'fiscal', 'fiscal_send',
    'fiscal_notes', 'fiscal_download', 'fiscal_config', 'fiscal_numbering', 'fiscal_provider', 'fiscal_audit',
    'profit_view', 'profit_rules', 'profit_approve',
    'profit_beneficiaries', 'profit_settle', 'profit_settle_approve', 'profit_pay',
    'expenses', 'expenses_pay', 'budgets', 'payroll', 'payroll_approve', 'payroll_pay'
  ]::text[];
$$;

-- 1. Quien ya podía exportar algo conserva la posibilidad (queda en la auditoría como cambio de usuario).
update public.store_users
set permissions = array_append(permissions, 'exports')
where active
  and not ('exports' = any (permissions))
  and permissions && array['audit', 'receivables', 'payables', 'expenses', 'payroll', 'profit_view', 'profit_settle', 'inventory']::text[];

-- 2. Cuentas por pagar con alcance de punto.
create or replace function public.erp__payable_in_my_points(p_store uuid, p_purchase uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.erp_my_points(p_store) is null
      or exists (select 1 from public.erp_purchases pu where pu.id = p_purchase and pu.warehouse_id = any (public.erp_my_points(p_store)));
$$;
revoke all on function public.erp__payable_in_my_points(uuid, uuid) from public, anon;
grant execute on function public.erp__payable_in_my_points(uuid, uuid) to authenticated;

drop policy if exists erp_ap_select on public.erp_payables;
create policy erp_ap_select on public.erp_payables for select to authenticated
  using (public.erp_can(store_id, 'payables') and public.erp__payable_in_my_points(store_id, purchase_id));

notify pgrst, 'reload schema';
