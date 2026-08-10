-- Escrow metadata is written by the verified server API after an on-chain
-- program confirms each deposit and settlement transaction.
alter table public.battles
  add column if not exists escrow_state text not null default 'not_configured',
  add column if not exists escrow_program_id text,
  add column if not exists escrow_account text,
  add column if not exists creator_deposit_signature text,
  add column if not exists opponent_deposit_signature text,
  add column if not exists settlement_signature text,
  add column if not exists escrow_error text;

alter table public.battles
  drop constraint if exists battles_escrow_state_check;

alter table public.battles
  add constraint battles_escrow_state_check
  check (escrow_state in ('not_configured', 'awaiting_deposits', 'funded', 'settled', 'refunded', 'error'));

create index if not exists battles_escrow_state_idx
  on public.battles (escrow_state, ends_at);
