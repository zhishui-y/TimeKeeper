import { describe, expect, it } from "vitest";
import { MIN_ACCOUNT_TABLE_COLUMN_WIDTHS } from "./accountTableColumns";
import { MIN_APPOINTMENT_TABLE_COLUMN_WIDTHS } from "./appointmentTableColumns";
import { MIN_RESIZABLE_TABLE_COLUMN_WIDTH } from "./tableColumns";

describe("resizable table column widths", () => {
  it("uses the two-character minimum for every adjustable column", () => {
    expect(Object.values(MIN_ACCOUNT_TABLE_COLUMN_WIDTHS)).toEqual(
      Array(Object.keys(MIN_ACCOUNT_TABLE_COLUMN_WIDTHS).length).fill(
        MIN_RESIZABLE_TABLE_COLUMN_WIDTH,
      ),
    );
    expect(new Set(Object.values(MIN_ACCOUNT_TABLE_COLUMN_WIDTHS))).toEqual(
      new Set([MIN_RESIZABLE_TABLE_COLUMN_WIDTH]),
    );
    expect(new Set(Object.values(MIN_APPOINTMENT_TABLE_COLUMN_WIDTHS))).toEqual(
      new Set([MIN_RESIZABLE_TABLE_COLUMN_WIDTH]),
    );
  });
});
