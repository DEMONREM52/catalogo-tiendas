-- =====================================================================
-- REMHUB · Avisos al celular: la base llama al dominio nuevo (remhub.co)
--
--   La base avisaba a https://remhub.store/api/push/… y ese dominio ahora
--   redirige (307) a remhub.co. pg_net no sigue redirecciones: los avisos de
--   pedidos internos y mensajes nunca salían. Se cambia remhub.store por
--   remhub.co en la configuración privada y en las tareas programadas.
-- No borra datos. Es idempotente.
-- =====================================================================

do $$
begin
  if to_regclass('public.app_private_config') is not null then
    update public.app_private_config
    set value = replace(replace(value, 'https://www.remhub.store', 'https://remhub.co'), 'https://remhub.store', 'https://remhub.co')
    where value like '%remhub.store%';
    insert into public.app_private_config (key, value)
    values ('push_webhook_url', 'https://remhub.co/api/push/stock-requests')
    on conflict (key) do nothing;
  end if;
  -- Tareas programadas (pg_cron) que llamen al dominio viejo.
  if to_regclass('cron.job') is not null then
    execute $q$update cron.job set command = replace(replace(command, 'https://www.remhub.store', 'https://remhub.co'), 'https://remhub.store', 'https://remhub.co') where command like '%remhub.store%'$q$;
  end if;
end $$;
