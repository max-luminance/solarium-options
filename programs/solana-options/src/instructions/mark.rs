use anchor_lang::prelude::*;

use crate::ExpiryData;
use pyth_solana_receiver_sdk::price_update::{get_feed_id_from_hex, PriceUpdateV2};

#[derive(Accounts)]
#[instruction(timestamp_expiry: i64)]
pub struct Mark<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
      init_if_needed,
      payer = payer,
      space = 8 + ExpiryData::INIT_SPACE,
      seeds = [
          "expiry-meta".as_bytes(),
          timestamp_expiry.to_le_bytes().as_ref(),
      ],
      bump,
  )]
    pub expiry: Account<'info, ExpiryData>,
    pub price_update: Account<'info, PriceUpdateV2>,
    pub system_program: Program<'info, System>,
}

pub fn handle_mark(ctx: Context<Mark>, expiry: i64) -> Result<()> {
    let price_update = &mut ctx.accounts.price_update;
    let maximum_age: u64 = 604800;
    let feed_id: [u8; 32] =
        get_feed_id_from_hex("0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d")?;
    let price = price_update.get_price_no_older_than(&Clock::get()?, maximum_age, &feed_id)?;
    ctx.accounts.expiry.set_inner(ExpiryData {
        price: price.price,
        conf: price.conf,
        exponent: price.exponent,
        publish_time: price.publish_time,
    });
    Ok(())
}
