-- Creator cancellations use their own states so the payout reconciler can
-- never mistake a one-player refund for a completed two-player settlement.
alter table public.battles
  drop constraint if exists battles_escrow_state_check;

alter table public.battles
  add constraint battles_escrow_state_check
  check (escrow_state in (
    'not_configured', 'awaiting_deposits', 'funded', 'payment_pending',
    'payment_submitted', 'refund_pending', 'refund_submitted', 'settled',
    'refunded', 'review_required', 'error'
  ));

