-- Scheduling rules, evaluated in the studio's timezone.
--
--  * Working hours (weekly windows, overridden per date by schedule_exceptions)
--    define the moments when a car can be RECEIVED and HANDED BACK.
--  * A service occupies one suitable resource for the continuous range
--    [start, start + duration + buffer) — across nights and closed days if needed.
--  * A start is offered when: it lies inside a receiving window on the slot grid,
--    it is at least min_lead_minutes ahead, it is within horizon_days, and the
--    hand-back moment (start + duration, buffer excluded) falls inside working
--    hours of its own local date (exceptions included).
--  * It is AVAILABLE when at least one active resource linked to the service has
--    no active occupancy overlapping the range.

-- Is the studio open (can receive or hand back a car) at this instant?
-- Closing time is inclusive: a car may be handed back exactly at closing.
create or replace function private.is_open_at(p_tenant_id uuid, p_moment timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  with t as (
    select (p_moment at time zone timezone) as local_ts
    from public.tenants where id = p_tenant_id
  ), d as (
    select local_ts::date as day, local_ts::time as tod from t
  )
  select case
    when exists (select 1 from public.schedule_exceptions e, d
                 where e.tenant_id = p_tenant_id and e.date = d.day) then
      exists (select 1 from public.schedule_exceptions e, d
              where e.tenant_id = p_tenant_id and e.date = d.day and not e.is_closed
                and d.tod >= e.opens_at and d.tod <= e.closes_at)
    else
      exists (select 1 from public.working_hours w, d
              where w.tenant_id = p_tenant_id and w.weekday = extract(isodow from d.day)::int
                and d.tod >= w.opens_at and d.tod <= w.closes_at)
  end;
$$;

-- Candidate starts (independent of occupancy) for a service between two local dates.
create or replace function private.slot_candidates(
  p_tenant_id uuid, p_service_id uuid, p_from date, p_to date, p_now timestamptz,
  p_lead_minutes int default null)
returns table (
  starts_at timestamptz,
  ends_at timestamptz,
  occupied_until timestamptz,
  local_date date,
  local_time time)
language sql
stable
set search_path = ''
as $$
  with t as (
    select id, timezone, slot_step_minutes,
           coalesce(p_lead_minutes, min_lead_minutes) as min_lead_minutes, horizon_days,
           (p_now at time zone timezone)::date as today
    from public.tenants where id = p_tenant_id
  ), s as (
    select duration_minutes, buffer_minutes
    from public.services
    where tenant_id = p_tenant_id and id = p_service_id and is_active
  ), days as (
    select g::date as day
    from t, generate_series(greatest(p_from, t.today)::timestamp,
                            least(p_to, t.today + t.horizon_days)::timestamp,
                            interval '1 day') as g
  ), windows as (
    select d.day, e.opens_at, e.closes_at
    from days d
    join public.schedule_exceptions e on e.tenant_id = p_tenant_id and e.date = d.day
    where not e.is_closed
    union all
    select d.day, w.opens_at, w.closes_at
    from days d
    join public.working_hours w
      on w.tenant_id = p_tenant_id and w.weekday = extract(isodow from d.day)::int
    where not exists (select 1 from public.schedule_exceptions e
                      where e.tenant_id = p_tenant_id and e.date = d.day)
  ), grid as (
    select w.day, g as local_ts
    from windows w, t,
      generate_series(w.day + w.opens_at,
                      w.day + w.closes_at - interval '1 minute',
                      make_interval(mins => t.slot_step_minutes)) as g
  ), timed as (
    select g.day, g.local_ts,
           (g.local_ts at time zone t.timezone) as starts_at,
           s.duration_minutes, s.buffer_minutes, t.min_lead_minutes
    from grid g, t, s
  )
  select x.starts_at,
         x.starts_at + make_interval(mins => x.duration_minutes) as ends_at,
         x.starts_at + make_interval(mins => x.duration_minutes + x.buffer_minutes) as occupied_until,
         x.day as local_date,
         x.local_ts::time as local_time
  from timed x
  where x.starts_at >= p_now + make_interval(mins => x.min_lead_minutes)
    and private.is_open_at(p_tenant_id, x.starts_at + make_interval(mins => x.duration_minutes))
  order by x.starts_at;
$$;

-- Candidates with the number of free suitable resources for each.
create or replace function private.service_slots(
  p_tenant_id uuid, p_service_id uuid, p_from date, p_to date, p_now timestamptz default now(),
  p_lead_minutes int default null)
returns table (
  starts_at timestamptz,
  ends_at timestamptz,
  occupied_until timestamptz,
  local_date date,
  local_time time,
  free_resources int)
language sql
stable
set search_path = ''
as $$
  select c.starts_at, c.ends_at, c.occupied_until, c.local_date, c.local_time,
    (select count(*)::int
       from public.service_resources sr
       join public.resources r
         on r.tenant_id = sr.tenant_id and r.id = sr.resource_id and r.is_active
      where sr.tenant_id = p_tenant_id and sr.service_id = p_service_id
        and not exists (
          select 1 from public.resource_occupancies o
          where o.tenant_id = p_tenant_id
            and o.resource_id = sr.resource_id
            and o.released_at is null
            and o.during && tstzrange(c.starts_at, c.occupied_until, '[)'))) as free_resources
  from private.slot_candidates(p_tenant_id, p_service_id, p_from, p_to, p_now, p_lead_minutes) c
  order by c.starts_at;
$$;

-- Is p_starts_at one of the offered starts for this service (ignores occupancy)?
create or replace function private.is_offered_start(
  p_tenant_id uuid, p_service_id uuid, p_starts_at timestamptz, p_now timestamptz default now())
returns boolean
language sql
stable
set search_path = ''
as $$
  with d as (
    select (p_starts_at at time zone t.timezone)::date as day
    from public.tenants t where t.id = p_tenant_id
  )
  select exists (
    select 1 from d, private.slot_candidates(p_tenant_id, p_service_id, d.day, d.day, p_now) c
    where c.starts_at = p_starts_at);
$$;

-- ---------------------------------------------------------------------------
-- Reporting periods. One definition shared by the cabinet UI and the assistant,
-- so "this week" means the same Monday–Sunday in the studio's timezone everywhere.
-- ---------------------------------------------------------------------------
create or replace function private.resolve_period(
  p_timezone text, p_period text, p_from date default null, p_to date default null,
  p_now timestamptz default now())
returns table (period text, from_date date, to_date date, starts_at timestamptz, ends_at timestamptz)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_today date := (p_now at time zone p_timezone)::date;
  v_monday date := v_today - (extract(isodow from v_today)::int - 1);
  v_month date := date_trunc('month', v_today::timestamp)::date;
  f date;
  t date;
begin
  case p_period
    when 'today' then f := v_today; t := v_today;
    when 'tomorrow' then f := v_today + 1; t := v_today + 1;
    when 'yesterday' then f := v_today - 1; t := v_today - 1;
    when 'this_week' then f := v_monday; t := v_monday + 6;
    when 'last_week' then f := v_monday - 7; t := v_monday - 1;
    when 'next_week' then f := v_monday + 7; t := v_monday + 13;
    when 'this_month' then f := v_month; t := (v_month + interval '1 month')::date - 1;
    when 'last_month' then f := (v_month - interval '1 month')::date; t := v_month - 1;
    when 'last_7_days' then f := v_today - 6; t := v_today;
    when 'next_7_days' then f := v_today; t := v_today + 6;
    when 'last_30_days' then f := v_today - 29; t := v_today;
    when 'custom' then
      if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
        perform private.fail(422, 'invalid_period', 'Неверный период');
      end if;
      f := p_from; t := p_to;
    else
      perform private.fail(422, 'invalid_period', 'Неизвестный период');
  end case;

  return query select p_period, f, t,
    (f::timestamp at time zone p_timezone),
    ((t + 1)::timestamp at time zone p_timezone);
end;
$$;
