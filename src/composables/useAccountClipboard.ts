import { onMounted, onScopeDispose } from "vue";
import { api, errorMessage } from "../api/client";
import { useUiStore } from "../stores/ui";
import type { AccountProfile } from "../types/domain";

const PASSWORD_SHORTCUT_WINDOW_MS = 30_000;

export function useAccountClipboard(disabled: () => boolean) {
  const ui = useUiStore();
  let pending: { id: string; expiresAt: number } | null = null;
  let expiryTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
  let version = 0;
  let disposed = false;
  let copyingPassword = false;

  function cancel(): void {
    version += 1;
    pending = null;
    globalThis.clearTimeout(expiryTimer);
    expiryTimer = undefined;
  }

  async function copyAccount(profile: AccountProfile): Promise<void> {
    if (disabled() || copyingPassword) return;
    cancel();
    const requestVersion = version;
    const expiresAt = Date.now() + PASSWORD_SHORTCUT_WINDOW_MS;
    try {
      await api.copyAccountName(profile.id);
      if (disposed || requestVersion !== version) return;
      if (profile.password && Date.now() < expiresAt) {
        pending = { id: profile.id, expiresAt };
        expiryTimer = globalThis.setTimeout(cancel, expiresAt - Date.now());
        ui.notify("账号已复制，30秒内回到时约管家按 Tab 可复制密码", "success");
      } else {
        ui.notify("账号已复制", "success");
      }
    } catch (cause) {
      if (!disposed && requestVersion === version) ui.notify(errorMessage(cause), "danger");
    }
  }

  async function copyPasswordById(id: string, requestVersion: number): Promise<void> {
    copyingPassword = true;
    try {
      await api.copyAccountPassword(id);
      if (disposed || requestVersion !== version) return;
      cancel();
      ui.notify("密码已复制，剪贴板将在30秒后清空", "success");
    } catch (cause) {
      if (!disposed && requestVersion === version) ui.notify(errorMessage(cause), "danger");
    } finally {
      copyingPassword = false;
    }
  }

  async function copyPassword(profile: AccountProfile): Promise<void> {
    if (disabled() || copyingPassword) return;
    cancel();
    await copyPasswordById(profile.id, version);
  }

  async function copyCharacterName(profile: AccountProfile): Promise<void> {
    if (disabled() || copyingPassword) return;
    cancel();
    const requestVersion = version;
    try {
      await api.copyAccountCharacterName(profile.id);
      if (!disposed && requestVersion === version) ui.notify("角色名已复制", "success");
    } catch (cause) {
      if (!disposed && requestVersion === version) ui.notify(errorMessage(cause), "danger");
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (
      event.key !== "Tab" ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.repeat ||
      event.isComposing ||
      event.defaultPrevented ||
      disabled() ||
      copyingPassword ||
      !pending
    ) {
      return;
    }
    if (Date.now() >= pending.expiresAt) {
      cancel();
      return;
    }
    const target = event.target;
    if (
      (target instanceof Element &&
        target.closest(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="dialog"]',
        )) ||
      document.querySelector('[aria-modal="true"]')
    ) {
      return;
    }
    // 只消费这次单独的 Tab；窗口失焦与 Alt+Tab 都不改变等待状态。
    event.preventDefault();
    event.stopPropagation();
    void copyPasswordById(pending.id, version);
  }

  onMounted(() => {
    document.addEventListener("keydown", handleKeydown);
    document.addEventListener("copy", cancel);
    document.addEventListener("cut", cancel);
  });

  onScopeDispose(() => {
    disposed = true;
    cancel();
    document.removeEventListener("keydown", handleKeydown);
    document.removeEventListener("copy", cancel);
    document.removeEventListener("cut", cancel);
  });

  return { copyAccount, copyPassword, copyCharacterName };
}
