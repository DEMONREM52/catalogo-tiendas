-- =====================================================================
-- 20261302 · Sin avisos del «simulacro del mes sin internet»
--
-- Pedido del usuario (2026-11-08): quitar todo lo del simulacro mensual y sus mensajes.
-- La campana (erp_offline_alerts) deja de mostrar «Simulacro del mes pendiente» y el resumen al
-- administrador; los demás avisos sin conexión (contingencias, ventas por revisar, numeración) siguen igual.
-- Las tablas del simulacro (erp_drills, erp_drill_settings) se dejan sin tocar; no borra datos.
-- Es idempotente. Requiere 20261244.
-- =====================================================================

create or replace function public.erp_offline_alerts(p_store uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_fiscal boolean;
  v_pos boolean;
  v_n integer;
  v_hours numeric;
  v_issues integer;
  v_issues_c integer;
  r record;
begin
  if not public.erp__is_member(p_store) then return '[]'::jsonb; end if;
  v_fiscal := public.erp_can_any(p_store, public.fiscal__view_perms());
  v_pos := public.erp_can(p_store, 'pos');

  if v_fiscal or v_pos then
    select count(*), min(extract(epoch from (d.created_at + interval '48 hours' - now())) / 3600) into v_n, v_hours
    from public.fiscal_documents d
    where d.store_id = p_store and d.document_type = 'contingency_invoice'
      and d.status not in ('ACCEPTED', 'VOID', 'CANCELLED', 'CANCEL_PENDING')
      and public.erp_point_allowed(p_store, d.point_id);
    if v_n > 0 then
      v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'offline-contingency-pending',
        'severity', case when v_hours < 12 then 'critical' else 'serious' end, 'icon', 'alert', 'count', v_n,
        'title', v_n || case when v_n = 1 then ' factura de contingencia sin aceptar' else ' facturas de contingencia sin aceptar' end,
        'body', case when v_hours <= 0 then 'Ya pasó el plazo de 48 horas de la DIAN: revísalas ya en el Centro fiscal.'
                     else 'Quedan ' || greatest(floor(v_hours)::integer, 0) || ' horas del plazo de la DIAN. Revísalas en el Centro fiscal.' end,
        'href', '/dashboard/fiscal?tab=contingencias'));
    end if;
  end if;

  if v_pos then
    select count(*), count(*) filter (where i.kind = 'contingencia') into v_issues, v_issues_c
    from public.erp_pos_offline_issues i
    where i.store_id = p_store and i.resolved_at is null and public.erp_point_allowed(p_store, i.point_id);
    if v_issues > 0 then
      v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'offline-sale-issues',
        'severity', case when v_issues_c > 0 then 'critical' else 'serious' end, 'icon', 'alert', 'count', v_issues,
        'title', v_issues || case when v_issues = 1 then ' venta sin conexión por revisar' else ' ventas sin conexión por revisar' end,
        'body', case when v_issues_c > 0 then 'Hay facturas de contingencia entregadas en papel que aún no quedan registradas. Ábrelas en el POS.'
                     else 'No se pudieron registrar solas (inventario, precio o permisos). Ábrelas en el POS.' end,
        'href', '/dashboard/pos'));
    end if;
  end if;

  if v_fiscal then
    for r in
      select w.id, w.name
      from public.fiscal_point_configs c
      join public.erp_warehouses w on w.id = c.point_id
      join public.erp_org_settings os on os.store_id = c.store_id and os.fiscal_enabled
      where c.store_id = p_store and c.enabled and public.erp_point_allowed(p_store, c.point_id)
        and public.fiscal__pick_range(c.point_id, c.fiscal_entity_id, 'contingency_invoice', c.environment) is null
      order by w.name
      limit 5
    loop
      v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'fiscal-no-contingency-' || r.id, 'severity', 'warning', 'icon', 'hash',
        'title', 'Sin numeración de contingencia: ' || r.name,
        'body', 'Si se cae el internet no podrás facturar en papel. Pídela a la DIAN y cárgala en Centro fiscal → Numeración.',
        'href', '/dashboard/fiscal?tab=numeracion'));
    end loop;
  end if;

  return v_out;
end;
$$;
revoke all on function public.erp_offline_alerts(uuid) from public, anon;
grant execute on function public.erp_offline_alerts(uuid) to authenticated;

notify pgrst, 'reload schema';
