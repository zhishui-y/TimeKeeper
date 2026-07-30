<script setup lang="ts">
import { KeyRound, LockKeyhole, ShieldCheck, TimerOff } from "@lucide/vue";
import { computed, onMounted, shallowRef, watch } from "vue";
import { useVault } from "../../composables/useVault";
import { useUiStore } from "../../stores/ui";
import VaultPasswordChangeForm from "./VaultPasswordChangeForm.vue";

const autoLockMinutes = defineModel<number>("autoLockMinutes", { required: true });
const ui = useUiStore();
const {
  status,
  loading,
  error: vaultError,
  load: loadVault,
  unlock,
  initialize,
  changePassword,
  lock,
} = useVault();

const unlockPassword = shallowRef("");
const passwordChangeOpen = shallowRef(false);
const passwordChangeError = shallowRef<string | null>(null);
const lastEnabledMinutes = shallowRef(autoLockMinutes.value > 0 ? autoLockMinutes.value : 15);
const autoLockDisabled = computed({
  get: () => autoLockMinutes.value === 0,
  set: (disabled: boolean) => {
    if (disabled) {
      if (autoLockMinutes.value > 0) lastEnabledMinutes.value = autoLockMinutes.value;
      autoLockMinutes.value = 0;
      return;
    }
    autoLockMinutes.value = Math.min(Math.max(lastEnabledMinutes.value, 1), 1440);
  },
});
const statusLabel = computed(() =>
  status.value.unlocked ? "已解锁" : status.value.initialized ? "已锁定" : "未初始化",
);

watch(autoLockMinutes, (minutes) => {
  if (minutes > 0) lastEnabledMinutes.value = minutes;
});

watch(
  () => status.value.unlocked,
  (unlocked) => {
    if (unlocked) return;
    passwordChangeOpen.value = false;
    passwordChangeError.value = null;
  },
);

async function submitVault(): Promise<void> {
  const result = status.value.initialized
    ? await unlock(unlockPassword.value)
    : await initialize(unlockPassword.value);
  if (!result) return;
  unlockPassword.value = "";
  ui.notify("密码库已解锁", "success");
}

async function lockVault(): Promise<void> {
  const result = await lock();
  if (!result) return;
  passwordChangeOpen.value = false;
  ui.notify("密码库已锁定", "success");
}

function openPasswordChange(): void {
  passwordChangeError.value = null;
  passwordChangeOpen.value = true;
}

async function submitPasswordChange(payload: {
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  passwordChangeError.value = null;
  const result = await changePassword(payload.currentPassword, payload.newPassword);
  if (!result) {
    passwordChangeError.value = vaultError.value ?? "主密码修改失败，请重试";
    return;
  }
  passwordChangeOpen.value = false;
  ui.notify("主密码已修改；旧备份仍需旧主密码，建议重新导出完整备份", "success");
}

function closePasswordChange(): void {
  passwordChangeOpen.value = false;
  passwordChangeError.value = null;
}

onMounted(() => void loadVault());

defineExpose({ refresh: loadVault });
</script>

<!-- eslint-disable vue/html-self-closing, vue/max-attributes-per-line -->
<template>
  <div class="vault-settings">
    <div class="vault-settings__grid">
      <section class="vault-control" aria-labelledby="vault-status-title">
        <div class="vault-control__heading">
          <div>
            <span class="vault-control__eyebrow">当前状态</span>
            <strong id="vault-status-title" :class="{ 'is-success': status.unlocked }">
              {{ statusLabel }}
            </strong>
          </div>
          <span class="vault-control__state-icon" :class="{ 'is-success': status.unlocked }">
            <ShieldCheck v-if="status.unlocked" :size="18" />
            <LockKeyhole v-else :size="18" />
          </span>
        </div>

        <button
          v-if="status.unlocked"
          class="button button--compact vault-control__main-action"
          type="button"
          :disabled="loading"
          @click="lockVault"
        >
          <LockKeyhole :size="14" />立即锁定
        </button>
        <form v-else class="vault-unlock" @submit.prevent="submitVault">
          <input
            v-model="unlockPassword"
            class="input"
            type="password"
            :autocomplete="status.initialized ? 'current-password' : 'new-password'"
            :placeholder="status.initialized ? '输入主密码' : '设置主密码'"
            aria-label="密码库主密码"
            :disabled="loading"
          />
          <button class="button button--primary button--compact" type="submit" :disabled="loading">
            {{ loading ? "处理中..." : status.initialized ? "解锁" : "初始化" }}
          </button>
        </form>
        <span v-if="vaultError && !status.unlocked" class="vault-control__error" role="alert">
          {{ vaultError }}
        </span>
      </section>

      <section class="vault-control" aria-labelledby="auto-lock-title">
        <div class="vault-control__heading">
          <div>
            <span class="vault-control__eyebrow">会话保护</span>
            <strong id="auto-lock-title">无操作自动锁定</strong>
          </div>
          <TimerOff :size="18" />
        </div>

        <div class="auto-lock-setting">
          <label class="toggle">
            <input
              v-model="autoLockDisabled"
              type="checkbox"
              role="switch"
              aria-describedby="auto-lock-description"
            />
            <span class="toggle__track" aria-hidden="true"><span /></span>
            <span>不自动锁定</span>
          </label>
          <div v-if="!autoLockDisabled" class="unit-input">
            <input
              v-model.number="autoLockMinutes"
              class="input mono-number"
              type="number"
              min="1"
              max="1440"
              aria-label="无操作自动锁定分钟数"
            />
            <span>分钟</span>
          </div>
        </div>
        <span id="auto-lock-description" class="vault-control__description">
          {{
            autoLockDisabled
              ? "保持解锁，直到手动锁定或关闭应用。"
              : `连续 ${autoLockMinutes} 分钟无操作后锁定。`
          }}
          保存设置后生效。
        </span>
      </section>

      <section class="vault-control" aria-labelledby="vault-security-title">
        <div class="vault-control__heading">
          <div>
            <span class="vault-control__eyebrow">安全设置</span>
            <strong id="vault-security-title">主密码</strong>
          </div>
          <KeyRound :size="18" />
        </div>
        <span class="vault-control__description">
          修改后账号密码保持不变；已导出的旧备份仍使用旧主密码。
        </span>
        <button
          class="button button--compact vault-control__main-action"
          type="button"
          :disabled="!status.unlocked || loading"
          @click="openPasswordChange"
        >
          <KeyRound :size="14" />
          {{ status.unlocked ? "修改主密码" : "解锁后可修改" }}
        </button>
      </section>
    </div>

    <VaultPasswordChangeForm
      v-if="passwordChangeOpen && status.unlocked"
      :loading="loading"
      :error="passwordChangeError"
      @submit="submitPasswordChange"
      @cancel="closePasswordChange"
    />
  </div>
</template>

<style scoped>
.vault-settings {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.vault-settings__grid {
  display: grid;
  grid-template-columns: minmax(210px, 0.9fr) minmax(250px, 1.08fr) minmax(220px, 0.9fr);
  gap: 12px;
}

.vault-control {
  display: flex;
  min-width: 0;
  min-height: 122px;
  flex-direction: column;
  justify-content: space-between;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius, 12px);
  background: var(--surface-soft);
}

.vault-control__heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  color: var(--ink-muted);
}

.vault-control__heading > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.vault-control__eyebrow {
  color: var(--ink-muted);
  font-size: 9px;
  letter-spacing: 0.08em;
}

.vault-control__heading strong {
  color: var(--ink-strong);
  font-size: 12px;
}

.vault-control__heading strong.is-success {
  color: var(--brand);
}

.vault-control__state-icon {
  display: grid;
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
  place-items: center;
  border-radius: 9px;
  color: var(--amber);
  background: color-mix(in srgb, var(--amber) 10%, transparent);
}

.vault-control__state-icon.is-success {
  color: var(--brand);
  background: var(--brand-soft);
}

.vault-control__main-action {
  align-self: flex-start;
}

.vault-control__description {
  color: var(--ink-muted);
  font-size: 10px;
  line-height: 1.55;
}

.vault-control__error {
  color: var(--danger);
  font-size: 10px;
  line-height: 1.4;
}

.vault-unlock {
  display: flex;
  gap: 7px;
}

.vault-unlock .input {
  min-width: 0;
  flex: 1;
}

.auto-lock-setting {
  display: flex;
  min-height: 34px;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.auto-lock-setting .unit-input {
  flex: 0 0 auto;
}

.auto-lock-setting .unit-input .input {
  width: 78px;
}

.toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--ink);
  cursor: pointer;
  font-size: 11px;
  font-weight: 650;
}

.toggle input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  opacity: 0;
}

.toggle__track {
  position: relative;
  width: 34px;
  height: 19px;
  flex: 0 0 34px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: #e5e8e2;
  transition:
    border-color 150ms ease,
    background 150ms ease;
}

.toggle__track > span {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(35, 48, 40, 0.22);
  transition: transform 150ms ease;
}

.toggle input:checked + .toggle__track {
  border-color: var(--brand);
  background: var(--brand);
}

.toggle input:checked + .toggle__track > span {
  transform: translateX(15px);
}

.toggle input:focus-visible + .toggle__track {
  outline: 2px solid color-mix(in srgb, var(--brand) 42%, transparent);
  outline-offset: 2px;
}

@media (max-width: 900px) {
  .vault-settings__grid {
    grid-template-columns: repeat(2, minmax(220px, 1fr));
  }

  .vault-control:last-child {
    grid-column: 1 / -1;
    min-height: 100px;
  }
}

@media (max-width: 620px) {
  .vault-settings__grid {
    grid-template-columns: 1fr;
  }

  .vault-control:last-child {
    grid-column: auto;
  }
}
</style>
