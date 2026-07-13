<script setup lang="ts">
import { KeyRound, LockKeyhole, ShieldCheck } from "@lucide/vue";
import { computed, shallowRef } from "vue";
import type { VaultStatus } from "../../types/domain";

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
const localError = shallowRef("");
const title = computed(() => (props.status.initialized ? "解锁时约管家" : "创建主密码"));
const description = computed(() =>
  props.status.initialized
    ? "账号密码库已锁定，输入主密码后继续。"
    : "主密码用于保护账号密码，忘记后无法恢复。",
);

function submit(): void {
  localError.value = "";
  if (!props.status.initialized && password.value.length < 8) {
    localError.value = "主密码至少需要8个字符";
    return;
  }
  if (!password.value) {
    localError.value = "请输入主密码";
    return;
  }
  emit("submit", password.value);
  password.value = "";
}
</script>

<template>
  <div class="vault-gate">
    <div class="vault-gate__brand">
      <span class="vault-gate__seal">时</span>
      <span>时约管家</span>
    </div>
    <section class="vault-gate__dialog" aria-live="polite">
      <div class="vault-gate__icon">
        <ShieldCheck v-if="!status.initialized" :size="24" />
        <LockKeyhole v-else :size="24" />
      </div>
      <template v-if="ready">
        <h1>{{ title }}</h1>
        <p>{{ description }}</p>
        <form class="vault-gate__form" @submit.prevent="submit">
          <label>
            <span>主密码</span>
            <div class="vault-gate__input">
              <KeyRound :size="16" />
              <input
                v-model="password"
                type="password"
                :autocomplete="status.initialized ? 'current-password' : 'new-password'"
                autofocus
                :disabled="loading"
                :placeholder="status.initialized ? '输入主密码' : '至少8个字符'"
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
        <h1>正在打开时约管家</h1>
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
  color: var(--ink);
  background: #eef1ed;
}

.vault-gate__brand {
  position: absolute;
  top: 26px;
  left: 30px;
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--ink-strong);
  font-size: 15px;
  font-weight: 750;
}

.vault-gate__seal {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 4px;
  color: #fff;
  background: var(--brand);
  font-family: "STSong", "SimSun", serif;
  font-size: 18px;
}

.vault-gate__dialog {
  display: flex;
  width: 390px;
  min-height: 360px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 42px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: 0 18px 48px rgba(42, 54, 49, 0.1);
}

.vault-gate__icon {
  display: grid;
  width: 48px;
  height: 48px;
  margin-bottom: 20px;
  place-items: center;
  border: 1px solid #bdd0c4;
  border-radius: 6px;
  color: var(--brand);
  background: var(--brand-soft);
}

.vault-gate__dialog h1 {
  color: var(--ink-strong);
  font-size: 20px;
}

.vault-gate__dialog > p {
  margin: 8px 0 24px;
  color: var(--ink-muted);
  font-size: 11px;
}

.vault-gate__form {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 12px;
}

.vault-gate__form label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--ink-muted);
  font-size: 10px;
}

.vault-gate__input {
  display: flex;
  height: 38px;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border: 1px solid var(--line-strong);
  border-radius: 5px;
  color: var(--ink-muted);
  background: #fff;
}

.vault-gate__input:focus-within {
  border-color: var(--brand);
  box-shadow: 0 0 0 2px var(--brand-soft);
}

.vault-gate__input input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  color: var(--ink-strong);
  background: transparent;
  font: inherit;
}

.vault-gate__error {
  color: var(--danger);
  font-size: 10px;
}

.vault-gate__loading {
  width: 180px;
  height: 2px;
  overflow: hidden;
  background: var(--line);
}

.vault-gate__loading::after {
  display: block;
  width: 45%;
  height: 100%;
  background: var(--brand);
  animation: vault-loading 1s ease-in-out infinite alternate;
  content: "";
}

.vault-gate__note {
  position: absolute;
  bottom: 24px;
  color: var(--ink-muted);
  font-size: 10px;
}

@keyframes vault-loading {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(122%);
  }
}
</style>
