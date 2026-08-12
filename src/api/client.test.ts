// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountProfileInput, AppointmentInput } from "../types/domain";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke,
  Channel: class {
    constructor(readonly onmessage: (value: unknown) => void) {}
  },
}));

describe("native API command payloads", () => {
  beforeEach(() => {
    vi.resetModules();
    invoke.mockReset();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("forwards the explicit three-state account credential contract", async () => {
    invoke.mockResolvedValue({ id: "account-1" });
    const { api, isTauri } = await import("./client");
    const input: AccountProfileInput = {
      contactName: "南枝",
      server: "梦江南",
      characterName: "青禾",
      specialization: "冰心",
      gearScore: "128000",
      accountName: "demo",
      credential: { kind: "remove" },
      currentScore: null,
      highestScore: null,
      scoreUpdatedAt: null,
      notes: null,
      needsReview: false,
    };

    expect(isTauri).toBe(true);
    await api.updateAccountProfile("account-1", input);
    expect(invoke).toHaveBeenCalledWith("update_account_profile", { id: "account-1", input });
  });

  it("keeps Beijing civil appointment input free of implicit offsets", async () => {
    invoke.mockResolvedValue({ appointment: {}, conflicts: [] });
    const { api } = await import("./client");
    const input: AppointmentInput = {
      serviceDate: "2026-08-10",
      startTime: "23:30",
      endTime: "01:00",
      contactName: "跨天预约",
      mode: "business",
      serviceStatus: "scheduled",
      settlementStatus: "unsettled",
      amountMinor: 12_345,
      reminderMinutes: 1_440,
    };

    await api.createAppointment(input);
    expect(invoke).toHaveBeenCalledWith("create_appointment", { input });
    expect(JSON.stringify(invoke.mock.calls[0])).not.toMatch(/[zZ]|[+-]\d{2}:\d{2}/u);
  });
});
