use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{transfer_checked, Mint, Token, TokenAccount, TransferChecked},
};


use crate::state::CoveredCall;

#[derive(Accounts)]
#[instruction(amount_underlying: u64)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(
        init, 
        payer = seller,
        space = 8 + CoveredCall::INIT_SPACE,
        seeds = [b"covered-call", seller.key().as_ref()],
        bump,
    )]
    pub data: Account<'info, CoveredCall>,
    pub mint_underlying: Account<'info, Mint>,
    #[account(
        mut,
        constraint = ata_seller_underlying.amount >= amount_underlying,
        associated_token::mint = mint_underlying,
        associated_token::authority = seller,
    )]
    pub ata_seller_underlying: Account<'info, TokenAccount>,
    #[account(
        init,
        payer = seller,
        associated_token::mint = mint_underlying,
        associated_token::authority = data,
    )]
    pub ata_vault_underlying: Account<'info, TokenAccount>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Initialize>, amount_underlying: u64) -> Result<()> {
    msg!("Greetings from: {:?}", ctx.accounts.seller.key());

    // Set state
    ctx.accounts.data.set_inner(CoveredCall {
        seller: ctx.accounts.seller.key(),
        amount_underlying: amount_underlying,
    });
    
    // Transfer underlying to vault
    transfer_checked(CpiContext::new(ctx.accounts.token_program.to_account_info(), TransferChecked {
        from: ctx.accounts.ata_seller_underlying.to_account_info(),
        to: ctx.accounts.ata_vault_underlying.to_account_info(),
        mint: ctx.accounts.mint_underlying.to_account_info(),
        authority: ctx.accounts.seller.to_account_info(),
    }), amount_underlying, ctx.accounts.mint_underlying.decimals)?;

    Ok(())
}
