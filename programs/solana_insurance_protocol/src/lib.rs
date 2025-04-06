use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

mod risk_assessment;
mod capital_management;
mod claims;
mod exploit_detection;

use risk_assessment::*;
use capital_management::*;
use claims::*;
use exploit_detection::*;



declare_id!("4LLgpV6Hu42KLg8W2GzdxjRxXmVoybSwb897WEdmXWQE"); 

#[program]
pub mod solana_insurance_protocol {
    use super::*;

    // === Core Insurance Functions ===
    
    pub fn initialize(ctx: Context<Initialize>, protocol_fee: u64) -> Result<()> {
        let protocol_state = &mut ctx.accounts.protocol_state;
        protocol_state.authority = ctx.accounts.authority.key();
        protocol_state.protocol_fee = protocol_fee;
        protocol_state.bump = ctx.bumps.protocol_state;        
        let registry = &mut ctx.accounts.registry;
        registry.protocol_count = 0;
        
        Ok(())
    }

    pub fn register_protocol(
        ctx: Context<RegisterProtocol>,
        protocol_name: String,
        tvl_usd: u64,
    ) -> Result<()> {
        let protocol_info = &mut ctx.accounts.protocol_info;
        protocol_info.authority = ctx.accounts.authority.key();
        protocol_info.protocol_name = protocol_name;
        protocol_info.tvl_usd = tvl_usd;
        protocol_info.risk_score = 50; // Default medium risk score
        protocol_info.is_active = true;
        protocol_info.bump = ctx.bumps.protocol_info;        
        // Update the registry
        let registry = &mut ctx.accounts.registry;
        registry.protocol_count = registry.protocol_count.checked_add(1).unwrap();
        
        Ok(())
    }

    pub fn create_policy(
        ctx: Context<CreatePolicy>,
        coverage_amount: u64,
        premium_amount: u64,
        duration_days: u16,
    ) -> Result<()> {
        let policy = &mut ctx.accounts.policy;
        let _protocol_info = &ctx.accounts.protocol_info;  // Underscore prefix
        let clock = Clock::get()?;
        
        policy.insured = ctx.accounts.insured.key();
        policy.protocol = ctx.accounts.protocol_info.key();
        policy.coverage_amount = coverage_amount;
        policy.premium_amount = premium_amount;
        policy.start_time = clock.unix_timestamp;
        policy.end_time = clock.unix_timestamp + (duration_days as i64 * 86400);
        policy.is_active = true;
        policy.is_claimed = false;
        policy.bump = ctx.bumps.policy;
        
        // Transfer premium from the insured's token account to the protocol's treasury
        let cpi_accounts = Transfer {
            from: ctx.accounts.insured_token.to_account_info(),
            to: ctx.accounts.treasury_token.to_account_info(),
            authority: ctx.accounts.insured.to_account_info(),
        };
        
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        
        token::transfer(cpi_ctx, premium_amount)?;
        
        Ok(())
    }
    
    // === Risk Assessment Functions ===
    
    pub fn update_protocol_risk(
        ctx: Context<UpdateProtocolRisk>,
        code_risk_params: CodeRiskParams,
        economic_risk_params: EconomicRiskParams,
        operational_risk_params: OperationalRiskParams,
    ) -> Result<()> {
        let protocol_info = &mut ctx.accounts.protocol_info;
        
        // Only the protocol authority or the protocol admin can update the risk parameters
        require!(
            ctx.accounts.authority.key() == protocol_info.authority || 
            ctx.accounts.authority.key() == ctx.accounts.protocol_state.authority,
            ErrorCode::UnauthorizedAccess
        );
        
        // Calculate individual risk components
        let code_risk = assess_code_risk(
            code_risk_params.audit_count,
            code_risk_params.bug_bounty_size,
            code_risk_params.complexity_score,
        );
        
        let economic_risk = assess_economic_risk(
            protocol_info.tvl_usd, // Use the stored TVL
            economic_risk_params.liquidity_depth,
            economic_risk_params.concentration_risk,
        );
        
        let operational_risk = assess_operational_risk(
            operational_risk_params.governance_count,
            operational_risk_params.admin_count,
            operational_risk_params.oracle_dependency,
        );
        
        // Calculate the composite risk score
        let risk_score = calculate_composite_risk_score(code_risk, economic_risk, operational_risk);
        
        // Update the protocol's risk score
        protocol_info.risk_score = risk_score;
        
        Ok(())
    }
    
    // === Capital Management Functions ===
    
    pub fn initialize_capital_pool(
        ctx: Context<InitializeCapitalPool>,
        pool_type: u8,
        yield_rate_bps: u64,
    ) -> Result<()> {
        capital_management::initialize_capital_pool(ctx, pool_type, yield_rate_bps)
    }
    
    pub fn provide_capital(
        ctx: Context<ProvideCapital>,
        amount: u64,
    ) -> Result<()> {
        capital_management::provide_capital(ctx, amount)
    }
    
    pub fn withdraw_capital(
        ctx: Context<WithdrawCapital>,
        amount: u64,
    ) -> Result<()> {
        capital_management::withdraw_capital(ctx, amount)
    }
    
    // === Claims Processing Functions ===
    
    pub fn submit_claim(
        ctx: Context<SubmitClaim>,
        amount: u64,
        evidence: String,
    ) -> Result<()> {
        claims::submit_claim(ctx, amount, evidence)
    }
    
    pub fn resolve_claim(
        ctx: Context<ResolveClaim>,
        approve: bool,
        resolution_notes: String,
    ) -> Result<()> {
        claims::resolve_claim(ctx, approve, resolution_notes)
    }
    
    // === Exploit Detection Functions ===
    
    pub fn create_exploit_alert(
        ctx: Context<CreateExploitAlert>,
        anomaly_type: u8,
        severity: u8,
        details: String,
    ) -> Result<()> {
        exploit_detection::create_exploit_alert(ctx, anomaly_type, severity, details)
    }
    
    pub fn resolve_exploit_alert(
        ctx: Context<ResolveExploitAlert>,
        is_confirmed: bool,
        resolution_notes: String,
    ) -> Result<()> {
        exploit_detection::resolve_exploit_alert(ctx, is_confirmed, resolution_notes)
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(
        init,
        payer = authority,
        space = ProtocolState::SIZE,
        seeds = [b"protocol-state"],
        bump
    )]
    pub protocol_state: Account<'info, ProtocolState>,
    
    #[account(
        init,
        payer = authority,
        space = ProtocolRegistry::SIZE,
        seeds = [b"protocol-registry"],
        bump
    )]
    pub registry: Account<'info, ProtocolRegistry>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RegisterProtocol<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(
        init,
        payer = authority,
        space = ProtocolInfo::SIZE,
        seeds = [b"protocol-info", authority.key().as_ref()],
        bump
    )]
    pub protocol_info: Account<'info, ProtocolInfo>,
    
    #[account(
        mut,
        seeds = [b"protocol-registry"],
        bump
    )]
    pub registry: Account<'info, ProtocolRegistry>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreatePolicy<'info> {
    #[account(mut)]
    pub insured: Signer<'info>,
    
    #[account(
        init,
        payer = insured,
        space = Policy::SIZE,
        seeds = [b"policy", insured.key().as_ref(), protocol_info.key().as_ref()],
        bump
    )]
    pub policy: Account<'info, Policy>,
    
    #[account(
        mut,
        constraint = protocol_info.is_active @ ErrorCode::ProtocolNotActive
    )]
    pub protocol_info: Account<'info, ProtocolInfo>,
    
    #[account(
        mut,
        constraint = insured_token.owner == insured.key(),
        constraint = insured_token.mint == treasury_token.mint
    )]
    pub insured_token: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub treasury_token: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateProtocolRisk<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(mut)]
    pub protocol_info: Account<'info, ProtocolInfo>,
    
    #[account(
        seeds = [b"protocol-state"],
        bump = protocol_state.bump
    )]
    pub protocol_state: Account<'info, ProtocolState>,
}

#[account]
pub struct ProtocolState {
    pub authority: Pubkey,
    pub protocol_fee: u64,
    pub bump: u8,
}

impl ProtocolState {
    pub const SIZE: usize = 8 + // discriminator
                           32 + // authority
                           8 +  // protocol_fee
                           1;   // bump
}

#[account]
pub struct ProtocolRegistry {
    pub protocol_count: u64,
}

impl ProtocolRegistry {
    pub const SIZE: usize = 8 + // discriminator
                           8;   // protocol_count
}

#[account]
pub struct ProtocolInfo {
    pub authority: Pubkey,
    pub protocol_name: String,
    pub tvl_usd: u64,
    pub risk_score: u8,
    pub is_active: bool,
    pub bump: u8,
}

impl ProtocolInfo {
    pub const SIZE: usize = 8 +     // discriminator
                           32 +     // authority
                           36 +     // protocol_name (max 32 chars + 4 bytes for string length)
                           8 +      // tvl_usd
                           1 +      // risk_score
                           1 +      // is_active
                           1;       // bump
}

#[account]
pub struct Policy {
    pub insured: Pubkey,
    pub protocol: Pubkey,
    pub coverage_amount: u64,
    pub premium_amount: u64,
    pub start_time: i64,
    pub end_time: i64,
    pub is_active: bool,
    pub is_claimed: bool,
    pub bump: u8,
}

impl Policy {
    pub const SIZE: usize = 8 +     // discriminator
                           32 +     // insured
                           32 +     // protocol
                           8 +      // coverage_amount
                           8 +      // premium_amount
                           8 +      // start_time
                           8 +      // end_time
                           1 +      // is_active
                           1 +      // is_claimed
                           1;       // bump
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CodeRiskParams {
    pub audit_count: u8,
    pub bug_bounty_size: u64,
    pub complexity_score: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct EconomicRiskParams {
    pub liquidity_depth: u64,
    pub concentration_risk: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct OperationalRiskParams {
    pub governance_count: u8,
    pub admin_count: u8,
    pub oracle_dependency: bool,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Protocol is not active")]
    ProtocolNotActive,
    #[msg("Insufficient premium amount")]
    InsufficientPremium,
    #[msg("Policy has expired")]
    PolicyExpired,
    #[msg("Policy is already claimed")]
    PolicyAlreadyClaimed,
    #[msg("Unauthorized access")]
    UnauthorizedAccess,
    #[msg("Invalid pool type")]
    InvalidPoolType,
    #[msg("Insufficient pool capital")]
    InsufficientPoolCapital,
    #[msg("Insufficient provider capital")]
    InsufficientProviderCapital,
    #[msg("Policy not active")]
    PolicyNotActive,
    #[msg("Unauthorized claim")]
    UnauthorizedClaim,
    #[msg("Excess claim amount")]
    ExcessClaimAmount,
    #[msg("Unauthorized resolver")]
    UnauthorizedResolver,
    #[msg("Claim already resolved")]
    ClaimAlreadyResolved,
    #[msg("Invalid anomaly type")]
    InvalidAnomalyType,
    #[msg("Invalid severity")]
    InvalidSeverity,
}