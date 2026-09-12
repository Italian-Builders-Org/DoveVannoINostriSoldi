-- Runs entirely inside Supabase Postgres: no Edge Function or external keepalive.
create extension if not exists pg_cron;
select cron.schedule(
  'assistant-quota-retention',
  '*/10 * * * *',
  'select assistant_private.expire_quota();'
);
