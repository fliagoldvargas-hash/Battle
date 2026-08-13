-- Mainnet treasury mode is custodial: this table is intentionally private and
-- is only read or written with the server service role after Privy auth.
create table if not exists public.protocol_fee_schedules (
  singleton boolean primary key default true check (singleton),
  holder_mint text,
  holder_mint_decimals integer not null default 0 check (holder_mint_decimals between 0 and 18),
  tier_one_minimum numeric(20, 0) not null default 1000 check (tier_one_minimum > 0),
  tier_two_minimum numeric(20, 0) not null default 10000 check (tier_two_minimum > tier_one_minimum),
  tier_three_minimum numeric(20, 0) not null default 100000 check (tier_three_minimum > tier_two_minimum),
  tier_four_minimum numeric(20, 0) not null default 1000000 check (tier_four_minimum > tier_three_minimum),
  no_holder_fee_bps smallint not null default 100 check (no_holder_fee_bps between 0 and 10000),
  tier_one_fee_bps smallint not null default 75 check (tier_one_fee_bps between 0 and no_holder_fee_bps),
  tier_two_fee_bps smallint not null default 50 check (tier_two_fee_bps between 0 and tier_one_fee_bps),
  tier_three_fee_bps smallint not null default 25 check (tier_three_fee_bps between 0 and tier_two_fee_bps),
  tier_four_fee_bps smallint not null default 10 check (tier_four_fee_bps between 0 and tier_three_fee_bps),
  updated_by_wallet text,
  updated_at timestamptz not null default now()
);

insert into public.protocol_fee_schedules (singleton)
values (true)
on conflict (singleton) do nothing;

alter table public.protocol_fee_schedules enable row level security;
revoke all on public.protocol_fee_schedules from anon, authenticated;

alter table public.battles
  add column if not exists settlement_reference_id text,
  add column if not exists settlement_submitted_at timestamptz,
  add column if not exists payout_lamports numeric(20, 0),
  add column if not exists join_reservation_token uuid,
  add column if not exists join_reservation_wallet text,
  add column if not exists join_reservation_expires_at timestamptz;

alter table public.battles
  drop constraint if exists battles_escrow_state_check;

alter table public.battles
  add constraint battles_escrow_state_check
  check (escrow_state in (
    'not_configured', 'awaiting_deposits', 'funded', 'payment_pending',
    'payment_submitted', 'settled', 'refunded', 'review_required', 'error'
  ));

create unique index if not exists battles_settlement_reference_id_uidx
  on public.battles (settlement_reference_id)
  where settlement_reference_id is not null;

create index if not exists battles_treasury_pending_idx
  on public.battles (network, status, escrow_state, ends_at)
  where network = 'mainnet';
