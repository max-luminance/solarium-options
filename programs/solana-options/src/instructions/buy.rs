use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{transfer_checked, Mint, Token, TokenAccount, TransferChecked},
};

use crate::error::ErrorCode;
use crate::state::CoveredCall;

#[derive(Accounts)]
#[instruction(amount_premium: u64)]
pub struct Buy<'info> {
    #[account(mut, constraint = buyer.key() == data.buyer)]
    pub buyer: Signer<'info>,
    #[account(
        mut,
        seeds = [
            "covered-call".as_bytes(), 
            data.seller.as_ref(),
            buyer.key().as_ref(),
            data.mint_underlying.as_ref(),
            data.mint_quote.as_ref(),
            &data.amount_underlying.to_le_bytes(), 
            &data.amount_quote.to_le_bytes(), 
            &data.expiry_unix_timestamp.to_le_bytes(), 
        ], 
        bump = data.bump,
    )]
    pub data: Account<'info, CoveredCall>,
    #[account( constraint = mint_premium.key() == data.mint_underlying)]
    pub mint_premium: Account<'info, Mint>,
    #[account(
        mut,
        constraint = ata_buyer_premium.amount >= amount_premium,
        associated_token::mint = mint_premium,
        associated_token::authority = buyer,
    )]
    pub ata_buyer_premium: Account<'info, TokenAccount>, // This already exists because we enforce it to be underlying
    #[account(
        mut,
        associated_token::mint = mint_premium,
        associated_token::authority = data,
    )]
    pub ata_vault_premium: Account<'info, TokenAccount>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_buy(ctx: Context<Buy>, amount_premium: u64) -> Result<()> {
    let clock = Clock::get()?;

    require!(
        clock.unix_timestamp <= ctx.accounts.data.expiry_unix_timestamp,
        ErrorCode::OptionExpired
    );

    require!(
        ctx.accounts.data.amount_premium.is_none(),
        ErrorCode::OptionAlreadyBought
    );
    ctx.accounts.data.amount_premium = Some(amount_premium);

    // Transfer premium in underlying to vault
    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.ata_buyer_premium.to_account_info(),
                to: ctx.accounts.ata_vault_premium.to_account_info(),
                mint: ctx.accounts.mint_premium.to_account_info(),
                authority: ctx.accounts.buyer.to_account_info(),
            },
        ),
        amount_premium,
        ctx.accounts.mint_premium.decimals,
    )?;

    Ok(())
}
