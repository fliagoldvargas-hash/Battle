begin;

set local lock_timeout = '5s';

alter table public.battle_deposit_intents
  drop constraint battle_deposit_intents_stake_lamports_check;

alter table public.battle_deposit_intents
  add constraint battle_deposit_intents_stake_lamports_check
  check (stake_lamports between 13000000 and 10000000000);

commit;
