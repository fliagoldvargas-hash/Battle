-- A deposit is first reserved server-side. This lets a player safely retry
-- confirmation after a wallet/RPC timeout without sending a second transfer.
create table if not exists public.battle_deposit_intents (
  id uuid primary key default gen_random_uuid(),
  network text not null check (network in ('mainnet', 'devnet')),
  action text not null check (action in ('create', 'join')),
  battle_id uuid references public.battles(id) on delete cascade,
  privy_user_id text not null,
  wallet_address text not null,
  token_mint text,
  token_symbol text,
  token_market_cap numeric,
  stake_lamports numeric(20, 0) not null check (stake_lamports between 100000000 and 10000000000),
  duration_seconds integer,
  fee_bps smallint,
  deposit_signature text unique,
  consumed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  check ((action = 'create' and battle_id is null and token_mint is not null and duration_seconds is not null and fee_bps is not null)
    or (action = 'join' and battle_id is not null and token_mint is null and duration_seconds is null and fee_bps is null))
);

create index if not exists battle_deposit_intents_lookup_idx
  on public.battle_deposit_intents (network, action, wallet_address, expires_at desc);

alter table public.battle_deposit_intents enable row level security;
revoke all on public.battle_deposit_intents from anon, authenticated;
