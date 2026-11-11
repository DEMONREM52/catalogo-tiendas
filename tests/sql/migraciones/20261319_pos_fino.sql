-- 20261319 · POS fino: cuatro permisos que antes venían dentro de «POS / Facturar».
--
--   pos_credit     Vender a crédito             (erp_credit_register; «Créditos y cupos» también sirve)
--   pos_layaways   Apartados                    (erp_layaway_*)
--   pos_quotes     Cotizaciones                 (erp_quote_save / erp_quotes_list / erp_quote_set_status; «Pedidos» también sirve)
--   pos_all_sales  Ver ventas de otros vendedores en el POS (erp_pos_documents; sin él, solo las suyas)
--
-- Nadie pierde nada: a quien tiene «pos» se le agregan los cuatro (una sola vez, con la marca 'perm_pos2'), y
-- también a las plantillas de roles que traen «pos». Desde ahí se pueden quitar uno por uno.
-- Las funciones se toman TAL COMO ESTÁN en la base (pg_get_functiondef) y solo se cambia la revisión del permiso;
-- si una no tiene la forma esperada, no se toca y sale un aviso. Se puede correr dos veces.

do $$
declare
  v_known text[] := public.erp__known_permissions();
  v_new text[] := array['pos_credit', 'pos_layaways', 'pos_quotes', 'pos_all_sales', 'perm_pos2'];
  v_first boolean := not ('pos_credit' = any (v_known));
begin
  -- 1. La base reconoce los permisos nuevos.
  if exists (select 1 from unnest(v_new) x where not (x = any (v_known))) then
    v_known := v_known || array(select x from unnest(v_new) x where not (x = any (v_known)));
    execute format('create or replace function public.erp__known_permissions() returns text[] language sql immutable as $f$ select %L::text[] $f$', v_known);
  end if;

  -- 2. Plantillas de roles con «pos» (solo la primera vez).
  if v_first and to_regclass('public.erp_role_templates') is not null then
    execute $u$
      update public.erp_role_templates t set permissions = array(select distinct x from unnest(
        t.permissions || array['pos_credit', 'pos_layaways', 'pos_quotes', 'pos_all_sales']) x)
      where 'pos' = any (t.permissions)
    $u$;
  end if;
end $$;

-- 3. Usuarios: quien tiene «pos» sigue pudiendo todo (una sola vez por usuario, gracias a la marca).
update public.store_users su
set permissions = array(select distinct x from unnest(
  coalesce(su.permissions, '{}'::text[])
  || case when 'pos' = any (coalesce(su.permissions, '{}'::text[])) then array['pos_credit', 'pos_layaways', 'pos_quotes', 'pos_all_sales'] else '{}'::text[] end
  || array['perm_pos2']) x)
where not ('perm_pos2' = any (coalesce(su.permissions, '{}'::text[])));

-- 4. Funciones.
do $$
declare
  r record;
  v_old text;
  v_new text;
  v_mark text;
  v_done integer := 0;
begin
  for r in
    select p.oid, p.proname from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
      and (p.proname in ('erp_credit_register', 'erp_pos_documents', 'erp_quote_save', 'erp_quotes_list', 'erp_quote_set_status')
           or p.proname like 'erp\_layaway%' escape '\')
    order by p.proname
  loop
    v_old := pg_get_functiondef(r.oid);
    v_mark := case when r.proname = 'erp_credit_register' then 'pos_credit'
                   when r.proname = 'erp_pos_documents' then 'pos_all_sales'
                   when r.proname like 'erp\_quote%' escape '\' then 'pos_quotes'
                   else 'pos_layaways' end;
    if position('''' || v_mark || '''' in v_old) > 0 then
      raise notice '· % ya estaba', r.proname;
      continue;
    end if;

    if r.proname = 'erp_credit_register' then
      v_new := regexp_replace(v_old,
        '(if not public\.erp_can\(p_store, ''pos''\) then raise exception ''No tienes permiso para facturar\.''; end if;)',
        E'\\1\n  if not public.erp_can_any(p_store, array[''pos_credit'', ''credit'']::text[]) then raise exception ''No tienes permiso para vender a crédito.''; end if;');
    elsif r.proname = 'erp_pos_documents' then
      v_new := regexp_replace(v_old,
        '(and m\.point_id = params\.pt)',
        E'\\1\n    and (public.erp_can(p_store, ''pos_all_sales'') or m.seller_id = auth.uid() or m.created_by = auth.uid())');
    else
      -- erp_can(x, 'pos') → (erp_can(x, 'pos') and erp_can(x, '<propio>'))
      v_new := regexp_replace(v_old,
        'public\.erp_can\((\s*[A-Za-z_][A-Za-z0-9_.]*\s*),\s*''pos''(::text)?\s*\)',
        '(public.erp_can(\1, ''pos'') and public.erp_can(\1, ''' || v_mark || '''))', 'g');
    end if;

    if v_new <> v_old then
      execute v_new;
      v_done := v_done + 1;
      raise notice '✔ % ahora pide «%»', r.proname, v_mark;
    else
      raise notice '· % sin cambio (no pide «pos» de la forma esperada)', r.proname;
    end if;
  end loop;
  raise notice 'Funciones actualizadas: %', v_done;
end $$;
