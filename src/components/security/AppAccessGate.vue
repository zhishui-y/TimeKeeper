<script setup lang="ts">
import { KeyRound, LockKeyhole, ShieldCheck, TriangleAlert } from "@lucide/vue";
import { computed, shallowRef, watch } from "vue";
import { useAppAccessStore } from "../../stores/appAccess";
import { useUiStore } from "../../stores/ui";
import {
  MIN_MASTER_PASSWORD_CHARACTERS,
  RECOMMENDED_MASTER_PASSWORD_CHARACTERS,
  isMasterPasswordLongEnough,
} from "../../utils/security";

type GateMode = "access" | "reset";

const access = useAppAccessStore();
const ui = useUiStore();
const mode = shallowRef<GateMode>("access");
const password = shallowRef("");
const confirmation = shallowRef("");
const resetConfirmationText = shallowRef("");
const localError = shallowRef("");
const migrationMessage = shallowRef("");

const hasLegacyCredentials = computed(() => access.legacyMigrationPendingCount > 0);
const isLegacyUpgrade = computed(() => !access.initialized && hasLegacyCredentials.value);
const isCreating = computed(() => !access.initialized && !hasLegacyCredentials.value);
const title = computed(() => {
  if (mode.value === "reset") return "重置入口密码";
  if (isLegacyUpgrade.value) return "升级本地密码数据";
  return isCreating.value ? "创建入口密码" : "解锁时约管家";
});
const description = computed(() => {
  if (mode.value === "reset") {
    return "重置只替换应用入口密码，不会删除预约、账号或已保存的业务密码。";
  }
  if (isLegacyUpgrade.value) {
    return `检测到 ${access.legacyMigrationPendingCount} 条旧密码，请输入原主密码完成一次性迁移。`;
  }
  return isCreating.value
    ? "入口密码用于防止他人随手打开本机应用，忘记后可以无损重置。"
    : "输入入口密码后继续，本次进程内不会自动锁定。";
});

function clearMessages(): void {
  localError.value = "";
  migrationMessage.value = "";
  access.clearError();
}

function resetForm(): void {
  password.value = "";
  confirmation.value = "";
  resetConfirmationText.value = "";
  clearMessages();
}

function setMode(next: GateMode): void {
  mode.value = next;
  resetForm();
}

function validateNewPassword(): boolean {
  if (!isMasterPasswordLongEnough(password.value)) {
    localError.value = `入口密码至少需要${MIN_MASTER_PASSWORD_CHARACTERS}个字符`;
    return false;
  }
  if (password.value !== confirmation.value) {
    localError.value = "两次输入的入口密码不一致";
    return false;
  }
  return true;
}

async function submit(): Promise<void> {
  if (access.loading) return;
  clearMessages();

  if (mode.value === "reset") {
    if (!validateNewPassword()) return;
    if (resetConfirmationText.value !== "重置") {
      localError.value = "请输入“重置”确认操作";
      return;
    }
    const result = await access.resetPassword(password.value, resetConfirmationText.value);
    if (result) resetForm();
    return;
  }

  if (!password.value) {
    localError.value = isLegacyUpgrade.value ? "请输入原主密码" : "请输入入口密码";
    return;
  }
  if (isLegacyUpgrade.value) {
    const result = await access.migrateLegacyCredentials(password.value);
    if (!result) return;
    migrationMessage.value = `已迁移 ${result.migratedCount} 条，缺失 ${result.missingCount} 条，仍待迁移 ${result.pendingCount} 条。`;
    ui.notify(migrationMessage.value, result.pendingCount > 0 ? "warning" : "success");
    password.value = "";
    return;
  }
  if (isCreating.value) {
    if (!validateNewPassword()) return;
    if (await access.initialize(password.value)) resetForm();
    return;
  }
  if (await access.unlock(password.value)) resetForm();
}

watch(
  () => access.unlocked,
  (unlocked) => {
    if (unlocked) resetForm();
  },
);
</script>

<template>
  <div class="access-gate">
    <div class="access-gate__brand">
      <span class="access-gate__seal">时</span>
      <span>时约管家</span>
    </div>
    <section
      class="access-gate__dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="access-gate-title"
      aria-live="polite"
    >
      <div class="access-gate__icon">
        <TriangleAlert v-if="isLegacyUpgrade && mode === 'access'" :size="24" />
        <ShieldCheck v-else-if="isCreating || mode === 'reset'" :size="24" />
        <LockKeyhole v-else :size="24" />
      </div>
      <template v-if="access.ready">
        <h1 id="access-gate-title">{{ title }}</h1>
        <p>{{ description }}</p>
        <form class="access-gate__form" @submit.prevent="submit">
          <label>
            <span>{{ isLegacyUpgrade && mode === "access" ? "原主密码" : "入口密码" }}</span>
            <div class="access-gate__input">
              <KeyRound :size="16" />
              <input
                v-model="password"
                :aria-label="isLegacyUpgrade && mode === 'access' ? '原主密码' : '入口密码'"
                type="password"
                :autocomplete="isCreating || mode === 'reset' ? 'new-password' : 'current-password'"
                autofocus
                :disabled="access.loading"
                :minlength="
                  isCreating || mode === 'reset' ? MIN_MASTER_PASSWORD_CHARACTERS : undefined
                "
                :placeholder="
                  isCreating || mode === 'reset'
                    ? `至少${MIN_MASTER_PASSWORD_CHARACTERS}个字符，建议${RECOMMENDED_MASTER_PASSWORD_CHARACTERS}位以上`
                    : '输入密码'
                "
                @input="clearMessages"
              />
            </div>
          </label>
          <label v-if="isCreating || mode === 'reset'">
            <span>再次输入入口密码</span>
            <div class="access-gate__input">
              <KeyRound :size="16" />
              <input
                v-model="confirmation"
                aria-label="再次输入入口密码"
                type="password"
                autocomplete="new-password"
                :disabled="access.loading"
                placeholder="再次输入以确认"
                @input="clearMessages"
              />
            </div>
          </label>
          <label v-if="mode === 'reset'">
            <span>操作确认</span>
            <div class="access-gate__input">
              <input
                v-model="resetConfirmationText"
                aria-label="操作确认"
                :disabled="access.loading"
                placeholder="请输入“重置”"
                @input="clearMessages"
              />
            </div>
          </label>
          <span v-if="localError || access.error" class="access-gate__error" role="alert">
            {{ localError || access.error }}
          </span>
          <span v-if="migrationMessage" class="access-gate__success" role="status">
            {{ migrationMessage }}
          </span>
          <button class="button button--primary" type="submit" :disabled="access.loading">
            {{
              access.loading
                ? "正在处理..."
                : mode === "reset"
                  ? "重置并进入"
                  : isLegacyUpgrade
                    ? "迁移并进入"
                    : isCreating
                      ? "创建并进入"
                      : "进入"
            }}
          </button>
          <button
            v-if="mode === 'access' && !isCreating"
            class="access-gate__link"
            type="button"
            :disabled="access.loading"
            @click="setMode('reset')"
          >
            {{ isLegacyUpgrade ? "忘记原主密码，设置新入口密码" : "忘记入口密码" }}
          </button>
          <button
            v-else-if="mode === 'reset'"
            class="access-gate__link"
            type="button"
            :disabled="access.loading"
            @click="setMode('access')"
          >
            返回密码输入
          </button>
        </form>
      </template>
      <template v-else>
        <h1 id="access-gate-title">正在打开时约管家</h1>
        <p>正在检查本地数据与入口状态...</p>
        <div class="access-gate__loading" />
      </template>
    </section>
    <span class="access-gate__note">本地存储 · 无云端上传</span>
  </div>
</template>

<style scoped>
.access-gate {
  position: fixed;
  z-index: 1000;
  inset: 0;
  display: grid;
  min-width: 520px;
  place-items: center;
  overflow: hidden;
  color: var(--ink);
  background:
    radial-gradient(circle at 16% 12%, rgba(255, 253, 248, 0.95), transparent 32%),
    radial-gradient(circle at 88% 78%, rgba(45, 104, 84, 0.1), transparent 34%),
    linear-gradient(145deg, #efeee5 0%, #e3e7dc 100%);
}

.access-gate__brand {
  position: absolute;
  top: 28px;
  left: 32px;
  display: flex;
  align-items: center;
  gap: 11px;
  color: var(--ink-strong);
  font-family: var(--font-serif);
  font-size: 16px;
  font-weight: 700;
}

.access-gate__seal {
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border-radius: 12px;
  color: #fff8eb;
  background: var(--accent);
  box-shadow: 0 9px 22px rgba(128, 55, 40, 0.2);
  font-family: var(--font-serif);
  font-size: 20px;
}

.access-gate__dialog {
  display: flex;
  width: 430px;
  min-height: 390px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 44px 46px;
  border: 1px solid rgba(108, 125, 115, 0.22);
  border-radius: 22px;
  background: rgba(255, 253, 248, 0.95);
  box-shadow: 0 28px 70px rgba(35, 48, 40, 0.13);
}

.access-gate__icon {
  display: grid;
  width: 54px;
  height: 54px;
  margin-bottom: 20px;
  place-items: center;
  border: 1px solid var(--brand-border);
  border-radius: 16px;
  color: var(--brand);
  background: var(--brand-soft);
}

.access-gate__dialog h1 {
  color: var(--ink-strong);
  font-family: var(--font-serif);
  font-size: 24px;
}

.access-gate__dialog > p {
  max-width: 320px;
  margin: 10px 0 24px;
  color: var(--ink-muted);
  font-size: 12px;
  line-height: 1.65;
  text-align: center;
}

.access-gate__form {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 12px;
}

.access-gate__form label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--ink-muted);
  font-size: 12px;
  font-weight: 620;
}

.access-gate__input {
  display: flex;
  height: 42px;
  align-items: center;
  gap: 9px;
  padding: 0 12px;
  border: 1px solid var(--line-strong);
  border-radius: 11px;
  color: var(--ink-muted);
  background: #fffefa;
}

.access-gate__input:focus-within {
  border-color: #729887;
  box-shadow: 0 0 0 3px rgba(45, 104, 84, 0.1);
}

.access-gate__input input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  color: var(--ink-strong);
  background: transparent;
  font: inherit;
}

.access-gate__error,
.access-gate__success {
  padding: 8px 10px;
  border-radius: 9px;
  font-size: 11px;
  line-height: 1.45;
}

.access-gate__error {
  border: 1px solid #dfb8ae;
  color: var(--danger);
  background: #fff6f1;
}

.access-gate__success {
  border: 1px solid var(--brand-border);
  color: var(--brand-strong);
  background: var(--brand-soft);
}

.access-gate__form .button {
  min-height: 42px;
}

.access-gate__link {
  border: 0;
  color: var(--brand-strong);
  background: transparent;
  cursor: pointer;
  font-size: 11px;
}

.access-gate__link:disabled {
  cursor: default;
  opacity: 0.55;
}

.access-gate__loading {
  width: 210px;
  height: 3px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--brand-soft);
}

.access-gate__loading::after {
  display: block;
  width: 45%;
  height: 100%;
  border-radius: inherit;
  background: var(--brand);
  animation: access-loading 1s ease-in-out infinite alternate;
  content: "";
}

.access-gate__note {
  position: absolute;
  bottom: 26px;
  color: var(--ink-muted);
  font-size: 10px;
  letter-spacing: 0.12em;
}

@keyframes access-loading {
  to {
    transform: translateX(122%);
  }
}

@media (max-height: 760px) {
  .access-gate__dialog {
    min-height: 350px;
    padding-block: 30px;
  }
}
</style>
