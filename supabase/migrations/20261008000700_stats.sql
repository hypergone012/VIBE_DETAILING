-- Owner statistics, computed in SQL for a period resolved in the studio timezone.
--
-- Three different facts are kept apart on purpose:
--   visits          cars that actually arrived (arrived_at in period)
--   completed       jobs marked ready (done_at in period)
--   received_minor  money actually received (payments.paid_at in period), and
--                   refunded_minor / net_received_minor next to it
-- `scheduled_value_minor` is the list price of upcoming/ongoing bookings that START
-- in the period. It is an expectation, NOT revenue, and is labelled as such.

create or replace function private.stats_json(p_tenant_id uuid, p_period text, p_from date, p_to date)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  t public.tenants;
  p record;
begin
  select * into t from public.tenants where id = p_tenant_id;
  select * into p from private.resolve_period(t.timezone, p_period, p_from, p_to);
  if p.to_date - p.from_date > 366 then
    perform private.fail(422, 'invalid_period', 'Слишком длинный период');
  end if;

  return jsonb_build_object(
    'period', jsonb_build_object('key', p.period, 'from', p.from_date, 'to', p.to_date,
                                 'starts_at', p.starts_at, 'ends_at', p.ends_at,
                                 'timezone', t.timezone),
    'currency', t.currency,
    'visits', (select count(*) from public.bookings b
               where b.tenant_id = t.id and b.arrived_at >= p.starts_at and b.arrived_at < p.ends_at),
    'completed', (select count(*) from public.bookings b
                  where b.tenant_id = t.id and b.done_at >= p.starts_at and b.done_at < p.ends_at),
    'received_minor', (select coalesce(sum(amount_minor), 0) from public.payments x
                       where x.tenant_id = t.id and x.kind = 'payment'
                         and x.paid_at >= p.starts_at and x.paid_at < p.ends_at),
    'refunded_minor', (select coalesce(sum(amount_minor), 0) from public.payments x
                       where x.tenant_id = t.id and x.kind = 'refund'
                         and x.paid_at >= p.starts_at and x.paid_at < p.ends_at),
    'net_received_minor', (select coalesce(sum(case when kind = 'payment' then amount_minor else -amount_minor end), 0)
                           from public.payments x
                           where x.tenant_id = t.id and x.paid_at >= p.starts_at and x.paid_at < p.ends_at),
    'payments_count', (select count(*) from public.payments x
                       where x.tenant_id = t.id and x.kind = 'payment'
                         and x.paid_at >= p.starts_at and x.paid_at < p.ends_at),
    'bookings_starting', (select count(*) from public.bookings b
                          where b.tenant_id = t.id and b.status <> 'cancelled'
                            and b.starts_at >= p.starts_at and b.starts_at < p.ends_at),
    'scheduled_count', (select count(*) from public.bookings b
                        where b.tenant_id = t.id and b.status in ('confirmed', 'arrived')
                          and b.starts_at >= p.starts_at and b.starts_at < p.ends_at),
    'scheduled_value_minor', (select coalesce(sum(price_minor), 0) from public.bookings b
                              where b.tenant_id = t.id and b.status in ('confirmed', 'arrived')
                                and b.starts_at >= p.starts_at and b.starts_at < p.ends_at),
    'new_bookings', (select count(*) from public.bookings b
                     where b.tenant_id = t.id and b.created_at >= p.starts_at and b.created_at < p.ends_at),
    'cancellations', (select count(*) from public.bookings b
                      where b.tenant_id = t.id and b.cancelled_at >= p.starts_at and b.cancelled_at < p.ends_at),
    'no_shows', (select count(*) from public.bookings b
                 where b.tenant_id = t.id and b.no_show_at >= p.starts_at and b.no_show_at < p.ends_at),
    'by_day', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'date', d.day,
          'visits', (select count(*) from public.bookings b
                     where b.tenant_id = t.id and (b.arrived_at at time zone t.timezone)::date = d.day),
          'completed', (select count(*) from public.bookings b
                        where b.tenant_id = t.id and (b.done_at at time zone t.timezone)::date = d.day),
          'net_received_minor', (select coalesce(sum(case when kind = 'payment' then amount_minor else -amount_minor end), 0)
                                 from public.payments x
                                 where x.tenant_id = t.id and (x.paid_at at time zone t.timezone)::date = d.day))
        order by d.day), '[]'::jsonb)
      from (select g::date as day from generate_series(p.from_date::timestamp, p.to_date::timestamp, interval '1 day') g) d
      where p.to_date - p.from_date <= 62));
end;
$$;

create or replace function public.owner_stats(
  p_slug text, p_period text, p_from date default null, p_to date default null)
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
  return private.stats_json(t.id, p_period, p_from, p_to);
end;
$$;

revoke all on function public.owner_stats(text, text, date, date) from public, anon;
grant execute on function public.owner_stats(text, text, date, date) to authenticated;
