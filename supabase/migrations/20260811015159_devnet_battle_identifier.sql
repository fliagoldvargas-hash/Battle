alter table public.battles
  add column if not exists onchain_battle_id text;

create unique index if not exists battles_network_onchain_battle_id_uidx
  on public.battles (network, onchain_battle_id)
  where onchain_battle_id is not null;
