-- =====================================================================
-- REMHUB · Candado (RLS) en pos_payments
--
-- Quedó abierta en 20261234 porque la app la usa, pero solo la lee el panel
-- del administrador de RemHub (igual que pos_invoices). El servidor (llave de
-- servicio) sigue con acceso completo.
-- No borra datos. Es idempotente.
-- =====================================================================

do $$
begin
  if to_regclass('public.pos_payments') is null then return; end if;
  alter table public.pos_payments enable row level security;
  drop policy if exists remhub_admin_read on public.pos_payments;
  create policy remhub_admin_read on public.pos_payments for select to authenticated using (public.erp_is_platform_admin());
end $$;

notify pgrst, 'reload schema';

select relname as tabla, relrowsecurity as candado from pg_class where oid = to_regclass('public.pos_payments');
