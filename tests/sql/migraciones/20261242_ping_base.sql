-- =====================================================================
-- REMHUB · ¿Responde la base de datos?
--
-- remhub_ping(): la consulta más pequeña posible. La app la llama cada
-- minuto (y al fallar algo) para saber si la base responde, si está lenta
-- o si no contesta, y avisarlo distinto a «sin internet».
-- No lee ni escribe datos. Idempotente.
-- =====================================================================

create or replace function public.remhub_ping()
returns jsonb
language sql
stable
set search_path = public
as $$ select jsonb_build_object('ok', true, 'at', now()) $$;
revoke all on function public.remhub_ping() from public;
grant execute on function public.remhub_ping() to anon, authenticated;

notify pgrst, 'reload schema';
