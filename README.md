# Token Battle

Solana escrow battles with a holder-based platform-fee schedule.

## Holder fee administration

The contract stores the holder-token mint and the complete fee schedule on-chain. A battle reads the creator's verified SPL or Token-2022 balance when it is created and stores the resulting basis-point fee in that battle. Later balance or schedule changes do not affect it.

Set `PROTOCOL_ADMIN_WALLET` in Vercel to the public Solana address that is permitted to administer the protocol. That wallet must connect through Privy and can then open **Protocol status** to initialize (once) and load the token CA and four thresholds. The server verifies the Privy session and linked wallet before requesting the on-chain update through the protocol authority.

For Devnet, set the variable only in the Preview environment. Before Mainnet, deploy a separately audited program and configure the Mainnet RPC, program id, authority, fee treasury, and a Mainnet-specific `PROTOCOL_ADMIN_WALLET`.
