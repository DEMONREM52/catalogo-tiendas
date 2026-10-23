-- =====================================================================
-- REMHUB · Funciones con permisos de dueño que se llamaban sin sesión
--
-- Supabase avisaba «Public Can Execute SECURITY DEFINER Function»: funciones
-- que corren con permisos de dueño y que cualquiera podía llamar sin iniciar
-- sesión por /rest/v1/rpc (ej. apply_stock_on_confirm, admin_fiscal_*).
--
-- Se les quita el acceso SIN SESIÓN (anon). Los usuarios con sesión, el
-- servidor y los demás roles de Supabase lo conservan igual que antes.
--
-- Se dejan como están (no se tocan):
--   · las que llama la página pública o el servidor (lista de abajo, sacada
--     del código de RemHub fuera del panel);
--   · las que usa un permiso de tabla (RLS), un valor por defecto, una regla
--     (check), una vista o una función normal: esas se ejecutan con el rol de
--     quien consulta y, sin acceso, el catálogo público dejaría de funcionar.
--
-- Lo que se cambia queda anotado en remhub_private.anon_revoked para poder
-- devolverlo (ver el final). No borra datos. Es idempotente.
-- =====================================================================

create schema if not exists remhub_private;
revoke all on schema remhub_private from public, anon, authenticated;
create table if not exists remhub_private.anon_revoked (
  firma text primary key,
  revoked_at timestamptz not null default now()
);

create temporary table if not exists _anon_report (funcion text, resultado text);
truncate _anon_report;

do $$
declare
  f record;
  r record;
  v_refs text;
  -- Funciones que llama RemHub fuera del panel (catálogo, pedidos, traslados, comprobantes, login, registro, servidor…).
  v_allow text[] := array[
    'admin_store_spaces','catalog_admin_bulk','catalog_admin_duplicate','catalog_admin_products','catalog_admin_summary',
    'catalog_create_order','catalog_public','catalog_public_image_search','catalog_public_meta','catalog_public_products',
    'catalog_public_stock','confirm_order_v2','create_order_from_cart','create_wompi_checkout','erp__security_event',
    'erp_access_overview','erp_alerts','erp_audit_access','erp_audit_chain_heads','erp_audit_client_event','erp_audit_export',
    'erp_audit_overview','erp_audit_scope_save','erp_audit_search','erp_audit_verify','erp_below_cost_check',
    'erp_beneficiary_save','erp_budget_save','erp_cancel_purchase','erp_cancel_transfer','erp_cash_board','erp_cash_close',
    'erp_cash_move','erp_cash_open','erp_cash_review','erp_cash_settings_save','erp_combo_delete','erp_combo_save',
    'erp_combos_list','erp_commission_rules_get','erp_commission_rules_save','erp_commissions','erp_confirm_transfer',
    'erp_cost_alert_push','erp_cost_alerts_list','erp_cost_alerts_seen','erp_credit_check','erp_credit_register',
    'erp_customer_insights','erp_customer_orders_by_token','erp_customer_pay','erp_customer_statement','erp_daily_close',
    'erp_daily_close_digest','erp_dispatch_transfers','erp_employee_delete','erp_employee_save','erp_expense_attach',
    'erp_expense_category_save','erp_expense_detail','erp_expense_pay','erp_expense_payment_void','erp_expense_save',
    'erp_expense_void','erp_expenses_list','erp_extra_alerts','erp_finance_catalog','erp_finance_overview','erp_finance_setup',
    'erp_goal_save','erp_goals_progress','erp_internal_board','erp_internal_claim_create','erp_internal_claim_decide',
    'erp_internal_doc_add','erp_internal_doc_void','erp_internal_opening_from_stock','erp_internal_payment_add',
    'erp_internal_payment_void','erp_internal_pct_rule_save','erp_internal_point_save','erp_internal_preview',
    'erp_internal_profit','erp_internal_push_digest','erp_internal_settings_save','erp_internal_statement','erp_kardex',
    'erp_layaway_cancel','erp_layaway_complete','erp_layaway_create','erp_layaway_hold','erp_layaway_pay','erp_layaway_release',
    'erp_layaways_list','erp_lot_close','erp_lot_save','erp_lots_list','erp_loyalty_adjust','erp_loyalty_balance',
    'erp_loyalty_brand','erp_loyalty_customers','erp_loyalty_history','erp_loyalty_point_rules_get',
    'erp_loyalty_point_rules_save','erp_loyalty_redeem','erp_loyalty_settings_get','erp_loyalty_settings_save','erp_my_access',
    'erp_my_point','erp_my_points','erp_notification_prefs_get','erp_notification_prefs_save','erp_order_doc_by_token',
    'erp_order_payment_by_token','erp_overview','erp_pay_supplier','erp_payable_alert_ack','erp_payable_alert_settings_save',
    'erp_payable_push_digest','erp_payable_reminder_save','erp_payables_board','erp_payment_qr_list','erp_payment_qr_save',
    'erp_payroll_concept_save','erp_payroll_create','erp_payroll_delete_draft','erp_payroll_detail','erp_payroll_line_update',
    'erp_payroll_pay','erp_payroll_payment_void','erp_payroll_runs_list','erp_payroll_transition','erp_permission_grants_cleanup',
    'erp_point_prices','erp_point_valuation','erp_points_dashboard','erp_pool_overview','erp_pool_settings_save',
    'erp_pos_documents','erp_pos_order_set_items','erp_pos_price_floors','erp_pos_set_customer_doc','erp_pos_set_payment',
    'erp_pos_submit_offline','erp_post_adjustment','erp_price_approval_decide','erp_price_approval_get',
    'erp_price_approval_request','erp_price_approvals_for_order','erp_price_approvals_pending','erp_price_limit_save',
    'erp_price_limits_get','erp_price_passes','erp_price_rule_decide','erp_price_rule_retire','erp_price_rule_save',
    'erp_price_rules_list','erp_prices_below_cost','erp_product_costs','erp_product_finder','erp_product_image_search',
    'erp_product_last_costs','erp_product_list_prices','erp_product_margins','erp_product_markups','erp_product_pricing_get',
    'erp_product_pricing_save','erp_product_stock_by_point','erp_products_pending_entry','erp_profit_settings_get',
    'erp_profit_settings_save','erp_profit_summary','erp_promotion_delete','erp_promotion_save','erp_promotions_list',
    'erp_purchase_set_notes','erp_purchase_suggestions','erp_push_subscribe','erp_push_unsubscribe','erp_quote_public',
    'erp_quote_save','erp_quote_set_status','erp_quotes_list','erp_receivable_manual','erp_receivable_pay',
    'erp_receivable_payment_void','erp_receivable_void','erp_receivables_overview','erp_receive_invoice','erp_recurring_delete',
    'erp_recurring_save','erp_report','erp_reprice_apply','erp_reprice_preview','erp_reserve_fund_delete','erp_reserve_fund_save',
    'erp_reserve_move','erp_restock_suggestions','erp_role_template_delete','erp_role_template_save','erp_sale_finance_fix_costs',
    'erp_sale_void','erp_sale_void_rights','erp_search_products','erp_sellers','erp_settlement_breakdown',
    'erp_settlement_calculate','erp_settlement_detail','erp_settlement_pay','erp_settlement_payment_void',
    'erp_settlement_transition','erp_settlements_list','erp_split_save','erp_stale_stock','erp_stock_browse','erp_stock_check',
    'erp_stock_inbox','erp_stock_page','erp_stock_request_create','erp_stock_request_detail','erp_stock_request_message',
    'erp_stock_request_precheck','erp_stock_request_read','erp_stock_request_sign','erp_stock_request_suggestions',
    'erp_stock_requests_list','erp_tag_order','erp_third_party_balances','erp_transfer_track','erp_transfer_track_prices',
    'erp_transfer_track_renew','erp_transfer_track_request','erp_transfer_track_sign','erp_transfer_update_items',
    'erp_update_purchase','erp_warranty_list','erp_warranty_save','erp_warranty_update','fiscal__webhook_store',
    'fiscal_point_readiness','fiscal_public_receipt','get_order_by_token_v2','get_wompi_payment_status','process_addi_callback',
    'process_wompi_event','product_image_pending','product_image_save','product_set_categories','saas_admin_customers',
    'saas_admin_dashboard','saas_admin_help_video_save','saas_admin_manual_payment','saas_admin_payments','saas_admin_plans',
    'saas_admin_referral_reward','saas_admin_referrals','saas_admin_save_plan','saas_admin_set_subscription',
    'saas_admin_settings_save','saas_admin_store_growth','saas_admin_store_health','saas_admin_store_history','saas_cancel',
    'saas_checkout_create','saas_entitlements','saas_my_payments','saas_my_referrals','saas_my_store_status','saas_onboarding',
    'saas_payment_apply','saas_plan_blocked_permissions','saas_public_plans','saas_public_showcase','saas_push_digest',
    'saas_set_referrer','saas_signup_create_store','saas_track','saas_trial_start','saas_webhook_reject','search_products_pro',
    'search_products_safe','store_domain_add','store_domain_list','store_domain_remove','store_domain_set_primary',
    'store_domain_set_status','store_home_target','store_links_get','store_public_domain','store_public_home',
    'store_public_image_search','store_public_paused','store_public_search','store_public_seo','store_public_tracking',
    'store_public_verification','store_seo_get','store_seo_health','store_seo_save','store_short_link_delete',
    'store_short_link_hit','store_short_link_save','store_site_get','store_slug_available','store_slug_check',
    'store_team_set_order_status','update_order_items_by_token_v2'
  ];
begin
  -- Textos que se ejecutan con el rol de quien consulta: si nombran una función, esa se deja igual.
  select string_agg(x, ' ') into v_refs from (
    select coalesce(qual, '') || ' ' || coalesce(with_check, '') as x from pg_policies
    union all select pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d
    union all select pg_get_constraintdef(c.oid) from pg_constraint c where c.contype = 'c'
    union all select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and not p.prosecdef
    union all select pg_get_viewdef(c.oid) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('v', 'm')
  ) t;
  v_refs := coalesce(v_refs, '');

  for f in
    select p.oid, p.proname, p.oid::regprocedure::text as firma
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.prokind = 'f'
      and has_function_privilege('anon', p.oid, 'execute')
      and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
    order by 3
  loop
    if f.proname = any(v_allow) then
      insert into _anon_report values (f.firma, 'se deja: la usa la página pública o el servidor');
      continue;
    end if;
    if v_refs ~ ('\m' || f.proname || '\M') then
      insert into _anon_report values (f.firma, 'se deja: la usa un permiso o regla de la base');
      continue;
    end if;
    begin
      -- Quién la podía usar antes (además de anon): se le devuelve el permiso tras quitar el general.
      create temporary table if not exists _had (rol text);
      truncate _had;
      insert into _had
        select r2.rolname from pg_roles r2
        where r2.rolname <> 'anon' and r2.rolname !~ '^pg_' and has_function_privilege(r2.oid, f.oid, 'execute');
      execute format('revoke execute on function %s from public, anon', f.firma);
      for r in select rol from _had loop
        execute format('grant execute on function %s to %I', f.firma, r.rol);
      end loop;
      insert into remhub_private.anon_revoked (firma) values (f.firma) on conflict (firma) do nothing;
      insert into _anon_report values (f.firma, 'sin sesión ya no (con sesión sigue igual)');
    exception when others then
      insert into _anon_report values (f.firma, 'no se pudo: ' || sqlerrm);
    end;
  end loop;
end $$;

notify pgrst, 'reload schema';

select resultado, count(*) as funciones, (array_agg(funcion order by funcion))[1:8] as ejemplos
from _anon_report group by resultado order by resultado;

-- Para devolver el acceso sin sesión a UNA función (si algo público dejara de servir):
--   grant execute on function public.NOMBRE(argumentos) to anon;
-- Para devolverlo a TODAS las que cambió esta migración:
--   do $$ declare x text; begin for x in select firma from remhub_private.anon_revoked loop
--     execute format('grant execute on function %s to anon', x); end loop; end $$;
