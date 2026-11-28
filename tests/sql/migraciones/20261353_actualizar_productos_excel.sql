-- =====================================================================
-- REMHUB · Actualizar productos desde Excel (Data Studio)
--
--   products_bulk_update(p_store, p_key, p_file, p_rows)
--   · Cambia SOLO los campos que se mandan: nombre, código de barras,
--     categoría, descripción y precios 1 a 5. Nunca costo ni unidades
--     (esos siguen entrando solo por ingreso de factura, ajuste o traslado).
--   · Cada fila trae lo que la persona vio antes ("expect"). Si el
--     producto cambió mientras revisaba, esa fila NO se toca y se avisa.
--   · Permisos: «Editar productos» e «Importar productos»; para precios,
--     además «Cambiar precios».
--   · Precio por % de ganancia: si el producto tiene % y costo, el precio
--     escrito queda exacto y el % pasa a ser el que da ese precio (igual
--     que al escribir el precio en el producto). Por debajo del costo, esa
--     fila no se toca.
--   · Llave del envío: el mismo envío dos veces se aplica una sola vez.
--   · Auditoría: un registro con el resumen; el historial de precios y la
--     auditoría de cada producto se llenan solos (disparadores de siempre).
--   · erp_product_bulk_runs guarda cada envío con el antes y el después.
-- No borra datos. No cambia permisos. Es idempotente.
-- =====================================================================

create table if not exists public.erp_product_bulk_runs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  op_key text not null,
  user_id uuid,
  file_name text,
  updated integer not null default 0,
  result jsonb not null default '{}'::jsonb,
  changes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (store_id, op_key)
);
alter table public.erp_product_bulk_runs enable row level security;
revoke all on public.erp_product_bulk_runs from public, anon, authenticated;
grant select on public.erp_product_bulk_runs to authenticated;
drop policy if exists erp_product_bulk_runs_read on public.erp_product_bulk_runs;
create policy erp_product_bulk_runs_read on public.erp_product_bulk_runs for select to authenticated
  using (public.erp_can(store_id, 'products_import'));

create or replace function public.products_bulk_update(p_store uuid, p_key text, p_file text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed constant text[] := array['name', 'barcode', 'category_id', 'description', 'price_1', 'price_2', 'price_3', 'price_4', 'price_5'];
  v_prev jsonb;
  v_row jsonb;
  v_set jsonb;
  v_expect jsonb;
  v_key text;
  v_id uuid;
  v_cur jsonb;
  v_any_price boolean := false;
  v_has_markups boolean;
  v_basis text := 'last';
  v_cost numeric;
  v_price numeric;
  v_level integer;
  v_mk jsonb;
  v_bad text;
  v_updated integer := 0;
  v_same integer := 0;
  v_conflicts jsonb := '[]'::jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_done jsonb := '[]'::jsonb;
  v_fields text[] := '{}'::text[];
  v_run uuid := gen_random_uuid();
  v_file text := left(coalesce(p_file, ''), 200);
  v_result jsonb;
begin
  if auth.uid() is null or not public.erp_can(p_store, 'products') or not public.erp_can(p_store, 'products_import') then
    raise exception 'Necesitas los permisos «Editar productos» e «Importar productos».' using errcode = '42501';
  end if;
  if coalesce(btrim(p_key), '') = '' or length(p_key) > 100 then raise exception 'Falta la llave del envío.'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'Los cambios llegaron mal.'; end if;
  if jsonb_array_length(p_rows) > 1000 then raise exception 'Máximo 1.000 productos por envío.'; end if;

  -- El mismo envío dos veces (doble clic, se cayó la red): se devuelve lo que pasó la primera vez.
  perform pg_advisory_xact_lock(hashtext('products_bulk_update:' || p_store::text || ':' || p_key));
  select r.result into v_prev from public.erp_product_bulk_runs r where r.store_id = p_store and r.op_key = p_key;
  if found then return v_prev || jsonb_build_object('repeated', true); end if;

  -- Forma de los datos, antes de tocar nada.
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_set := v_row -> 'set';
    if jsonb_typeof(v_row -> 'id') is distinct from 'string' or jsonb_typeof(v_set) is distinct from 'object' then
      raise exception 'Los cambios llegaron mal.';
    end if;
    for v_key in select jsonb_object_keys(v_set) loop
      if not v_key = any (v_allowed) then raise exception 'Ese campo no se cambia desde Excel: %', v_key; end if;
      if v_key like 'price\_%' then v_any_price := true; end if;
      if not v_key = any (v_fields) then v_fields := v_fields || v_key; end if;
    end loop;
  end loop;
  if v_any_price and not public.erp_can(p_store, 'products_prices') then
    raise exception 'Necesitas el permiso «Cambiar precios» para cambiar precios.' using errcode = '42501';
  end if;

  v_has_markups := exists (select 1 from information_schema.columns
                           where table_schema = 'public' and table_name = 'products' and column_name = 'markup_1');
  begin
    execute 'select coalesce(price_cost_basis, ''last'') from public.erp_profit_settings where store_id = $1' into v_basis using p_store;
  exception when undefined_table or undefined_column then v_basis := 'last';
  end;
  v_basis := coalesce(v_basis, 'last');
  -- El precio escrito queda exacto: el cálculo automático por % no corre en este envío (el % se ajusta abajo).
  perform set_config('erp.skip_reprice', '1', true);

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_set := v_row -> 'set';
    v_expect := coalesce(v_row -> 'expect', '{}'::jsonb);
    begin v_id := (v_row ->> 'id')::uuid; exception when others then v_id := null; end;
    v_cur := null;
    select to_jsonb(p) into v_cur from public.products p where p.id = v_id and p.store_id = p_store for update;
    if v_cur is null then
      v_errors := v_errors || jsonb_build_object('id', v_row ->> 'id', 'error', 'Ese producto no existe en la tienda');
      continue;
    end if;

    -- ¿Alguien lo cambió mientras se revisaba? Solo cuentan los campos que este envío cambia.
    select string_agg(e.key, ',') into v_bad from jsonb_each(v_expect) e
    where e.key = any (v_allowed) and v_set ? e.key and (v_cur -> e.key) is distinct from e.value;
    if v_bad is not null then
      v_conflicts := v_conflicts || jsonb_build_object('id', v_id, 'name', v_cur ->> 'name', 'fields', v_bad);
      continue;
    end if;
    -- Ya tiene esos valores: nada que hacer.
    if not exists (select 1 from jsonb_each(v_set) e where (v_cur -> e.key) is distinct from e.value) then
      v_same := v_same + 1;
      continue;
    end if;

    -- Valores de esta fila.
    v_bad := null;
    if v_set ? 'name' and coalesce(btrim(v_set ->> 'name'), '') = '' then v_bad := 'El nombre no puede quedar vacío';
    elsif v_set ? 'name' and length(v_set ->> 'name') > 200 then v_bad := 'El nombre pasa de 200 letras';
    elsif v_set ? 'barcode' and length(coalesce(v_set ->> 'barcode', '')) > 64 then v_bad := 'El código de barras pasa de 64 caracteres';
    elsif v_set ? 'description' and length(coalesce(v_set ->> 'description', '')) > 5000 then v_bad := 'La descripción pasa de 5.000 letras';
    elsif v_set ? 'category_id' and v_set ->> 'category_id' is not null
          and not exists (select 1 from public.product_categories c where c.id::text = v_set ->> 'category_id' and c.store_id = p_store) then
      v_bad := 'La categoría no es de esta tienda';
    end if;
    for v_level in 1..5 loop
      exit when v_bad is not null;
      continue when not v_set ? ('price_' || v_level);
      if jsonb_typeof(v_set -> ('price_' || v_level)) is distinct from 'number'
         or (v_set ->> ('price_' || v_level))::numeric < 0 or (v_set ->> ('price_' || v_level))::numeric > 999999999999 then
        v_bad := 'Precio ' || v_level || ': no es un precio válido';
      end if;
    end loop;

    -- % de ganancia: el que da el precio escrito, sobre el mismo costo con que la base calcula los precios.
    v_mk := '{}'::jsonb;
    if v_bad is null and v_has_markups then
      v_cost := case when v_basis = 'last' and coalesce((v_cur ->> 'last_cost')::numeric, 0) > 0 then (v_cur ->> 'last_cost')::numeric
                     else coalesce((v_cur ->> 'cost_price')::numeric, 0) end;
      if v_cost > 0 then
        for v_level in 1..5 loop
          continue when not v_set ? ('price_' || v_level) or coalesce(v_cur -> ('markup_' || v_level), 'null'::jsonb) = 'null'::jsonb;
          v_price := (v_set ->> ('price_' || v_level))::numeric;
          if v_price < v_cost then v_bad := 'Precio ' || v_level || ': queda por debajo del costo (revísalo en el producto)'; exit; end if;
          v_mk := v_mk || jsonb_build_object('markup_' || v_level, least(1000, round((v_price / v_cost - 1) * 100, 4)));
        end loop;
      end if;
    end if;
    if v_bad is not null then
      v_errors := v_errors || jsonb_build_object('id', v_id, 'name', v_cur ->> 'name', 'error', v_bad);
      continue;
    end if;

    begin
      update public.products set
        name = case when v_set ? 'name' then btrim(v_set ->> 'name') else name end,
        barcode = case when v_set ? 'barcode' then nullif(btrim(coalesce(v_set ->> 'barcode', '')), '') else barcode end,
        category_id = case when v_set ? 'category_id' then (v_set ->> 'category_id')::uuid else category_id end,
        description = case when v_set ? 'description' then coalesce(v_set ->> 'description', '') else description end,
        price_1 = case when v_set ? 'price_1' then (v_set ->> 'price_1')::numeric else price_1 end,
        price_2 = case when v_set ? 'price_2' then (v_set ->> 'price_2')::numeric else price_2 end,
        price_3 = case when v_set ? 'price_3' then (v_set ->> 'price_3')::numeric else price_3 end,
        price_4 = case when v_set ? 'price_4' then (v_set ->> 'price_4')::numeric else price_4 end,
        price_5 = case when v_set ? 'price_5' then (v_set ->> 'price_5')::numeric else price_5 end,
        price_retail = case when v_set ? 'price_3' then (v_set ->> 'price_3')::numeric else price_retail end,
        price_wholesale = case when v_set ? 'price_2' then (v_set ->> 'price_2')::numeric else price_wholesale end
      where id = v_id;
      if v_mk <> '{}'::jsonb then
        execute 'update public.products set
            markup_1 = case when $1 ? ''markup_1'' then ($1 ->> ''markup_1'')::numeric else markup_1 end,
            markup_2 = case when $1 ? ''markup_2'' then ($1 ->> ''markup_2'')::numeric else markup_2 end,
            markup_3 = case when $1 ? ''markup_3'' then ($1 ->> ''markup_3'')::numeric else markup_3 end,
            markup_4 = case when $1 ? ''markup_4'' then ($1 ->> ''markup_4'')::numeric else markup_4 end,
            markup_5 = case when $1 ? ''markup_5'' then ($1 ->> ''markup_5'')::numeric else markup_5 end
          where id = $2' using v_mk, v_id;
      end if;
      v_updated := v_updated + 1;
      v_done := v_done || jsonb_build_object('id', v_id, 'name', v_cur ->> 'name',
        'before', (select coalesce(jsonb_object_agg(e.key, v_cur -> e.key), '{}'::jsonb) from jsonb_each(v_set) e),
        'after', v_set);
    exception
      when unique_violation then
        v_errors := v_errors || jsonb_build_object('id', v_id, 'name', v_cur ->> 'name', 'error', 'Ese código ya lo tiene otro producto');
      when check_violation or not_null_violation or string_data_right_truncation or numeric_value_out_of_range then
        v_errors := v_errors || jsonb_build_object('id', v_id, 'name', v_cur ->> 'name', 'error', 'La base no aceptó el valor: ' || sqlerrm);
    end;
  end loop;
  perform set_config('erp.skip_reprice', '', true);

  v_result := jsonb_build_object('ok', true, 'run_id', v_run, 'updated', v_updated, 'same', v_same,
    'conflicts', v_conflicts, 'errors', v_errors, 'fields', to_jsonb(v_fields));
  insert into public.erp_product_bulk_runs (id, store_id, op_key, user_id, file_name, updated, result, changes)
  values (v_run, p_store, p_key, auth.uid(), v_file, v_updated, v_result, v_done);

  begin
    perform public.erp_audit(p_store, 'producto.actualizacion_excel', 'producto', v_run,
      jsonb_build_object('file', v_file, 'updated', v_updated, 'same', v_same, 'conflicts', jsonb_array_length(v_conflicts),
        'errors', jsonb_array_length(v_errors), 'fields', to_jsonb(v_fields), 'prices', v_any_price));
  exception when undefined_function then null;
  end;
  return v_result;
end;
$$;
revoke all on function public.products_bulk_update(uuid, text, text, jsonb) from public, anon;
grant execute on function public.products_bulk_update(uuid, text, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
