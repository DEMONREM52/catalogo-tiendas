-- =====================================================================
-- REMHUB · Candado (RLS) en las tablas que no lo tenían
--
-- Supabase avisaba «RLS Disabled in Public» (crítico): esas tablas se podían
-- leer y cambiar con la clave pública, sin iniciar sesión. Son tablas del
-- sistema anterior (pos_invoices, pos_customers, billing_series, contadores…).
--
--   1. Activa RLS en cada tabla de public que no lo tenga, MENOS las que la
--      app usa directamente desde el navegador (esas se reportan al final
--      para revisarlas una por una; no se tocan).
--   2. Solo el administrador de RemHub puede leerlas (panel de admin).
--      El servidor (llave de servicio) sigue teniendo acceso completo.
--   3. Las funciones viejas de consecutivos que escriben en esas tablas pasan
--      a ejecutarse con permisos de dueño, para que sigan funcionando igual.
-- No borra datos. Es idempotente. Al final muestra lo que hizo.
-- =====================================================================

create temporary table if not exists _rls_report (tabla text, accion text);
truncate _rls_report;

do $$
declare
  t record;
  -- Tablas que el navegador usa directamente (no se tocan aquí aunque no tengan RLS).
  v_app text[] := array[
    'addi_payment_attempts','billing_customers','billing_document_lines','billing_documents','billing_payments','billing_settings',
    'cash_receipts','cash_sessions','categories','credit_invoices','data_exchange_jobs','erp_adjustments','erp_audit_logs',
    'erp_notification_prefs','erp_order_meta','erp_payables','erp_purchase_files','erp_purchase_items','erp_purchases','erp_push_log',
    'erp_push_subscriptions','erp_role_templates','erp_stock_levels','erp_stock_request_items','erp_stock_request_messages',
    'erp_stock_requests','erp_suppliers','erp_transfer_items','erp_transfers','erp_warehouses','fiscal_entities',
    'fiscal_provider_accounts','fiscal_secrets','fiscal_webhook_events','inventory_movements','order_items','order_payments','orders',
    'payment_transactions','pos_ar_accounts','pos_payments','product_categories','product_category_links','products',
    'saas_help_videos','siigo_invoices','store_addi_credentials','store_catalog_categories','store_catalog_products','store_catalogs',
    'store_contacts','store_links','store_members','store_payment_methods','store_payment_secrets','store_profiles',
    'store_social_campaign_items','store_social_campaigns','store_social_posts','store_staff','store_tracking','store_users',
    'stores','themes','user_profiles'];
begin
  for t in
    select c.oid, c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
      -- Las tablas de extensiones (ej. PostGIS) no son nuestras.
      and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
    order by c.relname
  loop
    if t.relname = any(v_app) then
      insert into _rls_report values (t.relname, 'REVISAR: la app la usa y no tiene RLS (no se tocó)');
      continue;
    end if;
    begin
      execute format('alter table public.%I enable row level security', t.relname);
      execute format('drop policy if exists remhub_admin_read on public.%I', t.relname);
      if to_regprocedure('public.erp_is_platform_admin()') is not null then
        execute format('create policy remhub_admin_read on public.%I for select to authenticated using (public.erp_is_platform_admin())', t.relname);
      end if;
      insert into _rls_report values (t.relname, 'candado puesto (solo el admin de RemHub la lee)');
    exception when others then
      insert into _rls_report values (t.relname, 'no se pudo: ' || sqlerrm);
    end;
  end loop;
end $$;

-- pos_invoices y admin_notifications: la app solo las lee el admin (panel) y el servidor.
do $$
declare v text;
begin
  foreach v in array array['pos_invoices', 'admin_notifications'] loop
    if to_regclass('public.' || v) is null then continue; end if;
    if not (select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.' || v)) then
      execute format('alter table public.%I enable row level security', v);
      execute format('drop policy if exists remhub_admin_read on public.%I', v);
      if to_regprocedure('public.erp_is_platform_admin()') is not null then
        execute format('create policy remhub_admin_read on public.%I for select to authenticated using (public.erp_is_platform_admin())', v);
      end if;
      insert into _rls_report values (v, 'candado puesto (solo el admin de RemHub la lee)');
    end if;
  end loop;
end $$;

-- Funciones viejas de consecutivos: siguen funcionando con el candado (permisos de dueño).
do $$
declare f record;
begin
  for f in
    select p.oid, p.oid::regprocedure::text as firma
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and not p.prosecdef
      and p.proname in ('billing_next_doc_number', 'next_doc_number', 'pos_next_invoice_number', 'rh_next_doc_number')
  loop
    execute format('alter function %s security definer set search_path = public', f.firma);
    insert into _rls_report values (f.firma, 'función con permisos de dueño');
  end loop;
end $$;

notify pgrst, 'reload schema';

select tabla, accion from _rls_report order by accion desc, tabla;
