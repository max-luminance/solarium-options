use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{
        close_account, transfer_checked, CloseAccount, Mint, Token, TokenAccount, TransferChecked,
    },
};

use crate::math::calc_strike;
use crate::state::CoveredCall;
use crate::{error::ErrorCode, ExpiryData};

#[derive(Accounts)]
pub struct Close<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, constraint = seller.key() == data.seller)]
    pub seller: SystemAccount<'info>,
    #[account(mut, constraint = buyer.key() == data.buyer)]
    pub buyer: SystemAccount<'info>,
    #[account(
        mut,
        seeds = [
            "covered-call".as_bytes(), 
            seller.key().as_ref(),
            buyer.key().as_ref(),
            mint_base.key().as_ref(),
            &data.mint_quote.as_ref(),
            &data.amount_base.to_le_bytes(),
            &data.amount_quote.to_le_bytes(),
            &data.timestamp_expiry.to_le_bytes(),
        ],
        bump = data.bump,
        close = seller,
    )]
    pub data: Account<'info, CoveredCall>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + ExpiryData::INIT_SPACE,
        seeds = [
          "expiry-meta".as_bytes(),
           &data.timestamp_expiry.to_le_bytes(),
        ],
        bump,
    )]
    pub expiry: Account<'info, ExpiryData>,
    #[account( constraint = mint_base.key() == data.mint_base)]
    pub mint_base: Account<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = data.mint_base,
        associated_token::authority = seller,
    )]
    pub ata_seller_base: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = mint_base,
        associated_token::authority = data,
    )]
    pub ata_vault_base: Account<'info, TokenAccount>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_close(ctx: Context<Close>) -> Result<()> {
    let clock = Clock::get()?;

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

    let strike = calc_strike(
        ctx.accounts.data.amount_base,
        ctx.accounts.data.amount_quote,
    );

    require!(
        clock.unix_timestamp > ctx.accounts.data.timestamp_expiry
            || (ctx.accounts.expiry.price != 0 && ctx.accounts.expiry.price <= strike) // Must be out of the money or...
            || ctx.accounts.data.is_exercised  // Buyer already exercised
            || ctx.accounts.data.amount_premium.is_none(),
        ErrorCode::OptionCannotBeClosedYet
    );

    // Transfer base to seller
    if ctx.accounts.ata_vault_base.amount > 0 {
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.ata_vault_base.to_account_info(),
                    to: ctx.accounts.ata_seller_base.to_account_info(),
                    mint: ctx.accounts.mint_base.to_account_info(),
                    authority: ctx.accounts.data.to_account_info(),
                },
                signer,
            ),
            ctx.accounts.ata_vault_base.amount,
            ctx.accounts.mint_base.decimals,
        )?;
    }

    close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        CloseAccount {
            account: ctx.accounts.ata_vault_base.to_account_info(),
            destination: ctx.accounts.seller.to_account_info(),
            authority: ctx.accounts.data.to_account_info(),
        },
        signer,
    ))?;

    Ok(())
}
