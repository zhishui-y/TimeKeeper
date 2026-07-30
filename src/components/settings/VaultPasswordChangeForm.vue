<script setup lang="ts">
import { KeyRound, ShieldAlert } from "@lucide/vue";
import { computed, shallowRef } from "vue";
import {
  MIN_MASTER_PASSWORD_CHARACTERS,
  RECOMMENDED_MASTER_PASSWORD_CHARACTERS,
  isMasterPasswordLongEnough,
} from "../../utils/security";

const props = defineProps<{
  loading: boolean;
  error?: string | null;
}>();

const emit = defineEmits<{
  submit: [payload: { currentPassword: string; newPassword: string }];
  cancel: [];
}>();

const currentPassword = shallowRef("");
const newPassword = shallowRef("");
const confirmation = shallowRef("");
const localError = shallowRef("");
const visibleError = computed(() => localError.value || props.error || "");

function clearLocalError(): void {
  localError.value = "";
}

function submit(): void {
  localError.value = "";
  if (!currentPassword.value) {
    localError.value = "请输入当前主密码";
    return;
  }
  if (!isMasterPasswordLongEnough(newPassword.value)) {
    localError.value = `新主密码至少需要${MIN_MASTER_PASSWORD_CHARACTERS}个字符`;
    return;
  }
  if (newPassword.value === currentPassword.value) {
    localError.value = "新主密码不能与当前主密码相同";
    return;
  }
  if (newPassword.value !== confirmation.value) {
    localError.value = "两次输入的新主密码不一致";
    return;
  }

  const payload = {
    currentPassword: currentPassword.value,
    newPassword: newPassword.value,
  };
  currentPassword.value = "";
  emit("submit", payload);
}

function cancel(): void {
  currentPassword.value = "";
  newPassword.value = "";
  confirmation.value = "";
  localError.value = "";
  emit("cancel");
}
</script>

<!-- eslint-disable vue/html-self-closing, vue/max-attributes-per-line -->
<template>
  <form class="password-change" aria-labelledby="password-change-title" @submit.prevent="submit">
    <div class="password-change__heading">
      <span class="password-change__icon"><KeyRound :size="17" /></span>
      <div>
        <strong id="password-change-title">修改主密码</strong>
        <span>
          最低{{ MIN_MASTER_PASSWORD_CHARACTERS }}个字符，建议{{
            RECOMMENDED_MASTER_PASSWORD_CHARACTERS
          }}位以上；旧主密码立即失效。
        </span>
      </div>
    </div>

    <div class="password-change__fields">
      <label class="field">
        <span class="field__label">当前主密码</span>
        <input
          v-model="currentPassword"
          class="input"
          type="password"
          autocomplete="current-password"
          :disabled="loading"
          aria-label="当前主密码"
          @input="clearLocalError"
        />
      </label>
      <label class="field">
        <span class="field__label">新主密码</span>
        <input
          v-model="newPassword"
          class="input"
          type="password"
          autocomplete="new-password"
          :disabled="loading"
          aria-label="新主密码"
          :minlength="MIN_MASTER_PASSWORD_CHARACTERS"
          :placeholder="`至少${MIN_MASTER_PASSWORD_CHARACTERS}个字符`"
          @input="clearLocalError"
        />
      </label>
      <label class="field">
        <span class="field__label">确认新主密码</span>
        <input
          v-model="confirmation"
          class="input"
          type="password"
          autocomplete="new-password"
          :disabled="loading"
          aria-label="确认新主密码"
          @input="clearLocalError"
        />
      </label>
    </div>

    <div class="password-change__footer">
      <div class="password-change__message">
        <span v-if="visibleError" class="password-change__error" role="alert">
          {{ visibleError }}
        </span>
        <span v-else class="password-change__note">
          <ShieldAlert :size="13" />
          已导出的旧备份仍需使用旧主密码。
        </span>
      </div>
      <div class="password-change__actions">
        <button class="button button--compact" type="button" :disabled="loading" @click="cancel">
          取消
        </button>
        <button class="button button--primary button--compact" type="submit" :disabled="loading">
          {{ loading ? "正在修改..." : "确认修改" }}
        </button>
      </div>
    </div>
  </form>
</template>

<style scoped>
.password-change {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 14px;
  border: 1px solid color-mix(in srgb, var(--brand-border) 78%, var(--line));
  border-radius: var(--radius, 12px);
  background:
    linear-gradient(
      110deg,
      color-mix(in srgb, var(--brand-soft) 34%, transparent),
      transparent 58%
    ),
    var(--surface-soft);
}

.password-change__heading {
  display: flex;
  align-items: center;
  gap: 9px;
}

.password-change__heading > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.password-change__heading strong {
  color: var(--ink-strong);
  font-size: 12px;
}

.password-change__heading span {
  color: var(--ink-muted);
  font-size: 10px;
  line-height: 1.45;
}

.password-change__icon {
  display: grid;
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
  place-items: center;
  border-radius: 9px;
  color: var(--brand);
  background: var(--brand-soft);
}

.password-change__fields {
  display: grid;
  grid-template-columns: repeat(3, minmax(150px, 1fr));
  gap: 10px;
}

.password-change__footer {
  display: flex;
  min-height: 32px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.password-change__message {
  min-width: 0;
}

.password-change__error {
  color: var(--danger);
  font-size: 11px;
  line-height: 1.45;
}

.password-change__note {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: #7b5d2c;
  font-size: 10px;
}

.password-change__actions {
  display: flex;
  flex: 0 0 auto;
  gap: 7px;
}

@media (max-width: 900px) {
  .password-change__fields {
    grid-template-columns: repeat(2, minmax(160px, 1fr));
  }

  .password-change__fields .field:last-child {
    grid-column: 1 / -1;
  }
}

@media (max-width: 620px) {
  .password-change__fields {
    grid-template-columns: 1fr;
  }

  .password-change__fields .field:last-child {
    grid-column: auto;
  }

  .password-change__footer {
    align-items: stretch;
    flex-direction: column;
  }

  .password-change__actions {
    justify-content: flex-end;
  }
}
</style>
