begin;

set local lock_timeout = '5s';

alter table public.battle_deposit_intents
  drop constraint battle_deposit_intents_stake_lamports_check;

-- Existing 0.013 SOL test deposits remain valid historical records. PostgreSQL
-- still enforces a NOT VALID check for every new or updated row.
alter table public.battle_deposit_intents
  add constraint battle_deposit_intents_stake_lamports_check
  check (stake_lamports between 14000000 and 10000000000)
  not valid;

commit;
