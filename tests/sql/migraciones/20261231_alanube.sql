-- =====================================================================
-- REMHUB · Facturación electrónica con Alanube (API e-Provider de Alegra)
--
-- El adaptador «alegra» ya está implementado con la documentación oficial de
-- Alanube (developer.alanube.co): factura, documento equivalente POS, notas
-- crédito/débito, nota de ajuste POS, consulta de estado, XML/PDF, webhooks,
-- set de pruebas y resoluciones. Esta migración lo deja disponible para que
-- los puntos lo puedan elegir (primero en pruebas, luego en producción).
-- No borra datos. Es idempotente.
-- =====================================================================

insert into public.fiscal_providers (code, name, status, supports_production, supports_webhooks, requires_certificate, notes, sort_order)
values ('alegra', 'Alanube (Alegra e-Provider)', 'available', true, true, false,
  'Proveedor tecnológico autorizado por la DIAN (Soluciones Alegra S.A.S). Token Bearer de la cuenta de Alanube; cada NIT es una compañía en Alanube. Firma con el certificado de Alegra sin costo adicional.', 10)
on conflict (code) do update set name = excluded.name, status = 'available', supports_production = true, supports_webhooks = true,
  requires_certificate = false, notes = excluded.notes, sort_order = excluded.sort_order;

notify pgrst, 'reload schema';
