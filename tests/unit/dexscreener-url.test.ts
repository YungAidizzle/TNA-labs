import { describe, expect, it } from "vitest";
import { resolveDexscreenerUrl } from "@/lib/dashboard/dexscreener-url";

describe("resolveDexscreenerUrl", () => {
  it("prefers a stored Dexscreener url when it is already valid", () => {
    expect(
      resolveDexscreenerUrl({
        chainId: "solana",
        pairAddress: "frog-pair",
        tokenAddress: "frog-token",
        dexscreenerUrl: " https://dexscreener.com/solana/frog-custom-page ",
      }),
    ).toBe("https://dexscreener.com/solana/frog-custom-page");
  });

  it("builds a pair page when the stored url is missing or invalid", () => {
    expect(
      resolveDexscreenerUrl({
        chainId: "base",
        pairAddress: "0xPair123",
        tokenAddress: "0xToken123",
        dexscreenerUrl: "javascript:alert('nope')",
      }),
    ).toBe("https://dexscreener.com/base/0xPair123");
  });

  it("falls back to a token page when no pair address is available", () => {
    expect(
      resolveDexscreenerUrl({
        chainId: "ethereum",
        pairAddress: "",
        tokenAddress: "0x6982508145454ce325ddbe47a25d4ec3d2311933",
        dexscreenerUrl: null,
      }),
    ).toBe("https://dexscreener.com/ethereum/0x6982508145454ce325ddbe47a25d4ec3d2311933");
  });

  it("returns null when no valid Dexscreener destination can be resolved", () => {
    expect(
      resolveDexscreenerUrl({
        chainId: "",
        pairAddress: "",
        tokenAddress: "",
        dexscreenerUrl: "https://example.com/not-dexscreener",
      }),
    ).toBeNull();
  });
});
