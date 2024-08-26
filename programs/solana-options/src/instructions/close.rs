use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{
        close_account, transfer_checked, CloseAccount, Mint, Token, TokenAccount, TransferChecked,
    },
};

use crate::error::ErrorCode;
use crate::state::CoveredCall;

#[derive(Accounts)]
pub struct Close<'info> {
    pub payer: Signer<'info>,
    #[account(mut, constraint = seller.key() == data.seller)]
    pub seller: SystemAccount<'info>,
    #[account(
        mut,
        seeds = ["covered-call".as_bytes(), &data.amount_quote.to_le_bytes(), data.seller.as_ref()], // TODO:- Improve the seed, so can mint many. Do i want to save the seed?
        bump = data.bump,
        close = seller,
    )]
    pub data: Account<'info, CoveredCall>,
    #[account( constraint = mint_underlying.key() == data.mint_underlying)]
    pub mint_underlying: Account<'info, Mint>,
    #[account( constraint = mint_quote.key() == data.mint_quote)]
    pub mint_quote: Account<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = data.mint_underlying,
        associated_token::authority = seller,
    )]
    pub ata_seller_underlying: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = data.mint_quote,
        associated_token::authority = seller,
    )]
    pub ata_seller_quote: Account<'info, TokenAccount>,
    #[account(
        mut,
        // close = seller,
        associated_token::mint = mint_underlying,
        associated_token::authority = data,
    )]
    pub ata_vault_underlying: Account<'info, TokenAccount>,
    #[account(
        mut,
        // close = seller,
        associated_token::mint = mint_quote,
        associated_token::authority = data,
    )]
    pub ata_vault_quote: Account<'info, TokenAccount>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_close(ctx: Context<Close>) -> Result<()> {
    let clock = Clock::get()?;

    require!(
        clock.unix_timestamp > ctx.accounts.data.expiry_unix_timestamp
            || ctx.accounts.data.is_exercised == true
            || ctx.accounts.data.amount_premium.is_none(),
        ErrorCode::OptionCannotBeClosedYet
    );

    // Transfer underlying to seller
    if ctx.accounts.ata_vault_underlying.amount > 0 {
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.ata_vault_underlying.to_account_info(),
                    to: ctx.accounts.ata_seller_underlying.to_account_info(),
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
            ctx.accounts.ata_vault_underlying.amount,
            ctx.accounts.mint_underlying.decimals,
        )?;
    }

    // Transfer quote to seller
    if ctx.accounts.ata_vault_quote.amount > 0 {
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.ata_vault_quote.to_account_info(),
                    to: ctx.accounts.ata_seller_quote.to_account_info(),
                    mint: ctx.accounts.mint_quote.to_account_info(),
                    authority: ctx.accounts.data.to_account_info(),
                },
                &[&[
                    "covered-call".as_bytes(),
                    &ctx.accounts.data.amount_quote.to_le_bytes(),
                    ctx.accounts.data.seller.as_ref(),
                    &[ctx.accounts.data.bump],
                ]],
            ),
            ctx.accounts.ata_vault_quote.amount,
            ctx.accounts.mint_quote.decimals,
        )?;
    }

    close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        CloseAccount {
            account: ctx.accounts.ata_vault_underlying.to_account_info(),
            destination: ctx.accounts.seller.to_account_info(),
            authority: ctx.accounts.data.to_account_info(),
        },
        &[&[
            "covered-call".as_bytes(),
            &ctx.accounts.data.amount_quote.to_le_bytes(),
            ctx.accounts.data.seller.as_ref(),
            &[ctx.accounts.data.bump],
        ]],
    ))?;

    close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        CloseAccount {
            account: ctx.accounts.ata_vault_quote.to_account_info(),
            destination: ctx.accounts.seller.to_account_info(),
            authority: ctx.accounts.data.to_account_info(),
        },
        &[&[
            "covered-call".as_bytes(),
            &ctx.accounts.data.amount_quote.to_le_bytes(),
            ctx.accounts.data.seller.as_ref(),
            &[ctx.accounts.data.bump],
        ]],
    ))?;

    Ok(())
}
