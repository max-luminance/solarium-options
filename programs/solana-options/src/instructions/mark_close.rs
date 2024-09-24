use anchor_lang::prelude::*;

use crate::ExpiryData;

#[derive(Accounts)]
#[instruction(timestamp_expiry: i64)]
pub struct MarkClose<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
      mut,
      seeds = [
          "expiry-meta".as_bytes(),
          timestamp_expiry.to_le_bytes().as_ref(),
      ],
      bump = expiry.bump,
      close = payer,
    )]
    pub expiry: Account<'info, ExpiryData>,
    pub system_program: Program<'info, System>,
}

pub fn handle_mark_close(ctx: Context<MarkClose>, _expiry: i64) -> Result<()> {
    require!(
        ctx.accounts.payer.key() == ctx.accounts.expiry.payer,
        ErrorCode::ConstraintOwner,
    );
    Ok(())
}
