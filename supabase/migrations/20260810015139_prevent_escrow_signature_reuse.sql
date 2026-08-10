-- A finalized transfer can fund only one battle. These indexes prevent a
-- replayed deposit signature from being attached to multiple battles.
create unique index if not exists battles_creator_deposit_signature_uidx
  on public.battles (creator_deposit_signature)
  where creator_deposit_signature is not null;

create unique index if not exists battles_opponent_deposit_signature_uidx
  on public.battles (opponent_deposit_signature)
  where opponent_deposit_signature is not null;
