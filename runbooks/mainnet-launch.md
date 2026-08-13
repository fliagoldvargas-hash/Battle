# Mainnet launch runbook

This branch is intentionally separate from `escrow-devnet`. The Devnet program, Devnet authority, Supabase Devnet scheduler and preview deployment must remain running while this checklist is completed.

## Mainnet identities

The local WSL key directory is `/root/.config/solana/token-battle-mainnet/`. It contains four distinct private keys and is outside Git:

- `program.json` — Program address: `CJisngeZUAiZCJ9Ej8ctfSsupVa5E2penz3sjYQXoh7m`.
- `deployer.json` — pays the program deployment.
- `upgrade-authority.json` — retains the ability to upgrade the deployed program; do not place this key in Vercel.
- `operator.json` — becomes the on-chain config admin and settlement signer; its JSON is stored only as Vercel's encrypted `ORACLE_SETTLEMENT_AUTHORITY_SECRET`.

Back up these files before funding or deploying. Fund `deployer.json` with the amount required by the Mainnet deployment and fund `operator.json` with a small SOL balance to pay settlement transaction fees. Neither wallet is a user-fund treasury.

## Deploy and initialize

Run from WSL at the repository root after funding, never with the Devnet wallet:

```sh
anchor build
solana program deploy --url mainnet-beta \
  --keypair /root/.config/solana/token-battle-mainnet/deployer.json \
  --program-id /root/.config/solana/token-battle-mainnet/program.json \
  --upgrade-authority /root/.config/solana/token-battle-mainnet/upgrade-authority.json \
  target/deploy/token_battle_escrow.so

export ESCROW_PROGRAM_ID=CJisngeZUAiZCJ9Ej8ctfSsupVa5E2penz3sjYQXoh7m
export ESCROW_FEE_TREASURY_ADDRESS=HokiRpvfevAAbeKEWuSRZzgwY1eR3YYQf9edoK9cQ5AN
export ESCROW_SETTLEMENT_AUTHORITY=3jSdQrSX6Q7KcTqVCt1ZoofcZ5ZLkLFkZK6DLmezNAv3
export SOLANA_MAINNET_OPERATOR_PATH=/root/.config/solana/token-battle-mainnet/operator.json
node scripts/initialize-mainnet.mjs
node scripts/verify-mainnet-config.mjs
```

`initialize-mainnet.mjs` is idempotent. It creates the config and default holder-fee PDA only once. Before the project token exists, the default rate remains 1%; after launch, the protocol-admin panel sets the real Mainnet CA and the existing 1%, 0.75%, 0.5%, 0.25%, 0.1% tiers.

## Vercel and Supabase

Set these in Vercel for the `mainnet-release` Preview branch first, then copy them to Production only after the low-value test succeeds:

```text
BATTLE_NETWORK=mainnet
VITE_BATTLE_NETWORK=mainnet
ESCROW_PROGRAM_ID=CJisngeZUAiZCJ9Ej8ctfSsupVa5E2penz3sjYQXoh7m
VITE_ESCROW_PROGRAM_ID=CJisngeZUAiZCJ9Ej8ctfSsupVa5E2penz3sjYQXoh7m
SOLANA_RPC_URL=<reliable Mainnet RPC URL>
VITE_SOLANA_RPC_URL=<same reliable Mainnet RPC URL>
ORACLE_SETTLEMENT_AUTHORITY_SECRET=<contents of operator.json>
PROTOCOL_ADMIN_WALLET=8CgfmTVP1tk8tdTcounQf14phJaVLqfwpuPkGRjQXSpy
ESCROW_FEE_TREASURY_ADDRESS=HokiRpvfevAAbeKEWuSRZzgwY1eR3YYQf9edoK9cQ5AN
VITE_ESCROW_FEE_TREASURY_ADDRESS=HokiRpvfevAAbeKEWuSRZzgwY1eR3YYQf9edoK9cQ5AN
CRON_SECRET=<new random Mainnet-only secret>
```

Store the exact `CRON_SECRET` value in Supabase Vault as `mainnet_oracle_cron_secret`, then apply `supabase/migrations/20260813143724_schedule_mainnet_oracle_fast.sql`. That job calls only `https://vantaagents.fun/api/cron/battles` every 30 seconds.

Configure both `vantaagents.fun` and its Preview hostname in Privy Allowed Origins before testing wallet login.

## Release verification

Use two project-controlled wallets, each funded only with the minimum test stake plus fees. Create and join a one-minute battle through the Preview URL. Confirm all of the following before merging this branch into `main`:

1. Both deposits reach the derived battle vault on Mainnet.
2. The Supabase battle row has `network = mainnet`, `escrow_state = funded`, and both deposit signatures.
3. Within the next scheduler cycle after the end time, Solana Explorer shows one settlement transaction paying the winner and `HokiRpvfevAAbeKEWuSRZzgwY1eR3YYQf9edoK9cQ5AN`.
4. The battle is `settled`, its fee receipt is `settled`, and their settlement signatures match.
5. Wallet connect, disconnect, create, join, cancel and expired refund paths work on the Preview URL.

Only then merge `mainnet-release` to `main`, set the same variables for Production, deploy and repeat that one low-value Mainnet battle on `https://vantaagents.fun`.
