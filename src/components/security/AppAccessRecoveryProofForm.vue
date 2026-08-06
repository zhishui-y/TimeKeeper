<script setup lang="ts">
import AppAccessRecoverySetupForm from "./AppAccessRecoverySetupForm.vue";

defineProps<{
  question: string | null;
  answer: string;
  legacyQuestion: string;
  legacyAnswer: string;
  legacyConfirmation: string;
  loading: boolean;
}>();

const emit = defineEmits<{
  "update:answer": [value: string];
  "update:legacyQuestion": [value: string];
  "update:legacyAnswer": [value: string];
  "update:legacyConfirmation": [value: string];
  input: [];
}>();
</script>

<template>
  <template v-if="question">
    <label>
      <span>恢复问题</span>
      <div class="access-gate__recovery-question">{{ question }}</div>
    </label>
    <label>
      <span>恢复答案</span>
      <input
        class="access-gate__plain-input"
        :value="answer"
        :disabled="loading"
        type="password"
        autocomplete="off"
        aria-label="恢复答案"
        placeholder="输入恢复答案"
        @input="
          emit('update:answer', ($event.target as HTMLInputElement).value);
          emit('input');
        "
      />
    </label>
  </template>
  <AppAccessRecoverySetupForm
    v-else
    :question="legacyQuestion"
    :answer="legacyAnswer"
    :confirmation="legacyConfirmation"
    :loading="loading"
    :labels="false"
    @update:question="emit('update:legacyQuestion', $event)"
    @update:answer="emit('update:legacyAnswer', $event)"
    @update:confirmation="emit('update:legacyConfirmation', $event)"
    @input="emit('input')"
  />
</template>
