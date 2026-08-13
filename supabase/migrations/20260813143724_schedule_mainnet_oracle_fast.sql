-- Mainnet uses an independent scheduler and Vault secret. It never calls the
-- Devnet preview, so a Mainnet settlement cannot be signed by Devnet settings.
create extension if not exists pg_net;
create extension if not exists pg_cron;

select cron.unschedule(jobid)
from cron.job
where jobname = 'settle-mainnet-battles-every-30-seconds';

select cron.schedule(
  'settle-mainnet-battles-every-30-seconds',
  '30 seconds',
  $job$
    select net.http_get(
      url := 'https://vantaagents.fun/api/cron/battles',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'mainnet_oracle_cron_secret'
        )
      ),
      timeout_milliseconds := 20000
    );
  $job$
);
