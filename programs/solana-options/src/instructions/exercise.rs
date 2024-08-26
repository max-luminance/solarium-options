use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{transfer_checked, Mint, Token, TokenAccount, TransferChecked},
};

use crate::error::ErrorCode;
use crate::state::CoveredCall;

#[derive(Accounts)]
pub struct Exercise<'info> {
    #[account(mut, constraint = buyer.key() == data.buyer)]
    pub buyer: Signer<'info>,
    #[account(
        mut,
        seeds = ["covered-call".as_bytes(), &data.amount_quote.to_le_bytes(), data.seller.as_ref()], // TODO:- Improve the seed, so can mint many. Do i want to save the seed?
        bump = data.bump,
    )]
    pub data: Account<'info, CoveredCall>,
    #[account( constraint = mint_underlying.key() == data.mint_underlying)]
    pub mint_underlying: Account<'info, Mint>,
    #[account( constraint = mint_quote.key() == data.mint_quote)]
    pub mint_quote: Account<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = data.mint_underlying,
        associated_token::authority = buyer,
    )]
    pub ata_buyer_underlying: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = ata_buyer_quote.amount >= data.amount_quote,
        associated_token::mint = data.mint_quote,
        associated_token::authority = buyer,
    )]
    pub ata_buyer_quote: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = mint_underlying,
        associated_token::authority = data,
    )]
    pub ata_vault_underlying: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = mint_quote,
        associated_token::authority = data,
    )]
    pub ata_vault_quote: Account<'info, TokenAccount>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_exercise(ctx: Context<Exercise>) -> Result<()> {
    let clock = Clock::get()?;

    require!(
        clock.unix_timestamp <= ctx.accounts.data.expiry_unix_timestamp,
        ErrorCode::OptionExpired
    );

    require!(
        ctx.accounts.data.amount_premium.is_some(),
        ErrorCode::OptionNotPurchased
    );

    require!(
        ctx.accounts.data.is_exercised == false,
        ErrorCode::OptionAlreadyExercised
    );

    // Transfer quote to vote in underlying to vault
    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.ata_buyer_quote.to_account_info(),
                to: ctx.accounts.ata_vault_quote.to_account_info(),
                mint: ctx.accounts.mint_quote.to_account_info(),
                authority: ctx.accounts.buyer.to_account_info(),
            },
        ),
        ctx.accounts.data.amount_quote,
        ctx.accounts.mint_quote.decimals,
    )?;

    // Transfer underlying from vault to buyer
    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.ata_vault_underlying.to_account_info(),
                to: ctx.accounts.ata_buyer_underlying.to_account_info(),
                mint: ctx.accounts.mint_underlying.to_account_info(),
                authority: ctx.accounts.data.to_account_info(),
            },
            &[&[
                "covered-call".as_bytes(),
                &ctx.accounts.data.amount_quote.to_le_bytes(),
                ctx.accounts.data.seller.as_ref(),
                &[ctx.accounts.data.bump],
            ]],
        ),
        ctx.accounts.data.amount_underlying,
        ctx.accounts.mint_underlying.decimals,
    )?;

    ctx.accounts.data.is_exercised = true;

    Ok(())
}
