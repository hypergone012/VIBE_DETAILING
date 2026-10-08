-- Reminders: Web Push subscriptions + an outbox of notification jobs.
--
--  * A client opts in on their booking page (token-authenticated); a reminder job
--    is created with dedupe_key = reminder_24h:<booking>:<start epoch>.
--  * Reschedule changes the key: the old job is cancelled and a new one created.
--    Cancellation / no-show cancels pending jobs.
--  * The dispatch Edge Function (invoked by Supabase Cron) claims due jobs with a
--    lease (FOR UPDATE SKIP LOCKED); only the lease holder can complete a job.
--  * Preview studios and demo bookings never send: their due jobs are skipped in SQL.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

insert into private.app_config (key, value, description) values
  ('push.allowed_host_pattern',
   '"^(fcm\\.googleapis\\.com|updates\\.push\\.services\\.mozilla\\.com|[a-z0-9.-]+\\.notify\\.windows\\.com|web\\.push\\.apple\\.com|[a-z0-9.-]+\\.push\\.apple\\.com)$"',
   'Push endpoints must belong to a browser push service (prevents SSRF via the dispatcher)'),
  ('push.allow_insecure_test_endpoints', 'false',
   'Local/test only: also accept http endpoints on host.docker.internal / 127.0.0.1')
on conflict (key) do nothing;

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  booking_id uuid not null,
  endpoint text not null,
  p256dh text not null check (char_length(p256dh) between 40 and 200),
  auth text not null check (char_length(auth) between 10 and 100),
  user_agent text check (char_length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_error text,
  unique (booking_id, endpoint),
  foreign key (tenant_id, booking_id) references public.bookings (tenant_id, id) on delete cascade
);

create table public.notification_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  booking_id uuid not null,
  kind text not null check (kind in ('reminder_24h')),
  channel text not null default 'webpush' check (channel in ('webpush')),
  dedupe_key text not null unique,
  run_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed', 'cancelled', 'skipped')),
  attempts int not null default 0,
  max_attempts int not null default 5,
  lease_until timestamptz,
  locked_by text,
  last_error text,
  result jsonb,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, booking_id) references public.bookings (tenant_id, id) on delete cascade
);

create index notification_jobs_due_idx on public.notification_jobs (run_at)
  where status in ('pending', 'processing');
create index notification_jobs_booking_idx on public.notification_jobs (booking_id);

create trigger notification_jobs_touch before update on public.notification_jobs
  for each row execute function private.touch_updated_at();

alter table public.push_subscriptions enable row level security;
alter table public.notification_jobs enable row level security;
-- No API role reads these tables directly.
revoke all on public.push_subscriptions, public.notification_jobs from anon, authenticated;

create or replace function private.reminder_key(p_booking_id uuid, p_starts_at timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'reminder_24h:' || p_booking_id::text || ':' || extract(epoch from p_starts_at)::bigint::text;
$$;

-- Ensures exactly one live reminder job for a confirmed booking with subscribers.
-- Returns the job's run_at, or NULL when no reminder will be sent.
create or replace function private.schedule_reminder(p_booking_id uuid)
returns timestamptz
language plpgsql
volatile
set search_path = ''
as $$
declare
  b public.bookings;
  v_key text;
  v_run_at timestamptz;
begin
  select * into b from public.bookings where id = p_booking_id;
  if b.id is null or b.status <> 'confirmed' then
    return null;
  end if;
  if not exists (select 1 from public.push_subscriptions s
                 where s.booking_id = b.id and s.revoked_at is null) then
    return null;
  end if;

  v_run_at := b.starts_at - interval '24 hours';
  if v_run_at < now() then
    -- Booked less than a day ahead: remind right away if the visit is still 2h+ away.
    if b.starts_at < now() + interval '2 hours' then
      return null;
    end if;
    v_run_at := now();
  end if;

  v_key := private.reminder_key(b.id, b.starts_at);
  insert into public.notification_jobs (tenant_id, booking_id, kind, dedupe_key, run_at)
  values (b.tenant_id, b.id, 'reminder_24h', v_key, v_run_at)
  on conflict (dedupe_key) do nothing;

  return (select run_at from public.notification_jobs where dedupe_key = v_key and status in ('pending', 'processing', 'sent'));
end;
$$;

-- Called after every booking change (create, reschedule, cancel, status).
create or replace function private.on_booking_changed(p_booking_id uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  b public.bookings;
begin
  select * into b from public.bookings where id = p_booking_id;
  if b.id is null then
    return;
  end if;
  update public.notification_jobs
  set status = 'cancelled', lease_until = null,
      last_error = case when b.status <> 'confirmed' then 'booking_' || b.status else 'rescheduled' end
  where booking_id = b.id
    and status in ('pending', 'processing')
    and (b.status <> 'confirmed' or dedupe_key <> private.reminder_key(b.id, b.starts_at));
  perform private.schedule_reminder(b.id);
end;
$$;

create or replace function private.push_endpoint_allowed(p_endpoint text)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_host text := substring(p_endpoint from '^https?://([^/:?#]+)');
begin
  if v_host is null or char_length(p_endpoint) > 1000 then
    return false;
  end if;
  if p_endpoint ~ '^https://' and v_host ~ (select value #>> '{}' from private.app_config
                                             where key = 'push.allowed_host_pattern') then
    return true;
  end if;
  return coalesce((select (value #>> '{}')::boolean from private.app_config
                   where key = 'push.allow_insecure_test_endpoints'), false)
     and v_host in ('host.docker.internal', '127.0.0.1', 'localhost');
end;
$$;

create or replace function public.register_push(p_slug text, p_token text, p_subscription jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  b public.bookings;
  t public.tenants;
  v_endpoint text := p_subscription ->> 'endpoint';
  v_run_at timestamptz;
begin
  perform private.public_gate('push:' || private.client_ip(), 'rate.push_ip_per_hour', 30, interval '1 hour');
  b := private.booking_by_token(p_slug, p_token);
  if b.id is null then
    return private.err('not_found', 'Запись не найдена');
  end if;
  select * into t from public.tenants where id = b.tenant_id;
  if b.status <> 'confirmed' then
    return private.err('invalid_state', 'Напоминание доступно только для активной записи');
  end if;
  if not private.push_endpoint_allowed(v_endpoint)
     or coalesce(p_subscription #>> '{keys,p256dh}', '') = ''
     or coalesce(p_subscription #>> '{keys,auth}', '') = '' then
    return private.err('invalid_subscription', 'Браузер вернул неподдерживаемую подписку');
  end if;

  begin
    insert into public.push_subscriptions (tenant_id, booking_id, endpoint, p256dh, auth, user_agent)
    values (b.tenant_id, b.id, v_endpoint, p_subscription #>> '{keys,p256dh}', p_subscription #>> '{keys,auth}',
            left(p_subscription ->> 'user_agent', 300))
    on conflict (booking_id, endpoint) do update
      set p256dh = excluded.p256dh, auth = excluded.auth, revoked_at = null, last_error = null;
  exception when check_violation then
    return private.err('invalid_subscription', 'Браузер вернул неподдерживаемую подписку');
  end;

  v_run_at := private.schedule_reminder(b.id);
  return jsonb_build_object(
    'ok', true,
    'state', case
      when t.status <> 'live' or b.is_demo then 'preview'
      when v_run_at is null then 'too_late'
      else 'scheduled' end,
    'reminder_at', v_run_at);
end;
$$;

create or replace function public.unregister_push(p_slug text, p_token text, p_endpoint text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  b public.bookings;
begin
  perform private.public_gate('push:' || private.client_ip(), 'rate.push_ip_per_hour', 30, interval '1 hour');
  b := private.booking_by_token(p_slug, p_token);
  if b.id is null then
    return private.err('not_found', 'Запись не найдена');
  end if;
  update public.push_subscriptions set revoked_at = now()
  where booking_id = b.id and endpoint = p_endpoint and revoked_at is null;
  if not exists (select 1 from public.push_subscriptions where booking_id = b.id and revoked_at is null) then
    update public.notification_jobs set status = 'cancelled', last_error = 'unsubscribed'
    where booking_id = b.id and status = 'pending';
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- What the dispatcher needs for one job.
create or replace function private.job_json(p_job_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'job_id', j.id, 'kind', j.kind, 'attempts', j.attempts, 'dedupe_key', j.dedupe_key,
    'booking', jsonb_build_object(
      'id', b.id, 'code', b.code, 'service_name', b.service_name, 'starts_at', b.starts_at,
      'status', b.status),
    'tenant', jsonb_build_object(
      'slug', t.slug, 'name', t.name, 'short_name', t.short_name, 'timezone', t.timezone,
      'address', t.address, 'locale', t.locale),
    'subscriptions', coalesce((
      select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
      from public.push_subscriptions s where s.booking_id = b.id and s.revoked_at is null), '[]'::jsonb))
  from public.notification_jobs j
  join public.bookings b on b.id = j.booking_id
  join public.tenants t on t.id = j.tenant_id
  where j.id = p_job_id;
$$;

create or replace function public.claim_notification_jobs(
  p_worker text, p_limit int default 20, p_lease_seconds int default 120)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  -- Never send for preview studios, demo bookings or bookings that are no longer confirmed.
  update public.notification_jobs j
  set status = 'skipped', lease_until = null,
      last_error = case when t.status <> 'live' then 'preview_tenant'
                        when b.is_demo then 'demo_booking'
                        else 'booking_' || b.status end
  from public.bookings b, public.tenants t
  where b.id = j.booking_id and t.id = j.tenant_id
    and j.status = 'pending' and j.run_at <= now()
    and (t.status <> 'live' or b.is_demo or b.status <> 'confirmed');

  -- Expired leases that used up their attempts become failures.
  update public.notification_jobs
  set status = 'failed', lease_until = null, last_error = coalesce(last_error, 'lease_expired')
  where status = 'processing' and lease_until < now() and attempts >= max_attempts;

  with due as (
    select id from public.notification_jobs
    where ((status = 'pending' and run_at <= now())
           or (status = 'processing' and lease_until < now()))
      and attempts < max_attempts
    order by run_at
    limit least(greatest(p_limit, 1), 100)
    for update skip locked
  ), claimed as (
    update public.notification_jobs j
    set status = 'processing', locked_by = p_worker, attempts = j.attempts + 1,
        lease_until = now() + make_interval(secs => least(greatest(p_lease_seconds, 10), 900))
    from due
    where j.id = due.id
    returning j.id
  )
  select coalesce(array_agg(id), '{}') into v_ids from claimed;

  return jsonb_build_object('jobs', coalesce((select jsonb_agg(private.job_json(id)) from unnest(v_ids) id), '[]'::jsonb));
end;
$$;

-- Completes a job; ignored unless the caller still holds the lease.
create or replace function public.complete_notification_job(
  p_job_id uuid, p_worker text, p_outcome text, p_error text default null,
  p_gone_endpoints text[] default '{}', p_result jsonb default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  j public.notification_jobs;
begin
  select * into j from public.notification_jobs where id = p_job_id for update;
  if j.id is null or j.status <> 'processing' or j.locked_by is distinct from p_worker then
    return jsonb_build_object('applied', false, 'status', j.status);
  end if;

  if cardinality(p_gone_endpoints) > 0 then
    update public.push_subscriptions
    set revoked_at = now(), last_error = 'gone'
    where booking_id = j.booking_id and endpoint = any (p_gone_endpoints);
  end if;

  if p_outcome = 'sent' then
    update public.notification_jobs
    set status = 'sent', sent_at = now(), lease_until = null, last_error = p_error, result = p_result
    where id = j.id;
  elsif p_outcome = 'retry' and j.attempts < j.max_attempts then
    update public.notification_jobs
    set status = 'pending', lease_until = null, last_error = p_error, result = p_result,
        run_at = now() + make_interval(mins => power(2, j.attempts)::int)
    where id = j.id;
  elsif p_outcome = 'no_subscribers' then
    update public.notification_jobs
    set status = 'skipped', lease_until = null, last_error = 'no_subscribers', result = p_result
    where id = j.id;
  else
    update public.notification_jobs
    set status = 'failed', lease_until = null, last_error = coalesce(p_error, p_outcome), result = p_result
    where id = j.id;
  end if;
  return jsonb_build_object('applied', true,
                            'status', (select status from public.notification_jobs where id = j.id));
end;
$$;

revoke all on function public.register_push(text, text, jsonb) from public;
revoke all on function public.unregister_push(text, text, text) from public;
revoke all on function public.claim_notification_jobs(text, int, int) from public, anon, authenticated;
revoke all on function public.complete_notification_job(uuid, text, text, text, text[], jsonb) from public, anon, authenticated;
grant execute on function public.register_push(text, text, jsonb) to anon, authenticated;
grant execute on function public.unregister_push(text, text, text) to anon, authenticated;
grant execute on function public.claim_notification_jobs(text, int, int) to service_role;
grant execute on function public.complete_notification_job(uuid, text, text, text, text[], jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Supabase Cron → dispatch Edge Function. The URL and shared secret live in Vault
-- (see SETUP.md). Without them the job is a no-op, so local resets stay quiet.
-- ---------------------------------------------------------------------------
create or replace function private.invoke_dispatch()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'dispatch_secret';
  if v_url is null or v_secret is null then
    return;
  end if;
  if not exists (select 1 from public.notification_jobs
                 where (status = 'pending' and run_at <= now())
                    or (status = 'processing' and lease_until < now())) then
    return;
  end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/notifications-dispatch',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-dispatch-secret', v_secret),
    body := jsonb_build_object('source', 'cron'),
    timeout_milliseconds := 30000);
end;
$$;

revoke all on function private.invoke_dispatch() from public;

do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname in ('notifications-dispatch', 'rate-counters-cleanup');
  perform cron.schedule('notifications-dispatch', '* * * * *', 'select private.invoke_dispatch()');
  perform cron.schedule('rate-counters-cleanup', '17 * * * *', 'select private.cleanup_rate_counters()');
end;
$$;
