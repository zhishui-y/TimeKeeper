// @vitest-environment jsdom

import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, shallowRef } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi } from "../../api/mockClient";
import { useOperationStore } from "../../stores/operations";
import { useUiStore } from "../../stores/ui";
import AuthenticatedAppShell from "./AuthenticatedAppShell.vue";

vi.mock("../../composables/useAppointmentStatusAutomation", () => ({
  useAppointmentStatusAutomation: () => undefined,
}));
vi.mock("../../composables/useOperationWarnings", () => ({
  useOperationWarnings: () => undefined,
}));
vi.mock("../../composables/useAccounts", () => ({
  useAccounts: () => ({
    items: shallowRef([]),
    loading: shallowRef(false),
    error: shallowRef(null),
    load: vi.fn(),
  }),
}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

async function mountShell() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/",
        name: "today",
        component: defineComponent({ template: "<div>今日内容</div>" }),
        meta: { title: "今日工作台", subtitle: "今天" },
      },
      {
        path: "/settings",
        name: "settings",
        component: defineComponent({ template: "<div>设置内容</div>" }),
      },
      ...["calendar", "appointments", "accounts", "revenue"].map((name) => ({
        path: `/${name}`,
        name,
        component: defineComponent({ template: "<div>页面内容</div>" }),
      })),
    ],
  });
  await router.push("/");
  await router.isReady();
  const wrapper = mount(AuthenticatedAppShell, { global: { plugins: [pinia, router] } });
  await flushPromises();
  return { wrapper, pinia };
}

describe("AuthenticatedAppShell", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps global operation progress visible and disables conflicting creation", async () => {
    const pending = deferred<{ path: string; sizeBytes: number; createdAt: string }>();
    vi.spyOn(mockApi, "createBackup").mockReturnValue(pending.promise);
    const lockSpy = vi.spyOn(mockApi, "lockAppAccess");
    const { wrapper, pinia } = await mountShell();
    const operations = useOperationStore(pinia);

    const request = operations.exportBackup("C:\\backup.tkbackup");
    await flushPromises();
    expect(wrapper.get(".app-shell__operation").text()).toContain("正在导出完整备份");
    expect(wrapper.get("button.button--primary").attributes("disabled")).toBeDefined();
    await wrapper.get('button[aria-label="锁定时约管家"]').trigger("click");
    expect(lockSpy).not.toHaveBeenCalled();
    expect(useUiStore(pinia).toast).toMatchObject({
      message: "请等待当前后台任务完成后再锁定",
      tone: "warning",
    });

    pending.resolve({
      path: "C:\\backup.tkbackup",
      sizeBytes: 1,
      createdAt: "2026-08-12T00:00:00Z",
    });
    await request;
    await flushPromises();
    expect(wrapper.find(".app-shell__operation").exists()).toBe(false);
    wrapper.unmount();
  });

  it("shows a global error when locking fails", async () => {
    vi.spyOn(mockApi, "lockAppAccess").mockRejectedValue(new Error("锁定失败"));
    const { wrapper, pinia } = await mountShell();
    await wrapper.get('button[aria-label="锁定时约管家"]').trigger("click");
    await flushPromises();

    expect(useUiStore(pinia).toast).toMatchObject({ message: "锁定失败", tone: "danger" });
    wrapper.unmount();
  });
});
