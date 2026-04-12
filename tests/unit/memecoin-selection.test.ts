import { describe, expect, it } from "vitest";
import { resolveSelectedLiveMemecoinId } from "@/lib/dashboard/memecoin-selection";

describe("memecoin selection guard", () => {
  it("falls back to the next live coin when the selected coin becomes invalid", () => {
    const rows = [
      {
        row: {
          id: "dead-coin",
          isLive: false,
          validationStatus: "invalid",
        },
      },
      {
        row: {
          id: "live-coin",
          isLive: true,
          validationStatus: "live",
        },
      },
    ];

    expect(resolveSelectedLiveMemecoinId(rows, "dead-coin")).toBe("live-coin");
  });

  it("returns null when no live rows remain", () => {
    const rows = [
      {
        row: {
          id: "dead-coin",
          isLive: false,
          validationStatus: "invalid",
        },
      },
    ];

    expect(resolveSelectedLiveMemecoinId(rows, "dead-coin")).toBeNull();
  });
});
