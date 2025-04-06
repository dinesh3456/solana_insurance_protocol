use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::{Policy, ProtocolInfo, CapitalPool, ErrorCode};

#[account]
pub struct Claim {
    pub policy: Pubkey,
    pub claimant: Pubkey,
    pub amount: u64,
    pub evidence: String,
    pub submitted_time: i64,
    pub status: u8, // 0 = Pending, 1 = Approved, 2 = Rejected
    pub resolution_time: i64,
    pub resolver: Pubkey,
    pub resolution_notes: String,
    pub bump: u8,
}

impl Claim {
    pub const SIZE: usize = 8 +     // discriminator
                           32 +     // policy
                           32 +     // claimant
                           8 +      // amount
                           100 +    // evidence (max 96 chars + 4 bytes for string length)
                           8 +      // submitted_time
                           1 +      // status
                           8 +      // resolution_time
                           32 +     // resolver
                           100 +    // resolution_notes (max 96 chars + 4 bytes for string length)
                           1;       // bump
}

// Status constants
pub const CLAIM_STATUS_PENDING: u8 = 0;
pub const CLAIM_STATUS_APPROVED: u8 = 1;
pub const CLAIM_STATUS_REJECTED: u8 = 2;

pub fn submit_claim(
    ctx: Context<SubmitClaim>,
    amount: u64,
    evidence: String,
) -> Result<()> {
    let policy = &ctx.accounts.policy;
    let claim = &mut ctx.accounts.claim;
    let clock = Clock::get()?;
    
    // Verify the policy is active and hasn't expired
    require!(policy.is_active, ErrorCode::PolicyNotActive);
    require!(policy.end_time > clock.unix_timestamp, ErrorCode::PolicyExpired);
    require!(!policy.is_claimed, ErrorCode::PolicyAlreadyClaimed);
    
    // Verify the claimant is the insured
    require!(ctx.accounts.claimant.key() == policy.insured, ErrorCode::UnauthorizedClaim);
    
    // Verify the claim amount is within the coverage limits
    require!(amount <= policy.coverage_amount, ErrorCode::ExcessClaimAmount);
    
    // Initialize the claim
    claim.policy = ctx.accounts.policy.key();
    claim.claimant = ctx.accounts.claimant.key();
    claim.amount = amount;
    claim.evidence = evidence;
    claim.submitted_time = clock.unix_timestamp;
    claim.status = CLAIM_STATUS_PENDING;
    claim.resolution_time = 0;
    claim.resolver = Pubkey::default();
    claim.resolution_notes = String::new();
    claim.bump = ctx.bumps.claim;
    
    Ok(())
}

pub fn resolve_claim(
    ctx: Context<ResolveClaim>,
    approve: bool,
    resolution_notes: String,
) -> Result<()> {
    let claim = &mut ctx.accounts.claim;
    let policy = &mut ctx.accounts.policy;
    let clock = Clock::get()?;
    
    // Only protocol authority can resolve claims
    require!(
        ctx.accounts.resolver.key() == ctx.accounts.protocol_info.authority,
        ErrorCode::UnauthorizedResolver
    );
    
    // Verify the claim is pending
    require!(claim.status == CLAIM_STATUS_PENDING, ErrorCode::ClaimAlreadyResolved);
    
    // Update the claim
    claim.status = if approve { CLAIM_STATUS_APPROVED } else { CLAIM_STATUS_REJECTED };
    claim.resolution_time = clock.unix_timestamp;
    claim.resolver = ctx.accounts.resolver.key();
    claim.resolution_notes = resolution_notes;
    
    if approve {
        // Mark the policy as claimed
        policy.is_claimed = true;
        
        // If approved, transfer the claim amount from capital pool to the claimant
        let pool = &mut ctx.accounts.capital_pool;
        
        // Check if pool has enough available capital
        require!(
            pool.available_capital >= claim.amount,
            ErrorCode::InsufficientPoolCapital
        );
        
        // Update the capital pool
        pool.available_capital = pool.available_capital.checked_sub(claim.amount).unwrap();
        pool.reserved_capital = pool.reserved_capital.checked_add(claim.amount).unwrap();
        
        // Transfer funds to the claimant
        let seeds = &[
            b"capital-pool", 
            &[pool.pool_type][..],
            &[pool.bump]
        ];
        let signer = &[&seeds[..]];
        
        let cpi_accounts = Transfer {
            from: ctx.accounts.pool_token_account.to_account_info(),
            to: ctx.accounts.claimant_token.to_account_info(),
            authority: ctx.accounts.capital_pool.to_account_info(),
        };
        
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        
        token::transfer(cpi_ctx, claim.amount)?;
    }
    
    Ok(())
}

#[derive(Accounts)]
pub struct SubmitClaim<'info> {
    #[account(mut)]
    pub claimant: Signer<'info>,
    
    #[account(
        seeds = [b"policy", claimant.key().as_ref(), policy.protocol.as_ref()],
        bump = policy.bump,
        constraint = policy.insured == claimant.key()
    )]
    pub policy: Account<'info, Policy>,
    
    #[account(
        init,
        payer = claimant,
        space = Claim::SIZE,
        seeds = [b"claim", policy.key().as_ref()],
        bump
    )]
    pub claim: Account<'info, Claim>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ResolveClaim<'info> {
    #[account(mut)]
    pub resolver: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"claim", policy.key().as_ref()],
        bump = claim.bump
    )]
    pub claim: Account<'info, Claim>,
    
    #[account(
        mut,
        seeds = [b"policy", policy.insured.as_ref(), protocol_info.key().as_ref()],
        bump = policy.bump
    )]
    pub policy: Account<'info, Policy>,
    
    pub protocol_info: Account<'info, ProtocolInfo>,
    
    #[account(mut)]
    pub capital_pool: Account<'info, CapitalPool>,
    
    #[account(
        mut,
        constraint = pool_token_account.mint == capital_pool.token_mint,
        constraint = pool_token_account.key() == capital_pool.token_account
    )]
    pub pool_token_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        constraint = claimant_token.mint == pool_token_account.mint,
        constraint = claimant_token.owner == policy.insured
    )]
    pub claimant_token: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}