import { expect } from "chai";
import { startAnchor } from "solana-bankrun";
import { BankrunProvider } from "anchor-bankrun";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolanaOptions } from "../target/types/solana_options";
const IDL = require("../target/idl/solana_options.json");

// TODO:- Transfer mint to the program
describe("solana-options", () => {
  it("Is initialized!", async () => {
    const context = await startAnchor(".", [], []);
    const provider = new BankrunProvider(context);

    // Configure the client to use the local cluster.
    // anchor.setProvider(anchor.AnchorProvider.env());
    const program = new Program<SolanaOptions>(IDL, provider);

    // const program = anchor.workspace.SolanaOptions as Program<SolanaOptions>;
    // Add your test here.
    const tx = await program.methods.initialize().rpc();
    console.log("Your transaction signature", tx);

    // Check state
    const [addr] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("covered-call")],
      program.programId
    );

    const state = await program.account.coveredCall.fetch(addr);
    expect(state).to.deep.equal({
      seller: context.payer.publicKey,
    });
  });
});
