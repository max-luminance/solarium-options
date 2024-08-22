import { describe, it, expect } from "vitest";
import { startAnchor, BanksClient } from "solana-bankrun";
import { BankrunProvider } from "anchor-bankrun";
import * as anchor from "@coral-xyz/anchor";
import * as token from "@solana/spl-token";
import { Program } from "@coral-xyz/anchor";
import { SolanaOptions } from "../target/types/solana_options.js";
import IDL from "../target/idl/solana_options.json";
import {
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "spl-token-bankrun";
import { Keypair, PublicKey } from "@solana/web3.js";

async function getAtaTokenBalance(
  client: BanksClient,
  mint: PublicKey,
  user: PublicKey
) {
  const ata = token.getAssociatedTokenAddressSync(mint, user, true);

  return (await getAccount(client, ata)).amount;
}

const fixture = async () => {
  const context = await startAnchor(".", [], []);
  const provider = new BankrunProvider(context);

  // @ts-ignore
  const program = new Program<SolanaOptions>(IDL, provider);

  const authority = anchor.web3.Keypair.generate();

  const seller = context.payer;
  const buyer = Keypair.generate();

  const [wsol, usdc] = await Promise.all([
    createMint(
      context.banksClient,
      context.payer,
      authority.publicKey,
      authority.publicKey,
      9
    ),
    createMint(
      context.banksClient,
      context.payer,
      authority.publicKey,
      authority.publicKey,
      6
    ),
  ]);

  const ata_seller = await createAssociatedTokenAccount(
    context.banksClient,
    context.payer,
    wsol,
    context.payer.publicKey
  );

  await mintTo(
    context.banksClient,
    context.payer,
    wsol,
    ata_seller,
    authority,
    BigInt(1000)
  );

  const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("covered-call"), context.payer.publicKey.toBuffer()],
    program.programId
  );

  return {
    context,
    program,
    provider,
    pda,
    wsol,
    seller,
    usdc,
    buyer,
  };
};
expect.extend({
  toBeBN: (actual: anchor.BN, expected: anchor.BN) => {
    return {
      pass: actual.eq(expected),
      message: () => `expected ${expected} to be ${actual}`,
      actual: actual.toString(),
      expected: expected.toString(),
    };
  },
});

describe("solana-options", () => {
  it("Can initialize option", async () => {
    const { context, program, pda, wsol, seller, usdc, buyer } =
      await fixture();

    expect(
      await getAtaTokenBalance(context.banksClient, wsol, seller.publicKey)
    ).to.equal(BigInt(1000));

    const expiry = new anchor.BN(Math.floor(Date.now() / 1000) + 60);
    const tx = await program.methods
      .initialize(
        new anchor.BN("1000"),
        new anchor.BN(1),
        new anchor.BN(expiry)
      )
      .accounts({
        mintUnderlying: wsol,
        mintQuote: usdc,
        buyer: buyer.publicKey,
      })
      .rpc();

    // Check state
    expect(await program.account.coveredCall.fetch(pda)).toStrictEqual({
      amountQuote: expect.toBeBN(new anchor.BN(1)),
      amountUnderlying: expect.toBeBN(new anchor.BN(1000)),
      buyer: buyer.publicKey,
      expiryUnixTimestamp: expect.toBeBN(expiry),
      mintQuote: usdc,
      mintUnderlying: wsol,
      seller: context.payer.publicKey,
    });

    expect(
      await getAtaTokenBalance(context.banksClient, wsol, seller.publicKey)
    ).to.equal(BigInt(0));

    expect(await getAtaTokenBalance(context.banksClient, wsol, pda)).to.equal(
      BigInt(1000)
    );
  });

  it("Can reject initialize with expiry in the past", async () => {
    const { context, program, wsol, seller, usdc, buyer } = await fixture();

    expect(
      await getAtaTokenBalance(context.banksClient, wsol, seller.publicKey)
    ).to.equal(BigInt(1000));

    await expect(
      program.methods
        .initialize(
          new anchor.BN("1000"),
          new anchor.BN(1),
          new anchor.BN(Math.floor(Date.now() / 1000) - 600)
        )
        .accounts({
          mintUnderlying: wsol,
          mintQuote: usdc,
          buyer: buyer.publicKey,
        })
        .rpc()
    ).rejects.toThrowError(
      /^AnchorError thrown in programs\/solana-options\/src\/instructions\/initialize.rs:\d+. Error Code: ExpiryIsInThePast. Error Number: 6000. Error Message: Expiry is in the past.$/
    );
  });
  it("Can reject initialize with insufficient underlying", async () => {
    const { context, program, wsol, seller, usdc, buyer } = await fixture();

    expect(
      await getAtaTokenBalance(context.banksClient, wsol, seller.publicKey)
    ).to.equal(BigInt(1000));

    await expect(
      program.methods
        .initialize(
          new anchor.BN("10000"),
          new anchor.BN(1),
          new anchor.BN(Math.floor(Date.now() / 1000) + 60)
        )
        .accounts({
          mintUnderlying: wsol,
          mintQuote: usdc,
          buyer: buyer.publicKey,
        })
        .rpc()
    ).rejects.toThrowError(
      "AnchorError caused by account: ata_seller_underlying. Error Code: ConstraintRaw. Error Number: 2003. Error Message: A raw constraint was violated."
    );
  });
});
