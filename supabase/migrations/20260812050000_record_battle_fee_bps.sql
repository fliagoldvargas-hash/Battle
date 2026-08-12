-- The escrow snapshots the fee rate when a battle is created. Persist that
-- value so history, winner payouts, and fee receipts remain auditable even
-- after the holder schedule changes.
alter table public.battles
  add column if not exists fee_bps smallint not null default 25
  check (fee_bps between 0 and 10000);

comment on column public.battles.fee_bps is
  'Fee rate snapshotted from the on-chain battle account, in basis points.';
