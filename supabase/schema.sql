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
  creator_wallet text not null,
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'waiting' and opponent_wallet is null and token_b_mint is null) or status <> 'waiting')
);

create table if not exists public.battle_price_snapshots (
  id bigint generated always as identity primary key,
  battle_id uuid not null references public.battles(id) on delete cascade,
  captured_at timestamptz not null default now(),
  token_a_price_usd numeric not null check (token_a_price_usd >= 0),
  token_b_price_usd numeric,
  unique (battle_id, captured_at)
);

create index if not exists battles_status_created_at_idx on public.battles (status, created_at desc);
create index if not exists battle_price_snapshots_battle_id_captured_at_idx on public.battle_price_snapshots (battle_id, captured_at desc);

alter table public.battles enable row level security;
alter table public.battle_price_snapshots enable row level security;

revoke all on public.battles, public.battle_price_snapshots from anon, authenticated;
grant select on public.battles, public.battle_price_snapshots to anon, authenticated;

drop policy if exists "Anyone can read battles" on public.battles;
create policy "Anyone can read battles"
  on public.battles for select to anon, authenticated using (true);

drop policy if exists "Anyone can read battle price snapshots" on public.battle_price_snapshots;
create policy "Anyone can read battle price snapshots"
  on public.battle_price_snapshots for select to anon, authenticated using (true);
