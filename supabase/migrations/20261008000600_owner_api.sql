-- Owner cabinet API (role `authenticated`). Every function resolves the studio by
-- slug AND verifies membership of auth.uid() on the server; the client never sends
-- tenant_id. Errors raise PTxxx (the whole call rolls back).

create or replace function private.owner_tenant(p_slug text)
returns public.tenants
language plpgsql
stable
set search_path = ''
as $$
declare
  t public.tenants;
begin
  if (select auth.uid()) is null then
    perform private.fail(401, 'not_authenticated', 'Войдите в кабинет');
  end if;
  select * into t from public.tenants where slug = lower(btrim(p_slug)) and status <> 'archived';
  if t.id is null or not private.is_member(t.id) then
    -- Same answer for "no such studio" and "not your studio".
    perform private.fail(403, 'forbidden', 'Нет доступа к этой студии');
  end if;
  return t;
end;
$$;

create or replace function private.owner_booking_for_update(p_tenant_id uuid, p_booking_id uuid)
returns public.bookings
language plpgsql
volatile
set search_path = ''
as $$
declare
  b public.bookings;
begin
  select * into b from public.bookings
  where tenant_id = p_tenant_id and id = p_booking_id
  for update;
  if b.id is null then
    perform private.fail(404, 'not_found', 'Запись не найдена');
  end if;
  return b;
end;
$$;

create or replace function private.add_override(p_tenant_id uuid, p_fields text[])
returns void
language sql
set search_path = ''
as $$
  update public.tenants
  set owner_overrides = (select array_agg(distinct f order by f)
                         from unnest(owner_overrides || p_fields) f)
  where id = p_tenant_id;
$$;

-- ---------------------------------------------------------------------------
-- Session & reads
-- ---------------------------------------------------------------------------
create or replace function public.owner_session(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.tenants;
begin
  t := private.owner_tenant(p_slug);
  return jsonb_build_object(
    'tenant_id', t.id, 'slug', t.slug, 'name', t.name, 'status', t.status,
    'timezone', t.timezone, 'currency', t.currency, 'accent_color', t.accent_color,
    'logo_path', t.logo_path,
    'role', (select role from public.tenant_members
             where tenant_id = t.id and user_id = (select auth.uid())),
    'email', (select email from auth.users where id = (select auth.uid())));
end;
$$;

-- Schedule for a reporting period (same period resolver as stats and the assistant):
-- bookings overlapping the period, active blocks and resources.
create or replace function public.owner_schedule(
  p_slug text, p_period text, p_from date default null, p_to date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  p record;
begin
  t := private.owner_tenant(p_slug);
  select * into p from private.resolve_period(t.timezone, p_period, p_from, p_to);
  if p.to_date - p.from_date > 62 then
    perform private.fail(422, 'invalid_period', 'Слишком длинный период');
  end if;
  return jsonb_build_object(
    'period', jsonb_build_object('key', p.period, 'from', p.from_date, 'to', p.to_date,
                                 'starts_at', p.starts_at, 'ends_at', p.ends_at),
    'timezone', t.timezone,
    'resources', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'kind', r.kind,
                                          'is_active', r.is_active) order by r.sort, r.name)
      from public.resources r where r.tenant_id = t.id), '[]'::jsonb),
    'bookings', coalesce((
      select jsonb_agg(private.booking_owner_json(b.id) order by b.starts_at)
      from public.bookings b
      where b.tenant_id = t.id
        and b.starts_at < p.ends_at
        and b.ends_at > p.starts_at), '[]'::jsonb),
    'blocks', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', o.id, 'resource_id', o.resource_id, 'starts_at', lower(o.during),
          'ends_at', upper(o.during), 'note', o.note) order by lower(o.during))
      from public.resource_occupancies o
      where o.tenant_id = t.id and o.kind = 'block' and o.released_at is null
        and o.during && tstzrange(p.starts_at, p.ends_at, '[)')), '[]'::jsonb));
end;
$$;

create or replace function public.owner_booking(p_slug text, p_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.tenants;
begin
  t := private.owner_tenant(p_slug);
  if not exists (select 1 from public.bookings where tenant_id = t.id and id = p_booking_id) then
    perform private.fail(404, 'not_found', 'Запись не найдена');
  end if;
  return jsonb_build_object(
    'booking', private.booking_owner_json(p_booking_id),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'kind', p.kind, 'amount_minor', p.amount_minor,
                                          'method', p.method, 'paid_at', p.paid_at, 'note', p.note)
                       order by p.paid_at)
      from public.payments p where p.tenant_id = t.id and p.booking_id = p_booking_id), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('kind', e.kind, 'payload', e.payload, 'actor', e.actor,
                                          'created_at', e.created_at) order by e.created_at)
      from public.booking_events e where e.tenant_id = t.id and e.booking_id = p_booking_id), '[]'::jsonb));
end;
$$;

-- Slot grid for a manual booking (owner ignores the client lead time).
create or replace function public.owner_slots(
  p_slug text, p_service_id uuid, p_from date default null, p_days int default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  v_from date;
  v_to date;
begin
  t := private.owner_tenant(p_slug);
  v_from := coalesce(p_from, (now() at time zone t.timezone)::date);
  v_to := v_from + least(greatest(coalesce(p_days, 7), 1), 31) - 1;
  return jsonb_build_object(
    'timezone', t.timezone,
    'days', coalesce((
      select jsonb_agg(jsonb_build_object(
          'date', d::date,
          'slots', coalesce((
            select jsonb_agg(jsonb_build_object(
                'starts_at', s.starts_at, 'time', to_char(s.local_time, 'HH24:MI'),
                'available', s.free_resources > 0, 'free_resources', s.free_resources)
              order by s.starts_at)
            from private.service_slots(t.id, p_service_id, d::date, d::date, now(), 0) s), '[]'::jsonb))
        order by d)
      from generate_series(v_from::timestamp, v_to::timestamp, interval '1 day') d), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Booking commands
-- ---------------------------------------------------------------------------
create or replace function public.owner_create_booking(
  p_slug text,
  p_service_id uuid,
  p_starts_at timestamptz,
  p_customer jsonb,
  p_resource_id uuid,
  p_idempotency_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  v_name text;
  v_phone text;
  v_car text;
  v_fp text;
  r record;
begin
  t := private.owner_tenant(p_slug);
  if p_idempotency_key is null or p_service_id is null or p_starts_at is null then
    perform private.fail(422, 'invalid_input', 'Не хватает данных для записи');
  end if;
  if p_starts_at < now() - interval '1 day' or p_starts_at > now() + interval '365 days' then
    perform private.fail(422, 'invalid_input', 'Дата записи вне допустимого диапазона');
  end if;
  v_name := private.clean_text(p_customer ->> 'name', 1, 80);
  v_phone := private.normalize_phone(p_customer ->> 'phone');
  v_car := private.clean_text(p_customer ->> 'car', 1, 80);
  if v_name is null or v_phone is null or v_car is null then
    perform private.fail(422, 'invalid_input', 'Укажите имя, телефон и автомобиль');
  end if;
  if p_resource_id is not null and not exists (
      select 1 from public.resources where tenant_id = t.id and id = p_resource_id and is_active) then
    perform private.fail(422, 'invalid_input', 'Бокс не найден');
  end if;

  v_fp := private.booking_fingerprint(p_service_id, p_starts_at, v_phone, v_name, v_car, p_resource_id);
  select * into r from private.place_booking(
    t.id, p_service_id, p_starts_at, v_name, v_phone, v_car,
    upper(private.clean_text(p_customer ->> 'plate', 1, 16)),
    private.clean_text(p_customer ->> 'comment', 1, 500),
    'owner', p_resource_id, p_idempotency_key, v_fp, t.status = 'preview', null,
    (select auth.uid()), private.clean_text(p_customer ->> 'owner_note', 1, 500));

  case r.outcome
    when 'created', 'replayed' then
      if r.outcome = 'created' then
        perform private.on_booking_changed(r.booking_id);
      end if;
      return jsonb_build_object(
        'replayed', r.outcome = 'replayed',
        'booking', private.booking_owner_json(r.booking_id),
        'access_token', private.booking_access_token(r.booking_id, p_idempotency_key));
    when 'idempotency_conflict' then
      perform private.fail(409, 'idempotency_conflict', 'Повторный запрос с другими данными');
    when 'slot_taken' then
      perform private.fail(409, 'slot_taken', 'Бокс занят в это время: ' ||
        coalesce('запись ' || (r.conflict ->> 'booking_code'), 'блокировка'));
    else
      perform private.fail(422, 'service_unavailable', 'Услуга недоступна или для неё не выбран бокс');
  end case;
  return null;
end;
$$;

-- Atomic reschedule. The old occupancy is released and the new one inserted in
-- the same transaction; if no resource is free the call raises and everything —
-- including the release — rolls back, so the original booking is untouched.
create or replace function public.owner_reschedule_booking(
  p_slug text, p_booking_id uuid, p_starts_at timestamptz, p_resource_id uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  b public.bookings;
  v_range tstzrange;
  v_resource uuid;
  v_new uuid;
  v_conflict jsonb;
begin
  t := private.owner_tenant(p_slug);
  b := private.owner_booking_for_update(t.id, p_booking_id);
  if b.status not in ('confirmed', 'arrived') then
    perform private.fail(409, 'invalid_state', 'Эту запись нельзя перенести');
  end if;
  if p_starts_at is null or p_starts_at < now() - interval '1 day' or p_starts_at > now() + interval '365 days' then
    perform private.fail(422, 'invalid_input', 'Неверная дата переноса');
  end if;
  if p_resource_id is not null and not exists (
      select 1 from public.resources where tenant_id = t.id and id = p_resource_id and is_active) then
    perform private.fail(422, 'invalid_input', 'Бокс не найден');
  end if;
  if p_starts_at = b.starts_at and coalesce(p_resource_id, b.resource_id) = b.resource_id then
    return jsonb_build_object('changed', false, 'booking', private.booking_owner_json(b.id));
  end if;

  v_range := tstzrange(p_starts_at,
    p_starts_at + make_interval(mins => b.duration_minutes + b.buffer_minutes), '[)');

  update public.resource_occupancies
  set released_at = now()
  where booking_id = b.id and released_at is null;

  for v_resource in
    select r.id
    from public.resources r
    where r.tenant_id = t.id and r.is_active
      and (
        (p_resource_id is not null and r.id = p_resource_id)
        or (p_resource_id is null and (
              r.id = b.resource_id
              or exists (select 1 from public.service_resources sr
                         where sr.tenant_id = t.id and sr.service_id = b.service_id and sr.resource_id = r.id)))
      )
    order by (r.id = b.resource_id) desc, r.sort, r.name, r.id
  loop
    begin
      insert into public.resource_occupancies (tenant_id, resource_id, kind, booking_id, during, created_by)
      values (t.id, v_resource, 'booking', b.id, v_range, (select auth.uid()));
      v_new := v_resource;
      exit;
    exception when exclusion_violation then
      if v_conflict is null then
        v_conflict := private.conflicting_occupant(v_resource, v_range);
      end if;
    end;
  end loop;

  if v_new is null then
    perform private.fail(409, 'slot_taken', 'Новое время занято: ' ||
      coalesce('запись ' || (v_conflict ->> 'booking_code'), 'блокировка') || '. Исходная запись сохранена.');
  end if;

  update public.bookings
  set starts_at = p_starts_at,
      ends_at = p_starts_at + make_interval(mins => b.duration_minutes),
      resource_id = v_new,
      reschedule_count = reschedule_count + 1
  where id = b.id;

  perform private.log_booking_event(t.id, b.id, 'rescheduled', jsonb_build_object(
    'from', b.starts_at, 'to', p_starts_at, 'from_resource', b.resource_id, 'to_resource', v_new), 'owner');
  perform private.on_booking_changed(b.id);

  return jsonb_build_object('changed', true, 'booking', private.booking_owner_json(b.id));
end;
$$;

create or replace function public.owner_cancel_booking(p_slug text, p_booking_id uuid, p_reason text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  b public.bookings;
begin
  t := private.owner_tenant(p_slug);
  b := private.owner_booking_for_update(t.id, p_booking_id);
  if b.status = 'cancelled' then
    return jsonb_build_object('changed', false, 'booking', private.booking_owner_json(b.id));
  end if;
  if b.status not in ('confirmed', 'arrived') then
    perform private.fail(409, 'invalid_state', 'Эту запись нельзя отменить');
  end if;
  update public.bookings
  set status = 'cancelled', cancelled_at = now(), cancelled_by = 'owner',
      cancel_reason = private.clean_text(p_reason, 1, 300)
  where id = b.id;
  perform private.release_booking_occupancy(b.id);
  perform private.log_booking_event(t.id, b.id, 'cancelled', jsonb_build_object('by', 'owner'), 'owner');
  perform private.on_booking_changed(b.id);
  return jsonb_build_object('changed', true, 'booking', private.booking_owner_json(b.id));
end;
$$;

-- Status flow: confirmed → arrived → done; confirmed → no_show; one-step undo.
-- "done" frees the box early: the occupancy is cut to now + buffer.
create or replace function public.owner_set_status(p_slug text, p_booking_id uuid, p_status text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  b public.bookings;
  v_occ public.resource_occupancies;
  v_full tstzrange;
begin
  t := private.owner_tenant(p_slug);
  b := private.owner_booking_for_update(t.id, p_booking_id);
  if b.status = p_status then
    return jsonb_build_object('changed', false, 'booking', private.booking_owner_json(b.id));
  end if;

  if b.status = 'confirmed' and p_status = 'arrived' then
    update public.bookings set status = 'arrived', arrived_at = now() where id = b.id;
  elsif b.status in ('confirmed', 'arrived') and p_status = 'done' then
    update public.bookings
    set status = 'done', arrived_at = coalesce(arrived_at, now()), done_at = now()
    where id = b.id;
    update public.resource_occupancies o
    set during = tstzrange(lower(o.during),
                           greatest(lower(o.during), now()) + make_interval(mins => b.buffer_minutes), '[)')
    where o.booking_id = b.id and o.released_at is null
      and greatest(lower(o.during), now()) + make_interval(mins => b.buffer_minutes) < upper(o.during);
  elsif b.status = 'confirmed' and p_status = 'no_show' then
    update public.bookings set status = 'no_show', no_show_at = now() where id = b.id;
    perform private.release_booking_occupancy(b.id);
  elsif b.status = 'arrived' and p_status = 'confirmed' then
    update public.bookings set status = 'confirmed', arrived_at = null where id = b.id;
  elsif b.status = 'done' and p_status = 'arrived' then
    -- Undo "done": restore the full occupancy if the freed time is still free.
    select * into v_occ from public.resource_occupancies
    where booking_id = b.id and released_at is null;
    v_full := tstzrange(b.starts_at, b.starts_at + make_interval(mins => b.duration_minutes + b.buffer_minutes), '[)');
    begin
      update public.resource_occupancies set during = v_full where id = v_occ.id;
    exception when exclusion_violation then
      perform private.fail(409, 'cannot_undo', 'Освобождённое время уже занято другой записью');
    end;
    update public.bookings set status = 'arrived', done_at = null where id = b.id;
  else
    perform private.fail(409, 'invalid_transition', 'Нельзя сменить статус с «' || b.status || '» на «' || p_status || '»');
  end if;

  perform private.log_booking_event(t.id, b.id, 'status', jsonb_build_object('from', b.status, 'to', p_status), 'owner');
  perform private.on_booking_changed(b.id);
  return jsonb_build_object('changed', true, 'booking', private.booking_owner_json(b.id));
end;
$$;

create or replace function public.owner_update_booking_note(p_slug text, p_booking_id uuid, p_note text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  b public.bookings;
begin
  t := private.owner_tenant(p_slug);
  b := private.owner_booking_for_update(t.id, p_booking_id);
  update public.bookings set owner_note = private.clean_text(p_note, 1, 500) where id = b.id;
  return jsonb_build_object('booking', private.booking_owner_json(b.id));
end;
$$;

-- Money actually received or returned. Refunds never exceed what was paid.
create or replace function public.owner_add_payment(
  p_slug text, p_booking_id uuid, p_kind text, p_amount_minor bigint, p_method text,
  p_note text, p_idempotency_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  b public.bookings;
  v_existing public.payments;
  v_paid bigint;
  v_refunded bigint;
  v_id uuid;
begin
  t := private.owner_tenant(p_slug);
  if p_idempotency_key is null then
    perform private.fail(422, 'invalid_input', 'Нет ключа идемпотентности');
  end if;
  select * into v_existing from public.payments
  where tenant_id = t.id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.booking_id = p_booking_id and v_existing.kind = p_kind
       and v_existing.amount_minor = p_amount_minor then
      return jsonb_build_object('replayed', true, 'payment_id', v_existing.id,
                                'booking', private.booking_owner_json(p_booking_id));
    end if;
    perform private.fail(409, 'idempotency_conflict', 'Повторный запрос с другими данными');
  end if;

  if p_kind not in ('payment', 'refund') or p_method not in ('cash', 'card', 'transfer', 'other') then
    perform private.fail(422, 'invalid_input', 'Неверный тип или способ оплаты');
  end if;
  if p_amount_minor is null or p_amount_minor <= 0 or p_amount_minor > 100000000 then
    perform private.fail(422, 'invalid_input', 'Сумма должна быть больше нуля');
  end if;

  b := private.owner_booking_for_update(t.id, p_booking_id);
  select coalesce(sum(amount_minor) filter (where kind = 'payment'), 0),
         coalesce(sum(amount_minor) filter (where kind = 'refund'), 0)
    into v_paid, v_refunded
  from public.payments where tenant_id = t.id and booking_id = b.id;

  if p_kind = 'refund' and p_amount_minor > v_paid - v_refunded then
    perform private.fail(422, 'refund_exceeds_paid', 'Возврат больше полученной суммы');
  end if;

  insert into public.payments (tenant_id, booking_id, kind, amount_minor, method, note, is_demo,
                               idempotency_key, created_by)
  values (t.id, b.id, p_kind, p_amount_minor, p_method, private.clean_text(p_note, 1, 200),
          b.is_demo, p_idempotency_key, (select auth.uid()))
  returning id into v_id;

  perform private.log_booking_event(t.id, b.id, p_kind,
    jsonb_build_object('amount_minor', p_amount_minor, 'method', p_method), 'owner');

  return jsonb_build_object('replayed', false, 'payment_id', v_id, 'booking', private.booking_owner_json(b.id));
end;
$$;

-- Owner block of a resource (maintenance, private job). Same EXCLUDE as bookings.
create or replace function public.owner_create_block(
  p_slug text, p_resource_id uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_note text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  v_range tstzrange;
  v_id uuid;
begin
  t := private.owner_tenant(p_slug);
  if not exists (select 1 from public.resources where tenant_id = t.id and id = p_resource_id) then
    perform private.fail(422, 'invalid_input', 'Бокс не найден');
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at
     or p_ends_at - p_starts_at > interval '31 days' then
    perform private.fail(422, 'invalid_input', 'Неверный интервал блокировки');
  end if;
  v_range := tstzrange(p_starts_at, p_ends_at, '[)');

  -- Natural idempotency: an identical active block is returned as is.
  select id into v_id from public.resource_occupancies
  where tenant_id = t.id and resource_id = p_resource_id and kind = 'block'
    and released_at is null and during = v_range;
  if v_id is not null then
    return jsonb_build_object('id', v_id, 'replayed', true);
  end if;

  begin
    insert into public.resource_occupancies (tenant_id, resource_id, kind, during, note, created_by)
    values (t.id, p_resource_id, 'block', v_range, private.clean_text(p_note, 1, 200), (select auth.uid()))
    returning id into v_id;
  exception when exclusion_violation then
    perform private.fail(409, 'slot_taken', 'В это время бокс уже занят: ' || coalesce(
      'запись ' || (private.conflicting_occupant(p_resource_id, v_range) ->> 'booking_code'), 'блокировка'));
  end;
  return jsonb_build_object('id', v_id, 'replayed', false);
end;
$$;

create or replace function public.owner_release_block(p_slug text, p_block_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t public.tenants;
begin
  t := private.owner_tenant(p_slug);
  update public.resource_occupancies
  set released_at = now()
  where tenant_id = t.id and id = p_block_id and kind = 'block' and released_at is null;
  return jsonb_build_object('released', found);
end;
$$;

-- Rotates the client link of a booking (e.g. for a phone booking) and returns it once.
create or replace function public.owner_issue_booking_link(p_slug text, p_booking_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  b public.bookings;
  v_token text := private.base64url(extensions.gen_random_bytes(32));
begin
  t := private.owner_tenant(p_slug);
  b := private.owner_booking_for_update(t.id, p_booking_id);
  insert into public.booking_access_tokens (tenant_id, booking_id, token_hash)
  values (t.id, b.id, private.token_hash(v_token))
  on conflict (booking_id) do update set token_hash = excluded.token_hash, created_at = now(), revoked_at = null;
  return jsonb_build_object('access_token', v_token);
end;
$$;

-- ---------------------------------------------------------------------------
-- Studio settings
-- ---------------------------------------------------------------------------
create or replace function public.owner_settings(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.tenants;
begin
  t := private.owner_tenant(p_slug);
  return jsonb_build_object(
    'tenant', to_jsonb(t) - 'config_hash',
    'resources', coalesce((select jsonb_agg(to_jsonb(r) order by r.sort, r.name)
                           from public.resources r where r.tenant_id = t.id), '[]'::jsonb),
    'services', coalesce((select jsonb_agg(to_jsonb(s) || jsonb_build_object('resource_ids', coalesce((
                                 select jsonb_agg(sr.resource_id) from public.service_resources sr
                                 where sr.tenant_id = t.id and sr.service_id = s.id), '[]'::jsonb))
                                 order by s.sort, s.name)
                          from public.services s where s.tenant_id = t.id), '[]'::jsonb),
    'hours', coalesce((select jsonb_agg(jsonb_build_object('weekday', w.weekday,
                                 'opens_at', to_char(w.opens_at, 'HH24:MI'), 'closes_at', to_char(w.closes_at, 'HH24:MI'))
                                 order by w.weekday, w.opens_at)
                       from public.working_hours w where w.tenant_id = t.id), '[]'::jsonb),
    'exceptions', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'date', e.date, 'is_closed', e.is_closed,
                                 'opens_at', to_char(e.opens_at, 'HH24:MI'), 'closes_at', to_char(e.closes_at, 'HH24:MI'),
                                 'note', e.note, 'origin', e.origin) order by e.date)
                            from public.schedule_exceptions e
                            where e.tenant_id = t.id and e.date >= (now() at time zone t.timezone)::date - 1), '[]'::jsonb),
    'photos', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'path', p.storage_path, 'caption', p.caption,
                                 'sort', p.sort, 'origin', p.origin) order by p.sort, p.created_at)
                        from public.tenant_photos p where p.tenant_id = t.id and p.is_active), '[]'::jsonb));
end;
$$;

create or replace function public.owner_update_profile(p_slug text, p_patch jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  v text;
  v_int int;
  v_fields text[] := '{}'::text[];
begin
  t := private.owner_tenant(p_slug);
  if jsonb_typeof(p_patch) <> 'object' then
    perform private.fail(422, 'invalid_input', 'Неверные данные');
  end if;

  if p_patch ? 'name' then
    v := private.clean_text(p_patch ->> 'name', 1, 80);
    if v is null then perform private.fail(422, 'invalid_input', 'Название: от 1 до 80 символов'); end if;
    update public.tenants set name = v where id = t.id; v_fields := array_append(v_fields, 'name');
  end if;
  if p_patch ? 'short_name' then
    v := private.clean_text(p_patch ->> 'short_name', 1, 24);
    if v is null then perform private.fail(422, 'invalid_input', 'Короткое название: до 24 символов'); end if;
    update public.tenants set short_name = v where id = t.id; v_fields := array_append(v_fields, 'short_name');
  end if;
  if p_patch ? 'tagline' then
    update public.tenants set tagline = private.clean_text(p_patch ->> 'tagline', 1, 120) where id = t.id;
    v_fields := array_append(v_fields, 'tagline');
  end if;
  if p_patch ? 'description' then
    update public.tenants set description = private.clean_text(p_patch ->> 'description', 1, 600) where id = t.id;
    v_fields := array_append(v_fields, 'description');
  end if;
  if p_patch ? 'address' then
    update public.tenants set address = private.clean_text(p_patch ->> 'address', 1, 200) where id = t.id;
    v_fields := array_append(v_fields, 'address');
  end if;
  if p_patch ? 'address_note' then
    update public.tenants set address_note = private.clean_text(p_patch ->> 'address_note', 1, 300) where id = t.id;
    v_fields := array_append(v_fields, 'address_note');
  end if;
  if p_patch ? 'map_url' then
    v := nullif(btrim(coalesce(p_patch ->> 'map_url', '')), '');
    if v is not null and v !~ '^https://' then
      perform private.fail(422, 'invalid_input', 'Ссылка на карту должна начинаться с https://');
    end if;
    update public.tenants set map_url = v where id = t.id; v_fields := array_append(v_fields, 'map_url');
  end if;
  if p_patch ? 'messenger_url' then
    v := nullif(btrim(coalesce(p_patch ->> 'messenger_url', '')), '');
    if v is not null and v !~ '^https://' then
      perform private.fail(422, 'invalid_input', 'Ссылка на мессенджер должна начинаться с https://');
    end if;
    update public.tenants set messenger_url = v where id = t.id; v_fields := array_append(v_fields, 'messenger_url');
  end if;
  if p_patch ? 'phone' then
    v := private.normalize_phone(p_patch ->> 'phone');
    if v is null then perform private.fail(422, 'invalid_input', 'Проверьте номер телефона'); end if;
    update public.tenants set phone = v where id = t.id; v_fields := array_append(v_fields, 'phone');
  end if;
  if p_patch ? 'phone_display' then
    update public.tenants set phone_display = private.clean_text(p_patch ->> 'phone_display', 1, 32) where id = t.id;
    v_fields := array_append(v_fields, 'phone_display');
  end if;
  if p_patch ? 'accent_color' then
    v := p_patch ->> 'accent_color';
    if v is null or v !~ '^#[0-9A-Fa-f]{6}$' then
      perform private.fail(422, 'invalid_input', 'Цвет в формате #RRGGBB');
    end if;
    update public.tenants set accent_color = upper(v) where id = t.id; v_fields := array_append(v_fields, 'accent_color');
  end if;
  if p_patch ? 'hero_alt' then
    update public.tenants set hero_alt = private.clean_text(p_patch ->> 'hero_alt', 1, 160) where id = t.id;
    v_fields := array_append(v_fields, 'hero_alt');
  end if;
  if p_patch ? 'slot_step_minutes' then
    v_int := (p_patch ->> 'slot_step_minutes')::int;
    if v_int not in (10, 15, 20, 30, 60) then perform private.fail(422, 'invalid_input', 'Шаг сетки: 10, 15, 20, 30 или 60 минут'); end if;
    update public.tenants set slot_step_minutes = v_int where id = t.id; v_fields := array_append(v_fields, 'slot_step_minutes');
  end if;
  if p_patch ? 'min_lead_minutes' then
    v_int := (p_patch ->> 'min_lead_minutes')::int;
    if v_int not between 0 and 10080 then perform private.fail(422, 'invalid_input', 'Запас времени до записи: 0–10080 минут'); end if;
    update public.tenants set min_lead_minutes = v_int where id = t.id; v_fields := array_append(v_fields, 'min_lead_minutes');
  end if;
  if p_patch ? 'horizon_days' then
    v_int := (p_patch ->> 'horizon_days')::int;
    if v_int not between 1 and 180 then perform private.fail(422, 'invalid_input', 'Горизонт записи: 1–180 дней'); end if;
    update public.tenants set horizon_days = v_int where id = t.id; v_fields := array_append(v_fields, 'horizon_days');
  end if;
  if p_patch ? 'cancel_until_hours' then
    v_int := (p_patch ->> 'cancel_until_hours')::int;
    if v_int not between 0 and 168 then perform private.fail(422, 'invalid_input', 'Отмена: 0–168 часов'); end if;
    update public.tenants set cancel_until_hours = v_int where id = t.id; v_fields := array_append(v_fields, 'cancel_until_hours');
  end if;

  if cardinality(v_fields) > 0 then
    perform private.add_override(t.id, v_fields);
  end if;
  return jsonb_build_object('updated', v_fields);
exception when invalid_text_representation or numeric_value_out_of_range then
  perform private.fail(422, 'invalid_input', 'Неверный формат числа');
  return null;
end;
$$;

-- Owner uploads go to tenant-media/<tenant_id>/owner/<file>; only such objects are accepted.
create or replace function private.assert_owner_media(p_tenant_id uuid, p_path text)
returns text
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_path is null or p_path !~ ('^' || p_tenant_id::text || '/owner/[A-Za-z0-9._-]{1,120}$') then
    perform private.fail(422, 'invalid_media', 'Файл должен быть загружен в кабинете');
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'tenant-media' and name = p_path) then
    perform private.fail(422, 'invalid_media', 'Файл не найден в хранилище');
  end if;
  return p_path;
end;
$$;

create or replace function public.owner_set_media(p_slug text, p_kind text, p_path text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t public.tenants;
begin
  t := private.owner_tenant(p_slug);
  perform private.assert_owner_media(t.id, p_path);
  if p_kind = 'logo' then
    update public.tenants set logo_path = p_path where id = t.id;
    perform private.add_override(t.id, array['logo']);
  elsif p_kind = 'hero' then
    update public.tenants set hero_path = p_path where id = t.id;
    perform private.add_override(t.id, array['hero']);
  else
    perform private.fail(422, 'invalid_input', 'Неизвестный тип изображения');
  end if;
  return jsonb_build_object('kind', p_kind, 'path', p_path);
end;
$$;

create or replace function private.validate_info_cards(p_cards jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  c jsonb;
  v_out jsonb := '[]'::jsonb;
  v_title text;
  v_text text;
  v_icon text;
begin
  if jsonb_typeof(p_cards) <> 'array' or jsonb_array_length(p_cards) <> 3 then
    perform private.fail(422, 'invalid_input', 'Нужно ровно три карточки');
  end if;
  for c in select * from jsonb_array_elements(p_cards) loop
    v_title := private.clean_text(c ->> 'title', 1, 40);
    v_text := private.clean_text(c ->> 'text', 1, 160);
    v_icon := coalesce(c ->> 'icon', 'sparkle');
    if v_title is null or v_text is null then
      perform private.fail(422, 'invalid_input', 'Заголовок до 40 и текст до 160 символов');
    end if;
    if v_icon not in ('sparkle', 'shield', 'clock', 'drop', 'car', 'star', 'wrench', 'medal', 'coffee', 'camera') then
      v_icon := 'sparkle';
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('title', v_title, 'text', v_text, 'icon', v_icon));
  end loop;
  return v_out;
end;
$$;

create or replace function public.owner_set_info_cards(p_slug text, p_cards jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  v_cards jsonb;
begin
  t := private.owner_tenant(p_slug);
  v_cards := private.validate_info_cards(p_cards);
  update public.tenants set info_cards = v_cards where id = t.id;
  perform private.add_override(t.id, array['info_cards']);
  return jsonb_build_object('info_cards', v_cards);
end;
$$;

create or replace function public.owner_upsert_service(p_slug text, p_service jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  v_id uuid := nullif(p_service ->> 'id', '')::uuid;
  v_name text := private.clean_text(p_service ->> 'name', 1, 80);
  v_price bigint := (p_service ->> 'price_minor')::bigint;
  v_duration int := (p_service ->> 'duration_minutes')::int;
  v_buffer int := coalesce((p_service ->> 'buffer_minutes')::int, 0);
  v_resource_ids uuid[];
begin
  t := private.owner_tenant(p_slug);
  if v_name is null then perform private.fail(422, 'invalid_input', 'Название услуги: 1–80 символов'); end if;
  if v_price is null or v_price < 0 then perform private.fail(422, 'invalid_input', 'Цена не может быть отрицательной'); end if;
  if v_duration is null or v_duration not between 15 and 20160 then
    perform private.fail(422, 'invalid_input', 'Длительность: от 15 минут до 14 дней');
  end if;
  if v_buffer not between 0 and 1440 then perform private.fail(422, 'invalid_input', 'Подготовка: 0–1440 минут'); end if;

  select coalesce(array_agg(x::uuid), '{}') into v_resource_ids
  from jsonb_array_elements_text(coalesce(p_service -> 'resource_ids', '[]'::jsonb)) x;
  if exists (select 1 from unnest(v_resource_ids) rid
             where not exists (select 1 from public.resources r where r.tenant_id = t.id and r.id = rid)) then
    perform private.fail(422, 'invalid_input', 'Неизвестный бокс');
  end if;

  if v_id is null then
    insert into public.services (tenant_id, key, name, description, category, price_minor, price_is_from,
                                 duration_minutes, buffer_minutes, is_active, sort, origin)
    values (t.id, 'owner-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10), v_name,
            private.clean_text(p_service ->> 'description', 1, 400),
            private.clean_text(p_service ->> 'category', 1, 40),
            v_price, coalesce((p_service ->> 'price_is_from')::boolean, false), v_duration, v_buffer,
            coalesce((p_service ->> 'is_active')::boolean, true),
            coalesce((p_service ->> 'sort')::int,
                     (select coalesce(max(sort), 0) + 10 from public.services where tenant_id = t.id)),
            'owner')
    returning id into v_id;
  else
    update public.services
    set name = v_name,
        description = private.clean_text(p_service ->> 'description', 1, 400),
        category = private.clean_text(p_service ->> 'category', 1, 40),
        price_minor = v_price,
        price_is_from = coalesce((p_service ->> 'price_is_from')::boolean, price_is_from),
        duration_minutes = v_duration,
        buffer_minutes = v_buffer,
        is_active = coalesce((p_service ->> 'is_active')::boolean, is_active),
        sort = coalesce((p_service ->> 'sort')::int, sort),
        owner_modified = true
    where tenant_id = t.id and id = v_id;
    if not found then perform private.fail(404, 'not_found', 'Услуга не найдена'); end if;
  end if;

  if p_service ? 'resource_ids' then
    delete from public.service_resources where tenant_id = t.id and service_id = v_id;
    insert into public.service_resources (tenant_id, service_id, resource_id)
    select t.id, v_id, rid from unnest(v_resource_ids) rid;
  end if;

  return (select to_jsonb(s) || jsonb_build_object('resource_ids', coalesce((
            select jsonb_agg(sr.resource_id) from public.service_resources sr
            where sr.tenant_id = t.id and sr.service_id = s.id), '[]'::jsonb))
          from public.services s where s.id = v_id);
exception when invalid_text_representation or numeric_value_out_of_range then
  perform private.fail(422, 'invalid_input', 'Неверный формат числа');
  return null;
end;
$$;

create or replace function public.owner_upsert_resource(p_slug text, p_resource jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  v_id uuid := nullif(p_resource ->> 'id', '')::uuid;
  v_name text := private.clean_text(p_resource ->> 'name', 1, 60);
  v_kind text := coalesce(p_resource ->> 'kind', 'box');
  v_future int;
begin
  t := private.owner_tenant(p_slug);
  if v_name is null then perform private.fail(422, 'invalid_input', 'Название бокса: 1–60 символов'); end if;
  if v_kind not in ('box', 'lift', 'bay', 'master') then v_kind := 'box'; end if;

  if v_id is null then
    insert into public.resources (tenant_id, key, name, kind, is_active, sort, origin)
    values (t.id, 'owner-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10), v_name, v_kind,
            coalesce((p_resource ->> 'is_active')::boolean, true),
            coalesce((p_resource ->> 'sort')::int,
                     (select coalesce(max(sort), 0) + 10 from public.resources where tenant_id = t.id)),
            'owner')
    returning id into v_id;
    -- A new box can do every service unless the owner narrows it later.
    if coalesce((p_resource ->> 'link_all_services')::boolean, true) then
      insert into public.service_resources (tenant_id, service_id, resource_id)
      select t.id, s.id, v_id from public.services s where s.tenant_id = t.id;
    end if;
  else
    update public.resources
    set name = v_name, kind = v_kind,
        is_active = coalesce((p_resource ->> 'is_active')::boolean, is_active),
        sort = coalesce((p_resource ->> 'sort')::int, sort),
        owner_modified = true
    where tenant_id = t.id and id = v_id;
    if not found then perform private.fail(404, 'not_found', 'Бокс не найден'); end if;
  end if;

  select count(*) into v_future from public.bookings
  where tenant_id = t.id and resource_id = v_id and status in ('confirmed', 'arrived') and ends_at > now();

  return (select to_jsonb(r) || jsonb_build_object('future_bookings', v_future)
          from public.resources r where r.id = v_id);
end;
$$;

-- Replaces the weekly hours. [{weekday:1..7, opens_at:'HH:MM', closes_at:'HH:MM'}]
create or replace function public.owner_set_working_hours(p_slug text, p_hours jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t public.tenants;
begin
  t := private.owner_tenant(p_slug);
  if jsonb_typeof(p_hours) <> 'array' then
    perform private.fail(422, 'invalid_input', 'Неверный формат часов работы');
  end if;
  delete from public.working_hours where tenant_id = t.id;
  begin
    insert into public.working_hours (tenant_id, weekday, opens_at, closes_at)
    select t.id, (h ->> 'weekday')::smallint, (h ->> 'opens_at')::time, (h ->> 'closes_at')::time
    from jsonb_array_elements(p_hours) h;
  exception when check_violation or unique_violation or invalid_datetime_format
             or invalid_text_representation or not_null_violation or datetime_field_overflow then
    perform private.fail(422, 'invalid_input', 'Проверьте часы: закрытие позже открытия, без дублей');
  end;
  if exists (
    select 1 from public.working_hours a join public.working_hours b
      on a.tenant_id = b.tenant_id and a.weekday = b.weekday and a.id < b.id
     and a.opens_at < b.closes_at and b.opens_at < a.closes_at
    where a.tenant_id = t.id) then
    perform private.fail(422, 'invalid_input', 'Интервалы одного дня пересекаются');
  end if;
  perform private.add_override(t.id, array['working_hours']);
  return jsonb_build_object('hours', (select coalesce(jsonb_agg(jsonb_build_object('weekday', weekday,
            'opens_at', to_char(opens_at, 'HH24:MI'), 'closes_at', to_char(closes_at, 'HH24:MI'))
            order by weekday, opens_at), '[]'::jsonb) from public.working_hours where tenant_id = t.id));
end;
$$;

create or replace function public.owner_upsert_exception(p_slug text, p_exception jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  v_date date;
  v_closed boolean := coalesce((p_exception ->> 'is_closed')::boolean, true);
  v_affected int;
begin
  t := private.owner_tenant(p_slug);
  v_date := (p_exception ->> 'date')::date;
  begin
    insert into public.schedule_exceptions (tenant_id, date, is_closed, opens_at, closes_at, note, origin)
    values (t.id, v_date, v_closed,
            case when v_closed then null else (p_exception ->> 'opens_at')::time end,
            case when v_closed then null else (p_exception ->> 'closes_at')::time end,
            private.clean_text(p_exception ->> 'note', 1, 120), 'owner')
    on conflict (tenant_id, date) do update
      set is_closed = excluded.is_closed, opens_at = excluded.opens_at,
          closes_at = excluded.closes_at, note = excluded.note, origin = 'owner';
  exception when check_violation or not_null_violation then
    perform private.fail(422, 'invalid_input', 'Для особых часов укажите открытие и закрытие');
  end;

  select count(*) into v_affected from public.bookings b
  where b.tenant_id = t.id and b.status in ('confirmed', 'arrived')
    and (b.starts_at at time zone t.timezone)::date = v_date;

  return jsonb_build_object('date', v_date, 'bookings_on_date', v_affected);
exception when invalid_datetime_format or invalid_text_representation or datetime_field_overflow then
  perform private.fail(422, 'invalid_input', 'Неверная дата или время');
  return null;
end;
$$;

create or replace function public.owner_delete_exception(p_slug text, p_date date)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t public.tenants;
begin
  t := private.owner_tenant(p_slug);
  delete from public.schedule_exceptions where tenant_id = t.id and date = p_date;
  return jsonb_build_object('deleted', found);
end;
$$;

-- Portfolio: three explicit actions — add a card, replace one photo, edit one caption.
create or replace function public.owner_add_photo(p_slug text, p_path text, p_caption text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  v_id uuid;
begin
  t := private.owner_tenant(p_slug);
  perform private.assert_owner_media(t.id, p_path);
  insert into public.tenant_photos (tenant_id, storage_path, caption, sort, origin)
  values (t.id, p_path, private.clean_text(p_caption, 1, 140),
          (select coalesce(max(sort), 0) + 10 from public.tenant_photos where tenant_id = t.id),
          'owner')
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'path', p_path);
end;
$$;

create or replace function public.owner_replace_photo(p_slug text, p_photo_id uuid, p_path text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t public.tenants;
begin
  t := private.owner_tenant(p_slug);
  perform private.assert_owner_media(t.id, p_path);
  update public.tenant_photos
  set storage_path = p_path, owner_modified = true
  where tenant_id = t.id and id = p_photo_id and is_active;
  if not found then perform private.fail(404, 'not_found', 'Фото не найдено'); end if;
  return jsonb_build_object('id', p_photo_id, 'path', p_path);
end;
$$;

create or replace function public.owner_set_photo_caption(p_slug text, p_photo_id uuid, p_caption text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t public.tenants;
begin
  t := private.owner_tenant(p_slug);
  update public.tenant_photos
  set caption = private.clean_text(p_caption, 1, 140), owner_modified = true
  where tenant_id = t.id and id = p_photo_id and is_active;
  if not found then perform private.fail(404, 'not_found', 'Фото не найдено'); end if;
  return jsonb_build_object('id', p_photo_id);
end;
$$;

create or replace function public.owner_remove_photo(p_slug text, p_photo_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t public.tenants;
begin
  t := private.owner_tenant(p_slug);
  update public.tenant_photos
  set is_active = false, owner_modified = true
  where tenant_id = t.id and id = p_photo_id;
  return jsonb_build_object('removed', found);
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.owner_session(text)',
    'public.owner_schedule(text, text, date, date)',
    'public.owner_booking(text, uuid)',
    'public.owner_slots(text, uuid, date, int)',
    'public.owner_create_booking(text, uuid, timestamptz, jsonb, uuid, uuid)',
    'public.owner_reschedule_booking(text, uuid, timestamptz, uuid)',
    'public.owner_cancel_booking(text, uuid, text)',
    'public.owner_set_status(text, uuid, text)',
    'public.owner_update_booking_note(text, uuid, text)',
    'public.owner_add_payment(text, uuid, text, bigint, text, text, uuid)',
    'public.owner_create_block(text, uuid, timestamptz, timestamptz, text)',
    'public.owner_release_block(text, uuid)',
    'public.owner_issue_booking_link(text, uuid)',
    'public.owner_settings(text)',
    'public.owner_update_profile(text, jsonb)',
    'public.owner_set_media(text, text, text)',
    'public.owner_set_info_cards(text, jsonb)',
    'public.owner_upsert_service(text, jsonb)',
    'public.owner_upsert_resource(text, jsonb)',
    'public.owner_set_working_hours(text, jsonb)',
    'public.owner_upsert_exception(text, jsonb)',
    'public.owner_delete_exception(text, date)',
    'public.owner_add_photo(text, text, text)',
    'public.owner_replace_photo(text, uuid, text)',
    'public.owner_set_photo_caption(text, uuid, text)',
    'public.owner_remove_photo(text, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
