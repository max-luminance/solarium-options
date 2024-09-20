import { describe, it, expect } from "vitest";
import {
  startAnchor,
  BanksClient,
  ProgramTestContext,
  Clock,
} from "solana-bankrun";
import { BankrunProvider } from "anchor-bankrun";
import * as anchor from "@coral-xyz/anchor";
import * as token from "@solana/spl-token";
import { PythSolanaReceiver } from "@pythnetwork/pyth-solana-receiver";
import { Program } from "@coral-xyz/anchor";
import { SolanaOptions } from "../target/types/solana_options.js";
import IDL from "../target/idl/solana_options.json";
import BN from "bn.js";
import {
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "spl-token-bankrun";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, Signer } from "@solana/web3.js";
import { getExpiryPda, getPda, getStrikePrice } from "./helpers.js";
import { getI32Codec, getI64Codec, getU64Codec } from "@solana/codecs-numbers";

const authority = anchor.web3.Keypair.generate();
const priceUpdate = new PublicKey(
  "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE",
);
async function getAtaTokenBalance(
  client: BanksClient,
  mint: PublicKey,
  user: PublicKey,
) {
  const ata = token.getAssociatedTokenAddressSync(mint, user, true);

  return await getAccount(client, ata)
    .then((account) => account.amount)
    .catch(() => BigInt(0));
}

// From https://github.com/kevinheavey/solana-bankrun/issues/3#issuecomment-2211797870
async function airdrop(
  context: ProgramTestContext,
  user: PublicKey,
  lamports: bigint | number,
) {
  const accountInfo = await context.banksClient.getAccount(user);
  const newBalance =
    BigInt(accountInfo ? accountInfo.lamports : 0) + BigInt(lamports);

  context.setAccount(user, {
    lamports: Number(newBalance),
    data: Buffer.alloc(0),
    owner: PublicKey.default,
    executable: false,
  });
}

async function fundAtaAccountWithPayer(
  client: BanksClient,
  mint: PublicKey,
  payer: Signer,
  user: PublicKey,
  amount: bigint | number,
) {
  const ata = await createAssociatedTokenAccount(client, payer, mint, user);

  await mintTo(client, payer, mint, ata, authority, amount);
}

async function fundAtaAccount(
  client: BanksClient,
  mint: PublicKey,
  signer: Signer,
  amount: bigint | number,
) {
  return fundAtaAccountWithPayer(
    client,
    mint,
    signer,
    signer.publicKey,
    amount,
  );
}

const warpTo = async (context: ProgramTestContext, ms: anchor.BN) => {
  const currentClock = await context.banksClient.getClock();
  context.setClock(
    new Clock(
      currentClock.slot,
      currentClock.epochStartTimestamp,
      currentClock.epoch,
      currentClock.leaderScheduleEpoch,
      BigInt(ms.toNumber() + 100),
    ),
  );
};

const fixtureDeployed = async () => {
  const context = await startAnchor(".", [], []);
  const payer = context.payer;
  const buyer = Keypair.generate();
  const seller = Keypair.generate();
  await Promise.all([
    airdrop(context, buyer.publicKey, 1 * LAMPORTS_PER_SOL),
    airdrop(context, seller.publicKey, 1 * LAMPORTS_PER_SOL),
  ]);

  const provider = new BankrunProvider(context, new anchor.Wallet(seller));

  // @ts-ignore
  const program = new Program<SolanaOptions>(IDL, provider);

  const [wsol, usdc] = await Promise.all([
    createMint(
      context.banksClient,
      context.payer,
      authority.publicKey,
      authority.publicKey,
      9,
    ),
    createMint(
      context.banksClient,
      context.payer,
      authority.publicKey,
      authority.publicKey,
      6,
    ),
  ]);

  await Promise.all([
    fundAtaAccount(context.banksClient, wsol, seller, BigInt(1000)),
    fundAtaAccount(context.banksClient, wsol, buyer, BigInt(1000)),
  ]);

  const setPrice = (price: number, time = new Date()) => {
    const buff = Buffer.concat([
      Buffer.from([0x22, 0xf1, 0x23, 0x63, 0x9d, 0x7e, 0xf4, 0xcd]), // Discriminator
      new PublicKey("7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE").toBuffer(), // Write Authority
      Buffer.from([0x01]), // Verification Level
      Buffer.from("7w2Lb9os66QdoV1AldHaOSoNL47Qxse8D0z6yMKAtW0", "base64"), // Price Message - Fee ID
      getI64Codec().encode(price * 10 ** 8), // Price Message - Price
      getU64Codec().encode(12190053), // Price Message - Conf
      getI32Codec().encode(-8), // Price Message - Exponent
      getI64Codec().encode(Math.floor(time.getTime() / 1000)), // Price Message - PublishTime
      getI64Codec().encode(Math.floor(time.getTime() / 1000)), // Price Message - Prev Publish Time
      getI64Codec().encode(13867629500n), // Price Message - Ema Price
      getU64Codec().encode(10350801n), // Price Message - Ema Conf
      getU64Codec().encode(327071567n), // Posted Slot
    ]);

    context.setAccount(priceUpdate, {
      data: buff,
      owner: new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ"),
      executable: false,
      lamports: 201823520,
    });
  };

  return {
    context,
    program,
    provider,
    wsol,
    seller,
    usdc,
    buyer,
    payer,
    setPrice,
  };
};

const fixtureInitialized = async () => {
  const fixture = await fixtureDeployed();
  const { context, program, wsol, usdc, buyer, seller } = fixture;
  const expiry = new anchor.BN(Math.floor(Date.now() / 1000) + 180);
  await program.methods
    .initialize(
      new anchor.BN("1000"),
      new anchor.BN("3500"),
      new anchor.BN(expiry),
    )
    .accounts({
      mintBase: wsol,
      mintQuote: usdc,
      buyer: buyer.publicKey,
    })
    .rpc();

  const pda = getPda({
    amountQuote: 3500n,
    amountBase: 1000n,
    buyer: buyer.publicKey,
    expiry: BigInt(expiry.toString()),
    mintQuote: usdc,
    mintBase: wsol,
    programId: program.programId,
    seller: seller.publicKey,
  });

  return {
    expiry,
    pda,
    ...fixture,
  };
};

const fixtureBought = async () => {
  const fixture = await fixtureInitialized();
  const { program, pda, buyer, wsol } = fixture;

  await program.methods
    .buy(new anchor.BN(10))
    .accounts({
      data: pda,
      buyer: buyer.publicKey,
      mintPremium: wsol,
      payer: buyer.publicKey,
    })
    .signers([buyer])
    .rpc();

  return fixture;
};

const fixtureExercised = async () => {
  const fixture = await fixtureBought();
  const { program, pda, buyer, wsol, context, usdc, setPrice, expiry } =
    fixture;

  setPrice(4000);
  await program.methods.mark(expiry).accounts({ priceUpdate }).rpc();
  await warpTo(context, expiry.add(new anchor.BN(10)));

  // Create and fund the ata account for the buyer
  await fundAtaAccount(context.banksClient, usdc, buyer, BigInt(3500));
  await program.methods
    .exercise()
    .accounts({
      mintBase: wsol,
      mintQuote: usdc,
      data: pda,
      buyer: buyer.publicKey,
    })
    .signers([buyer])
    .rpc();

  return fixture;
};

describe("solana-options", { timeout: 100_000 }, () => {
  describe("initialize instruction", () => {
    it("Can initialize option", async () => {
      const { context, program, wsol, seller, usdc, buyer } =
        await fixtureDeployed();

      expect(
        await getAtaTokenBalance(context.banksClient, wsol, seller.publicKey),
      ).to.equal(BigInt(1000));

      const expiry = new anchor.BN(Math.floor(Date.now() / 1000) + 60);
      await airdrop(context, seller.publicKey, 10_000 * LAMPORTS_PER_SOL);
      expect(
        await getAtaTokenBalance(context.banksClient, wsol, seller.publicKey),
      ).to.equal(BigInt(1000));

      const pda = getPda({
        amountQuote: 42n,
        amountBase: 1000n,
        buyer: buyer.publicKey,
        expiry: BigInt(expiry.toString()),
        mintQuote: usdc,
        mintBase: wsol,
        programId: program.programId,
        seller: seller.publicKey,
      });
      const ata = token.getAssociatedTokenAddressSync(wsol, pda, true);
      // await fundAtaAccountWithPayer(context.banksClient, wsol, seller, pda, 0);
      const tx = await program.methods
        .initialize(
          new anchor.BN("1000"),
          new anchor.BN("42"),
          new anchor.BN(expiry),
        )
        .accounts({
          buyer: buyer.publicKey,
          mintQuote: usdc,
          mintBase: wsol,
          seller: seller.publicKey,
          // data: pda,
        })
        .signers([seller])
        .rpc();

      // Check state
      expect(await program.account.coveredCall.fetch(pda)).toStrictEqual({
        amountBase: expect.toBeBN(new anchor.BN(1000)),
        amountPremium: null,
        amountQuote: expect.toBeBN(new anchor.BN(42)),
        bump: expect.any(Number),
        buyer: buyer.publicKey,
        isExercised: false,
        mintBase: wsol,
        mintQuote: usdc,
        seller: seller.publicKey,
        timestampExpiry: expect.toBeBN(expiry),
        timestampCreated: expect.toBeBN(new anchor.BN(Date.now() / 1000)),
      });

      expect(
        await getAtaTokenBalance(context.banksClient, wsol, seller.publicKey),
      ).to.equal(BigInt(0));

      expect(await getAtaTokenBalance(context.banksClient, wsol, pda)).to.equal(
        BigInt(1000),
      );
    });

    it.skip("Can mint same option twice ", async () => {
      const { context, program, seller, usdc, buyer } = await fixtureDeployed();

      expect(
        await getAtaTokenBalance(context.banksClient, wsol, seller.publicKey),
      ).to.equal(BigInt(1000));

      const expiry = new anchor.BN(Math.floor(Date.now() / 1000) + 60);
      await program.methods
        .initialize(
          new anchor.BN("500"),
          new anchor.BN(1),
          new anchor.BN(expiry),
        )
        .accounts({
          mintBase: wsol,
          mintQuote: usdc,
          buyer: buyer.publicKey,
        })
        .rpc();

      await program.methods
        .initialize(
          new anchor.BN("500"),
          new anchor.BN(1),
          new anchor.BN(expiry),
        )
        .accounts({
          mintBase: wsol,
          mintQuote: usdc,
          buyer: buyer.publicKey,
        })
        .rpc();
    });

    it("Can reject initialize with expiry in the past", async () => {
      const { context, program, wsol, seller, usdc, buyer } =
        await fixtureDeployed();

      expect(
        await getAtaTokenBalance(context.banksClient, wsol, seller.publicKey),
      ).to.equal(BigInt(1000));

      await expect(
        program.methods
          .initialize(
            new anchor.BN("1000"),
            new anchor.BN(1),
            new anchor.BN(Math.floor(Date.now() / 1000) - 600),
          )
          .accounts({
            mintBase: wsol,
            mintQuote: usdc,
            buyer: buyer.publicKey,
          })
          .rpc(),
      ).rejects.toThrowError(
        /^AnchorError thrown in programs\/solana-options\/src\/instructions\/initialize.rs:\d+. Error Code: ExpiryIsInThePast. Error Number: 6000. Error Message: Expiry is in the past.$/,
      );
    });
    it("Can reject initialize with insufficient base", async () => {
      const { context, program, wsol, seller, usdc, buyer } =
        await fixtureDeployed();

      expect(
        await getAtaTokenBalance(context.banksClient, wsol, seller.publicKey),
      ).to.equal(BigInt(1000));

      await expect(
        program.methods
          .initialize(
            new anchor.BN("10000"),
            new anchor.BN(1),
            new anchor.BN(Math.floor(Date.now() / 1000) + 60),
          )
          .accounts({
            mintBase: wsol,
            mintQuote: usdc,
            buyer: buyer.publicKey,
          })
          .rpc(),
      ).rejects.toThrowError(
        "AnchorError caused by account: ata_seller_base. Error Code: ConstraintRaw. Error Number: 2003. Error Message: A raw constraint was violated.",
      );
    });
  });

  describe("Buy instruction", () => {
    it("Can allow buyer to successfully buy ", async () => {
      const { program, pda, buyer, wsol, context, expiry, usdc, seller } =
        await fixtureInitialized();

      expect(
        await getAtaTokenBalance(context.banksClient, wsol, buyer.publicKey),
      ).to.equal(BigInt(1000));

      await program.methods
        .buy(new anchor.BN(10))
        .accounts({
          data: pda,
          buyer: buyer.publicKey,
          mintPremium: wsol,
          payer: buyer.publicKey,
        })
        .signers([buyer])
        .rpc();

      // Check state
      expect(await program.account.coveredCall.fetch(pda)).toStrictEqual({
        amountBase: expect.toBeBN(new BN(1000)),
        amountPremium: expect.toBeBN(new BN(10)),
        amountQuote: expect.toBeBN(new BN(3500)),
        bump: expect.any(Number),
        buyer: buyer.publicKey,
        isExercised: false,
        mintBase: wsol,
        mintQuote: usdc,
        seller: seller.publicKey,
        timestampCreated: expect.any(BN),
        timestampExpiry: expect.toBeBN(expiry),
      });

      expect(
        await getAtaTokenBalance(context.banksClient, wsol, buyer.publicKey),
      ).to.equal(BigInt(990));

      expect(await getAtaTokenBalance(context.banksClient, wsol, pda)).to.equal(
        BigInt(1010),
      );
    });

    it("Can allow 3rd party to successfully buy for buyer", async () => {
      const { program, pda, buyer, wsol, context, expiry, usdc, seller } =
        await fixtureInitialized();

      const keeper = Keypair.generate();
      await airdrop(context, keeper.publicKey, 1 * LAMPORTS_PER_SOL);
      await fundAtaAccount(context.banksClient, wsol, keeper, BigInt(1000)),
        await program.methods
          .buy(new anchor.BN(10))
          .accounts({
            data: pda,
            buyer: buyer.publicKey,
            mintPremium: wsol,
            payer: keeper.publicKey,
          })
          .signers([keeper])
          .rpc();

      // Check state
      expect(await program.account.coveredCall.fetch(pda)).toStrictEqual({
        amountBase: expect.toBeBN(new BN(1000)),
        amountPremium: expect.toBeBN(new BN(10)),
        amountQuote: expect.toBeBN(new BN(3500)),
        bump: expect.any(Number),
        buyer: buyer.publicKey,
        isExercised: false,
        mintBase: wsol,
        mintQuote: usdc,
        seller: seller.publicKey,
        timestampCreated: expect.toBeBN(new BN(Date.now() / 1000)),
        timestampExpiry: expect.toBeBN(expiry),
      });

      expect(
        await getAtaTokenBalance(context.banksClient, wsol, keeper.publicKey),
      ).to.equal(BigInt(990));

      expect(await getAtaTokenBalance(context.banksClient, wsol, pda)).to.equal(
        BigInt(1010),
      );
    });

    it("Can reject if option has already been bought", async () => {
      const { program, pda, buyer, wsol, context, expiry } =
        await fixtureInitialized();

      await program.methods
        .buy(new anchor.BN(10))
        .accounts({
          data: pda,
          buyer: buyer.publicKey,
          mintPremium: wsol,
          payer: buyer.publicKey,
        })
        .signers([buyer])
        .rpc();

      // Wait to avoid getting the error "This transaction has already been processed"
      await new Promise((resolve) => setTimeout(resolve, 1));

      await expect(
        program.methods
          .buy(new anchor.BN(10))
          .accounts({
            buyer: buyer.publicKey,
            data: pda,
            mintPremium: wsol,
            payer: buyer.publicKey,
          })
          .signers([buyer])
          .rpc(),
      ).rejects.toThrowError(
        /AnchorError thrown in programs\/solana-options\/src\/instructions\/buy.rs:\d\d. Error Code: OptionAlreadyBought. Error Number: 6002. Error Message: Option is already bought./,
      );
    });

    it("Can reject if option is expired", async () => {
      const { program, pda, buyer, wsol, context, expiry } =
        await fixtureInitialized();

      // Lets warp past the expiry
      await warpTo(context, expiry.add(new anchor.BN(100)));

      await expect(
        program.methods
          .buy(new anchor.BN(10))
          .accounts({
            payer: buyer.publicKey,
            data: pda,
            buyer: buyer.publicKey,
            mintPremium: wsol,
          })
          .signers([buyer])
          .rpc(),
      ).rejects.toThrowError(
        /AnchorError thrown in programs\/solana-options\/src\/instructions\/buy.rs:\d\d. Error Code: OptionExpired. Error Number: 6001. Error Message: Option has expired./,
      );
    });

    it("Can reject buy if premium is not in base", async () => {
      const { program, pda, seller, buyer, wsol, context, usdc } =
        await fixtureInitialized();

      await fundAtaAccount(context.banksClient, usdc, buyer, BigInt(500));

      expect(
        await getAtaTokenBalance(context.banksClient, usdc, buyer.publicKey),
      ).to.equal(BigInt(500));

      await expect(
        program.methods
          .buy(new anchor.BN(500))
          .accounts({
            payer: buyer.publicKey,
            data: pda,
            buyer: buyer.publicKey,
            mintPremium: usdc,
          })
          .signers([buyer])
          .rpc(),
      ).rejects.toThrowError(
        "AnchorError caused by account: ata_vault_premium. Error Code: AccountNotInitialized. Error Number: 3012. Error Message: The program expected this account to be already initialized.",
      );

      // Also test when ata is initialized
      await createAssociatedTokenAccount(context.banksClient, buyer, usdc, pda);

      await expect(
        program.methods
          .buy(new anchor.BN(500))
          .accounts({
            payer: buyer.publicKey,
            data: pda,
            buyer: buyer.publicKey,
            mintPremium: usdc,
          })
          .signers([buyer])
          .rpc(),
      ).rejects.toThrowError(
        "AnchorError caused by account: mint_premium. Error Code: ConstraintRaw. Error Number: 2003. Error Message: A raw constraint was violated.",
      );
    });

    it("Can reject if buyer has insufficient funds", async () => {
      const { program, pda, buyer, wsol, context } = await fixtureInitialized();

      expect(
        await getAtaTokenBalance(context.banksClient, wsol, buyer.publicKey),
      ).to.equal(BigInt(1000));
      await expect(
        program.methods
          .buy(new anchor.BN(2000))
          .accounts({
            payer: buyer.publicKey,
            data: pda,
            buyer: buyer.publicKey,
            mintPremium: wsol,
          })
          .signers([buyer])
          .rpc(),
      ).rejects.toThrowError(
        "AnchorError caused by account: ata_buyer_premium. Error Code: ConstraintRaw. Error Number: 2003. Error Message: A raw constraint was violated.",
      );
    });

    it("Can reject if not buyer", async () => {
      const { program, pda, seller, wsol } = await fixtureInitialized();

      await expect(
        program.methods
          .buy(new anchor.BN(1))
          .accounts({
            payer: seller.publicKey,
            data: pda,
            buyer: seller.publicKey,
            mintPremium: wsol,
          })
          .signers([seller])
          .rpc(),
      ).rejects.toThrowError(
        "AnchorError caused by account: buyer. Error Code: ConstraintRaw. Error Number: 2003. Error Message: A raw constraint was violated",
      );
    });
  });

  describe("Exercise instruction", () => {
    it("Can reject if option has not been marked", async () => {
      const { program, pda, buyer, wsol, context, usdc } =
        await fixtureBought();

      await expect(
        program.methods
          .exercise()
          .accounts({
            mintBase: wsol,
            mintQuote: usdc,
            data: pda,
            buyer: buyer.publicKey,
          })
          .signers([buyer])
          .rpc(),
      ).rejects.toThrowError(
        "AnchorError caused by account: expiry. Error Code: AccountNotInitialized. Error Number: 3012. Error Message: The program expected this account to be already initialized.",
      );
    });

    const fixtureMarked = async () => {
      const fixture = await fixtureBought();
      const { program, setPrice, expiry } = fixture;
      setPrice(4000);
      await program.methods.mark(expiry).accounts({ priceUpdate }).rpc();
      return fixture;
    };

    it("Can exercise", async () => {
      const { program, pda, buyer, wsol, context, usdc, setPrice, expiry } =
        await fixtureMarked();

      expect(
        await getAtaTokenBalance(context.banksClient, wsol, buyer.publicKey),
      ).to.equal(BigInt(990));

      expect(getStrikePrice(1000n, 3500n)).to.equal(3500);

      await warpTo(context, expiry.add(new anchor.BN(100)));
      await program.methods
        .exercise()
        .accounts({
          mintBase: wsol,
          mintQuote: usdc,
          data: pda,
          buyer: buyer.publicKey,
        })
        .signers([buyer])
        .rpc();

      expect(
        await getAtaTokenBalance(context.banksClient, wsol, buyer.publicKey),
      ).to.equal(BigInt(990 + 125));
      expect(await getAtaTokenBalance(context.banksClient, wsol, pda)).to.equal(
        BigInt(1000 - 125 + 10),
      );
    });

    it("Can reject if option has already been exercised", async () => {
      const { program, pda, buyer, wsol, context, usdc, expiry } =
        await fixtureMarked();

      await warpTo(context, expiry.add(new anchor.BN(100)));
      await program.methods
        .exercise()
        .accounts({
          mintBase: wsol,
          mintQuote: usdc,
          data: pda,
          buyer: buyer.publicKey,
        })
        .signers([buyer])
        .rpc();

      // Wait to avoid getting the error "This transaction has already been processed"
      await new Promise((resolve) => setTimeout(resolve, 1));

      await expect(
        program.methods
          .exercise()
          .accounts({
            mintBase: wsol,
            mintQuote: usdc,
            data: pda,
            buyer: buyer.publicKey,
          })
          .signers([buyer])
          .rpc(),
      ).rejects.toThrowError(
        /AnchorError thrown in programs\/solana-options\/src\/instructions\/exercise.rs:\d\d. Error Code: OptionAlreadyExercised. Error Number: 6005. Error Message: Option already exercised./,
      );
    });

    it("Can reject if option hasn't been bought", async () => {
      const { program, pda, buyer, wsol, context, usdc, setPrice, expiry } =
        await fixtureInitialized();

      setPrice(4000);
      await program.methods.mark(expiry).accounts({ priceUpdate }).rpc();

      await warpTo(context, expiry.add(new anchor.BN(100)));

      await expect(
        program.methods
          .exercise()
          .accounts({
            mintBase: wsol,
            mintQuote: usdc,
            data: pda,
            buyer: buyer.publicKey,
          })
          .signers([buyer])
          .rpc(),
      ).rejects.toThrowError(
        /AnchorError thrown in programs\/solana-options\/src\/instructions\/exercise.rs:\d\d. Error Code: OptionNotPurchased. Error Number: 6003. Error Message: Option was not purchased./,
      );
    });

    it("Can reject if not buyer", async () => {
      const { program, pda, seller, wsol, usdc, context } =
        await fixtureMarked();

      await expect(
        program.methods
          .exercise()
          .accounts({
            mintBase: wsol,
            mintQuote: usdc,
            data: pda,
            buyer: seller.publicKey,
          })
          .signers([seller])
          .rpc(),
      ).rejects.toThrowError(
        "AnchorError caused by account: buyer. Error Code: ConstraintRaw. Error Number: 2003. Error Message: A raw constraint was violated.",
      );
    });

    it("Can reject if option as not expired", async () => {
      const { program, pda, buyer, wsol, context, usdc, expiry } =
        await fixtureMarked();

      await expect(
        program.methods
          .exercise()
          .accounts({
            mintBase: wsol,
            mintQuote: usdc,
            data: pda,
            buyer: buyer.publicKey,
          })
          .signers([buyer])
          .rpc(),
      ).rejects.toThrowError(
        /AnchorError thrown in programs\/solana-options\/src\/instructions\/exercise.rs:\d\d. Error Code: OptionNotExpired. Error Number: 6006. Error Message: Option has not expired./,
      );
    });
  });

  describe("Close instruction", () => {
    it("Can successfully close exercised option by seller", async () => {
      const { program, pda, buyer, wsol, context, usdc, seller } =
        await fixtureExercised();

      expect(await getAtaTokenBalance(context.banksClient, wsol, pda)).to.equal(
        BigInt(885),
      );
      expect(
        await getAtaTokenBalance(context.banksClient, wsol, seller.publicKey),
      ).to.equal(BigInt(0));

      await program.methods
        .close()
        .accounts({
          mintBase: wsol,
          data: pda,
          seller: seller.publicKey,
          buyer: buyer.publicKey,
        })
        .signers([seller])
        .rpc();

      // Expect accounts to be close
      expect(await context.banksClient.getAccount(pda)).to.equal(null);
      expect(
        await context.banksClient.getAccount(
          token.getAssociatedTokenAddressSync(wsol, pda, true),
        ),
      ).to.equal(null);
      expect(
        await context.banksClient.getAccount(
          token.getAssociatedTokenAddressSync(usdc, pda, true),
        ),
      ).to.equal(null);

      expect(await getAtaTokenBalance(context.banksClient, wsol, pda)).to.equal(
        BigInt(0),
      );
      expect(
        await getAtaTokenBalance(context.banksClient, wsol, seller.publicKey),
      ).to.equal(BigInt(885));
    });

    it("Can successfully close exercised option by anyone", async () => {
      const { program, pda, buyer, wsol, context, usdc, seller, payer } =
        await fixtureExercised();

      const keeper = Keypair.generate();
      await airdrop(context, keeper.publicKey, 1 * LAMPORTS_PER_SOL);

      expect(await getAtaTokenBalance(context.banksClient, wsol, pda)).to.equal(
        BigInt(885),
      );
      expect(
        await getAtaTokenBalance(context.banksClient, wsol, seller.publicKey),
      ).to.equal(BigInt(0));

      await fundAtaAccount(context.banksClient, usdc, seller, 0);

      await program.methods
        .close()
        .accounts({
          mintBase: wsol,
          mintQuote: usdc,
          data: pda,
          seller: seller.publicKey,
          payer: keeper.publicKey,
          buyer: buyer.publicKey,
        })
        .signers([keeper])
        .rpc();

      expect(await getAtaTokenBalance(context.banksClient, wsol, pda)).to.equal(
        BigInt(0),
      );
      expect(
        await getAtaTokenBalance(context.banksClient, wsol, seller.publicKey),
      ).to.equal(BigInt(885));
    });

    it("Can successfully close unbought option by anyone", async () => {
      const { program, pda, buyer, wsol, context, usdc, seller } =
        await fixtureInitialized();

      const keeper = Keypair.generate();
      await airdrop(context, keeper.publicKey, 1 * LAMPORTS_PER_SOL);

      expect(await getAtaTokenBalance(context.banksClient, wsol, pda)).to.equal(
        BigInt(1000),
      );
      expect(
        await getAtaTokenBalance(context.banksClient, wsol, seller.publicKey),
      ).to.equal(BigInt(0));

      await program.methods
        .close()
        .accounts({
          mintBase: wsol,
          data: pda,
          seller: seller.publicKey,
          payer: keeper.publicKey,
          buyer: buyer.publicKey,
        })
        .signers([keeper])
        .rpc();

      expect(await getAtaTokenBalance(context.banksClient, wsol, pda)).to.equal(
        BigInt(0),
      );
      expect(
        await getAtaTokenBalance(context.banksClient, wsol, seller.publicKey),
      ).to.equal(BigInt(1000));
    });

    it("Can successfully close unexercised option after expiry", async () => {
      const { program, pda, wsol, context, usdc, seller, expiry, buyer } =
        await fixtureBought();

      await warpTo(context, expiry.add(new anchor.BN(100)));

      expect(await getAtaTokenBalance(context.banksClient, wsol, pda)).to.equal(
        BigInt(1010),
      );
      expect(
        await getAtaTokenBalance(context.banksClient, wsol, seller.publicKey),
      ).to.equal(BigInt(0));

      await program.methods
        .close()
        .accounts({
          mintBase: wsol,
          data: pda,
          seller: seller.publicKey,
          payer: seller.publicKey,
          buyer: buyer.publicKey,
        })
        .signers([seller])
        .rpc();

      // Expect accounts to be close
      expect(await context.banksClient.getAccount(pda)).to.equal(null);
      expect(
        await context.banksClient.getAccount(
          token.getAssociatedTokenAddressSync(wsol, pda, true),
        ),
      ).to.equal(null);

      expect(await getAtaTokenBalance(context.banksClient, wsol, pda)).to.equal(
        BigInt(0),
      );
      expect(
        await getAtaTokenBalance(context.banksClient, wsol, seller.publicKey),
      ).to.equal(BigInt(1010));
    });

    it("Can reject closing bought option before expiry", async () => {
      const {
        program,
        pda,
        wsol,
        context,
        usdc,
        seller,
        buyer,
        expiry,
        setPrice,
      } = await fixtureBought();

      await expect(
        program.methods
          .close()
          .accounts({
            buyer: buyer.publicKey,
            data: pda,
            mintQuote: usdc,
            mintBase: wsol,
            payer: seller.publicKey,
            seller: seller.publicKey,
          })
          .signers([seller])
          .rpc(),
      ).rejects.toThrowError(
        /AnchorError thrown in programs\/solana-options\/src\/instructions\/close.rs:\d\d. Error Code: OptionCannotBeClosedYet. Error Number: 6004. Error Message: Option cannot be closed Yet./,
      );
    });
  });

  it("has correct price update account", async () => {
    const { provider } = await fixtureDeployed();

    const SOL_PRICE_FEED_ID =
      "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";

    const pyth = new PythSolanaReceiver(provider);
    expect(pyth.getPriceFeedAccountAddress(0, SOL_PRICE_FEED_ID)).to.deep.equal(
      priceUpdate,
    );
  });

  describe("Can set mark price", () => {
    it("Can reject if mark price is no close enough to expiry", async () => {
      const { program, context, provider, setPrice } = await fixtureDeployed();

      const expiry = new Date();
      const publishTime = new Date(expiry.getTime() - 30 * 60 * 1000 - 1);
      setPrice(130, publishTime);

      await expect(
        program.methods
          .mark(new anchor.BN(Math.floor(expiry.getTime() / 1000)))
          .accounts({ priceUpdate })
          .rpc(),
      ).rejects.toThrowError(
        /AnchorError thrown in programs\/solana-options\/src\/instructions\/mark.rs:\d\d. Error Code: PriceIrrelevant. Error Number: 6007. Error Message: Price not close to expiry./,
      );
    });

    it("Can set mark price after expiry", async () => {
      const { program, context, provider, setPrice } = await fixtureDeployed();

      const expiry = new Date();
      const publishTime = expiry;
      setPrice(130, publishTime);

      await warpTo(
        context,
        new BN(expiry.getTime() / 1000).add(new anchor.BN(10_000)),
      );

      await program.methods
        .mark(new anchor.BN(Math.floor(expiry.getTime() / 1000)))
        .accounts({ priceUpdate })
        .rpc();

      expect(
        await program.account.expiryData.fetch(
          getExpiryPda({ expiry, programId: program.programId }),
        ),
      ).toStrictEqual({
        bump: expect.any(Number),
        conf: expect.toBeBN(new BN(12190053)),
        price: expect.toBeBN(new BN(13000000000)),
        publishTime: expect.toBeBN(
          new BN(Math.floor(publishTime.getTime() / 1000)),
        ),
        exponent: -8,
      });
    });

    it("Can set mark price", async () => {
      const { program, context, provider, setPrice } = await fixtureDeployed();

      const publishTime = new Date(Date.now() - 1000);
      const expiry = new Date();
      setPrice(130, publishTime);

      await program.methods
        .mark(new anchor.BN(Math.floor(expiry.getTime() / 1000)))
        .accounts({ priceUpdate })
        .rpc();

      expect(
        await program.account.expiryData.fetch(
          getExpiryPda({ expiry, programId: program.programId }),
        ),
      ).toStrictEqual({
        bump: expect.any(Number),
        conf: expect.toBeBN(new BN(12190053)),
        price: expect.toBeBN(new BN(13000000000)),
        publishTime: expect.toBeBN(
          new BN(Math.floor(publishTime.getTime() / 1000)),
        ),
        exponent: -8,
      });
    });

    it("Can reject if price is after expiry", async () => {
      const { program, context, provider, setPrice } = await fixtureDeployed();

      const expiry = new Date();
      const publishTime = new Date(expiry.getTime() + 1000);
      setPrice(130, publishTime);

      await expect(
        program.methods
          .mark(new anchor.BN(Math.floor(expiry.getTime() / 1000)))
          .accounts({ priceUpdate })
          .rpc(),
      ).rejects.toThrowError(
        /AnchorError thrown in programs\/solana-options\/src\/instructions\/mark.rs:\d\d. Error Code: PriceIrrelevant. Error Number: 6007. Error Message: Price not close to expiry./,
      );
    });

    it("Can reject update if mark price is further away", async () => {
      const { program, context, provider, setPrice } = await fixtureDeployed();

      const expiry = new Date();

      setPrice(130, new Date(expiry.getTime() - 1000));
      await program.methods
        .mark(new anchor.BN(Math.floor(expiry.getTime() / 1000)))
        .accounts({ priceUpdate })
        .rpc();

      const publishTime = new Date(expiry.getTime() - 2000);
      setPrice(131, publishTime);

      await new Promise((resolve) => setTimeout(resolve, 3));

      await expect(
        program.methods
          .mark(new anchor.BN(Math.floor(expiry.getTime() / 1000)))
          .accounts({ priceUpdate })
          .rpc(),
      ).rejects.toThrowError(
        /AnchorError thrown in programs\/solana-options\/src\/instructions\/mark.rs:\d\d. Error Code: PriceIrrelevant. Error Number: 6007. Error Message: Price not close to expiry./,
      );
    });

    it("Can update if mark price is closer", async () => {
      const { program, setPrice } = await fixtureDeployed();

      const expiry = new Date();

      setPrice(130, new Date(expiry.getTime() - 2000));
      await program.methods
        .mark(new anchor.BN(Math.floor(expiry.getTime() / 1000)))
        .accounts({ priceUpdate })
        .rpc();

      await new Promise((resolve) => setTimeout(resolve, 3));

      const publishTime = new Date(expiry.getTime() - 1000);
      setPrice(131, publishTime);
      await program.methods
        .mark(new anchor.BN(Math.floor(expiry.getTime() / 1000)))
        .accounts({ priceUpdate })
        .rpc();

      expect(
        await program.account.expiryData.fetch(
          getExpiryPda({ expiry, programId: program.programId }),
        ),
      ).toStrictEqual({
        bump: expect.any(Number),
        conf: expect.toBeBN(new BN(12190053)),
        price: expect.toBeBN(new BN(13100000000)),
        publishTime: expect.toBeBN(
          new BN(Math.floor(publishTime.getTime() / 1000)),
        ),
        exponent: -8,
      });
    });
  });
});
