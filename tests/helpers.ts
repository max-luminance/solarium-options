import { expect } from "vitest";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";

expect.extend({
  toBeBN: (actual: BN, expected: BN) => {
    return {
      pass: expected.eq(actual),
      message: () => `expected ${expected} to be ${actual}`,
      actual: actual.toString(),
      expected: expected.toString(),
    };
  },
});

export function getPda(seeds: {
  amountBase: bigint;
  amountQuote: bigint;
  buyer: PublicKey;
  expiry: bigint;
  mintBase: PublicKey;
  mintQuote: PublicKey;
  programId: PublicKey;
  seller: PublicKey;
}) {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("covered-call"),
      seeds.seller.toBuffer(),
      seeds.buyer.toBuffer(),
      seeds.mintBase.toBuffer(),
      seeds.mintQuote.toBuffer(),
      new BN(seeds.amountBase.toString()).toArrayLike(Buffer, "le", 8),
      new BN(seeds.amountQuote.toString()).toArrayLike(Buffer, "le", 8),
      new BN(seeds.expiry.toString()).toArrayLike(Buffer, "le", 8),
    ],
    seeds.programId
  );
  return pda;
}
