-- =====================================================================
-- REMHUB · Llamadas: rechazar termina la llamada para todos (sobre 20261268)
--
--   Antes, si quien recibía rechazaba, la llamada seguía timbrando a los demás
--   (dueño, administradores…) y quien llamaba se quedaba esperando. Ahora
--   rechazar la termina para todos y queda en el chat quién la rechazó.
-- Requiere 20261268. No borra datos. Es idempotente.
-- =====================================================================

/** Colgar, rechazar o cancelar. Deja la constancia en el chat del pedido. */
create or replace function public.erp_call_end(p_call uuid, p_reason text default 'colgó')
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.erp_calls; v_status text; v_secs int; v_body text;
begin
  select * into c from public.erp_calls where id = p_call for update;
  if c.id is null then raise exception 'Llamada no encontrada.'; end if;
  if c.caller_id <> auth.uid() and c.answered_by is distinct from auth.uid()
     and not exists (select 1 from public.erp_call_invites where call_id = p_call and user_id = auth.uid()) then
    raise exception 'Esta llamada no es tuya.';
  end if;
  if c.status in ('ended', 'missed', 'declined') then return jsonb_build_object('ok', true, 'status', c.status); end if;

  if c.status = 'ringing' and c.caller_id <> auth.uid() then
    -- Quien recibe rechaza: la llamada termina para todos (quien llama se entera al instante).
    update public.erp_call_invites set status = 'declined' where call_id = p_call and user_id = auth.uid();
    v_status := 'declined';
  elsif c.status = 'ringing' then
    v_status := 'missed';
  else
    v_status := 'ended';
  end if;
  update public.erp_calls set status = v_status, ended_at = now(), ended_reason = left(coalesce(p_reason, ''), 60) where id = p_call;
  update public.erp_call_invites set status = 'missed' where call_id = p_call and status = 'ringing';

  if c.request_id is not null then
    v_secs := case when c.answered_at is not null then extract(epoch from now() - c.answered_at)::int end;
    v_body := case
      when v_status = 'ended' then (case when c.video then '🎥 Videollamada' else '📞 Llamada de voz' end) || ' · ' || (v_secs / 60) || ':' || lpad((v_secs % 60)::text, 2, '0')
        || ' (' || coalesce(c.caller_name, 'Alguien') || ' con ' || coalesce(c.answered_name, 'Alguien') || ')'
      when v_status = 'declined' then (case when c.video then '🎥 Videollamada' else '📞 Llamada' end) || ' de ' || coalesce(c.caller_name, 'Alguien') || ' rechazada por ' || public.erp__member_name(c.store_id, auth.uid())
      else (case when c.video then '🎥 Videollamada' else '📞 Llamada' end) || ' perdida de ' || coalesce(c.caller_name, 'Alguien') end;
    begin
      insert into public.erp_stock_request_messages (request_id, user_id, user_name, body, kind) values (c.request_id, null, null, v_body, 'system');
    exception when others then null; -- la constancia en el chat es opcional
    end;
  end if;
  return jsonb_build_object('ok', true, 'status', v_status);
end $$;
revoke all on function public.erp_call_end(uuid, text) from public, anon;
grant execute on function public.erp_call_end(uuid, text) to authenticated;

notify pgrst, 'reload schema';
