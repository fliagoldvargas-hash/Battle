-- Run the Devnet oracle independently of Vercel's Hobby daily cron and
-- GitHub Actions' best-effort scheduler. Postgres is always available, and
-- pg_cron supports a 30 second interval on this project version.
create extension if not exists pg_net;
create extension if not exists pg_cron;

select cron.schedule(
  'settle-devnet-battles-every-minute',
  '* * * * *',
  $job$
    select net.http_get(
      url := 'https://battle-git-escrow-devnet-fliagoldvargas-1644s-projects.vercel.app/api/cron/battles',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'devnet_oracle_cron_secret'
        )
      ),
      timeout_milliseconds := 20000
    );
  $job$
);
