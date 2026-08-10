-- Run once in the Supabase SQL Editor for the production project.
-- The values are stored in Vault, not in this repository.
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Replace the second argument with the current Vercel CRON_SECRET value.
select vault.create_secret('https://www.vantaagents.fun/api/cron/battles', 'battle_cron_url');
select vault.create_secret('REPLACE_WITH_VERCEL_CRON_SECRET', 'battle_cron_secret');

do $$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id from cron.job where jobname = 'battle-settlement';
  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;
end
$$;

select cron.schedule(
  'battle-settlement',
  '*/5 * * * *',
  $$
    select net.http_get(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'battle_cron_url'),
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'battle_cron_secret')
      )
    );
  $$
);
