type DexscreenerLinkInput = {
  chainId?: string | null;
  pairAddress?: string | null;
  tokenAddress?: string | null;
  dexscreenerUrl?: string | null;
};

function normalizeMaybeString(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeLower(value: string | null | undefined) {
  return normalizeMaybeString(value)?.toLowerCase() ?? null;
}

function isValidDexscreenerUrl(value: string | null | undefined, expectedChainId?: string | null) {
  const normalized = normalizeMaybeString(value);
  if (!normalized) {
    return false;
  }

  try {
    const parsed = new URL(normalized);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase();
    if (hostname !== "dexscreener.com" && hostname !== "www.dexscreener.com") {
      return false;
    }

    const segments = parsed.pathname
      .split("/")
      .map((segment) => segment.trim())
      .filter(Boolean);
    if (segments.length < 2) {
      return false;
    }

    if (expectedChainId && normalizeLower(segments[0]) !== normalizeLower(expectedChainId)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

export function buildDexscreenerUrl(chainId: string | null | undefined, identifier: string | null | undefined) {
  const normalizedChain = normalizeLower(chainId);
  const normalizedIdentifier = normalizeMaybeString(identifier);
  if (!normalizedChain || !normalizedIdentifier) {
    return null;
  }

  return `https://dexscreener.com/${normalizedChain}/${normalizedIdentifier}`;
}

export function resolveDexscreenerUrl(input: DexscreenerLinkInput) {
  const chainId = normalizeLower(input.chainId);
  const existingUrl = normalizeMaybeString(input.dexscreenerUrl);
  if (isValidDexscreenerUrl(existingUrl, chainId)) {
    return existingUrl;
  }

  return (
    buildDexscreenerUrl(chainId, input.pairAddress) ??
    buildDexscreenerUrl(chainId, input.tokenAddress)
  );
}
