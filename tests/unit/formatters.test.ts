import {
  clamp,
  formatCompactNumber,
  formatSigned,
  formatSignedPercent,
} from "@/lib/formatters";

describe("formatters", () => {
  it("formats compact numbers", () => {
    expect(formatCompactNumber(12_500)).toContain("K");
  });

  it("formats signed values", () => {
    expect(formatSigned(4.2)).toBe("+4.2");
    expect(formatSignedPercent(-3.5)).toBe("-3.5%");
  });

  it("clamps values into the requested range", () => {
    expect(clamp(120, 0, 100)).toBe(100);
    expect(clamp(-3, 0, 100)).toBe(0);
  });
});
