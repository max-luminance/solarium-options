
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{transfer_checked, Mint, Token, TokenAccount, TransferChecked},
};


use crate::state::CoveredCall;
use crate::error::ErrorCode;

#[derive(Accounts)]
#[instruction(amount_underlying: u64, amount_quote: u64, expiry_unix_timestamp: i64)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    pub buyer: SystemAccount<'info>,
    #[account(
        init, 
        payer = seller,
        space = 8 + CoveredCall::INIT_SPACE,
        seeds = ["covered-call".as_bytes(), seller.key().as_ref()], // TODO:- Improve the seed, so can mint many. Do i want to save the seed?
        bump,
    )]
    pub data: Account<'info, CoveredCall>,
    pub mint_underlying: Account<'info, Mint>,
    pub mint_quote: Account<'info, Mint>,
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

pub fn handle_initialize(ctx: Context<Initialize>, amount_underlying: u64, amount_quote: u64, expiry_unix_timestamp: i64) -> Result<()> {
    let clock = Clock::get()?;
    
    require!(expiry_unix_timestamp > clock.unix_timestamp, ErrorCode::ExpiryIsInThePast);

    // Set state
    ctx.accounts.data.set_inner(CoveredCall {
        amount_quote: amount_quote,
        amount_underlying: amount_underlying,
        buyer: ctx.accounts.buyer.key(),
        expiry_unix_timestamp: expiry_unix_timestamp,
        mint_quote: ctx.accounts.mint_quote.key(),
        mint_underlying: ctx.accounts.mint_underlying.key(),
        seller: ctx.accounts.seller.key(),
        bump: ctx.bumps.data,
        amount_premium: None,
        is_exercised: false,
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
