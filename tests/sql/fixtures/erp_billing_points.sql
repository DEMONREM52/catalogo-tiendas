-- REMHUB · Datos de facturación por punto (idempotente)
-- Ejecutar después de erp_core.sql / erp_ops.sql.
alter table public.erp_warehouses
  add column if not exists legal_name text,
  add column if not exists nit text,
  add column if not exists city text,
  add column if not exists email text,
  add column if not exists receipt_footer text;
