// Has 8 decimal precision to match pyth price oracle
pub fn calc_strike(base: u64, quote: u64) -> i64 {
    // Convert to u128 to avoid overflow and maintain precision
    let base = u128::from(base);
    let quote = u128::from(quote);
    let result = (quote * 10u128.pow(8 + 3) / base) as u64;
    result.try_into().unwrap()
}

pub fn get_settlements(strike: i64, mark: i64, amount: u64) -> [u64; 2] {
    if mark <= strike {
        return [amount, 0];
    }
    // Convert to u128 to avoid overflow and maintain precision
    // Round down the seller
    let seller = (u128::from(amount) * u128::from(strike.unsigned_abs())
        / u128::from(mark.unsigned_abs())) as u64;

    [seller, amount - seller]
}

#[cfg(test)]
mod tests {
    use crate::math::{calc_strike, get_settlements};

    #[test]
    fn test_calc_strike() {
        assert_eq!(calc_strike(1000, 3500), 3500_0000_0000);
        assert_eq!(calc_strike(1_000_000_000, 130_000_000), 130_0000_0000);
        assert_eq!(calc_strike(1_000_000_000, 130_500_000), 130_5000_0000);
        assert_eq!(calc_strike(10000000, 1370000000000), 137000000_0000_0000); // Created this strike with incorrect decimals
    }

    #[test]
    fn test_get_settlements() {
        // Can handle if it is out of the money
        assert_eq!(get_settlements(130, 120, 1_000), [1_000, 0]);
        // Can handle if it is at the money
        assert_eq!(get_settlements(130, 130, 1_000), [1_000, 0]);

        // In the money
        assert_eq!(get_settlements(130, 140, 1_000), [928, 72]); // 928.57, 71.42

        assert_eq!(
            get_settlements(calc_strike(3000000000, 450000000), 15180059921, 3000000000),
            [2964415175, 35584825]
        );
    }
}
