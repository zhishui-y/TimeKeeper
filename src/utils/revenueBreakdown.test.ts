import { describe, expect, it } from "vitest";
import type { RevenueBreakdownItem } from "../types/domain";
import { compactRevenueBreakdownItems } from "./revenueBreakdown";

describe("compactRevenueBreakdownItems", () => {
  it("hides zero amounts and merges groups below one percent", () => {
    const items: RevenueBreakdownItem[] = [
      { name: "主要", amountMinor: 10_000, appointmentCount: 3 },
      { name: "小额", amountMinor: 99, appointmentCount: 2 },
      { name: "零额", amountMinor: 0, appointmentCount: 4 },
    ];

    expect(compactRevenueBreakdownItems(items)).toEqual([
      { name: "主要", amountMinor: 10_000, appointmentCount: 3 },
      { name: "其他", amountMinor: 99, appointmentCount: 2 },
    ]);
    expect(items).toHaveLength(3);
  });

  it("keeps a group whose share is exactly one percent", () => {
    expect(
      compactRevenueBreakdownItems([
        { name: "主要", amountMinor: 9_900, appointmentCount: 2 },
        { name: "百分之一", amountMinor: 100, appointmentCount: 1 },
      ]),
    ).toEqual([
      { name: "主要", amountMinor: 9_900, appointmentCount: 2 },
      { name: "百分之一", amountMinor: 100, appointmentCount: 1 },
    ]);
  });

  it("merges an existing other group and preserves positive amount and order totals", () => {
    const items: RevenueBreakdownItem[] = [
      { name: "主要", amountMinor: 20_000, appointmentCount: 5 },
      { name: "其他", amountMinor: 300, appointmentCount: 2 },
      { name: "零散", amountMinor: 100, appointmentCount: 3 },
    ];
    const result = compactRevenueBreakdownItems(items);

    expect(result).toEqual([
      { name: "主要", amountMinor: 20_000, appointmentCount: 5 },
      { name: "其他", amountMinor: 400, appointmentCount: 5 },
    ]);
    expect(result.reduce((total, item) => total + item.amountMinor, 0)).toBe(20_400);
    expect(result.reduce((total, item) => total + item.appointmentCount, 0)).toBe(10);
  });

  it("combines all tiny groups into a single other item", () => {
    const items = Array.from({ length: 101 }, (_, index) => ({
      name: `对象 ${index + 1}`,
      amountMinor: 1,
      appointmentCount: 1,
    }));

    expect(compactRevenueBreakdownItems(items)).toEqual([
      { name: "其他", amountMinor: 101, appointmentCount: 101 },
    ]);
  });

  it("returns an empty list when every amount is zero", () => {
    expect(
      compactRevenueBreakdownItems([
        { name: "零额一", amountMinor: 0, appointmentCount: 2 },
        { name: "零额二", amountMinor: 0, appointmentCount: 1 },
      ]),
    ).toEqual([]);
  });
});
