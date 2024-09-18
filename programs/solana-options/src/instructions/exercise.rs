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
        seeds = [
            "covered-call".as_bytes(), 
            data.seller.as_ref(),
            buyer.key().as_ref(),
            mint_base.key().as_ref(),
            mint_quote.key().as_ref(),
            &data.amount_base.to_le_bytes(),
            &data.amount_quote.to_le_bytes(),
            &data.timestamp_expiry.to_le_bytes(),
        ],
        bump = data.bump,
    )]
    pub data: Account<'info, CoveredCall>,
    #[account( constraint = mint_base.key() == data.mint_base)]
    pub mint_base: Account<'info, Mint>,
    #[account( constraint = mint_quote.key() == data.mint_quote)]
    pub mint_quote: Account<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = data.mint_base,
        associated_token::authority = buyer,
    )]
    pub ata_buyer_base: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = ata_buyer_quote.amount >= data.amount_quote,
        associated_token::mint = data.mint_quote,
        associated_token::authority = buyer,
    )]
    pub ata_buyer_quote: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = mint_base,
        associated_token::authority = data,
    )]
    pub ata_vault_base: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = buyer,
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
        clock.unix_timestamp <= ctx.accounts.data.timestamp_expiry,
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

    let seeds = [
        "covered-call".as_bytes(),
        ctx.accounts.data.seller.as_ref(),
        ctx.accounts.data.buyer.as_ref(),
        ctx.accounts.data.mint_base.as_ref(),
        ctx.accounts.data.mint_quote.as_ref(),
        &ctx.accounts.data.amount_base.to_le_bytes(),
        &ctx.accounts.data.amount_quote.to_le_bytes(),
        &ctx.accounts.data.timestamp_expiry.to_le_bytes(),
        &[ctx.accounts.data.bump],
    ];
    let signer = &[&seeds[..]];

    // Transfer quote to vault
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

    // Transfer base from vault to buyer
    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.ata_vault_base.to_account_info(),
                to: ctx.accounts.ata_buyer_base.to_account_info(),
                mint: ctx.accounts.mint_base.to_account_info(),
                authority: ctx.accounts.data.to_account_info(),
            },
            signer,
        ),
        ctx.accounts.data.amount_base,
        ctx.accounts.mint_base.decimals,
    )?;

    ctx.accounts.data.is_exercised = true;

    Ok(())
}
