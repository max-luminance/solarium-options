import { expect } from "vitest";
import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

expect.extend({
  toBeBN: (actual: BN, expected: BN) => {
    return {
      pass: actual.eq(expected),
      message: () => `expected ${expected} to be ${actual}`,
      actual: actual.toString(),
      expected: expected.toString(),
    };
  },
});

export function getPda(seeds: {
  amountQuote: bigint;
  amountUnderlying: bigint;
  buyer: PublicKey;
  expiry: bigint;
  mintQuote: PublicKey;
  mintUnderlying: PublicKey;
  programId: PublicKey;
  seller: PublicKey;
}) {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("covered-call"),
      seeds.seller.toBuffer(),
      seeds.buyer.toBuffer(),
      seeds.mintUnderlying.toBuffer(),
      seeds.mintQuote.toBuffer(),
      new BN(seeds.amountUnderlying.toString()).toArrayLike(Buffer, "le", 8),
      new BN(seeds.amountQuote.toString()).toArrayLike(Buffer, "le", 8),
      new BN(seeds.expiry.toString()).toArrayLike(Buffer, "le", 8),
    ],
    seeds.programId
  );
  return pda;
}
