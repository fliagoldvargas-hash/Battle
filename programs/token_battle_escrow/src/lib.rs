use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};
use anchor_spl::token_interface::Mint;

declare_id!("CJisngeZUAiZCJ9Ej8ctfSsupVa5E2penz3sjYQXoh7m");

pub const LEGACY_FEE_BPS: u16 = 25;
pub const NO_HOLDER_FEE_BPS: u16 = 100;
pub const TIER_ONE_FEE_BPS: u16 = 75;
pub const TIER_TWO_FEE_BPS: u16 = 50;
pub const TIER_THREE_FEE_BPS: u16 = 25;
pub const TIER_FOUR_FEE_BPS: u16 = 10;
pub const REFUND_DELAY_SECONDS: i64 = 86_400;

#[program]
pub mod token_battle_escrow {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        fee_treasury: Pubkey,
        settlement_authority: Pubkey,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.fee_treasury = fee_treasury;
        config.settlement_authority = settlement_authority;
        config.fee_bps = LEGACY_FEE_BPS;
        Ok(())
    }

    pub fn initialize_holder_config(ctx: Context<InitializeHolderConfig>) -> Result<()> {
        let holder_config = &mut ctx.accounts.holder_config;
        holder_config.holder_mint = Pubkey::default();
        holder_config.holder_mint_decimals = 0;
        holder_config.tier_one_minimum = 1_000;
        holder_config.tier_two_minimum = 10_000;
        holder_config.tier_three_minimum = 100_000;
        holder_config.tier_four_minimum = 1_000_000;
        holder_config.no_holder_fee_bps = NO_HOLDER_FEE_BPS;
        holder_config.tier_one_fee_bps = TIER_ONE_FEE_BPS;
        holder_config.tier_two_fee_bps = TIER_TWO_FEE_BPS;
        holder_config.tier_three_fee_bps = TIER_THREE_FEE_BPS;
        holder_config.tier_four_fee_bps = TIER_FOUR_FEE_BPS;
        holder_config.bump = ctx.bumps.holder_config;
        Ok(())
    }

    pub fn set_holder_config(
        ctx: Context<SetHolderConfig>,
        holder_mint: Pubkey,
        tier_one_minimum: u64,
        tier_two_minimum: u64,
        tier_three_minimum: u64,
        tier_four_minimum: u64,
        no_holder_fee_bps: u16,
        tier_one_fee_bps: u16,
        tier_two_fee_bps: u16,
        tier_three_fee_bps: u16,
        tier_four_fee_bps: u16,
    ) -> Result<()> {
        require!(
            holder_mint != Pubkey::default(),
            EscrowError::InvalidHolderMint
        );
        require!(tier_one_minimum > 0, EscrowError::InvalidHolderTier);
        require!(
            tier_one_minimum < tier_two_minimum
                && tier_two_minimum < tier_three_minimum
                && tier_three_minimum < tier_four_minimum,
            EscrowError::InvalidHolderTier
        );
        require!(
            no_holder_fee_bps <= 10_000
                && tier_one_fee_bps <= 10_000
                && tier_two_fee_bps <= 10_000
                && tier_three_fee_bps <= 10_000
                && tier_four_fee_bps <= 10_000,
            EscrowError::InvalidHolderFee
        );
        require!(
            no_holder_fee_bps >= tier_one_fee_bps
                && tier_one_fee_bps >= tier_two_fee_bps
                && tier_two_fee_bps >= tier_three_fee_bps
                && tier_three_fee_bps >= tier_four_fee_bps,
            EscrowError::InvalidHolderFee
        );

        let holder_config = &mut ctx.accounts.holder_config;
        holder_config.holder_mint = holder_mint;
        holder_config.holder_mint_decimals = ctx.accounts.holder_mint_account.decimals;
        holder_config.tier_one_minimum = tier_one_minimum;
        holder_config.tier_two_minimum = tier_two_minimum;
        holder_config.tier_three_minimum = tier_three_minimum;
        holder_config.tier_four_minimum = tier_four_minimum;
        holder_config.no_holder_fee_bps = no_holder_fee_bps;
        holder_config.tier_one_fee_bps = tier_one_fee_bps;
        holder_config.tier_two_fee_bps = tier_two_fee_bps;
        holder_config.tier_three_fee_bps = tier_three_fee_bps;
        holder_config.tier_four_fee_bps = tier_four_fee_bps;
        Ok(())
    }

    pub fn create_battle(
        ctx: Context<CreateBattle>,
        battle_id: [u8; 16],
        token_a_mint: Pubkey,
        stake_lamports: u64,
        duration_seconds: u32,
    ) -> Result<()> {
        require!(stake_lamports > 0, EscrowError::InvalidStake);
        require!(duration_seconds > 0, EscrowError::InvalidDuration);

        let battle = &mut ctx.accounts.battle;
        battle.id = battle_id;
        battle.creator = ctx.accounts.creator.key();
        battle.opponent = Pubkey::default();
        battle.token_a_mint = token_a_mint;
        battle.token_b_mint = Pubkey::default();
        battle.stake_lamports = stake_lamports;
        battle.duration_seconds = duration_seconds;
        battle.started_at = 0;
        battle.ends_at = 0;
        battle.status = BattleStatus::Waiting;
        battle.fee_bps = ctx.accounts.holder_config.fee_bps_for(holder_balance(
            &ctx.accounts.holder_config,
            &ctx.accounts.creator.key(),
            ctx.remaining_accounts,
        )?);
        battle.fee_treasury = ctx.accounts.config.fee_treasury;
        battle.settlement_authority = ctx.accounts.config.settlement_authority;
        battle.bump = ctx.bumps.battle;
        battle.vault_bump = ctx.bumps.vault;

        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.creator.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            stake_lamports,
        )?;
        Ok(())
    }

    pub fn join_battle(ctx: Context<JoinBattle>, token_b_mint: Pubkey) -> Result<()> {
        let battle = &mut ctx.accounts.battle;
        require!(
            battle.status == BattleStatus::Waiting,
            EscrowError::BattleNotOpen
        );
        require_keys_neq!(
            battle.creator,
            ctx.accounts.opponent.key(),
            EscrowError::CreatorCannotJoin
        );
        require!(token_b_mint != battle.token_a_mint, EscrowError::SameToken);

        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.opponent.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            battle.stake_lamports,
        )?;

        let now = Clock::get()?.unix_timestamp;
        battle.opponent = ctx.accounts.opponent.key();
        battle.token_b_mint = token_b_mint;
        battle.started_at = now;
        battle.ends_at = now
            .checked_add(battle.duration_seconds as i64)
            .ok_or(EscrowError::TimestampOverflow)?;
        battle.status = BattleStatus::Active;
        Ok(())
    }

    pub fn cancel_waiting(ctx: Context<CancelWaiting>) -> Result<()> {
        require!(
            ctx.accounts.battle.status == BattleStatus::Waiting,
            EscrowError::BattleNotOpen
        );
        transfer_from_vault(
            &ctx.accounts.vault.to_account_info(),
            &ctx.accounts.creator.to_account_info(),
            ctx.accounts.battle.stake_lamports,
        )?;
        Ok(())
    }

    pub fn refund_expired(ctx: Context<RefundExpired>) -> Result<()> {
        let battle = &ctx.accounts.battle;
        require!(
            battle.status == BattleStatus::Active,
            EscrowError::BattleNotActive
        );
        let now = Clock::get()?.unix_timestamp;
        require!(
            now >= battle
                .ends_at
                .checked_add(REFUND_DELAY_SECONDS)
                .ok_or(EscrowError::TimestampOverflow)?,
            EscrowError::RefundNotAvailable
        );
        require_keys_eq!(
            battle.creator,
            ctx.accounts.creator.key(),
            EscrowError::InvalidParticipant
        );
        require_keys_eq!(
            battle.opponent,
            ctx.accounts.opponent.key(),
            EscrowError::InvalidParticipant
        );
        transfer_from_vault(
            &ctx.accounts.vault.to_account_info(),
            &ctx.accounts.creator.to_account_info(),
            battle.stake_lamports,
        )?;
        transfer_from_vault(
            &ctx.accounts.vault.to_account_info(),
            &ctx.accounts.opponent.to_account_info(),
            battle.stake_lamports,
        )?;
        Ok(())
    }

    pub fn settle_battle(ctx: Context<SettleBattle>) -> Result<()> {
        let battle = &ctx.accounts.battle;
        require!(
            battle.status == BattleStatus::Active,
            EscrowError::BattleNotActive
        );
        require_keys_eq!(
            battle.settlement_authority,
            ctx.accounts.settlement_authority.key(),
            EscrowError::InvalidSettlementAuthority
        );
        require_keys_eq!(
            battle.fee_treasury,
            ctx.accounts.fee_treasury.key(),
            EscrowError::InvalidFeeTreasury
        );
        require!(
            ctx.accounts.winner.key() == battle.creator
                || ctx.accounts.winner.key() == battle.opponent,
            EscrowError::InvalidWinner
        );
        let now = Clock::get()?.unix_timestamp;
        require!(now >= battle.ends_at, EscrowError::BattleNotFinished);

        let pot = battle
            .stake_lamports
            .checked_mul(2)
            .ok_or(EscrowError::TimestampOverflow)?;
        let fee = pot
            .checked_mul(battle.fee_bps as u64)
            .ok_or(EscrowError::TimestampOverflow)?
            / 10_000;
        let payout = pot
            .checked_sub(fee)
            .ok_or(EscrowError::InsufficientVaultBalance)?;
        transfer_from_vault(
            &ctx.accounts.vault.to_account_info(),
            &ctx.accounts.winner.to_account_info(),
            payout,
        )?;
        transfer_from_vault(
            &ctx.accounts.vault.to_account_info(),
            &ctx.accounts.fee_treasury.to_account_info(),
            fee,
        )?;
        Ok(())
    }
}

fn transfer_from_vault(vault: &AccountInfo, recipient: &AccountInfo, amount: u64) -> Result<()> {
    let vault_balance = vault.lamports();
    require!(
        vault_balance >= amount,
        EscrowError::InsufficientVaultBalance
    );
    **vault.try_borrow_mut_lamports()? = vault_balance
        .checked_sub(amount)
        .ok_or(EscrowError::InsufficientVaultBalance)?;
    **recipient.try_borrow_mut_lamports()? = recipient
        .lamports()
        .checked_add(amount)
        .ok_or(EscrowError::TimestampOverflow)?;
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, seeds = [b"config"], bump, space = 8 + Config::INIT_SPACE)]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(battle_id: [u8; 16])]
pub struct CreateBattle<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    #[account(seeds = [b"holder-config"], bump = holder_config.bump)]
    pub holder_config: Account<'info, HolderConfig>,
    #[account(init, payer = creator, seeds = [b"battle", battle_id.as_ref()], bump, space = 8 + Battle::INIT_SPACE)]
    pub battle: Account<'info, Battle>,
    #[account(init, payer = creator, seeds = [b"vault", battle.key().as_ref()], bump, space = 8 + Vault::INIT_SPACE)]
    pub vault: Account<'info, Vault>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeHolderConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [b"config"], bump, has_one = admin)]
    pub config: Account<'info, Config>,
    #[account(init, payer = admin, seeds = [b"holder-config"], bump, space = 8 + HolderConfig::INIT_SPACE)]
    pub holder_config: Account<'info, HolderConfig>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(holder_mint: Pubkey)]
pub struct SetHolderConfig<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [b"config"], bump, has_one = admin)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"holder-config"], bump = holder_config.bump)]
    pub holder_config: Account<'info, HolderConfig>,
    #[account(address = holder_mint)]
    pub holder_mint_account: InterfaceAccount<'info, Mint>,
}

#[derive(Accounts)]
pub struct JoinBattle<'info> {
    #[account(mut)]
    pub opponent: Signer<'info>,
    #[account(mut, seeds = [b"battle", battle.id.as_ref()], bump = battle.bump)]
    pub battle: Account<'info, Battle>,
    #[account(mut, seeds = [b"vault", battle.key().as_ref()], bump = battle.vault_bump)]
    pub vault: Account<'info, Vault>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelWaiting<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(mut, close = creator, has_one = creator, seeds = [b"battle", battle.id.as_ref()], bump = battle.bump)]
    pub battle: Account<'info, Battle>,
    #[account(mut, close = creator, seeds = [b"vault", battle.key().as_ref()], bump = battle.vault_bump)]
    pub vault: Account<'info, Vault>,
}

#[derive(Accounts)]
pub struct RefundExpired<'info> {
    pub caller: Signer<'info>,
    #[account(mut)]
    pub creator: SystemAccount<'info>,
    #[account(mut)]
    pub opponent: SystemAccount<'info>,
    #[account(mut, close = creator, seeds = [b"battle", battle.id.as_ref()], bump = battle.bump)]
    pub battle: Account<'info, Battle>,
    #[account(mut, close = creator, seeds = [b"vault", battle.key().as_ref()], bump = battle.vault_bump)]
    pub vault: Account<'info, Vault>,
}

#[derive(Accounts)]
pub struct SettleBattle<'info> {
    pub settlement_authority: Signer<'info>,
    #[account(mut)]
    pub winner: SystemAccount<'info>,
    #[account(mut)]
    pub fee_treasury: SystemAccount<'info>,
    #[account(mut, close = creator, seeds = [b"battle", battle.id.as_ref()], bump = battle.bump)]
    pub battle: Account<'info, Battle>,
    #[account(mut, close = creator, seeds = [b"vault", battle.key().as_ref()], bump = battle.vault_bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut, address = battle.creator)]
    pub creator: SystemAccount<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub fee_treasury: Pubkey,
    pub settlement_authority: Pubkey,
    pub fee_bps: u16,
}

#[account]
#[derive(InitSpace)]
pub struct HolderConfig {
    pub holder_mint: Pubkey,
    pub holder_mint_decimals: u8,
    pub tier_one_minimum: u64,
    pub tier_two_minimum: u64,
    pub tier_three_minimum: u64,
    pub tier_four_minimum: u64,
    pub no_holder_fee_bps: u16,
    pub tier_one_fee_bps: u16,
    pub tier_two_fee_bps: u16,
    pub tier_three_fee_bps: u16,
    pub tier_four_fee_bps: u16,
    pub bump: u8,
}

impl HolderConfig {
    pub fn fee_bps_for(&self, balance: u64) -> u16 {
        if self.holder_mint == Pubkey::default() {
            return self.no_holder_fee_bps;
        }
        if balance >= self.tier_four_minimum {
            return self.tier_four_fee_bps;
        }
        if balance >= self.tier_three_minimum {
            return self.tier_three_fee_bps;
        }
        if balance >= self.tier_two_minimum {
            return self.tier_two_fee_bps;
        }
        if balance >= self.tier_one_minimum {
            return self.tier_one_fee_bps;
        }
        self.no_holder_fee_bps
    }
}

fn holder_balance(
    holder_config: &HolderConfig,
    creator: &Pubkey,
    accounts: &[AccountInfo],
) -> Result<u64> {
    if holder_config.holder_mint == Pubkey::default() {
        return Ok(0);
    }

    let mut total = 0_u64;
    for account in accounts {
        require!(
            account.owner == &anchor_spl::token::ID || account.owner == &anchor_spl::token_2022::ID,
            EscrowError::InvalidHolderTokenAccount
        );
        let data = account.try_borrow_data()?;
        require!(
            data.len() >= 109 && data[108] != 0,
            EscrowError::InvalidHolderTokenAccount
        );

        let mut mint_bytes = [0_u8; 32];
        mint_bytes.copy_from_slice(&data[0..32]);
        let mut owner_bytes = [0_u8; 32];
        owner_bytes.copy_from_slice(&data[32..64]);
        let mut amount_bytes = [0_u8; 8];
        amount_bytes.copy_from_slice(&data[64..72]);

        require_keys_eq!(
            Pubkey::new_from_array(mint_bytes),
            holder_config.holder_mint,
            EscrowError::InvalidHolderTokenAccount
        );
        require_keys_eq!(
            Pubkey::new_from_array(owner_bytes),
            *creator,
            EscrowError::InvalidHolderTokenAccount
        );
        total = total
            .checked_add(u64::from_le_bytes(amount_bytes))
            .ok_or(EscrowError::HolderBalanceOverflow)?;
    }
    Ok(total)
}

#[account]
#[derive(InitSpace)]
pub struct Vault {}

#[account]
#[derive(InitSpace)]
pub struct Battle {
    pub id: [u8; 16],
    pub creator: Pubkey,
    pub opponent: Pubkey,
    pub token_a_mint: Pubkey,
    pub token_b_mint: Pubkey,
    pub stake_lamports: u64,
    pub duration_seconds: u32,
    pub started_at: i64,
    pub ends_at: i64,
    pub status: BattleStatus,
    pub fee_bps: u16,
    pub fee_treasury: Pubkey,
    pub settlement_authority: Pubkey,
    pub bump: u8,
    pub vault_bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum BattleStatus {
    Waiting,
    Active,
    Settled,
    Cancelled,
    Refunded,
}

#[error_code]
pub enum EscrowError {
    #[msg("Stake must be greater than zero.")]
    InvalidStake,
    #[msg("Battle duration must be greater than zero.")]
    InvalidDuration,
    #[msg("This battle is not open for joining.")]
    BattleNotOpen,
    #[msg("The creator cannot join their own battle.")]
    CreatorCannotJoin,
    #[msg("Both battle tokens must be different.")]
    SameToken,
    #[msg("This battle is not active.")]
    BattleNotActive,
    #[msg("The technical refund window has not opened.")]
    RefundNotAvailable,
    #[msg("Battle participant does not match the account provided.")]
    InvalidParticipant,
    #[msg("Vault does not contain the expected funds.")]
    InsufficientVaultBalance,
    #[msg("Timestamp arithmetic overflowed.")]
    TimestampOverflow,
    #[msg("The settlement signer is not authorized for this battle.")]
    InvalidSettlementAuthority,
    #[msg("The supplied fee treasury does not match this battle.")]
    InvalidFeeTreasury,
    #[msg("The winner must be one of the battle participants.")]
    InvalidWinner,
    #[msg("This battle has not ended yet.")]
    BattleNotFinished,
    #[msg("The holder mint must be a valid Solana token mint.")]
    InvalidHolderMint,
    #[msg("Holder tier minimums must be positive and strictly increasing.")]
    InvalidHolderTier,
    #[msg("Holder fee rates must be decreasing and no greater than 100%.")]
    InvalidHolderFee,
    #[msg("A supplied holder token account is invalid for this wallet and mint.")]
    InvalidHolderTokenAccount,
    #[msg("Holder token balance overflowed.")]
    HolderBalanceOverflow,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn holder_config(mint: Pubkey) -> HolderConfig {
        HolderConfig {
            holder_mint: mint,
            holder_mint_decimals: 6,
            tier_one_minimum: 1_000_000_000,
            tier_two_minimum: 10_000_000_000,
            tier_three_minimum: 100_000_000_000,
            tier_four_minimum: 1_000_000_000_000,
            no_holder_fee_bps: 100,
            tier_one_fee_bps: 75,
            tier_two_fee_bps: 50,
            tier_three_fee_bps: 25,
            tier_four_fee_bps: 10,
            bump: 255,
        }
    }

    #[test]
    fn holder_fee_tiers_are_selected_from_the_highest_matching_balance() {
        let config = holder_config(Pubkey::new_unique());
        assert_eq!(config.fee_bps_for(999_999_999), 100);
        assert_eq!(config.fee_bps_for(1_000_000_000), 75);
        assert_eq!(config.fee_bps_for(10_000_000_000), 50);
        assert_eq!(config.fee_bps_for(100_000_000_000), 25);
        assert_eq!(config.fee_bps_for(1_000_000_000_000), 10);
    }

    #[test]
    fn disabled_holder_config_keeps_the_standard_rate() {
        let config = holder_config(Pubkey::default());
        assert_eq!(config.fee_bps_for(u64::MAX), 100);
    }
}
