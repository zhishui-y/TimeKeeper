<script setup lang="ts">
import { KeyRound, LockKeyhole, ShieldCheck } from "@lucide/vue";
import { computed, shallowRef } from "vue";
import type { VaultStatus } from "../../types/domain";
import {
  MIN_MASTER_PASSWORD_CHARACTERS,
  RECOMMENDED_MASTER_PASSWORD_CHARACTERS,
  isMasterPasswordLongEnough,
} from "../../utils/security";

const props = defineProps<{
  status: VaultStatus;
  loading: boolean;
  ready: boolean;
  error?: string | null;
}>();

const emit = defineEmits<{
  submit: [password: string];
}>();

const password = shallowRef("");
const passwordConfirmation = shallowRef("");
const localError = shallowRef("");
const title = computed(() => (props.status.initialized ? "解锁时约管家" : "创建主密码"));
const description = computed(() =>
  props.status.initialized
    ? "账号密码库已锁定，输入主密码后继续。"
    : "主密码用于保护账号密码，忘记后无法恢复。",
);

function submit(): void {
  localError.value = "";
  if (!props.status.initialized && !isMasterPasswordLongEnough(password.value)) {
    localError.value = `主密码至少需要${MIN_MASTER_PASSWORD_CHARACTERS}个字符`;
    return;
  }
  if (!props.status.initialized && password.value !== passwordConfirmation.value) {
    localError.value = "两次输入的主密码不一致";
    return;
  }
  if (!password.value) {
    localError.value = "请输入主密码";
    return;
  }
  emit("submit", password.value);
  password.value = "";
  passwordConfirmation.value = "";
}
</script>

<template>
  <div class="vault-gate">
    <div class="vault-gate__brand">
      <span class="vault-gate__seal">时</span>
      <span>时约管家</span>
    </div>
    <section
      class="vault-gate__dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vault-gate-title"
      aria-live="polite"
    >
      <div class="vault-gate__icon">
        <ShieldCheck v-if="!status.initialized" :size="24" />
        <LockKeyhole v-else :size="24" />
      </div>
      <template v-if="ready">
        <h1 id="vault-gate-title">{{ title }}</h1>
        <p>{{ description }}</p>
        <form class="vault-gate__form" @submit.prevent="submit">
          <label>
            <span>主密码</span>
            <div class="vault-gate__input">
              <KeyRound :size="16" />
              <input
                v-model="password"
                aria-label="主密码"
                type="password"
                :autocomplete="status.initialized ? 'current-password' : 'new-password'"
                autofocus
                :disabled="loading"
                :minlength="status.initialized ? undefined : MIN_MASTER_PASSWORD_CHARACTERS"
                :placeholder="
                  status.initialized
                    ? '输入主密码'
                    : `至少${MIN_MASTER_PASSWORD_CHARACTERS}个字符，建议${RECOMMENDED_MASTER_PASSWORD_CHARACTERS}位以上`
                "
              />
            </div>
          </label>
          <label v-if="!status.initialized">
            <span>再次输入主密码</span>
            <div class="vault-gate__input">
              <KeyRound :size="16" />
              <input
                v-model="passwordConfirmation"
                aria-label="再次输入主密码"
                type="password"
                autocomplete="new-password"
                :disabled="loading"
                placeholder="再次输入以确认"
              />
            </div>
          </label>
          <span v-if="localError || error" class="vault-gate__error">{{
            localError || error
          }}</span>
          <button class="button button--primary" type="submit" :disabled="loading">
            {{ loading ? "正在处理..." : status.initialized ? "解锁" : "创建并进入" }}
          </button>
        </form>
      </template>
      <template v-else>
        <h1 id="vault-gate-title">正在打开时约管家</h1>
        <p>正在检查本地数据与密码库...</p>
        <div class="vault-gate__loading" />
      </template>
    </section>
    <span class="vault-gate__note">本地存储 · 无云端上传</span>
  </div>
</template>

<style scoped>
.vault-gate {
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

.vault-gate::before {
  position: absolute;
  top: -120px;
  right: -90px;
  width: 430px;
  height: 430px;
  border: 1px solid rgba(45, 104, 84, 0.08);
  border-radius: 50%;
  box-shadow:
    0 0 0 56px rgba(45, 104, 84, 0.025),
    0 0 0 112px rgba(45, 104, 84, 0.015);
  content: "";
  pointer-events: none;
}

.vault-gate::after {
  position: absolute;
  bottom: -130px;
  left: -90px;
  width: 360px;
  height: 360px;
  border: 1px solid rgba(181, 82, 62, 0.07);
  border-radius: 50%;
  content: "";
  pointer-events: none;
}

.vault-gate__brand {
  position: absolute;
  z-index: 2;
  top: 28px;
  left: 32px;
  display: flex;
  align-items: center;
  gap: 11px;
  color: var(--ink-strong);
  font-family: var(--font-serif);
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.06em;
}

.vault-gate__seal {
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border: 1px solid rgba(255, 248, 235, 0.32);
  border-radius: 12px;
  color: #fff8eb;
  background: var(--accent);
  box-shadow: 0 9px 22px rgba(128, 55, 40, 0.2);
  font-family: var(--font-serif);
  font-size: 20px;
}

.vault-gate__dialog {
  position: relative;
  z-index: 1;
  display: flex;
  width: 430px;
  min-height: 390px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 46px;
  overflow: hidden;
  border: 1px solid rgba(108, 125, 115, 0.22);
  border-radius: 22px;
  background: rgba(255, 253, 248, 0.95);
  box-shadow:
    0 28px 70px rgba(35, 48, 40, 0.13),
    0 4px 14px rgba(35, 48, 40, 0.06);
  backdrop-filter: blur(18px);
}

.vault-gate__dialog::before {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  height: 4px;
  background: linear-gradient(90deg, var(--brand), var(--brand) 68%, var(--accent) 68%);
  content: "";
}

.vault-gate__icon {
  display: grid;
  width: 54px;
  height: 54px;
  margin-bottom: 22px;
  place-items: center;
  border: 1px solid var(--brand-border);
  border-radius: 16px;
  color: var(--brand);
  background: linear-gradient(145deg, #f4f8f3, var(--brand-soft));
  box-shadow: 0 8px 20px rgba(45, 104, 84, 0.1);
}

.vault-gate__dialog h1 {
  color: var(--ink-strong);
  font-family: var(--font-serif);
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.vault-gate__dialog > p {
  max-width: 300px;
  margin: 10px 0 26px;
  color: var(--ink-muted);
  font-size: 12px;
  line-height: 1.65;
  text-align: center;
}

.vault-gate__form {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 14px;
}

.vault-gate__form label {
  display: flex;
  flex-direction: column;
  gap: 7px;
  color: var(--ink-muted);
  font-size: 12px;
  font-weight: 620;
}

.vault-gate__input {
  display: flex;
  height: 42px;
  align-items: center;
  gap: 9px;
  padding: 0 12px;
  border: 1px solid var(--line-strong);
  border-radius: 11px;
  color: var(--ink-muted);
  background: #fffefa;
  box-shadow: inset 0 1px 2px rgba(35, 48, 40, 0.03);
  transition:
    border-color 150ms ease,
    box-shadow 150ms ease;
}

.vault-gate__input:focus-within {
  border-color: #729887;
  box-shadow: 0 0 0 3px rgba(45, 104, 84, 0.1);
}

.vault-gate__input input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  color: var(--ink-strong);
  background: transparent;
  font: inherit;
  font-weight: 500;
}

.vault-gate__input input::placeholder {
  color: var(--ink-faint);
}

.vault-gate__error {
  padding: 8px 10px;
  border: 1px solid #dfb8ae;
  border-radius: 9px;
  color: var(--danger);
  background: #fff6f1;
  font-size: 11px;
  line-height: 1.45;
}

.vault-gate__form .button {
  min-height: 42px;
  margin-top: 2px;
}

.vault-gate__loading {
  width: 210px;
  height: 3px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--brand-soft);
}

.vault-gate__loading::after {
  display: block;
  width: 45%;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--brand), #79a18e);
  animation: vault-loading 1s ease-in-out infinite alternate;
  content: "";
}

.vault-gate__note {
  position: absolute;
  z-index: 2;
  bottom: 26px;
  color: var(--ink-muted);
  font-size: 10px;
  letter-spacing: 0.12em;
}

@keyframes vault-loading {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(122%);
  }
}

@media (max-height: 760px) {
  .vault-gate__brand {
    top: 20px;
  }

  .vault-gate__dialog {
    min-height: 350px;
    padding: 34px 42px;
  }

  .vault-gate__icon {
    margin-bottom: 16px;
  }

  .vault-gate__dialog > p {
    margin-bottom: 18px;
  }

  .vault-gate__note {
    bottom: 18px;
  }
}
</style>
