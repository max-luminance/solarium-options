pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("3JZ99S1BGfcdExZ4immxWKSGAFkbe3hxZo9NRxvrair4");

#[program]
pub mod solana_options {
    use super::*;

    pub fn buy(ctx: Context<Buy>, amount_premium: u64) -> Result<()> {
        handle_buy(ctx, amount_premium)
    }

    pub fn close(ctx: Context<Close>) -> Result<()> {
        handle_close(ctx)
    }

    pub fn exercise(ctx: Context<Exercise>) -> Result<()> {
        handle_exercise(ctx)
    }

    pub fn initialize(
        ctx: Context<Initialize>,
        amount_underlying: u64,
        amount_quote: u64,
        expiry_unix_timestamp: i64,
    ) -> Result<()> {
        handle_initialize(ctx, amount_underlying, amount_quote, expiry_unix_timestamp)
    }
}
