-- Run this file in the Supabase SQL Editor before adding the public variables.
-- Browser clients can only read. Writes must use a Vercel endpoint that verifies
-- the Privy access token; never expose SUPABASE_SERVICE_ROLE_KEY in Vite.

create extension if not exists pgcrypto;

do $$ begin
  create type public.battle_status as enum ('waiting', 'active', 'finished', 'settled', 'cancelled');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.battles (
  id uuid primary key default gen_random_uuid(),
  status public.battle_status not null default 'waiting',
  creator_privy_user_id text not null,
  creator_wallet text not null,
  opponent_privy_user_id text,
  opponent_wallet text,
  token_a_mint text not null,
  token_a_symbol text not null,
  token_a_market_cap numeric,
  token_a_change_pct numeric,
  token_b_mint text,
  token_b_symbol text,
  token_b_market_cap numeric,
  token_b_change_pct numeric,
  stake_lamports numeric(20, 0) not null check (stake_lamports > 0),
  pot_lamports numeric(20, 0) not null check (pot_lamports > 0),
  duration_seconds integer not null check (duration_seconds > 0),
  starts_at timestamptz,
  ends_at timestamptz,
  winner_mint text,
  winner_symbol text,
  escrow_state text not null default 'not_configured',
  escrow_program_id text,
  escrow_account text,
  creator_deposit_signature text,
  opponent_deposit_signature text,
  settlement_signature text,
  escrow_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'waiting' and opponent_wallet is null and opponent_privy_user_id is null and token_b_mint is null) or status <> 'waiting')
  ,check (escrow_state in ('not_configured', 'awaiting_deposits', 'funded', 'settled', 'refunded', 'error'))
);

create table if not exists public.battle_price_snapshots (
  id bigint generated always as identity primary key,
  battle_id uuid not null references public.battles(id) on delete cascade,
  captured_at timestamptz not null default now(),
  token_a_price_usd numeric not null check (token_a_price_usd >= 0),
  token_b_price_usd numeric,
  unique (battle_id, captured_at)
);

create table if not exists public.platform_fee_receipts (
  id bigint generated always as identity primary key,
  battle_id uuid not null unique references public.battles(id) on delete restrict,
  fee_lamports numeric(20, 0) not null check (fee_lamports > 0),
  fee_wallet text not null,
  settlement_signature text not null,
  status text not null default 'pending' check (status in ('pending', 'settled')),
  created_at timestamptz not null default now(),
  settled_at timestamptz
);

create index if not exists battles_status_created_at_idx on public.battles (status, created_at desc);
create index if not exists battle_price_snapshots_battle_id_captured_at_idx on public.battle_price_snapshots (battle_id, captured_at desc);
create index if not exists platform_fee_receipts_settled_at_idx on public.platform_fee_receipts (settled_at desc);
create index if not exists battles_escrow_state_idx on public.battles (escrow_state, ends_at);
create unique index if not exists battles_creator_deposit_signature_uidx
  on public.battles (creator_deposit_signature)
  where creator_deposit_signature is not null;
create unique index if not exists battles_opponent_deposit_signature_uidx
  on public.battles (opponent_deposit_signature)
  where opponent_deposit_signature is not null;

alter table public.battles enable row level security;
alter table public.battle_price_snapshots enable row level security;
alter table public.platform_fee_receipts enable row level security;

revoke all on public.battles, public.battle_price_snapshots, public.platform_fee_receipts from anon, authenticated;
grant select on public.battles, public.battle_price_snapshots to anon, authenticated;

drop policy if exists "Anyone can read battles" on public.battles;
create policy "Anyone can read battles"
  on public.battles for select to anon, authenticated using (true);

drop policy if exists "Anyone can read battle price snapshots" on public.battle_price_snapshots;
create policy "Anyone can read battle price snapshots"
  on public.battle_price_snapshots for select to anon, authenticated using (true);
