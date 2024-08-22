use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct CoveredCall {
    pub seller: Pubkey,
    pub buyer: Pubkey,
    pub amount_underlying: u64,
    pub amount_quote: u64,
    pub expiry_unix_timestamp: i64,
    pub mint_quote: Pubkey,
    pub mint_underlying: Pubkey,
}
