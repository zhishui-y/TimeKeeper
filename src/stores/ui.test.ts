import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUiStore } from "./ui";

describe("ui toast queue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });

  afterEach(() => vi.useRealTimers());

  it("shows an unlock migration result after the current operation feedback", () => {
    const ui = useUiStore();
    ui.notify("预约已创建", "success");
    ui.notifyAfterCurrent("应用入口已解锁；已迁移 2 条历史预约密码", "success");

    expect(ui.toast?.message).toBe("预约已创建");
    vi.advanceTimersByTime(3_600);
    expect(ui.toast?.message).toContain("已迁移 2 条");
    vi.advanceTimersByTime(3_600);
    expect(ui.toast).toBeNull();
  });
});
