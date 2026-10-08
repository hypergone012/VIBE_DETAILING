-- Assistant guard rails: per-IP rate limit and daily LLM budgets as atomic counters.
-- Called only by the `assistant` Edge Function with the service role.

create table private.llm_usage_daily (
  scope_key text not null,
  day date not null,
  requests int not null default 0,
  tokens bigint not null default 0,
  primary key (scope_key, day)
);

-- Reserves budget for one assistant request. Either every counter is incremented
-- or none is (the increments run in a subtransaction that is rolled back on refusal).
create or replace function public.assistant_begin(
  p_slug text, p_scope text, p_client_ip text, p_reserve_tokens int)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  v_day date := (now() at time zone 'UTC')::date;
  v_req int;
  v_tok bigint;
  v_reserve int := least(greatest(coalesce(p_reserve_tokens, 0), 0), 50000);
begin
  if p_scope not in ('client', 'owner') then
    return private.err('invalid_scope', 'Неизвестный режим помощника');
  end if;
  select * into t from public.tenants where slug = lower(btrim(p_slug)) and status in ('preview', 'live');
  if t.id is null then
    return private.err('tenant_not_found', 'Студия не найдена');
  end if;

  begin
    perform private.hit_rate_limit('assistant:' || coalesce(nullif(p_client_ip, ''), 'unknown'),
      private.config_int('rate.assistant_ip_per_10min', 20), interval '10 minutes');

    insert into private.llm_usage_daily as u (scope_key, day, requests, tokens)
    values ('tenant:' || t.id::text, v_day, 1, v_reserve)
    on conflict (scope_key, day) do update
      set requests = u.requests + 1, tokens = u.tokens + v_reserve
    returning requests, tokens into v_req, v_tok;
    if v_req > private.config_int('llm.tenant_daily_requests', 400)
       or v_tok > private.config_int('llm.tenant_daily_tokens', 200000) then
      raise exception using errcode = 'PT429', message = 'budget_exhausted';
    end if;

    insert into private.llm_usage_daily as u (scope_key, day, requests, tokens)
    values ('global', v_day, 1, v_reserve)
    on conflict (scope_key, day) do update
      set requests = u.requests + 1, tokens = u.tokens + v_reserve
    returning tokens into v_tok;
    if v_tok > private.config_int('llm.global_daily_tokens', 2000000) then
      raise exception using errcode = 'PT429', message = 'budget_exhausted';
    end if;
  exception when sqlstate 'PT429' then
    return private.err(sqlerrm,
      case when sqlerrm = 'rate_limited' then 'Слишком много вопросов подряд. Попробуйте через несколько минут.'
           else 'Помощник на сегодня исчерпал лимит. Запись работает как обычно.' end);
  end;

  return jsonb_build_object(
    'ok', true, 'tenant_id', t.id, 'slug', t.slug, 'status', t.status, 'name', t.name,
    'timezone', t.timezone, 'currency', t.currency, 'reserved_tokens', v_reserve);
end;
$$;

-- Reconciles the reservation with the tokens the provider actually reported.
create or replace function public.assistant_finish(p_tenant_id uuid, p_reserved_tokens int, p_used_tokens int)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update private.llm_usage_daily
  set tokens = greatest(tokens + (greatest(coalesce(p_used_tokens, 0), 0) - coalesce(p_reserved_tokens, 0)), 0)
  where day = (now() at time zone 'UTC')::date
    and scope_key in ('tenant:' || p_tenant_id::text, 'global');
$$;

revoke all on function public.assistant_begin(text, text, text, int) from public, anon, authenticated;
revoke all on function public.assistant_finish(uuid, int, int) from public, anon, authenticated;
grant execute on function public.assistant_begin(text, text, text, int) to service_role;
grant execute on function public.assistant_finish(uuid, int, int) to service_role;
