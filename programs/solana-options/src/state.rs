use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct CoveredCall {
    pub seller: Pubkey,
    pub buyer: Pubkey,
    pub amount_base: u64,
    pub amount_quote: u64,
    pub timestamp_expiry: i64,
    pub mint_quote: Pubkey,
    pub mint_base: Pubkey,
    pub bump: u8,
    pub amount_premium: Option<u64>,
    pub is_exercised: bool,
    pub timestamp_created: i64,
}
