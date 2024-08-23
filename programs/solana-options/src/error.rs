use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Expiry is in the past")]
    ExpiryIsInThePast,
    #[msg("Option has expired")]
    OptionExpired,
    #[msg("Option is already bought")]
    OptionAlreadyBought,
    #[msg("Option was not purchased")]
    OptionNotPurchased,
}
