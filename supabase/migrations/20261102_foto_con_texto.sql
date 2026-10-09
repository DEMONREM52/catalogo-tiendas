-- =====================================================================
-- REMHUB · Búsqueda por foto + texto leído en la foto
--
--   · El navegador lee el texto que aparece en la foto (por ejemplo
--     «V322», una marca o el nombre en la caja) y lo envía junto con la
--     huella de la imagen.
--   · Cada producto se califica por parecido visual Y por si ese texto
--     coincide con su código, código de barras, número interno, nombre,
--     descripción o ficha (características y especificaciones).
--   · Si el texto es exactamente el código del producto, sale primero.
--   · También aparecen productos sin foto analizada si su texto coincide.
--
-- Ejecutar DESPUÉS de 20261031_codigo_y_busqueda_por_foto.sql.
-- Es idempotente: se puede ejecutar varias veces.
-- =====================================================================
set search_path = public, extensions;

-- Código comparable sin signos: «V-322», «v 322» y «V322» son lo mismo.
create or replace function public.product__compact(p text)
returns text
language sql
immutable
as $$
  select regexp_replace(public.erp__norm_text(coalesce(p, '')), '[^a-z0-9]', '', 'g');
$$;

-- Todo el texto de la ficha del producto: descripción, descripción larga, características y especificaciones.
create or replace function public.product__blob(p_description text, p_details jsonb)
returns text
language sql
immutable
as $$
  select public.erp__norm_text(concat_ws(' ',
    p_description,
    case when jsonb_typeof(p_details) = 'object' then p_details ->> 'long_description' end,
    case when jsonb_typeof(p_details -> 'highlights') = 'array'
      then (select string_agg(x, ' ') from jsonb_array_elements_text(p_details -> 'highlights') as x) end,
    case when jsonb_typeof(p_details -> 'specifications') = 'array'
      then (select string_agg(concat_ws(' ', s ->> 'name', s ->> 'value'), ' ') from jsonb_array_elements(p_details -> 'specifications') as s) end
  ));
$$;

-- Palabras útiles del texto leído: sin tildes ni signos, sin palabras vacías, máximo 12.
create or replace function public.product__clean_terms(p_terms text[])
returns text[]
language sql
immutable
as $$
  select coalesce(array(
    select distinct t from (
      select regexp_replace(public.erp__norm_text(x), '^[^a-z0-9]+|[^a-z0-9]+$', '', 'g') as t
      from unnest(coalesce(p_terms, '{}'::text[])) as x
    ) s
    where (length(t) >= 3 or (length(t) >= 2 and t ~ '[0-9]'))
      and t not in ('de', 'del', 'la', 'las', 'el', 'los', 'con', 'para', 'por', 'una', 'uno', 'que', 'sin', 'the', 'and', 'for', 'with', 'made', 'new')
    limit 12
  ), '{}'::text[]);
$$;

-- Coincidencia del texto leído con un producto (0 a 1; 1 = es su código).
create or replace function public.product__ocr_score(p_name text, p_sku text, p_barcode text, p_no integer, p_blob text, p_terms text[])
returns real
language sql
stable
set search_path = public, extensions
as $$
  select case when cardinality(coalesce(p_terms, '{}'::text[])) = 0 then 0::real else (
    select (case when max(w) >= 1 then 1 else 0.6 * max(w) + 0.4 * avg(w) end)::real
    from (
      select case
        when public.product__compact(t) <> '' and (public.product__compact(p_sku) = public.product__compact(t)
             or public.product__compact(p_barcode) = public.product__compact(t) or p_no::text = t) then 1.0
        when length(public.product__compact(t)) >= 3 and strpos(public.product__compact(p_sku), public.product__compact(t)) > 0 then 0.85
        when strpos(public.erp__norm_text(p_name), t) > 0 then 0.8
        when strpos(coalesce(p_blob, ''), t) > 0 then 0.45
        when length(t) >= 4 and public.product__fuzzy(t, public.erp__norm_text(p_name)) >= 0.6 then 0.4
        else 0 end as w
      from unnest(p_terms) as t
    ) x
  ) end;
$$;

-- Calificación final de cada producto para una foto (+ el texto leído en ella).
create or replace function public.product__photo_rank(p_store uuid, p_model text, p_embedding real[], p_terms text[])
returns table (product_id uuid, score real, visual real, text_score real, code_hit boolean)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare v_terms text[] := public.product__clean_terms(p_terms);
begin
  if coalesce(cardinality(p_embedding), 0) <> 512 then raise exception 'Huella de imagen no válida.'; end if;
  return query
    with vis as (
      select v.product_id, max(1 - (v.embedding <=> p_embedding::vector))::real as visual
      from public.product_image_vectors v
      where v.store_id = p_store and v.model = p_model and v.embedding is not null
      group by v.product_id
    ), txt as (
      select p.id as product_id,
             public.product__ocr_score(p.name, p.sku, p.barcode, p.product_no, public.product__blob(p.description, p.product_details), v_terms) as t
      from public.products p
      where cardinality(v_terms) > 0 and p.store_id = p_store
    ), j as (
      select coalesce(vis.product_id, txt.product_id) as pid, vis.visual, coalesce(txt.t, 0)::real as t
      from vis full join txt on txt.product_id = vis.product_id
    )
    select j.pid,
           (case
              when j.t >= 1 then greatest(0.95, coalesce(j.visual, 0))
              when j.visual is not null then least(0.99, j.visual + 0.2 * j.t)
              else 0.3 + 0.45 * j.t
            end)::real,
           j.visual, j.t, j.t >= 1
    from j
    where j.visual is not null or j.t >= 0.4;
end;
$$;
revoke all on function public.product__photo_rank(uuid, text, real[], text[]) from public, anon, authenticated;

-- Se reemplazan las búsquedas por foto (ahora reciben también el texto leído).
drop function if exists public.store_public_image_search(uuid, real[], text, integer);
drop function if exists public.catalog_public_image_search(text, text, text, real[], text, integer);
drop function if exists public.erp_product_image_search(uuid, real[], text, integer, boolean);

-- Catálogo público de la tienda.
create or replace function public.store_public_image_search(
  p_store uuid, p_embedding real[], p_model text default 'mobileclip_s0', p_limit integer default 24, p_terms text[] default '{}'::text[]
) returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  with s as (
    select r.product_id, r.score, r.visual, r.text_score, r.code_hit
    from public.product__photo_rank(p_store, p_model, p_embedding, p_terms) r
    join public.products p on p.id = r.product_id and coalesce(p.active, true) and (p.stock is null or p.stock > 0)
    join public.stores st on st.id = p.store_id and st.active and (st.active_until is null or st.active_until > now())
    order by r.score desc
    limit least(greatest(coalesce(p_limit, 24), 1), 60)
  )
  select jsonb_build_object(
    'indexed', (select count(distinct v.product_id) from public.product_image_vectors v where v.store_id = p_store and v.model = p_model and v.embedding is not null),
    'terms', to_jsonb(public.product__clean_terms(p_terms)),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.product_id, 'score', round(s.score::numeric, 4),
        'match', case when s.code_hit then 'code' when s.text_score >= 0.4 then 'text' end
      ) order by s.score desc) from s), '[]'::jsonb)
  );
$$;
grant execute on function public.store_public_image_search(uuid, real[], text, integer, text[]) to anon, authenticated;

-- Catálogos de RemHub Social.
create or replace function public.catalog_public_image_search(
  p_store text, p_catalog text, p_key text, p_embedding real[], p_model text default 'mobileclip_s0', p_limit integer default 24,
  p_terms text[] default '{}'::text[]
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare v_catalog uuid; v_store uuid; v_rules boolean; v_result jsonb;
begin
  v_catalog := public.catalog__access(p_store, p_catalog, p_key);
  if v_catalog is null then raise exception 'Este catálogo no está disponible.'; end if;
  select store_id, wholesale_rules into v_store, v_rules from public.store_catalogs where id = v_catalog;

  with s as (
    select r.* from public.product__photo_rank(v_store, p_model, p_embedding, p_terms) r
  ), items as (
    select i.*, s.score, s.code_hit, s.text_score, p.name, p.description, p.image_url, p.product_details, p.min_wholesale, p.sku
    from s
    join public.catalog__items(v_catalog, array(select product_id from s)) i on i.product_id = s.product_id
    join public.products p on p.id = i.product_id
    where not i.category_hidden and i.price > 0 and (i.stock is null or i.stock > 0)
    order by s.score desc
    limit least(greatest(coalesce(p_limit, 24), 1), 60)
  )
  select jsonb_build_object(
    'indexed', (select count(distinct v.product_id) from public.product_image_vectors v where v.store_id = v_store and v.model = p_model and v.embedding is not null),
    'terms', to_jsonb(public.product__clean_terms(p_terms)),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'id', it.product_id, 'name', it.name, 'description', it.description, 'image_url', it.image_url,
      'price', it.price, 'price_retail', it.price, 'price_wholesale', it.price,
      'min_wholesale', case when v_rules then greatest(1, coalesce(it.min_wholesale, 1)) end,
      'stock', it.stock, 'category_id', it.category_key, 'featured', it.featured,
      'active', true, 'product_details', it.product_details, 'code', it.sku, 'score', round(it.score::numeric, 4),
      'match', case when it.code_hit then 'code' when it.text_score >= 0.4 then 'text' end
    ) order by it.score desc) from items it), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
grant execute on function public.catalog_public_image_search(text, text, text, real[], text, integer, text[]) to anon, authenticated;

-- Panel (productos, lista general, POS).
create or replace function public.erp_product_image_search(
  p_store uuid, p_embedding real[], p_model text default 'mobileclip_s0', p_limit integer default 24, p_active_only boolean default false,
  p_terms text[] default '{}'::text[]
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare v jsonb;
begin
  if not public.product__can_index(p_store) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'No tienes permiso para buscar productos.');
  end if;
  with s as (
    select r.* from public.product__photo_rank(p_store, p_model, p_embedding, p_terms) r
  ), best as (
    select p.id, p.name, p.sku, p.barcode, p.product_no, p.image_url, coalesce(p.active, true) as active,
           p.price_1, p.price_3, p.stock, s.score,
           case when s.code_hit then 'code' when s.text_score >= 0.4 then 'text' end as match
    from s join public.products p on p.id = s.product_id and p.store_id = p_store
    where not coalesce(p_active_only, false) or coalesce(p.active, true)
    order by s.score desc
    limit least(greatest(coalesce(p_limit, 24), 1), 60)
  )
  select jsonb_build_object(
    'ok', true,
    'indexed', (select count(distinct x.product_id) from public.product_image_vectors x where x.store_id = p_store and x.model = p_model and x.embedding is not null),
    'terms', to_jsonb(public.product__clean_terms(p_terms)),
    'items', coalesce((select jsonb_agg(to_jsonb(b) order by b.score desc) from best b), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;
grant execute on function public.erp_product_image_search(uuid, real[], text, integer, boolean, text[]) to authenticated;

-- Buscador del panel por nombre o código: ahora también busca en la descripción y la ficha.
create or replace function public.erp_product_finder(p_store uuid, p_q text, p_active_only boolean default false, p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare v jsonb;
begin
  if not public.product__can_index(p_store) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'No tienes permiso para buscar productos.');
  end if;
  select coalesce(jsonb_agg(to_jsonb(t) - 'rank' order by t.rank desc, t.name), '[]'::jsonb) into v
  from (
    select p.id, p.name, p.sku, p.barcode, p.product_no, p.image_url, coalesce(p.active, true) as active,
           p.price_1, p.price_3, p.stock, public.product__rank(p.name, p.sku, p.barcode, p.product_no, p_q) as rank
    from public.products p
    where p.store_id = p_store
      and (not coalesce(p_active_only, false) or coalesce(p.active, true))
      and cardinality(public.product__tokens(p_q)) > 0
      and public.product__matches(p.name, p.sku, p.barcode, p.product_no, public.product__blob(p.description, p.product_details), p_q)
    order by rank desc, p.name
    limit least(greatest(coalesce(p_limit, 30), 1), 60)
  ) t;
  return jsonb_build_object('ok', true, 'items', v);
end;
$$;
grant execute on function public.erp_product_finder(uuid, text, boolean, integer) to authenticated;

-- El público puede ver el código y el número interno (no el costo).
grant select (sku, product_no) on public.products to anon;

notify pgrst, 'reload schema';
