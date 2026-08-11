alter table public.battles
  add column if not exists network text not null default 'mainnet',
  add column if not exists onchain_battle_address text,
  add column if not exists onchain_battle_id text,
  add column if not exists vault_address text;

alter table public.battles
  drop constraint if exists battles_network_check;

alter table public.battles
  add constraint battles_network_check check (network in ('mainnet', 'devnet'));

create unique index if not exists battles_network_onchain_battle_address_uidx
  on public.battles (network, onchain_battle_address)
  where onchain_battle_address is not null;
create unique index if not exists battles_network_onchain_battle_id_uidx
  on public.battles (network, onchain_battle_id)
  where onchain_battle_id is not null;

create index if not exists battles_network_status_created_at_idx
  on public.battles (network, status, created_at desc);
