create table public.platform_fee_receipts (
  id bigint generated always as identity primary key,
  battle_id uuid not null unique references public.battles(id) on delete restrict,
  fee_lamports numeric(20, 0) not null check (fee_lamports > 0),
  fee_wallet text not null,
  settlement_signature text not null,
  status text not null default 'pending' check (status in ('pending', 'settled')),
  created_at timestamptz not null default now(),
  settled_at timestamptz
);

create index platform_fee_receipts_settled_at_idx
  on public.platform_fee_receipts (settled_at desc);

alter table public.platform_fee_receipts enable row level security;
revoke all on public.platform_fee_receipts from anon, authenticated;
