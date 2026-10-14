-- =====================================================================
-- REMHUB · Deshacer 20261107_proteger_costo.sql
-- Vuelve a dejar que cualquier usuario con sesión lea la tabla products
-- completa (incluido cost_price), como estaba antes. No cambia datos.
-- =====================================================================
grant select on public.products to authenticated;
notify pgrst, 'reload schema';
