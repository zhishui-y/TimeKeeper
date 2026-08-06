<script setup lang="ts">
defineProps<{
  question: string;
  answer: string;
  confirmation: string;
  loading: boolean;
  labels?: boolean;
}>();

const emit = defineEmits<{
  "update:question": [value: string];
  "update:answer": [value: string];
  "update:confirmation": [value: string];
  input: [];
}>();
</script>

<template>
  <div class="recovery-fields">
    <label>
      <span>{{ labels === false ? "恢复问题" : "恢复问题（2–100字）" }}</span>
      <input
        :value="question"
        :disabled="loading"
        autocomplete="off"
        aria-label="恢复问题"
        placeholder="例如：我最常用的陪玩角色是？"
        @input="
          emit('update:question', ($event.target as HTMLInputElement).value);
          emit('input');
        "
      />
    </label>
    <label>
      <span>恢复答案（2–100字）</span>
      <input
        :value="answer"
        :disabled="loading"
        type="password"
        autocomplete="off"
        aria-label="恢复答案"
        placeholder="答案会规范化后保存校验值"
        @input="
          emit('update:answer', ($event.target as HTMLInputElement).value);
          emit('input');
        "
      />
    </label>
    <label>
      <span>再次输入恢复答案</span>
      <input
        :value="confirmation"
        :disabled="loading"
        type="password"
        autocomplete="off"
        aria-label="再次输入恢复答案"
        placeholder="再次输入以确认"
        @input="
          emit('update:confirmation', ($event.target as HTMLInputElement).value);
          emit('input');
        "
      />
    </label>
  </div>
</template>
