import { describe, expect, it } from "vitest";
import {
  appointmentFiltersToQuery,
  parseAppointmentFilterQuery,
  validateAppointmentFilterDateRange,
} from "./appointmentRouteQuery";

describe("appointment route query", () => {
  it("keeps only supported scalar filters and trims search text", () => {
    const parsed = parseAppointmentFilterQuery({
      from: "2026-08-01",
      to: "2026-08-31",
      query: "  阿水  ",
      mode: "business",
      progressStatus: "pending_settlement",
      serviceStatus: "completed",
      settlementStatus: "unsettled",
      page: "4",
    });

    expect(parsed.filters).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
      query: "阿水",
      mode: "business",
      progressStatus: "pending_settlement",
    });
    expect(parsed.normalizedQuery).toEqual(parsed.filters);
    expect(parsed.isCanonical).toBe(false);
  });

  it.each([
    { from: "2026-08-01" },
    { from: "2026-08-32", to: "2026-09-01" },
    { from: "2026-08-09", to: "2026-08-03" },
    { from: ["2026-08-01"], to: "2026-08-09" },
  ])("drops an invalid external date range: %o", (query) => {
    const parsed = parseAppointmentFilterQuery(query);
    expect(parsed.filters).not.toHaveProperty("from");
    expect(parsed.filters).not.toHaveProperty("to");
    expect(parsed.normalizedQuery).toEqual({});
    expect(parsed.isCanonical).toBe(false);
  });

  it("drops invalid enums and resolves entertainment pending-settlement conflicts", () => {
    expect(
      parseAppointmentFilterQuery({ mode: "entertainment", progressStatus: "pending_settlement" }),
    ).toMatchObject({
      filters: { mode: "entertainment" },
      normalizedQuery: { mode: "entertainment" },
      isCanonical: false,
    });
    expect(
      parseAppointmentFilterQuery({ mode: "other", progressStatus: ["completed"] }).filters,
    ).toEqual({});
  });

  it("serializes a canonical pending-settlement link", () => {
    expect(
      appointmentFiltersToQuery({
        from: "2026-08-03",
        to: "2026-08-09",
        progressStatus: "pending_settlement",
        serviceStatus: "completed",
      }),
    ).toEqual({
      from: "2026-08-03",
      to: "2026-08-09",
      progressStatus: "pending_settlement",
    });
  });

  it("reports page-entered date errors without normalizing them away", () => {
    expect(validateAppointmentFilterDateRange({ from: "2026-08-03" })).toBe(
      "开始日期和结束日期必须同时填写",
    );
    expect(validateAppointmentFilterDateRange({ from: "2026-08-10", to: "2026-08-03" })).toBe(
      "开始日期不能晚于结束日期",
    );
    expect(validateAppointmentFilterDateRange({ from: "2026-02-30", to: "2026-03-01" })).toBe(
      "请输入有效的开始日期和结束日期",
    );
    expect(validateAppointmentFilterDateRange({ from: "2026-08-03", to: "2026-08-09" })).toBeNull();
  });
});
