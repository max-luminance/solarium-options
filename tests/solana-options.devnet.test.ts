import fs from "fs";
import { describe, it, expect, beforeAll } from "vitest";
import {
  Program,
  Idl,
  AnchorProvider,
  setProvider,
  Wallet,
  BN,
  web3,
} from "@coral-xyz/anchor";
import {
  createAssociatedTokenAccount,
  createAssociatedTokenAccountInstruction,
  createCloseAccountInstruction,
  createMint,
  createSyncNativeInstruction,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  mintTo,
  NATIVE_MINT,
} from "@solana/spl-token";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Signer,
  Transaction,
  Keypair,
} from "@solana/web3.js";

import { SolanaOptions } from "../target/types/solana_options";
import IDL from "../target/idl/solana_options.json";
import { getPda } from "./helpers";
import { parseUnits } from "./viem";

const RPC = "https://api.devnet.solana.com";
const connection = new Connection(RPC, {
  commitment: "confirmed",
});

const log = (msg: string, signature: string): void => {
  const url =
    connection.rpcEndpoint === "http://localhost:8899"
      ? `https://explorer.solana.com/transaction/${signature}?cluster=custom&customUrl=${connection.rpcEndpoint}`
      : `https://solana.fm/tx/${signature}?cluster=devnet-solana`;

  console.log(`${msg} with ${url}`);
};

const faddr = (addr: PublicKey) =>
  `${addr.toString().slice(0, 5)}...${addr.toString().slice(-5)}`;

const loadWallet = (file: string) =>
  web3.Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(file, "utf-8")))
  );

const payer = loadWallet("./.secrets/payer.json");
const seller = loadWallet("./.secrets/seller.json");
const buyer = loadWallet("./.secrets/buyer.json");

const provider = new AnchorProvider(connection, new Wallet(seller), {});
setProvider(provider);

const program = new Program<SolanaOptions>(IDL as SolanaOptions, provider);

const programId = new PublicKey("3JZ99S1BGfcdExZ4immxWKSGAFkbe3hxZo9NRxvrair4");

// async function getProgramAccounts(program: Program<SolanaOptions>) {
//   const accounts = await program.account.coveredCall.all();

//   return accounts.map((a) => ({
//     pda: a.publicKey,
//     amountPremium: a.account.amountPremium,
//     amountQuote: a.account.amountQuote,
//     amountUnderlying: a.account.amountUnderlying,
//     buyer: a.account.buyer,
//     timestampExpiry: a.account.timestampExpiry,
//     mintQuote: a.account.mintQuote,
//     mintUnderlying: a.account.mintUnderlying,
//     seller: a.account.seller,
//     bump: a.account.bump,
//     isExercised: a.account.isExercised,
//   }));
// }

describe.skip(
  "Devnet Solana Options",
  {
    timeout: 60_000,
    sequential: true,
  },
  () => {
    const amountBase = parseUnits("0.1", 9);
    const amountQuote = parseUnits("0.01", 6);
    const amountPremium = parseUnits("0.02", 9);

    const expiry = new BN(Math.floor(Date.now() / 1000) + 60);

    const usdcKeypair = Keypair.fromSecretKey(
      Buffer.from(JSON.parse(fs.readFileSync("./.secrets/usdc.json", "utf-8")))
    );
    const usdc = usdcKeypair.publicKey;

    const ataBuyerSol = getAssociatedTokenAddressSync(
      NATIVE_MINT,
      buyer.publicKey
    );
    const ataSellerSol = getAssociatedTokenAddressSync(
      NATIVE_MINT,
      seller.publicKey
    );
    const ataBuyerQuote = getAssociatedTokenAddressSync(usdc, buyer.publicKey);
    const ataSellerQuote = getAssociatedTokenAddressSync(
      usdc,
      seller.publicKey
    );
    const pda = getPda({
      amountQuote: amountQuote,
      amountBase: amountBase,
      buyer: buyer.publicKey,
      expiry: BigInt(expiry.toString()),
      mintQuote: usdc,
      mintBase: NATIVE_MINT,
      programId: programId,
      seller: provider.wallet.publicKey,
    });

    beforeAll(async () => {
      console.log("Running against: ", RPC);
      console.log("Seller       :", seller.publicKey.toString());
      console.log("Seller WSOL  :", ataSellerSol.toString());
      console.log("Seller USDC  :", ataSellerQuote.toString());
      console.log("");
      console.log("Buyer        :", buyer.publicKey.toString());
      console.log("Buyer WSOL   :", ataBuyerSol.toString());
      console.log("Buyer USDC   :", ataBuyerQuote.toString());
      console.log("");
      console.log("Vault PDA    :", pda.toString());
      console.log(
        "Vault WSOL   :",
        getAssociatedTokenAddressSync(NATIVE_MINT, pda, true).toString()
      );
      console.log(
        "Vault USDC   :",
        getAssociatedTokenAddressSync(usdc, pda, true).toString()
      );
      const [solPayer, solSeller, solBuyer] = await Promise.all(
        [payer, seller, buyer].map((a) =>
          connection.getBalance(a.publicKey).then((x) => BigInt(x))
        )
      );

      // Fund all accounts with necessary SOL
      if (solPayer < parseUnits("1", 9)) {
        const sig = await connection.requestAirdrop(
          payer.publicKey,
          Number(parseUnits("5", 9))
        );
        log("Requested airdrop to payer", sig);
      }
      const gas = parseUnits("0.1", 9);
      if (solSeller < amountBase + gas) {
        const tx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: payer.publicKey,
            toPubkey: seller.publicKey,
            lamports: amountBase + gas - solSeller,
          })
        );
        tx.feePayer = payer.publicKey;
        await connection
          .sendTransaction(tx, [payer])
          .then((sig) => log("Topped up sol to seller", sig));
      }

      if (solBuyer < amountQuote + gas) {
        const tx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: payer.publicKey,
            toPubkey: buyer.publicKey,
            lamports: amountQuote + gas - solBuyer,
          })
        );
        tx.feePayer = payer.publicKey;
        await connection
          .sendTransaction(tx, [payer])
          .then((sig) => log("Topped up quote to buyer", sig));
      }

      // Create USDC if not exists
      if ((await connection.getAccountInfo(usdc)) === null) {
        await createMint(
          connection,
          payer,
          payer.publicKey,
          null,
          6,
          usdcKeypair
        ).then(() => {
          console.log("Created USDC Mint", usdc.toString());
        });
      }

      if ((await connection.getAccountInfo(ataSellerQuote)) === null) {
        await createAssociatedTokenAccount(
          connection,
          payer,
          usdc,
          seller.publicKey
        ).then(() => console.log("Created Seller USDC ata"));
      }

      // Airdrop USDC to buyer
      if ((await connection.getAccountInfo(ataBuyerQuote)) === null) {
        await createAssociatedTokenAccount(
          connection,
          payer,
          usdc,
          buyer.publicKey
        ).then(() => console.log("Created Buyer USDC ata"));
        await mintTo(
          connection,
          payer,
          usdc,
          ataBuyerQuote,
          payer,
          amountQuote
        ).then(() => console.log("Minted USDC to Buyer"));
      }

      const info = await getAccount(connection, ataBuyerQuote);
      if (info.amount < amountQuote) {
        await mintTo(
          connection,
          payer,
          usdc,
          ataBuyerQuote,
          payer,
          amountQuote - info.amount
        ).then(() => console.log("Minted USDC to Buyer"));
      }
    }, 100_000);

    it("Can initialize option", async () => {
      const tx = await program.methods
        .initialize(
          new BN(amountBase.toString()),
          new BN(amountQuote.toString()),
          expiry
        )
        .preInstructions([
          createAssociatedTokenAccountInstruction(
            seller.publicKey,
            ataSellerSol,
            seller.publicKey,
            NATIVE_MINT
          ),
          SystemProgram.transfer({
            fromPubkey: seller.publicKey,
            toPubkey: ataSellerSol,
            lamports: amountBase,
          }),
          createSyncNativeInstruction(ataSellerSol),
        ])
        .accounts({
          buyer: buyer.publicKey,
          mintQuote: usdc,
          mintBase: NATIVE_MINT,
          seller: seller.publicKey,
        })
        .postInstructions([
          createCloseAccountInstruction(
            ataSellerSol,
            seller.publicKey,
            seller.publicKey
          ),
        ])
        .signers([seller])
        .rpc();

      log("Initialized option", tx);

      expect(await program.account.coveredCall.fetch(pda)).toStrictEqual({
        amountPremium: null,
        amountQuote: expect.toBeBN(new BN(amountQuote.toString())),
        amountBase: expect.toBeBN(new BN(amountBase.toString())),
        buyer: buyer.publicKey,
        timestampExpiry: expect.toBeBN(expiry),
        mintQuote: usdc,
        mintBase: NATIVE_MINT,
        seller: seller.publicKey,
        bump: expect.any(Number),
        isExercised: false,
        timestampCreated: expect.any(BN),
      });
    });

    it("Can buy option", async () => {
      const tx = await program.methods
        .buy(new BN(amountPremium.toString()))
        .preInstructions([
          createAssociatedTokenAccountInstruction(
            buyer.publicKey,
            ataBuyerSol,
            buyer.publicKey,
            NATIVE_MINT
          ),
          SystemProgram.transfer({
            fromPubkey: buyer.publicKey,
            toPubkey: ataBuyerSol,
            lamports: amountPremium,
          }),
          createSyncNativeInstruction(ataBuyerSol),
        ])
        .accounts({
          data: pda,
          buyer: buyer.publicKey,
          mintPremium: NATIVE_MINT,
        })
        .postInstructions([
          createCloseAccountInstruction(
            ataBuyerSol,
            buyer.publicKey,
            buyer.publicKey
          ),
        ])
        .signers([buyer])
        .rpc();

      log("Bought option", tx);

      // Expect amount Premium to be set
      expect(await program.account.coveredCall.fetch(pda)).toStrictEqual({
        amountPremium: expect.toBeBN(new BN(amountPremium.toString())),
        amountQuote: expect.toBeBN(new BN(amountQuote.toString())),
        amountBase: expect.toBeBN(new BN(amountBase.toString())),
        buyer: buyer.publicKey,
        timestampExpiry: expect.toBeBN(expiry),
        mintQuote: usdc,
        mintBase: NATIVE_MINT,
        seller: seller.publicKey,
        bump: expect.any(Number),
        isExercised: false,
        timestampCreated: expect.any(BN),
      });
    });

    it("can exercise option", async () => {
      const tx = await program.methods
        .exercise()
        .preInstructions([
          createAssociatedTokenAccountInstruction(
            buyer.publicKey,
            ataBuyerSol,
            buyer.publicKey,
            NATIVE_MINT
          ),
        ])
        .accounts({
          mintBase: NATIVE_MINT,
          mintQuote: usdc,
          data: pda,
          buyer: buyer.publicKey,
        })
        .postInstructions([
          createCloseAccountInstruction(
            ataBuyerSol,
            buyer.publicKey,
            buyer.publicKey
          ),
        ])
        .signers([buyer])
        .rpc();
      log("Exercised option", tx);

      // Expect is exercised to be set
      expect(await program.account.coveredCall.fetch(pda)).toStrictEqual({
        amountPremium: expect.toBeBN(new BN(amountPremium.toString())),
        amountQuote: expect.toBeBN(new BN(amountQuote.toString())),
        amountBase: expect.toBeBN(new BN(amountBase.toString())),
        buyer: buyer.publicKey,
        timestampExpiry: expect.toBeBN(expiry),
        mintQuote: usdc,
        mintBase: NATIVE_MINT,
        seller: seller.publicKey,
        bump: expect.any(Number),
        isExercised: true,
        timestampCreated: expect.any(BN),
      });
    });

    it("can close option", async () => {
      const tx = await program.methods
        .close()
        .preInstructions([
          createAssociatedTokenAccountInstruction(
            seller.publicKey,
            ataSellerSol,
            seller.publicKey,
            NATIVE_MINT
          ),
        ])
        .accounts({
          mintBase: NATIVE_MINT,
          mintQuote: usdc,
          data: pda,
          seller: seller.publicKey,
          payer: seller.publicKey,
          buyer: buyer.publicKey,
        })
        .postInstructions([
          createCloseAccountInstruction(
            ataSellerSol,
            seller.publicKey,
            seller.publicKey
          ),
        ])
        .signers([seller])
        .rpc();

      log("Closed option", tx);
    });

    it("Can reset balances", async () => {
      const tx2 = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: buyer.publicKey,
          toPubkey: seller.publicKey,
          lamports: amountBase - amountPremium,
        }),
        createTransferInstruction(
          ataSellerQuote,
          ataBuyerQuote,
          seller.publicKey,
          amountQuote
        )
      );

      tx2.feePayer = payer.publicKey;
      const sig = await connection.sendTransaction(tx2, [buyer, seller, payer]);
      log("Rebalanced funds", sig);
    });
  }
);
