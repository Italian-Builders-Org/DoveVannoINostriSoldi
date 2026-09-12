-- Only daily HMAC identifiers and bounded counters. No IPs, keys or conversations.
create schema assistant_private;
revoke all on schema assistant_private from public, anon, authenticated;
grant usage on schema assistant_private to service_role;

create table assistant_private.quota (
  scope text not null check (scope in ('local', 'preview', 'production')),
  quota_day date not null,
  kind text not null check (kind in ('network', 'browser')),
  subject text not null check (subject ~ '^[a-f0-9]{64}$'),
  used smallint not null default 0 check (used between 0 and 10),
  lease text check (lease ~ '^[a-f0-9]{32}$'),
  lease_until timestamptz,
  burst smallint not null default 0 check (burst between 0 and 60),
  burst_until timestamptz,
  expires_at timestamptz not null,
  primary key (scope, quota_day, kind, subject),
  check ((lease is null) = (lease_until is null))
);
create index quota_expiry_idx on assistant_private.quota (expires_at);
alter table assistant_private.quota enable row level security;
revoke all on assistant_private.quota from public, anon, authenticated;
grant select, insert, update, delete on assistant_private.quota to service_role;

-- Lock the network row first, then the browser row, in every operation.
-- The transaction commits before Regolo is called; the 90-second lease protects
-- the subsequent stream without holding a database connection open.
create function public.assistant_quota(
  p_scope text, p_day date, p_browser text, p_network text, p_lease text, p_reserve boolean
) returns integer[]
language plpgsql security invoker set search_path = '' set lock_timeout = '1500ms'
as $$
declare
  current_time_utc timestamptz := clock_timestamp();
  expiry timestamptz;
  network_row assistant_private.quota%rowtype;
  browser_row assistant_private.quota%rowtype;
  used_count integer;
begin
  if p_scope is null or p_scope not in ('local', 'preview', 'production')
     or p_day is distinct from (current_time_utc at time zone 'Europe/Rome')::date
     or p_browser is null or p_browser !~ '^[a-f0-9]{64}$'
     or p_network is null or p_network !~ '^[a-f0-9]{64}$'
     or p_lease is null or p_lease !~ '^[a-f0-9]{32}$' or p_reserve is null then
    raise exception 'Invalid quota request' using errcode = '22023';
  end if;
  expiry := ((p_day + 1)::timestamp at time zone 'Europe/Rome') + interval '2 minutes';
  insert into assistant_private.quota (scope, quota_day, kind, subject, expires_at)
    values (p_scope, p_day, 'network', p_network, expiry) on conflict do nothing;
  select * into strict network_row from assistant_private.quota
    where scope = p_scope and quota_day = p_day and kind = 'network' and subject = p_network
    for update;
  -- Refresh the clock after waiting for another transaction.
  current_time_utc := clock_timestamp();
  if p_day is distinct from (current_time_utc at time zone 'Europe/Rome')::date then
    raise exception 'Quota day expired' using errcode = '22023';
  end if;
  -- Rejected bursts do not create fresh browser rows or grow counters indefinitely.
  if network_row.burst_until > current_time_utc and network_row.burst >= 60 then
    return array[-2, network_row.used::integer];
  end if;
  update assistant_private.quota set
    burst = case when burst_until > current_time_utc then burst + 1 else 1 end,
    burst_until = case when burst_until > current_time_utc then burst_until else current_time_utc + interval '1 minute' end
    where scope = p_scope and quota_day = p_day and kind = 'network' and subject = p_network;
  insert into assistant_private.quota (scope, quota_day, kind, subject, expires_at)
    values (p_scope, p_day, 'browser', p_browser, expiry) on conflict do nothing;
  select * into strict browser_row from assistant_private.quota
    where scope = p_scope and quota_day = p_day and kind = 'browser' and subject = p_browser
    for update;
  current_time_utc := clock_timestamp();
  if p_day is distinct from (current_time_utc at time zone 'Europe/Rome')::date then
    raise exception 'Quota day expired' using errcode = '22023';
  end if;
  used_count := greatest(network_row.used, browser_row.used);
  if not p_reserve then return array[1, used_count]; end if;
  if used_count >= 10 then return array[0, used_count]; end if;
  if network_row.lease_until > current_time_utc or browser_row.lease_until > current_time_utc then
    return array[-1, used_count];
  end if;
  update assistant_private.quota set used = used + 1, lease = p_lease,
    lease_until = current_time_utc + interval '90 seconds'
    where scope = p_scope and quota_day = p_day
      and ((kind = 'network' and subject = p_network) or (kind = 'browser' and subject = p_browser));
  return array[1, used_count + 1];
end;
$$;
revoke all on function public.assistant_quota(text, date, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.assistant_quota(text, date, text, text, text, boolean) to service_role;

create function public.assistant_quota_release(
  p_scope text, p_day date, p_browser text, p_network text, p_lease text
) returns boolean
language plpgsql security invoker set search_path = '' set lock_timeout = '1500ms'
as $$
begin
  -- Updates take locks in the same order as admission. A stale caller cannot
  -- release a new stream's lease. Day changes never refund a reserved credit.
  update assistant_private.quota set lease = null, lease_until = null
    where scope = p_scope and quota_day = p_day and kind = 'network'
      and subject = p_network and lease = p_lease;
  update assistant_private.quota set lease = null, lease_until = null
    where scope = p_scope and quota_day = p_day and kind = 'browser'
      and subject = p_browser and lease = p_lease;
  return true;
end;
$$;
revoke all on function public.assistant_quota_release(text, date, text, text, text) from public, anon, authenticated;
grant execute on function public.assistant_quota_release(text, date, text, text, text) to service_role;

create function assistant_private.expire_quota() returns bigint
language sql security invoker set search_path = ''
as $$
  with expired as (
    delete from assistant_private.quota where expires_at <= clock_timestamp() returning 1
  ) select count(*) from expired;
$$;
revoke all on function assistant_private.expire_quota() from public, anon, authenticated;
grant execute on function assistant_private.expire_quota() to service_role;
