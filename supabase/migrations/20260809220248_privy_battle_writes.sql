-- Privy is the identity provider, not Supabase Auth. These identifiers are
-- written only by the Vercel API after it verifies a Privy access token.
alter table public.battles
  add column if not exists creator_privy_user_id text,
  add column if not exists opponent_privy_user_id text;

-- Preserve compatibility if this migration is applied to a non-empty early
-- development database. New rows are required to receive a verified Privy ID.
update public.battles
set creator_privy_user_id = concat('legacy:', id)
where creator_privy_user_id is null;

alter table public.battles
  alter column creator_privy_user_id set not null;

alter table public.battles
  drop constraint if exists battles_waiting_shape_check;

alter table public.battles
  add constraint battles_waiting_shape_check
  check (
    (status = 'waiting'
      and opponent_wallet is null
      and opponent_privy_user_id is null
      and token_b_mint is null)
    or status <> 'waiting'
  );

create index if not exists battles_creator_privy_user_id_idx
  on public.battles (creator_privy_user_id, created_at desc);

create index if not exists battles_opponent_privy_user_id_idx
  on public.battles (opponent_privy_user_id, created_at desc);
