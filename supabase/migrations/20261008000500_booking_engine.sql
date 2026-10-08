-- Booking engine shared by the public (client) and owner paths.

-- Places a booking atomically on the first free suitable resource.
--   outcome = 'created'              new booking, occupancy and token hash written
--           = 'replayed'             same idempotency key + same request → existing booking
--           = 'idempotency_conflict' same key, different request → nothing written
--           = 'slot_taken'           every candidate resource overlaps → nothing written
--           = 'service_unavailable'  service missing/inactive or no resource linked
-- Each resource attempt runs in its own subtransaction: an EXCLUDE violation rolls
-- back that attempt only, and the loop tries the next resource.
create or replace function private.place_booking(
  p_tenant_id uuid,
  p_service_id uuid,
  p_starts_at timestamptz,
  p_customer_name text,
  p_customer_phone text,
  p_car_label text,
  p_car_plate text,
  p_comment text,
  p_source text,
  p_resource_id uuid,
  p_idempotency_key uuid,
  p_fingerprint text,
  p_is_demo boolean,
  p_consent_at timestamptz,
  p_created_by uuid,
  p_owner_note text default null)
returns table (outcome text, booking_id uuid, conflict jsonb)
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_existing public.bookings;
  v_service public.services;
  v_currency text;
  v_range tstzrange;
  v_id uuid := gen_random_uuid();
  v_code text;
  v_resource uuid;
  v_placed boolean := false;
  v_conflict jsonb;
begin
  select * into v_existing from public.bookings
  where tenant_id = p_tenant_id and idempotency_key = p_idempotency_key;
  if found then
    return query select
      case when v_existing.request_fingerprint = p_fingerprint then 'replayed' else 'idempotency_conflict' end,
      v_existing.id, null::jsonb;
    return;
  end if;

  select * into v_service from public.services
  where tenant_id = p_tenant_id and id = p_service_id and is_active;
  if not found then
    return query select 'service_unavailable'::text, null::uuid, null::jsonb;
    return;
  end if;

  select currency into v_currency from public.tenants where id = p_tenant_id;
  v_range := tstzrange(
    p_starts_at,
    p_starts_at + make_interval(mins => v_service.duration_minutes + v_service.buffer_minutes),
    '[)');
  v_code := private.new_booking_code(p_tenant_id);

  begin
    for v_resource in
      select r.id
      from public.resources r
      where r.tenant_id = p_tenant_id and r.is_active
        and (
          (p_resource_id is not null and r.id = p_resource_id)
          or (p_resource_id is null and exists (
                select 1 from public.service_resources sr
                where sr.tenant_id = p_tenant_id and sr.service_id = p_service_id and sr.resource_id = r.id))
        )
      order by r.sort, r.name, r.id
    loop
      begin
        insert into public.bookings (
          id, tenant_id, code, service_id, resource_id, starts_at, ends_at,
          service_name, price_minor, price_is_from, currency, duration_minutes, buffer_minutes,
          customer_name, customer_phone, car_label, car_plate, customer_comment, owner_note,
          consent_at, status, source, is_demo, idempotency_key, request_fingerprint, created_by)
        values (
          v_id, p_tenant_id, v_code, p_service_id, v_resource, p_starts_at,
          p_starts_at + make_interval(mins => v_service.duration_minutes),
          v_service.name, v_service.price_minor, v_service.price_is_from, v_currency,
          v_service.duration_minutes, v_service.buffer_minutes,
          p_customer_name, p_customer_phone, p_car_label, p_car_plate, p_comment, p_owner_note,
          p_consent_at, 'confirmed', p_source, p_is_demo, p_idempotency_key, p_fingerprint, p_created_by);

        insert into public.resource_occupancies (tenant_id, resource_id, kind, booking_id, during, created_by)
        values (p_tenant_id, v_resource, 'booking', v_id, v_range, p_created_by);

        v_placed := true;
        exit;
      exception when exclusion_violation then
        if v_conflict is null then
          v_conflict := private.conflicting_occupant(v_resource, v_range);
        end if;
      end;
    end loop;
  exception when unique_violation then
    -- A concurrent request with the same idempotency key committed first.
    select * into v_existing from public.bookings
    where tenant_id = p_tenant_id and idempotency_key = p_idempotency_key;
    if found then
      return query select
        case when v_existing.request_fingerprint = p_fingerprint then 'replayed' else 'idempotency_conflict' end,
        v_existing.id, null::jsonb;
      return;
    end if;
    raise;
  end;

  if not v_placed then
    if v_conflict is null then
      return query select 'service_unavailable'::text, null::uuid, null::jsonb;
    else
      return query select 'slot_taken'::text, null::uuid, v_conflict;
    end if;
    return;
  end if;

  insert into public.booking_access_tokens (tenant_id, booking_id, token_hash)
  values (p_tenant_id, v_id, private.token_hash(private.booking_access_token(v_id, p_idempotency_key)));

  perform private.log_booking_event(p_tenant_id, v_id, 'created',
    jsonb_build_object('starts_at', p_starts_at, 'resource_id', v_resource, 'source', p_source),
    case when p_source = 'owner' then 'owner' else 'client' end);

  return query select 'created'::text, v_id, null::jsonb;
end;
$$;

-- Fingerprint of a create request: what makes two requests "the same".
create or replace function private.booking_fingerprint(
  p_service_id uuid, p_starts_at timestamptz, p_phone text, p_name text, p_car text, p_resource_id uuid)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(concat_ws('|',
    p_service_id::text, extract(epoch from p_starts_at)::bigint::text, p_phone,
    lower(p_name), lower(p_car), coalesce(p_resource_id::text, '*')), 'UTF8'), 'sha256'), 'hex');
$$;

-- Releases the active occupancy of a booking (cancel / no-show).
create or replace function private.release_booking_occupancy(p_booking_id uuid)
returns void
language sql
set search_path = ''
as $$
  update public.resource_occupancies
  set released_at = now()
  where booking_id = p_booking_id and released_at is null;
$$;

create or replace function private.mask_phone(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_phone is null then null
    else left(p_phone, 2) || ' ••• •••-' || substr(right(p_phone, 4), 1, 2) || '-' || right(p_phone, 2) end;
$$;

-- What the client sees for their booking (token holders only).
create or replace function private.booking_public_json(p_booking_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'code', b.code,
    'status', b.status,
    'service_name', b.service_name,
    'price_minor', b.price_minor,
    'price_is_from', b.price_is_from,
    'currency', b.currency,
    'starts_at', b.starts_at,
    'ends_at', b.ends_at,
    'duration_minutes', b.duration_minutes,
    'resource_name', r.name,
    'customer_name', b.customer_name,
    'customer_phone_masked', private.mask_phone(b.customer_phone),
    'car_label', b.car_label,
    'car_plate', b.car_plate,
    'is_demo', b.is_demo,
    'created_at', b.created_at,
    'cancelled_at', b.cancelled_at,
    'cancel_deadline', b.starts_at - make_interval(hours => t.cancel_until_hours),
    'can_cancel', b.status = 'confirmed'
                  and now() <= b.starts_at - make_interval(hours => t.cancel_until_hours),
    'studio', jsonb_build_object(
      'slug', t.slug, 'name', t.name, 'phone', t.phone, 'phone_display', t.phone_display,
      'address', t.address, 'map_url', t.map_url, 'timezone', t.timezone,
      'cancel_until_hours', t.cancel_until_hours))
  from public.bookings b
  join public.tenants t on t.id = b.tenant_id
  join public.resources r on r.tenant_id = b.tenant_id and r.id = b.resource_id
  where b.id = p_booking_id;
$$;

-- What the owner sees (full details + money).
create or replace function private.booking_owner_json(p_booking_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', b.id,
    'code', b.code,
    'status', b.status,
    'source', b.source,
    'is_demo', b.is_demo,
    'service_id', b.service_id,
    'service_name', b.service_name,
    'resource_id', b.resource_id,
    'resource_name', r.name,
    'starts_at', b.starts_at,
    'ends_at', b.ends_at,
    'occupied_until', (select upper(o.during) from public.resource_occupancies o
                       where o.booking_id = b.id and o.released_at is null limit 1),
    'duration_minutes', b.duration_minutes,
    'buffer_minutes', b.buffer_minutes,
    'price_minor', b.price_minor,
    'price_is_from', b.price_is_from,
    'currency', b.currency,
    'customer_name', b.customer_name,
    'customer_phone', b.customer_phone,
    'car_label', b.car_label,
    'car_plate', b.car_plate,
    'customer_comment', b.customer_comment,
    'owner_note', b.owner_note,
    'arrived_at', b.arrived_at,
    'done_at', b.done_at,
    'no_show_at', b.no_show_at,
    'cancelled_at', b.cancelled_at,
    'cancelled_by', b.cancelled_by,
    'cancel_reason', b.cancel_reason,
    'reschedule_count', b.reschedule_count,
    'created_at', b.created_at,
    'paid_minor', coalesce((select sum(p.amount_minor) from public.payments p
                            where p.tenant_id = b.tenant_id and p.booking_id = b.id and p.kind = 'payment'), 0),
    'refunded_minor', coalesce((select sum(p.amount_minor) from public.payments p
                                where p.tenant_id = b.tenant_id and p.booking_id = b.id and p.kind = 'refund'), 0))
  from public.bookings b
  join public.resources r on r.tenant_id = b.tenant_id and r.id = b.resource_id
  where b.id = p_booking_id;
$$;

-- ---------------------------------------------------------------------------
-- Public (anon) API. Business errors come back as {ok:false, error, message}.
-- ---------------------------------------------------------------------------
create or replace function private.public_tenant(p_slug text)
returns public.tenants
language sql
stable
set search_path = ''
as $$
  select * from public.tenants
  where slug = lower(btrim(p_slug)) and status in ('preview', 'live');
$$;

create or replace function private.err(p_code text, p_message text, p_extra jsonb default '{}'::jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('ok', false, 'error', p_code, 'message', p_message) || coalesce(p_extra, '{}'::jsonb);
$$;

create or replace function private.public_gate(p_bucket text, p_limit_key text, p_default int, p_window interval)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform private.hit_rate_limit('pub:' || private.client_ip(),
    private.config_int('rate.public_ip_per_5min', 300), interval '5 minutes');
  if p_bucket is not null then
    perform private.hit_rate_limit(p_bucket, private.config_int(p_limit_key, p_default), p_window);
  end if;
end;
$$;

-- Studio page data: profile, services, hours, upcoming exceptions, photos.
create or replace function public.get_public_tenant(p_slug text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t public.tenants;
begin
  perform private.public_gate(null, null, 0, null);
  t := private.public_tenant(p_slug);
  if t.id is null then
    return private.err('tenant_not_found', 'Студия не найдена');
  end if;

  return jsonb_build_object(
    'ok', true,
    'tenant', jsonb_build_object(
      'slug', t.slug, 'status', t.status, 'name', t.name, 'short_name', t.short_name,
      'tagline', t.tagline, 'description', t.description,
      'address', t.address, 'address_note', t.address_note, 'map_url', t.map_url,
      'geo', case when t.geo_lat is null then null else jsonb_build_object('lat', t.geo_lat, 'lng', t.geo_lng) end,
      'phone', t.phone, 'phone_display', t.phone_display, 'messenger_url', t.messenger_url,
      'accent_color', t.accent_color, 'logo_path', t.logo_path, 'hero_path', t.hero_path,
      'hero_alt', t.hero_alt, 'info_cards', t.info_cards,
      'timezone', t.timezone, 'currency', t.currency, 'locale', t.locale,
      'rules', jsonb_build_object(
        'slot_step_minutes', t.slot_step_minutes, 'min_lead_minutes', t.min_lead_minutes,
        'horizon_days', t.horizon_days, 'cancel_until_hours', t.cancel_until_hours)),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', s.id, 'key', s.key, 'name', s.name, 'description', s.description,
          'category', s.category, 'price_minor', s.price_minor, 'price_is_from', s.price_is_from,
          'duration_minutes', s.duration_minutes, 'bookable', exists (
            select 1 from public.service_resources sr
            join public.resources r on r.tenant_id = sr.tenant_id and r.id = sr.resource_id and r.is_active
            where sr.tenant_id = s.tenant_id and sr.service_id = s.id))
        order by s.sort, s.name)
      from public.services s where s.tenant_id = t.id and s.is_active), '[]'::jsonb),
    'hours', coalesce((
      select jsonb_agg(jsonb_build_object(
          'weekday', w.weekday, 'opens_at', to_char(w.opens_at, 'HH24:MI'),
          'closes_at', to_char(w.closes_at, 'HH24:MI'))
        order by w.weekday, w.opens_at)
      from public.working_hours w where w.tenant_id = t.id), '[]'::jsonb),
    'exceptions', coalesce((
      select jsonb_agg(jsonb_build_object(
          'date', e.date, 'is_closed', e.is_closed,
          'opens_at', to_char(e.opens_at, 'HH24:MI'), 'closes_at', to_char(e.closes_at, 'HH24:MI'),
          'note', e.note)
        order by e.date)
      from public.schedule_exceptions e
      where e.tenant_id = t.id
        and e.date between (now() at time zone t.timezone)::date
                       and (now() at time zone t.timezone)::date + t.horizon_days), '[]'::jsonb),
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'path', p.storage_path, 'caption', p.caption)
        order by p.sort, p.created_at)
      from public.tenant_photos p where p.tenant_id = t.id and p.is_active), '[]'::jsonb));
end;
$$;

-- Days with offered starts for a service; busy starts are returned with available=false.
create or replace function public.get_available_slots(
  p_slug text, p_service_id uuid, p_from date default null, p_days int default 14)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  v_from date;
  v_to date;
begin
  perform private.public_gate('slots:' || private.client_ip(), 'rate.slots_ip_per_5min', 120, interval '5 minutes');
  t := private.public_tenant(p_slug);
  if t.id is null then
    return private.err('tenant_not_found', 'Студия не найдена');
  end if;
  if not exists (select 1 from public.services s
                 where s.tenant_id = t.id and s.id = p_service_id and s.is_active) then
    return private.err('service_not_found', 'Услуга недоступна');
  end if;

  v_from := coalesce(p_from, (now() at time zone t.timezone)::date);
  v_to := v_from + least(greatest(coalesce(p_days, 14), 1), 31) - 1;

  return jsonb_build_object(
    'ok', true,
    'timezone', t.timezone,
    'from', v_from,
    'to', v_to,
    'horizon_end', (now() at time zone t.timezone)::date + t.horizon_days,
    'days', coalesce((
      select jsonb_agg(day_row order by day_row ->> 'date')
      from (
        select jsonb_build_object(
          'date', d::date,
          'slots', coalesce((
            select jsonb_agg(jsonb_build_object(
                'starts_at', s.starts_at,
                'time', to_char(s.local_time, 'HH24:MI'),
                'available', s.free_resources > 0)
              order by s.starts_at)
            from private.service_slots(t.id, p_service_id, d::date, d::date) s), '[]'::jsonb)) as day_row
        from generate_series(v_from::timestamp, v_to::timestamp, interval '1 day') d
      ) days), '[]'::jsonb));
end;
$$;

-- Client booking without registration. Returns the access token once; a retry with
-- the same idempotency key and payload returns the same booking and the same token.
create or replace function public.create_booking(
  p_slug text,
  p_service_id uuid,
  p_starts_at timestamptz,
  p_customer jsonb,
  p_idempotency_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  v_ip text := private.client_ip();
  v_name text;
  v_phone text;
  v_car text;
  v_plate text;
  v_comment text;
  v_fp text;
  r record;
begin
  perform private.public_gate('book:' || v_ip, 'rate.booking_ip_per_hour', 10, interval '1 hour');
  t := private.public_tenant(p_slug);
  if t.id is null then
    return private.err('tenant_not_found', 'Студия не найдена');
  end if;
  perform private.hit_rate_limit('book-tenant:' || t.id::text,
    private.config_int('rate.booking_tenant_per_hour', 200), interval '1 hour');

  if p_idempotency_key is null or p_service_id is null or p_starts_at is null then
    return private.err('invalid_input', 'Не хватает данных для записи');
  end if;
  v_name := private.clean_text(p_customer ->> 'name', 2, 80);
  v_phone := private.normalize_phone(p_customer ->> 'phone');
  v_car := private.clean_text(p_customer ->> 'car', 2, 80);
  v_plate := upper(private.clean_text(p_customer ->> 'plate', 1, 16));
  v_comment := private.clean_text(p_customer ->> 'comment', 1, 500);
  if v_name is null then
    return private.err('invalid_input', 'Укажите имя', jsonb_build_object('field', 'name'));
  end if;
  if v_phone is null then
    return private.err('invalid_input', 'Проверьте номер телефона', jsonb_build_object('field', 'phone'));
  end if;
  if v_car is null then
    return private.err('invalid_input', 'Укажите автомобиль', jsonb_build_object('field', 'car'));
  end if;
  if coalesce((p_customer ->> 'consent')::boolean, false) is not true then
    return private.err('invalid_input', 'Нужно согласие на обработку данных', jsonb_build_object('field', 'consent'));
  end if;

  v_fp := private.booking_fingerprint(p_service_id, p_starts_at, v_phone, v_name, v_car, null);

  -- Replays skip the slot check: the original request already passed it.
  if not exists (select 1 from public.bookings b
                 where b.tenant_id = t.id and b.idempotency_key = p_idempotency_key) then
    if not private.is_offered_start(t.id, p_service_id, p_starts_at) then
      return private.err('slot_not_offered', 'Это время недоступно для записи. Выберите другое.');
    end if;
  end if;

  select * into r from private.place_booking(
    t.id, p_service_id, p_starts_at, v_name, v_phone, v_car, v_plate, v_comment,
    'client', null, p_idempotency_key, v_fp, t.status = 'preview', now(), null);

  case r.outcome
    when 'created', 'replayed' then
      return jsonb_build_object(
        'ok', true,
        'replayed', r.outcome = 'replayed',
        'access_token', private.booking_access_token(r.booking_id, p_idempotency_key),
        'booking', private.booking_public_json(r.booking_id));
    when 'idempotency_conflict' then
      return private.err('idempotency_conflict', 'Запрос уже использован для другой записи. Обновите страницу.');
    when 'slot_taken' then
      return private.err('slot_taken', 'Это время только что заняли. Выберите другое.');
    else
      return private.err('service_not_found', 'Услуга недоступна для записи');
  end case;
end;
$$;

create or replace function private.booking_by_token(p_slug text, p_token text)
returns public.bookings
language sql
stable
set search_path = ''
as $$
  select b.*
  from public.booking_access_tokens a
  join public.bookings b on b.tenant_id = a.tenant_id and b.id = a.booking_id
  join public.tenants t on t.id = b.tenant_id
  where a.token_hash = private.token_hash(p_token)
    and a.revoked_at is null
    and t.slug = lower(btrim(p_slug))
    and t.status in ('preview', 'live');
$$;

create or replace function public.get_booking(p_slug text, p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  b public.bookings;
begin
  perform private.public_gate('token:' || private.client_ip(), 'rate.token_ip_per_10min', 60, interval '10 minutes');
  if p_token is null or char_length(p_token) < 32 then
    return private.err('not_found', 'Запись не найдена');
  end if;
  b := private.booking_by_token(p_slug, p_token);
  if b.id is null then
    return private.err('not_found', 'Запись не найдена');
  end if;
  return jsonb_build_object('ok', true, 'booking', private.booking_public_json(b.id));
end;
$$;

-- Client cancellation, allowed until cancel_until_hours before the start. Idempotent.
create or replace function public.cancel_booking(p_slug text, p_token text, p_reason text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  b public.bookings;
  t public.tenants;
begin
  perform private.public_gate('token:' || private.client_ip(), 'rate.token_ip_per_10min', 60, interval '10 minutes');
  b := private.booking_by_token(p_slug, p_token);
  if b.id is null then
    return private.err('not_found', 'Запись не найдена');
  end if;
  select * into b from public.bookings where id = b.id for update;
  select * into t from public.tenants where id = b.tenant_id;

  if b.status = 'cancelled' then
    return jsonb_build_object('ok', true, 'booking', private.booking_public_json(b.id));
  end if;
  if b.status <> 'confirmed' then
    return private.err('invalid_state', 'Эту запись уже нельзя отменить онлайн');
  end if;
  if now() > b.starts_at - make_interval(hours => t.cancel_until_hours) then
    return private.err('cancel_window_closed',
      'Онлайн-отмена доступна не позднее чем за ' || t.cancel_until_hours || ' ч. Позвоните в студию.',
      jsonb_build_object('phone', t.phone));
  end if;

  update public.bookings
  set status = 'cancelled', cancelled_at = now(), cancelled_by = 'client',
      cancel_reason = private.clean_text(p_reason, 1, 300)
  where id = b.id;
  perform private.release_booking_occupancy(b.id);
  perform private.log_booking_event(b.tenant_id, b.id, 'cancelled', jsonb_build_object('by', 'client'), 'client');
  perform private.on_booking_changed(b.id);

  return jsonb_build_object('ok', true, 'booking', private.booking_public_json(b.id));
end;
$$;

-- Notification hook; replaced by the notifications migration.
create or replace function private.on_booking_changed(p_booking_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform p_booking_id;
end;
$$;

revoke all on function public.get_public_tenant(text) from public;
revoke all on function public.get_available_slots(text, uuid, date, int) from public;
revoke all on function public.create_booking(text, uuid, timestamptz, jsonb, uuid) from public;
revoke all on function public.get_booking(text, text) from public;
revoke all on function public.cancel_booking(text, text, text) from public;

grant execute on function public.get_public_tenant(text) to anon, authenticated;
grant execute on function public.get_available_slots(text, uuid, date, int) to anon, authenticated;
grant execute on function public.create_booking(text, uuid, timestamptz, jsonb, uuid) to anon, authenticated;
grant execute on function public.get_booking(text, text) to anon, authenticated;
grant execute on function public.cancel_booking(text, text, text) to anon, authenticated;
