<script setup lang="ts">
import { shallowRef } from "vue";
import { isRecoveryTextValid, normalizeRecoveryAnswer } from "../../utils/security";

defineProps<{
  currentQuestion: string | null;
  loading: boolean;
  error?: string | null;
}>();

const emit = defineEmits<{
  submit: [currentPassword: string, question: string, answer: string];
}>();

const currentPassword = shallowRef("");
const question = shallowRef("");
const answer = shallowRef("");
const confirmation = shallowRef("");
const localError = shallowRef("");

function submit(): void {
  localError.value = "";
  if (!currentPassword.value) return void (localError.value = "请输入当前入口密码");
  if (!isRecoveryTextValid(question.value.trim())) {
    return void (localError.value = "恢复问题需要2–100个字符");
  }
  if (!isRecoveryTextValid(normalizeRecoveryAnswer(answer.value))) {
    return void (localError.value = "恢复答案规范化后需要2–100个字符");
  }
  if (normalizeRecoveryAnswer(answer.value) !== normalizeRecoveryAnswer(confirmation.value)) {
    return void (localError.value = "两次输入的恢复答案不一致");
  }
  emit("submit", currentPassword.value, question.value.trim(), answer.value);
  currentPassword.value = "";
  answer.value = "";
  confirmation.value = "";
}
</script>

<template>
  <form class="recovery-settings-form" @submit.prevent="submit">
    <div class="recovery-settings-form__heading">
      <strong>{{ currentQuestion ? "修改恢复问题" : "补设恢复问题" }}</strong>
      <span>重置入口密码时会先验证答案；问题明文展示，答案只保存 Argon2id 校验值。</span>
    </div>
    <div class="recovery-settings-form__fields">
      <label class="field"
        ><span class="field__label">当前入口密码</span
        ><input
          v-model="currentPassword"
          class="input"
          type="password"
          autocomplete="current-password"
      /></label>
      <label class="field"
        ><span class="field__label">恢复问题</span
        ><input
          v-model="question"
          class="input"
          autocomplete="off"
          :placeholder="currentQuestion || '例如：我最常用的角色是？'"
      /></label>
      <label class="field"
        ><span class="field__label">恢复答案</span
        ><input v-model="answer" class="input" type="password" autocomplete="off"
      /></label>
      <label class="field"
        ><span class="field__label">确认恢复答案</span
        ><input v-model="confirmation" class="input" type="password" autocomplete="off"
      /></label>
    </div>
    <div class="recovery-settings-form__footer">
      <span v-if="localError || error" class="recovery-settings-form__error" role="alert">{{
        localError || error
      }}</span>
      <span v-else class="recovery-settings-form__hint"
        >当前问题：{{ currentQuestion || "尚未设置" }}</span
      >
      <button class="button button--compact button--primary" type="submit" :disabled="loading">
        {{ loading ? "正在保存" : "保存恢复问题" }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.recovery-settings-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface-soft);
}

.recovery-settings-form__heading,
.recovery-settings-form__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.recovery-settings-form__heading {
  flex-direction: column;
  align-items: flex-start;
}

.recovery-settings-form__heading strong {
  color: var(--ink-strong);
}
.recovery-settings-form__heading span,
.recovery-settings-form__hint {
  color: var(--ink-muted);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}
.recovery-settings-form__fields {
  display: grid;
  grid-template-columns: repeat(4, minmax(130px, 1fr));
  gap: 10px;
}
.recovery-settings-form__error {
  color: var(--danger);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

@media (max-width: 950px) {
  .recovery-settings-form__fields {
    grid-template-columns: repeat(2, minmax(150px, 1fr));
  }
}
</style>
