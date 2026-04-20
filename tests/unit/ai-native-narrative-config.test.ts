import { afterEach, describe, expect, it } from "vitest";
import { getAiNativeNarrativeConfig } from "@/lib/ai-native-narratives/config";

const originalCronSecret = process.env.CRON_SECRET;
const originalAttentraCronSecret = process.env.ATTENTRA_CRON_SECRET;
const originalFinalCount = process.env.AI_NATIVE_NARRATIVE_FINAL_COUNT;
const originalDiscoveryCandidates = process.env.AI_NATIVE_NARRATIVE_DISCOVERY_CANDIDATES;
const originalSelectionCandidates = process.env.AI_NATIVE_NARRATIVE_SELECTION_CANDIDATES;
const originalDiscoveryBatches = process.env.AI_NATIVE_NARRATIVE_DISCOVERY_BATCHES;

afterEach(() => {
  if (originalCronSecret === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = originalCronSecret;
  }

  if (originalAttentraCronSecret === undefined) {
    delete process.env.ATTENTRA_CRON_SECRET;
  } else {
    process.env.ATTENTRA_CRON_SECRET = originalAttentraCronSecret;
  }

  if (originalFinalCount === undefined) {
    delete process.env.AI_NATIVE_NARRATIVE_FINAL_COUNT;
  } else {
    process.env.AI_NATIVE_NARRATIVE_FINAL_COUNT = originalFinalCount;
  }

  if (originalDiscoveryCandidates === undefined) {
    delete process.env.AI_NATIVE_NARRATIVE_DISCOVERY_CANDIDATES;
  } else {
    process.env.AI_NATIVE_NARRATIVE_DISCOVERY_CANDIDATES = originalDiscoveryCandidates;
  }

  if (originalSelectionCandidates === undefined) {
    delete process.env.AI_NATIVE_NARRATIVE_SELECTION_CANDIDATES;
  } else {
    process.env.AI_NATIVE_NARRATIVE_SELECTION_CANDIDATES = originalSelectionCandidates;
  }

  if (originalDiscoveryBatches === undefined) {
    delete process.env.AI_NATIVE_NARRATIVE_DISCOVERY_BATCHES;
  } else {
    process.env.AI_NATIVE_NARRATIVE_DISCOVERY_BATCHES = originalDiscoveryBatches;
  }
});

describe("AI-native narrative config", () => {
  it("falls back to ATTENTRA_CRON_SECRET when CRON_SECRET is not present", () => {
    delete process.env.CRON_SECRET;
    process.env.ATTENTRA_CRON_SECRET = "attentra-secret";

    const config = getAiNativeNarrativeConfig();

    expect(config.cronSecret).toBe("attentra-secret");
    expect(config.cronSecrets).toEqual(["attentra-secret"]);
    expect(config.cronSecretNames).toEqual(["ATTENTRA_CRON_SECRET"]);
  });

  it("accepts both cron secret env names during scheduler migration", () => {
    process.env.CRON_SECRET = "primary-secret";
    process.env.ATTENTRA_CRON_SECRET = "secondary-secret";

    const config = getAiNativeNarrativeConfig();

    expect(config.cronSecret).toBe("primary-secret");
    expect(config.cronSecrets).toEqual(["primary-secret", "secondary-secret"]);
    expect(config.cronSecretNames).toEqual(["CRON_SECRET", "ATTENTRA_CRON_SECRET"]);
  });

  it("enforces a 100-row board target and large discovery pool defaults", () => {
    process.env.AI_NATIVE_NARRATIVE_FINAL_COUNT = "12";
    process.env.AI_NATIVE_NARRATIVE_DISCOVERY_CANDIDATES = "240";
    process.env.AI_NATIVE_NARRATIVE_SELECTION_CANDIDATES = "140";
    process.env.AI_NATIVE_NARRATIVE_DISCOVERY_BATCHES = "4";

    const config = getAiNativeNarrativeConfig();

    expect(config.finalNarrativeCount).toBe(100);
    expect(config.discoveryCandidateCount).toBe(240);
    expect(config.selectionCandidateCount).toBe(140);
    expect(config.discoveryBatchCount).toBe(4);
  });
});
