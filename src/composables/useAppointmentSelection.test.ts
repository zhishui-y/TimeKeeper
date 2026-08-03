import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockApi } from "../api/mockClient";
import { useAppointmentSelection } from "./useAppointmentSelection";

describe("useAppointmentSelection", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("represents all filtered rows with one token and a small exclusion set", async () => {
    vi.spyOn(mockApi, "createAppointmentSelection").mockResolvedValue({
      token: "selection-token",
      totalCount: 10_000,
      expiresAt: "2099-01-01T00:00:00Z",
    });
    const selection = useAppointmentSelection();

    await expect(selection.selectAll({ query: "测试" })).resolves.toBe(true);
    expect(selection.selectedCount.value).toBe(10_000);
    selection.toggleOne("appointment-42", false);
    expect(selection.selectedCount.value).toBe(9_999);
    expect(selection.deleteSelection()).toEqual({
      kind: "token",
      token: "selection-token",
      excludedIds: ["appointment-42"],
    });
  });

  it("keeps explicit row selections across page changes without a token", () => {
    const selection = useAppointmentSelection();
    selection.toggleOne("page-1-row", true);
    selection.toggleOne("page-2-row", true);
    selection.toggleOne("page-1-row", false);

    expect(selection.selectedCount.value).toBe(1);
    expect(selection.deleteSelection()).toEqual({
      kind: "explicit",
      ids: ["page-2-row"],
    });
  });
});
