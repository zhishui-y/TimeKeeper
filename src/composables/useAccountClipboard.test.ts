import { createPinia } from "pinia";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockApi } from "../api/mockClient";
import { useUiStore } from "../stores/ui";
import type { AccountProfile } from "../types/domain";
import { useAccountClipboard } from "./useAccountClipboard";

const profile: AccountProfile = {
  id: "account-1",
  accountName: "账号一",
  password: "test-credential",
  needsReview: false,
  createdAt: "2026-11-06T00:00:00Z",
  updatedAt: "2026-11-06T00:00:00Z",
};

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function tab(init: KeyboardEventInit = {}, target: EventTarget = document) {
  const event = new KeyboardEvent("keydown", {
    key: "Tab",
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

describe("useAccountClipboard", () => {
  const wrappers: VueWrapper[] = [];

  function setup(disabled: () => boolean = () => false) {
    let clipboard!: ReturnType<typeof useAccountClipboard>;
    const pinia = createPinia();
    const wrapper = mount(
      defineComponent({
        setup() {
          clipboard = useAccountClipboard(disabled);
          return () => h("button", "普通按钮");
        },
      }),
      { global: { plugins: [pinia] }, attachTo: document.body },
    );
    wrappers.push(wrapper);
    return { ...clipboard, wrapper, ui: useUiStore(pinia) };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(mockApi, "copyAccountName").mockResolvedValue();
    vi.spyOn(mockApi, "copyAccountPassword").mockResolvedValue();
    vi.spyOn(mockApi, "copyAccountCharacterName").mockResolvedValue();
  });

  afterEach(() => {
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
    document.body.innerHTML = "";
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps the shortcut across focus changes and copies the bound password only once", async () => {
    const { copyAccount, ui } = setup();
    expect(tab().defaultPrevented).toBe(false);
    await copyAccount(profile);
    window.dispatchEvent(new Event("blur"));
    await vi.advanceTimersByTimeAsync(10_000);
    window.dispatchEvent(new Event("focus"));
    expect(mockApi.copyAccountPassword).not.toHaveBeenCalled();
    expect(tab().defaultPrevented).toBe(true);
    await flushPromises();
    expect(mockApi.copyAccountPassword).toHaveBeenCalledExactlyOnceWith("account-1");
    expect(ui.toast?.message).toBe("密码已复制，剪贴板将在30秒后清空");
    expect(tab().defaultPrevented).toBe(false);
  });

  it("expires after 30 seconds without extending the deadline on focus changes", async () => {
    const { copyAccount } = setup();
    await copyAccount(profile);
    await vi.advanceTimersByTimeAsync(29_999);
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(1);
    expect(tab().defaultPrevented).toBe(false);
    expect(mockApi.copyAccountPassword).not.toHaveBeenCalled();
  });

  it("starts the deadline on click, not after a slow account copy completes", async () => {
    const request = deferred();
    vi.mocked(mockApi.copyAccountName).mockReturnValue(request.promise);
    const { copyAccount } = setup();
    const copying = copyAccount(profile);
    await vi.advanceTimersByTimeAsync(20_000);
    request.resolve();
    await copying;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(tab().defaultPrevented).toBe(false);
    expect(mockApi.copyAccountPassword).not.toHaveBeenCalled();
  });

  it.each([
    { altKey: true },
    { ctrlKey: true },
    { shiftKey: true },
    { metaKey: true },
    { repeat: true },
    { isComposing: true },
  ])("ignores modified, repeated or composing Tab: %j", async (init) => {
    const { copyAccount } = setup();
    await copyAccount(profile);
    expect(tab(init).defaultPrevented).toBe(false);
    expect(mockApi.copyAccountPassword).not.toHaveBeenCalled();
    expect(tab().defaultPrevented).toBe(true);
    await flushPromises();
    expect(mockApi.copyAccountPassword).toHaveBeenCalledTimes(1);
  });

  it.each(["input", "textarea", "select", "contenteditable", "dialog"])(
    "preserves normal Tab inside %s without consuming the shortcut",
    async (kind) => {
      const { copyAccount } = setup();
      const element = document.createElement(
        ["contenteditable", "dialog"].includes(kind) ? "div" : kind,
      );
      if (kind === "contenteditable") element.setAttribute("contenteditable", "true");
      if (kind === "dialog") element.setAttribute("role", "dialog");
      document.body.append(element);
      await copyAccount(profile);
      expect(tab({}, element).defaultPrevented).toBe(false);
      expect(mockApi.copyAccountPassword).not.toHaveBeenCalled();
      expect(tab().defaultPrevented).toBe(true);
    },
  );

  it("does not override modal focus handling or an already handled event", async () => {
    const { copyAccount } = setup();
    await copyAccount(profile);
    const modal = document.createElement("div");
    modal.setAttribute("aria-modal", "true");
    document.body.append(modal);
    expect(tab().defaultPrevented).toBe(false);
    modal.remove();
    const event = new KeyboardEvent("keydown", { key: "Tab", cancelable: true });
    event.preventDefault();
    document.dispatchEvent(event);
    expect(mockApi.copyAccountPassword).not.toHaveBeenCalled();
    expect(tab().defaultPrevented).toBe(true);
  });

  it("binds the newest copied account and ignores an older request finishing late", async () => {
    const old = deferred();
    vi.mocked(mockApi.copyAccountName).mockReturnValueOnce(old.promise);
    const { copyAccount } = setup();
    const first = copyAccount(profile);
    await copyAccount({ ...profile, id: "account-2" });
    old.resolve();
    await first;
    tab();
    await flushPromises();
    expect(mockApi.copyAccountPassword).toHaveBeenCalledExactlyOnceWith("account-2");
  });

  it.each(["password", "characterName", "copy", "cut"])(
    "cancels the pending shortcut after %s",
    async (action) => {
      const { copyAccount, copyPassword, copyCharacterName } = setup();
      await copyAccount(profile);
      if (action === "password") await copyPassword({ ...profile, id: "account-2" });
      else if (action === "characterName") await copyCharacterName(profile);
      else document.dispatchEvent(new Event(action));
      vi.mocked(mockApi.copyAccountPassword).mockClear();
      expect(tab().defaultPrevented).toBe(false);
      expect(mockApi.copyAccountPassword).not.toHaveBeenCalled();
    },
  );

  it("does not arm after a failed account copy or when no password exists", async () => {
    vi.mocked(mockApi.copyAccountName).mockRejectedValueOnce(new Error("复制账号失败"));
    const { copyAccount, ui } = setup();
    await copyAccount(profile);
    expect(ui.toast?.message).toBe("复制账号失败");
    expect(tab().defaultPrevented).toBe(false);
    await copyAccount({ ...profile, password: null });
    expect(tab().defaultPrevented).toBe(false);
    expect(mockApi.copyAccountPassword).not.toHaveBeenCalled();
  });

  it("prevents duplicate in-flight copies and permits a retry after failure within the deadline", async () => {
    const request = deferred();
    vi.mocked(mockApi.copyAccountPassword).mockReturnValueOnce(request.promise);
    const { copyAccount, ui } = setup();
    await copyAccount(profile);
    tab();
    tab();
    await flushPromises();
    expect(mockApi.copyAccountPassword).toHaveBeenCalledTimes(1);
    request.reject(new Error("剪贴板暂时不可用"));
    await flushPromises();
    expect(ui.toast?.message).toBe("剪贴板暂时不可用");
    expect(tab().defaultPrevented).toBe(true);
    await flushPromises();
    expect(mockApi.copyAccountPassword).toHaveBeenCalledTimes(2);
    expect(tab().defaultPrevented).toBe(false);
  });

  it("respects disabled actions and removes the listener and pending requests on unmount", async () => {
    let disabled = true;
    const { copyAccount, wrapper } = setup(() => disabled);
    await copyAccount(profile);
    expect(mockApi.copyAccountName).not.toHaveBeenCalled();
    disabled = false;
    await copyAccount(profile);
    disabled = true;
    expect(tab().defaultPrevented).toBe(false);
    disabled = false;
    wrapper.unmount();
    expect(tab().defaultPrevented).toBe(false);
    expect(mockApi.copyAccountPassword).not.toHaveBeenCalled();
    const request = deferred();
    vi.mocked(mockApi.copyAccountName).mockReturnValueOnce(request.promise);
    const next = setup();
    const copying = next.copyAccount(profile);
    next.wrapper.unmount();
    request.resolve();
    await copying;
    expect(tab().defaultPrevented).toBe(false);
  });
});
