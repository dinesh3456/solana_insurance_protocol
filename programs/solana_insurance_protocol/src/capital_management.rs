use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::{ProtocolState, ErrorCode};

// Capital pool types
pub const CAPITAL_POOL_LOW_RISK: u8 = 1;
pub const CAPITAL_POOL_MEDIUM_RISK: u8 = 2;
pub const CAPITAL_POOL_HIGH_RISK: u8 = 3;

#[account]
pub struct CapitalPool {
    pub pool_type: u8,
    pub total_capital: u64,
    pub available_capital: u64,
    pub reserved_capital: u64,
    pub yield_rate_bps: u64,
    pub token_mint: Pubkey,
    pub token_account: Pubkey,
    pub authority: Pubkey,
    pub bump: u8,
}

impl CapitalPool {
    pub const SIZE: usize = 8 +    // discriminator
                           1 +     // pool_type
                           8 +     // total_capital
                           8 +     // available_capital
                           8 +     // reserved_capital
                           8 +     // yield_rate_bps
                           32 +    // token_mint
                           32 +    // token_account
                           32 +    // authority
                           1;      // bump
}

#[account]
pub struct CapitalProvider {
    pub owner: Pubkey,
    pub capital_amount: u64,
    pub pool: Pubkey,
    pub rewards_earned: u64,
    pub deposit_time: i64,
    pub bump: u8,
}

impl CapitalProvider {
    pub const SIZE: usize = 8 +    // discriminator
                           32 +    // owner
                           8 +     // capital_amount
                           32 +    // pool
                           8 +     // rewards_earned
                           8 +     // deposit_time
                           1;      // bump
}

pub fn initialize_capital_pool(
    ctx: Context<InitializeCapitalPool>,
    pool_type: u8,
    yield_rate_bps: u64,
) -> Result<()> {
    let capital_pool = &mut ctx.accounts.capital_pool;
    
    require!(
        pool_type == CAPITAL_POOL_LOW_RISK || 
        pool_type == CAPITAL_POOL_MEDIUM_RISK || 
        pool_type == CAPITAL_POOL_HIGH_RISK,
        ErrorCode::InvalidPoolType
    );
    
    capital_pool.pool_type = pool_type;
    capital_pool.total_capital = 0;
    capital_pool.available_capital = 0;
    capital_pool.reserved_capital = 0;
    capital_pool.yield_rate_bps = yield_rate_bps;
    capital_pool.token_mint = ctx.accounts.token_mint.key();
    capital_pool.token_account = ctx.accounts.pool_token_account.key();
    capital_pool.authority = ctx.accounts.authority.key();
    capital_pool.bump = ctx.bumps.capital_pool;
    
    Ok(())
}

pub fn provide_capital(
    ctx: Context<ProvideCapital>,
    amount: u64,
) -> Result<()> {
    let capital_provider = &mut ctx.accounts.capital_provider;
    let pool_key = ctx.accounts.capital_pool.key();
    let capital_pool = &mut ctx.accounts.capital_pool;
    let clock = Clock::get()?;
    
    // Initialize the capital provider account
    capital_provider.owner = ctx.accounts.owner.key();
    capital_provider.capital_amount = amount;
    capital_provider.pool = pool_key; 
    capital_provider.rewards_earned = 0;
    capital_provider.deposit_time = clock.unix_timestamp;
    capital_provider.bump = ctx.bumps.capital_provider;
    
    // Update the capital pool
    capital_pool.total_capital = capital_pool.total_capital.checked_add(amount).unwrap();
    capital_pool.available_capital = capital_pool.available_capital.checked_add(amount).unwrap();
    
    // Transfer funds from the provider's token account to the pool's token account
    let cpi_accounts = Transfer {
        from: ctx.accounts.provider_token.to_account_info(),
        to: ctx.accounts.pool_token_account.to_account_info(),
        authority: ctx.accounts.owner.to_account_info(),
    };
    
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    
    token::transfer(cpi_ctx, amount)?;
    
    Ok(())
}

pub fn withdraw_capital(
    ctx: Context<WithdrawCapital>,
    amount: u64,
) -> Result<()> {
    let capital_provider = &mut ctx.accounts.capital_provider;
    let capital_pool = &mut ctx.accounts.capital_pool;
    let clock = Clock::get()?;
    
    // Calculate rewards based on time and yield rate
    let time_held = clock.unix_timestamp - capital_provider.deposit_time;
    let days_held = std::cmp::max(time_held / 86400, 1) as u64; // At least 1 day
    
    let annual_yield = (capital_provider.capital_amount * capital_pool.yield_rate_bps) / 10000;
    let daily_yield = annual_yield / 365;
    let rewards = daily_yield * days_held;
    
    // Update rewards earned
    capital_provider.rewards_earned = capital_provider.rewards_earned.checked_add(rewards).unwrap();
    
    // Check if there's enough available capital
    require!(
        capital_pool.available_capital >= amount,
        ErrorCode::InsufficientPoolCapital
    );
    
    // Check if the provider has enough capital
    require!(
        capital_provider.capital_amount >= amount,
        ErrorCode::InsufficientProviderCapital
    );
    
    // Update capital provider balance
    capital_provider.capital_amount = capital_provider.capital_amount.checked_sub(amount).unwrap();
    
    // Update the capital pool
    capital_pool.total_capital = capital_pool.total_capital.checked_sub(amount).unwrap();
    capital_pool.available_capital = capital_pool.available_capital.checked_sub(amount).unwrap();
    
    // Transfer funds from the pool's token account to the provider's token account
    // We need to sign with the PDA
    let seeds = &[
        b"capital-pool", 
        &[capital_pool.pool_type][..],
        &[capital_pool.bump]
    ];
    let signer = &[&seeds[..]];
    
    let cpi_accounts = Transfer {
        from: ctx.accounts.pool_token_account.to_account_info(),
        to: ctx.accounts.provider_token.to_account_info(),
        authority: ctx.accounts.capital_pool.to_account_info(),
    };
    
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
    
    token::transfer(cpi_ctx, amount)?;
    
    // If the provider has withdrawn all capital, close the account
    if capital_provider.capital_amount == 0 {
        // Transfer the rent back to the owner
        let dest_starting_lamports = ctx.accounts.owner.lamports();
        let provider_lamports = ctx.accounts.capital_provider.to_account_info().lamports();
        
        **ctx.accounts.owner.lamports.borrow_mut() = dest_starting_lamports
            .checked_add(provider_lamports)
            .unwrap();
        **ctx.accounts.capital_provider.to_account_info().lamports.borrow_mut() = 0;
        
        // Zero out the data
        let capital_provider_info = ctx.accounts.capital_provider.to_account_info();
        let mut data = capital_provider_info.data.borrow_mut();
        for byte in data.iter_mut() {
            *byte = 0;
        }
    }
    
    Ok(())
}

#[derive(Accounts)]
#[instruction(pool_type: u8, yield_rate_bps: u64)] 
pub struct InitializeCapitalPool<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(
        init,
        payer = authority,
        space = CapitalPool::SIZE,
        seeds = [b"capital-pool", &[pool_type][..]],
        bump
    )]
    pub capital_pool: Account<'info, CapitalPool>,
    
    pub token_mint: Account<'info, anchor_spl::token::Mint>,
    
    #[account(
        constraint = pool_token_account.mint == token_mint.key(),
        constraint = pool_token_account.owner == capital_pool.key()
    )]
    pub pool_token_account: Account<'info, TokenAccount>,
    
    #[account(
        seeds = [b"protocol-state"],
        bump
    )]
    pub protocol_state: Account<'info, ProtocolState>,
    
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct ProvideCapital<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    
    #[account(
        init,
        payer = owner,
        space = CapitalProvider::SIZE,
        seeds = [b"capital-provider", owner.key().as_ref(), capital_pool.key().as_ref()],
        bump
    )]
    pub capital_provider: Account<'info, CapitalProvider>,
    
    #[account(mut)]
    pub capital_pool: Account<'info, CapitalPool>,
    
    #[account(
        mut,
        constraint = provider_token.mint == capital_pool.token_mint,
        constraint = provider_token.owner == owner.key()
    )]
    pub provider_token: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        constraint = pool_token_account.mint == capital_pool.token_mint,
        constraint = pool_token_account.key() == capital_pool.token_account
    )]
    pub pool_token_account: Account<'info, TokenAccount>,
    
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct WithdrawCapital<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"capital-provider", owner.key().as_ref(), capital_pool.key().as_ref()],
        bump = capital_provider.bump,
        constraint = capital_provider.owner == owner.key()
    )]
    pub capital_provider: Account<'info, CapitalProvider>,
    
    #[account(mut)]
    pub capital_pool: Account<'info, CapitalPool>,
    
    #[account(
        mut,
        constraint = provider_token.mint == capital_pool.token_mint,
        constraint = provider_token.owner == owner.key()
    )]
    pub provider_token: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        constraint = pool_token_account.mint == capital_pool.token_mint,
        constraint = pool_token_account.key() == capital_pool.token_account
    )]
    pub pool_token_account: Account<'info, TokenAccount>,
    
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}