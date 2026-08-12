import { describe, expect, it } from "vitest";
import {
  amountMinorInputValue,
  isSafeAmountMinor,
  MAX_SAFE_AMOUNT_MINOR,
  parseAmountMinor,
} from "./money";

describe("人民币分精确转换", () => {
  it("parses decimal text without floating-point rounding", () => {
    expect(parseAmountMinor("")).toBeNull();
    expect(parseAmountMinor("0")).toBe(0);
    expect(parseAmountMinor("0.01")).toBe(1);
    expect(parseAmountMinor("12.3")).toBe(1_230);
    expect(parseAmountMinor("0.90")).toBe(90);
    expect(parseAmountMinor("0.91")).toBe(91);
    expect(parseAmountMinor("0.92")).toBe(92);
    expect(parseAmountMinor("0.93")).toBe(93);
    expect(parseAmountMinor("90071992547409.91")).toBe(MAX_SAFE_AMOUNT_MINOR);
  });

  it("rejects excess precision malformed and unsafe values", () => {
    for (const value of ["-1", "1.001", "1e3", "NaN", "90071992547409.92"]) {
      expect(() => parseAmountMinor(value)).toThrow();
    }
  });

  it("formats safe minor units back to editable decimal text", () => {
    expect(amountMinorInputValue(null)).toBe("");
    expect(amountMinorInputValue(1)).toBe("0.01");
    expect(amountMinorInputValue(1_230)).toBe("12.3");
    expect(isSafeAmountMinor(MAX_SAFE_AMOUNT_MINOR)).toBe(true);
    expect(isSafeAmountMinor(MAX_SAFE_AMOUNT_MINOR + 1)).toBe(false);
  });
});
