use anchor_lang::prelude::*;

use crate::state::CoveredCall;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(
        init, 
        payer = seller,
        space = 8 + CoveredCall::INIT_SPACE,
        seeds = [b"covered-call"],
        bump,
    )]
    pub data: Account<'info, CoveredCall>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Initialize>) -> Result<()> {
    msg!("Greetings from: {:?}", ctx.accounts.seller.key());
    ctx.accounts.data.set_inner(CoveredCall {
        seller: ctx.accounts.seller.key()
    });
    Ok(())
}
