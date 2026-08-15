-- PostgREST's on_conflict target must reference a non-partial unique key.
-- PostgreSQL still permits multiple NULL values under this constraint, so
-- off-chain legacy battles without an address remain unaffected.
alter table public.battles
  add constraint battles_network_onchain_battle_address_key
  unique (network, onchain_battle_address);
