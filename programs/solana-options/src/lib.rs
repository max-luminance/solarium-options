pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("So1ar1uyyJ2bhm4DTN3M2wWkug4trVknn2kdZ2vD2Vh");

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
        amount_base: u64,
        amount_quote: u64,
        timestamp_expiry: i64,
    ) -> Result<()> {
        handle_initialize(ctx, amount_base, amount_quote, timestamp_expiry)
    }

    pub fn mark(ctx: Context<Mark>, timestamp_expiry: i64) -> Result<()> {
        handle_mark(ctx, timestamp_expiry)
    }
}
