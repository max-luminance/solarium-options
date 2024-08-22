pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("GyuBciZmWHt822Cak6q6RLFagT6oWHwcVb63vwfgt3FA");

#[program]
pub mod solana_options {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        amount_underlying: u64,
        amount_quote: u64,
        expiry_unix_timestamp: i64,
    ) -> Result<()> {
        initialize::handler(ctx, amount_underlying, amount_quote, expiry_unix_timestamp)
    }
}
