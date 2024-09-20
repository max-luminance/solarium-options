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
    #[msg("Option cannot be closed Yet")]
    OptionCannotBeClosedYet,
    #[msg("Option already exercised")]
    OptionAlreadyExercised,
    #[msg("Option has not expired")]
    OptionNotExpired,
    #[msg("Price not close to expiry")]
    PriceIrrelevant,
    #[msg("Option not marked")]
    OptionNotMarked,
}
