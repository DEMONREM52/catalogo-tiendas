-- =====================================================================
-- REMHUB · Vistas viejas sin saltarse los candados
--
-- Supabase avisaba «Security Definer View» (crítico) en 6 vistas del sistema
-- anterior: leían las tablas con permisos del dueño, saltándose el RLS, así
-- que con la clave pública se veían datos de todas las tiendas.
-- La app de hoy no usa ninguna.
--
--   1. Pasan a «security_invoker»: respetan el candado de quien consulta.
--   2. Se les quita el acceso desde la página (anon y usuarios). El servidor
--      (llave de servicio) y el editor SQL las siguen viendo.
-- No borra datos ni las vistas. Es idempotente. Al final muestra cómo quedaron.
-- =====================================================================

do $$
declare v text;
begin
  foreach v in array array['billing_products_view', 'vw_inventory_kardex', 'vw_customer_wallet_summary',
                           'vw_billing_documents_export', 'vw_wallet_export', 'vw_cash_receipts_export'] loop
    if to_regclass('public.' || v) is null then continue; end if;
    execute format('alter view public.%I set (security_invoker = true)', v);
    execute format('revoke all on public.%I from anon, authenticated', v);
    execute format('grant select on public.%I to service_role', v);
  end loop;
end $$;

notify pgrst, 'reload schema';

select c.relname as vista,
       coalesce((select option_value from pg_options_to_table(c.reloptions) where option_name = 'security_invoker'), 'false') as respeta_candado,
       has_table_privilege('anon', c.oid, 'select') as visible_sin_sesion
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'v'
  and c.relname in ('billing_products_view', 'vw_inventory_kardex', 'vw_customer_wallet_summary',
                    'vw_billing_documents_export', 'vw_wallet_export', 'vw_cash_receipts_export')
order by 1;
