<script setup lang="ts">
import { KeyRound } from "@lucide/vue";
import { shallowRef } from "vue";
import {
  MIN_MASTER_PASSWORD_CHARACTERS,
  RECOMMENDED_MASTER_PASSWORD_CHARACTERS,
  isMasterPasswordLongEnough,
} from "../../utils/security";

defineProps<{
  loading: boolean;
  error?: string | null;
}>();

const emit = defineEmits<{
  submit: [currentPassword: string, newPassword: string];
}>();

const currentPassword = shallowRef("");
const newPassword = shallowRef("");
const confirmation = shallowRef("");
const localError = shallowRef("");

function submit(): void {
  localError.value = "";
  if (!currentPassword.value) {
    localError.value = "请输入当前入口密码";
    return;
  }
  if (!isMasterPasswordLongEnough(newPassword.value)) {
    localError.value = `新入口密码至少需要${MIN_MASTER_PASSWORD_CHARACTERS}个字符`;
    return;
  }
  if (newPassword.value === currentPassword.value) {
    localError.value = "新入口密码不能与当前密码相同";
    return;
  }
  if (newPassword.value !== confirmation.value) {
    localError.value = "两次输入的新入口密码不一致";
    return;
  }
  emit("submit", currentPassword.value, newPassword.value);
  currentPassword.value = "";
  newPassword.value = "";
  confirmation.value = "";
}
</script>

<template>
  <form class="access-password-form" @submit.prevent="submit">
    <div class="access-password-form__heading">
      <KeyRound :size="17" />
      <div>
        <strong>修改入口密码</strong>
        <span>
          最低 {{ MIN_MASTER_PASSWORD_CHARACTERS }} 个字符，建议
          {{ RECOMMENDED_MASTER_PASSWORD_CHARACTERS }} 位以上。
        </span>
      </div>
    </div>
    <div class="access-password-form__fields">
      <label class="field">
        <span class="field__label">当前入口密码</span>
        <input
          v-model="currentPassword"
          class="input"
          type="password"
          autocomplete="current-password"
        />
      </label>
      <label class="field">
        <span class="field__label">新入口密码</span>
        <input v-model="newPassword" class="input" type="password" autocomplete="new-password" />
      </label>
      <label class="field">
        <span class="field__label">确认新入口密码</span>
        <input v-model="confirmation" class="input" type="password" autocomplete="new-password" />
      </label>
    </div>
    <div class="access-password-form__footer">
      <span v-if="localError || error" class="access-password-form__error" role="alert">
        {{ localError || error }}
      </span>
      <span v-else>入口密码只保护应用入口，不加密本地数据库或备份。</span>
      <button class="button button--primary button--compact" type="submit" :disabled="loading">
        {{ loading ? "正在修改…" : "修改入口密码" }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.access-password-form {
  display: flex;
  flex-direction: column;
  gap: 13px;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius, 12px);
  background: var(--surface-soft);
}

.access-password-form__heading {
  display: flex;
  align-items: center;
  gap: 9px;
  color: var(--brand);
}

.access-password-form__heading > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.access-password-form__heading strong {
  color: var(--ink-strong);
  font-size: 12px;
}

.access-password-form__heading span,
.access-password-form__footer {
  color: var(--ink-muted);
  font-size: 10px;
}

.access-password-form__fields {
  display: grid;
  grid-template-columns: repeat(3, minmax(150px, 1fr));
  gap: 10px;
}

.access-password-form__footer {
  display: flex;
  min-height: 34px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.access-password-form__error {
  color: var(--danger);
}

@media (max-width: 900px) {
  .access-password-form__fields {
    grid-template-columns: 1fr;
  }
}
</style>
