import * as anchor from "@coral-xyz/anchor";

interface CustomMatchers<R = unknown> {
  toBeBN: (expected: anchor.BN) => R;
}

declare module "vitest" {
  interface Assertion<T = any> extends CustomMatchers<T> {}
  interface AsymmetricMatchersContaining extends CustomMatchers {}
}
