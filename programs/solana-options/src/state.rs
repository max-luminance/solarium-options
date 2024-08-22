use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct CoveredCall {
    pub seller: Pubkey,
}
