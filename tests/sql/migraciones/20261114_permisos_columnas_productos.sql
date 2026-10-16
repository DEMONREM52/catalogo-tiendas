do $$
declare v_read text; v_edit text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_read
  from information_schema.columns
  where table_schema = 'public' and table_name = 'products' and column_name <> 'cost_price';
  execute format('grant select (%s) on public.products to authenticated', v_read);
  if not has_table_privilege('authenticated', 'public.products', 'UPDATE') then
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_edit
    from information_schema.columns
    where table_schema = 'public' and table_name = 'products' and column_name not in ('cost_price', 'stock');
    execute format('grant update (%s) on public.products to authenticated', v_edit);
  end if;
end $$;
notify pgrst, 'reload schema';
