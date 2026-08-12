-- Keep payouts responsive in Devnet. The work is serialized in the API, so
-- frequent scheduler ticks only pick up a battle once its escrow is due.
select cron.alter_job(
  (select jobid from cron.job where jobname = 'settle-devnet-battles-every-30-seconds'),
  schedule => '10 seconds'
);
