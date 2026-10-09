-- REMHUB · El código del producto se puede ver en el catálogo público (idempotente).
-- La protección fiscal deja al público leer solo algunas columnas de products (nunca el costo).
-- Se agrega el código (sku) y el número interno; el costo y demás datos internos siguen ocultos.
alter table public.products add column if not exists sku text;
alter table public.products add column if not exists product_no integer;
grant select (sku, product_no) on public.products to anon;

notify pgrst, 'reload schema';
