-- =====================================================================
-- REMHUB · Bandeja «Avisos del día» y qué avisos automáticos quiere cada tienda
--
-- 1. Bandeja de avisos a clientes (gratis, desde el WhatsApp de quien la usa):
--    cuentas por cobrar que vencen pronto o ya vencieron, con el mensaje armado.
--    Al tocar «Enviar» se abre WhatsApp con el texto; se marca como enviado hoy.
--      · erp_notice_settings (días de anticipación y plantillas editables)
--      · erp_notice_sends (quién envió, a quién y cuándo)
--      · erp_notice_tray / erp_notice_mark_sent / erp_notice_settings_save
-- 2. erp_whatsapp_settings_save (20261244) + qué avisos automáticos se mandan al equipo:
--    contingency (plazo DIAN), payables (cuentas por pagar por vencer), daily_close (cierre del día).
-- Requiere 20261244. Idempotente.
-- =====================================================================

-- 1. Bandeja de avisos -------------------------------------------------------
create table if not exists public.erp_notice_settings (
  store_id uuid primary key references public.stores(id) on delete cascade,
  days_before integer not null default 3 check (days_before between 0 and 30),
  include_overdue boolean not null default true,
  template_due text,
  template_overdue text,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create table if not exists public.erp_notice_sends (
  id bigserial primary key,
  store_id uuid not null references public.stores(id) on delete cascade,
  kind text not null check (kind in ('receivable')),
  ref_id uuid not null,
  sent_on date not null default ((now() at time zone 'America/Bogota')::date),
  phone text,
  sent_by uuid,
  sent_by_name text,
  created_at timestamptz not null default now(),
  unique (store_id, kind, ref_id, sent_on)
);
create index if not exists erp_notice_sends_ref on public.erp_notice_sends (store_id, ref_id, sent_on desc);
alter table public.erp_notice_settings enable row level security;
alter table public.erp_notice_sends enable row level security;
revoke all on public.erp_notice_settings, public.erp_notice_sends from anon, authenticated;

create or replace function public.erp__notice_defaults()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'due', 'Hola {cliente} 👋, te saluda {tienda}. Te recordamos que tu cuenta {documento} por {valor} vence el {fecha}. ¡Muchas gracias!',
    'overdue', 'Hola {cliente}, te saluda {tienda}. Tu cuenta {documento} por {valor} venció el {fecha} (hace {dias} días). ¿Nos ayudas con el pago? Gracias.');
$$;

create or replace function public.erp_notice_tray(p_store uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  st public.erp_notice_settings;
  v_today date := (now() at time zone 'America/Bogota')::date;
  v_days integer;
  v_overdue boolean;
begin
  if not public.erp_can_any(p_store, array['receivables', 'clients']::text[]) then
    return jsonb_build_object('ok', false, 'message', 'Necesitas el permiso de cartera.');
  end if;
  select * into st from public.erp_notice_settings where store_id = p_store;
  v_days := coalesce(st.days_before, 3);
  v_overdue := coalesce(st.include_overdue, true);
  return jsonb_build_object('ok', true, 'today', v_today, 'days_before', v_days, 'include_overdue', v_overdue,
    'template_due', coalesce(nullif(st.template_due, ''), public.erp__notice_defaults() ->> 'due'),
    'template_overdue', coalesce(nullif(st.template_overdue, ''), public.erp__notice_defaults() ->> 'overdue'),
    'items', (
      select coalesce(jsonb_agg(t.x order by t.due, t.name), '[]'::jsonb) from (
        select r.due_date as due, coalesce(c.name, 'Cliente') as name,
          jsonb_build_object('id', r.id, 'kind', 'receivable', 'customer_id', r.customer_id,
            'name', coalesce(nullif(btrim(c.name), ''), 'Cliente'),
            'phone', coalesce(nullif(btrim(c.mobile), ''), nullif(btrim(c.phone), '')),
            'doc_number', r.doc_number, 'description', r.description, 'balance', r.balance, 'due_date', r.due_date,
            'days_left', r.due_date - v_today, 'point_name', w.name,
            'sent_today', exists (select 1 from public.erp_notice_sends s where s.store_id = p_store and s.kind = 'receivable' and s.ref_id = r.id and s.sent_on = v_today),
            'last_sent', (select max(s.sent_on) from public.erp_notice_sends s where s.store_id = p_store and s.kind = 'receivable' and s.ref_id = r.id)) as x
        from public.erp_receivables r
        left join public.billing_customers c on c.id = r.customer_id
        left join public.erp_warehouses w on w.id = r.point_id
        where r.store_id = p_store and r.status <> 'void' and coalesce(r.balance, 0) > 0 and r.due_date is not null
          and r.due_date <= v_today + v_days and (v_overdue or r.due_date >= v_today)
          and public.erp_point_allowed(p_store, r.point_id)
        order by r.due_date
        limit 300) t));
end;
$$;
revoke all on function public.erp_notice_tray(uuid) from public, anon;
grant execute on function public.erp_notice_tray(uuid) to authenticated;

create or replace function public.erp_notice_mark_sent(p_store uuid, p_ref uuid, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.erp_can_any(p_store, array['receivables', 'clients']::text[]) then
    return jsonb_build_object('ok', false, 'message', 'Necesitas el permiso de cartera.');
  end if;
  if not exists (select 1 from public.erp_receivables r where r.id = p_ref and r.store_id = p_store and public.erp_point_allowed(p_store, r.point_id)) then
    return jsonb_build_object('ok', false, 'message', 'Esa cuenta no existe.');
  end if;
  insert into public.erp_notice_sends (store_id, kind, ref_id, phone, sent_by, sent_by_name)
  values (p_store, 'receivable', p_ref, left(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 20), auth.uid(), public.erp_actor_name(p_store))
  on conflict (store_id, kind, ref_id, sent_on) do nothing;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.erp_notice_mark_sent(uuid, uuid, text) from public, anon;
grant execute on function public.erp_notice_mark_sent(uuid, uuid, text) to authenticated;

create or replace function public.erp_notice_settings_save(p_store uuid, p_days integer, p_overdue boolean, p_template_due text, p_template_overdue text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.erp_can_any(p_store, array['receivables', 'clients']::text[]) then
    return jsonb_build_object('ok', false, 'message', 'Necesitas el permiso de cartera.');
  end if;
  if p_days is null or p_days not between 0 and 30 then return jsonb_build_object('ok', false, 'message', 'Los días de anticipación van de 0 a 30.'); end if;
  insert into public.erp_notice_settings as x (store_id, days_before, include_overdue, template_due, template_overdue, updated_by, updated_at)
  values (p_store, p_days, coalesce(p_overdue, true), nullif(left(btrim(coalesce(p_template_due, '')), 1000), ''),
    nullif(left(btrim(coalesce(p_template_overdue, '')), 1000), ''), auth.uid(), now())
  on conflict (store_id) do update
    set days_before = excluded.days_before, include_overdue = excluded.include_overdue, template_due = excluded.template_due,
        template_overdue = excluded.template_overdue, updated_by = excluded.updated_by, updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.erp_notice_settings_save(uuid, integer, boolean, text, text) from public, anon;
grant execute on function public.erp_notice_settings_save(uuid, integer, boolean, text, text) to authenticated;

-- 2. WhatsApp automático al equipo: también qué avisos ------------------------
-- p_data: { enabled, provider, numbers: [...], keys: {...}, events: ["contingency", "payables", "daily_close"] }
create or replace function public.erp_whatsapp_settings_save(p_store uuid, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_numbers text[] := '{}';
  v_raw text;
  v_n text;
  v_provider text := coalesce(nullif(p_data ->> 'provider', ''), 'remhub');
  v_key text;
  v_enabled boolean := coalesce((p_data ->> 'enabled')::boolean, false);
  v_events text[];
begin
  if not public.erp__whatsapp_manager(p_store) then return jsonb_build_object('ok', false, 'message', 'No tienes permiso para los avisos de la tienda.'); end if;
  if v_provider not in ('remhub', 'callmebot') then return jsonb_build_object('ok', false, 'message', 'Proveedor de WhatsApp no válido.'); end if;
  if jsonb_typeof(p_data -> 'events') = 'array' then
    select coalesce(array_agg(distinct e), '{}') into v_events
    from jsonb_array_elements_text(p_data -> 'events') e where e in ('contingency', 'payables', 'daily_close');
  else
    select coalesce(s.events, '{contingency}') into v_events from public.erp_whatsapp_settings s where s.store_id = p_store;
    v_events := coalesce(v_events, '{contingency}');
  end if;
  for v_raw in select jsonb_array_elements_text(coalesce(p_data -> 'numbers', '[]'::jsonb)) loop
    v_n := public.erp__wa_number(v_raw);
    if v_n is null then return jsonb_build_object('ok', false, 'message', 'El número «' || left(v_raw, 20) || '» no es un celular válido (ej.: 300 123 4567).'); end if;
    if not v_n = any (v_numbers) then v_numbers := array_append(v_numbers, v_n); end if;
  end loop;
  if cardinality(v_numbers) > 3 then return jsonb_build_object('ok', false, 'message', 'Máximo 3 números.'); end if;
  if v_enabled and cardinality(v_numbers) = 0 then return jsonb_build_object('ok', false, 'message', 'Escribe al menos un número.'); end if;
  if v_enabled and cardinality(v_events) = 0 then return jsonb_build_object('ok', false, 'message', 'Elige al menos un aviso.'); end if;

  insert into public.erp_whatsapp_settings as w (store_id, enabled, provider, numbers, events, updated_by, updated_by_name, updated_at)
  values (p_store, v_enabled, v_provider, v_numbers, v_events, auth.uid(), public.erp_actor_name(p_store), now())
  on conflict (store_id) do update
    set enabled = excluded.enabled, provider = excluded.provider, numbers = excluded.numbers, events = excluded.events,
        updated_by = excluded.updated_by, updated_by_name = excluded.updated_by_name, updated_at = now();

  for v_n in select * from unnest(v_numbers) loop
    v_key := btrim(coalesce(p_data -> 'keys' ->> v_n, ''));
    if v_key <> '' then
      if v_key !~ '^[A-Za-z0-9_-]{4,64}$' then return jsonb_build_object('ok', false, 'message', 'La clave de CallMeBot no es válida.'); end if;
      insert into public.erp_whatsapp_keys (store_id, number, apikey) values (p_store, v_n, v_key)
      on conflict (store_id, number) do update set apikey = excluded.apikey, created_at = now();
    end if;
  end loop;
  delete from public.erp_whatsapp_keys k where k.store_id = p_store and not (k.number = any (v_numbers));
  if v_enabled and v_provider = 'callmebot'
     and exists (select 1 from unnest(v_numbers) n where not exists (select 1 from public.erp_whatsapp_keys k where k.store_id = p_store and k.number = n)) then
    return jsonb_build_object('ok', false, 'message', 'Con CallMeBot cada número necesita su clave (la da el bot por WhatsApp).');
  end if;
  perform public.erp_audit(p_store, 'notify.whatsapp_saved', 'erp_whatsapp_settings', null,
    jsonb_build_object('enabled', v_enabled, 'provider', v_provider, 'numbers', cardinality(v_numbers), 'events', v_events));
  return public.erp_whatsapp_settings_get(p_store);
end;
$$;
revoke all on function public.erp_whatsapp_settings_save(uuid, jsonb) from public, anon;
grant execute on function public.erp_whatsapp_settings_save(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
