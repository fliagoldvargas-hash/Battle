use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};

declare_id!("8BbDmAQ6ZAuhKVZurkJdmnnrmg6X4QkAtQ8oFiKeX7Ff");

pub const FEE_BPS: u16 = 25;
pub const REFUND_DELAY_SECONDS: i64 = 86_400;

#[program]
pub mod token_battle_escrow {
    use super::*;

    pub fn initialize_config(ctx: Context<InitializeConfig>, fee_treasury: Pubkey, settlement_authority: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.fee_treasury = fee_treasury;
        config.settlement_authority = settlement_authority;
        config.fee_bps = FEE_BPS;
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
        battle.fee_bps = ctx.accounts.config.fee_bps;
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
        require!(battle.status == BattleStatus::Waiting, EscrowError::BattleNotOpen);
        require_keys_neq!(battle.creator, ctx.accounts.opponent.key(), EscrowError::CreatorCannotJoin);
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
        battle.ends_at = now.checked_add(battle.duration_seconds as i64).ok_or(EscrowError::TimestampOverflow)?;
        battle.status = BattleStatus::Active;
        Ok(())
    }

    pub fn cancel_waiting(ctx: Context<CancelWaiting>) -> Result<()> {
        require!(ctx.accounts.battle.status == BattleStatus::Waiting, EscrowError::BattleNotOpen);
        transfer_from_vault(&ctx.accounts.vault.to_account_info(), &ctx.accounts.creator.to_account_info(), ctx.accounts.battle.stake_lamports)?;
        Ok(())
    }

    pub fn refund_expired(ctx: Context<RefundExpired>) -> Result<()> {
        let battle = &ctx.accounts.battle;
        require!(battle.status == BattleStatus::Active, EscrowError::BattleNotActive);
        let now = Clock::get()?.unix_timestamp;
        require!(now >= battle.ends_at.checked_add(REFUND_DELAY_SECONDS).ok_or(EscrowError::TimestampOverflow)?, EscrowError::RefundNotAvailable);
        require_keys_eq!(battle.creator, ctx.accounts.creator.key(), EscrowError::InvalidParticipant);
        require_keys_eq!(battle.opponent, ctx.accounts.opponent.key(), EscrowError::InvalidParticipant);
        transfer_from_vault(&ctx.accounts.vault.to_account_info(), &ctx.accounts.creator.to_account_info(), battle.stake_lamports)?;
        transfer_from_vault(&ctx.accounts.vault.to_account_info(), &ctx.accounts.opponent.to_account_info(), battle.stake_lamports)?;
        Ok(())
    }
}

fn transfer_from_vault(vault: &AccountInfo, recipient: &AccountInfo, amount: u64) -> Result<()> {
    let vault_balance = vault.lamports();
    require!(vault_balance >= amount, EscrowError::InsufficientVaultBalance);
    **vault.try_borrow_mut_lamports()? = vault_balance.checked_sub(amount).ok_or(EscrowError::InsufficientVaultBalance)?;
    **recipient.try_borrow_mut_lamports()? = recipient.lamports().checked_add(amount).ok_or(EscrowError::TimestampOverflow)?;
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
    #[account(init, payer = creator, seeds = [b"battle", battle_id.as_ref()], bump, space = 8 + Battle::INIT_SPACE)]
    pub battle: Account<'info, Battle>,
    #[account(init, payer = creator, seeds = [b"vault", battle.key().as_ref()], bump, space = 8 + Vault::INIT_SPACE)]
    pub vault: Account<'info, Vault>,
    pub system_program: Program<'info, System>,
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
pub enum BattleStatus { Waiting, Active, Settled, Cancelled, Refunded }

#[error_code]
pub enum EscrowError {
    #[msg("Stake must be greater than zero.")] InvalidStake,
    #[msg("Battle duration must be greater than zero.")] InvalidDuration,
    #[msg("This battle is not open for joining.")] BattleNotOpen,
    #[msg("The creator cannot join their own battle.")] CreatorCannotJoin,
    #[msg("Both battle tokens must be different.")] SameToken,
    #[msg("This battle is not active.")] BattleNotActive,
    #[msg("The technical refund window has not opened.")] RefundNotAvailable,
    #[msg("Battle participant does not match the account provided.")] InvalidParticipant,
    #[msg("Vault does not contain the expected funds.")] InsufficientVaultBalance,
    #[msg("Timestamp arithmetic overflowed.")] TimestampOverflow,
}
