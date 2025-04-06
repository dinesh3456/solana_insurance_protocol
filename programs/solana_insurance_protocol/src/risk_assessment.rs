use crate::ErrorCode;

// Risk assessment factors with weights
pub const CODE_RISK_WEIGHT: u8 = 30;
pub const ECONOMIC_RISK_WEIGHT: u8 = 40;
pub const OPERATIONAL_RISK_WEIGHT: u8 = 30;

// Risk score ranges from 0 to 100
// 0-25: Low risk
// 26-50: Medium-low risk
// 51-75: Medium-high risk
// 76-100: High risk

pub fn assess_code_risk(
    audit_count: u8,
    bug_bounty_size: u64,
    complexity_score: u8,
) -> u8 {
    // Weighted code risk calculation
    // More audits, higher bug bounty, and lower complexity reduce risk
    let audit_factor = 100 - std::cmp::min(audit_count, 5) * 20;
    let bounty_factor = match bug_bounty_size {
        0 => 100,
        1..=50_000 => 75,
        50_001..=250_000 => 50,
        250_001..=1_000_000 => 25,
        _ => 0,
    };
    let complexity_factor = std::cmp::min(complexity_score, 100);
    
    let weighted_code_risk = (audit_factor + bounty_factor + complexity_factor) / 3;
    weighted_code_risk
}

pub fn assess_economic_risk(
    tvl_usd: u64,
    liquidity_depth: u64,
    concentration_risk: u8,
) -> u8 {
    // Economic risk increases with higher TVL, lower liquidity depth, and higher concentration
    let tvl_factor = match tvl_usd {
        0..=1_000_000 => 25,                 // < $1M
        1_000_001..=10_000_000 => 50,        // $1M-$10M
        10_000_001..=100_000_000 => 75,      // $10M-$100M
        _ => 100,                           // > $100M
    };
    
    let liquidity_factor = match liquidity_depth {
        0..=100_000 => 100,                  // Very low liquidity
        100_001..=1_000_000 => 75,           // Low liquidity
        1_000_001..=10_000_000 => 50,        // Medium liquidity
        _ => 25,                             // High liquidity
    };
    
    let concentration_factor = concentration_risk; // 0-100 scale
    
    let weighted_economic_risk = (tvl_factor + liquidity_factor + concentration_factor) / 3;
    weighted_economic_risk
}

pub fn assess_operational_risk(
    governance_count: u8,
    admin_count: u8,
    oracle_dependency: bool,
) -> u8 {
    // More governance participants and admins reduce risk
    // Oracle dependency increases risk
    
    let governance_factor = 100 - std::cmp::min(governance_count, 10) * 10;
    let admin_factor = 100 - std::cmp::min(admin_count, 5) * 20;
    let oracle_factor = if oracle_dependency { 100 } else { 0 };
    
    let weighted_operational_risk = (governance_factor + admin_factor + oracle_factor) / 3;
    weighted_operational_risk
}

pub fn calculate_composite_risk_score(
    code_risk: u8,
    economic_risk: u8,
    operational_risk: u8,
) -> u8 {
    // Weighted average of all risk factors
    let weighted_score = (
        (code_risk as u16 * CODE_RISK_WEIGHT as u16) +
        (economic_risk as u16 * ECONOMIC_RISK_WEIGHT as u16) +
        (operational_risk as u16 * OPERATIONAL_RISK_WEIGHT as u16)
    ) / 100;
    
    weighted_score as u8
}

pub fn calculate_premium_rate(risk_score: u8) -> u64 {
    // Premium rate calculation based on risk score
    // Returns basis points (1/100 of 1%)
    match risk_score {
        0..=25 => 25,        // 0.25% annual premium rate for low risk
        26..=50 => 50,       // 0.5% annual premium rate for medium-low risk
        51..=75 => 100,      // 1% annual premium rate for medium-high risk
        _ => 200,            // 2% annual premium rate for high risk
    }
}

pub fn calculate_premium_amount(
    coverage_amount: u64,
    premium_rate_bps: u64,
    duration_days: u16,
) -> u64 {
    // Calculate the premium amount based on coverage, rate, and duration
    // premium = coverage * rate * (duration / 365)
    let annual_premium = (coverage_amount * premium_rate_bps) / 10000; // Convert basis points to decimal
    let daily_premium = annual_premium / 365;
    let premium_amount = daily_premium * duration_days as u64;
    
    premium_amount
}