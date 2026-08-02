<script setup lang="ts">
import { LockKeyhole, X } from "@lucide/vue";
import { computed, shallowRef, useTemplateRef, watch } from "vue";
import { useModalFocus } from "../../composables/useModalFocus";

const props = defineProps<{
  open: boolean;
  loading: boolean;
  error: string | null;
}>();

const emit = defineEmits<{
  close: [];
  submit: [password: string];
}>();

const panelRef = useTemplateRef("panel");
const passwordRef = useTemplateRef("passwordInput");
const password = shallowRef("");
const localError = shallowRef<string | null>(null);
const attempted = shallowRef(false);
const visibleError = computed(() => localError.value ?? (attempted.value ? props.error : null));

function close(): void {
  emit("close");
}

function submit(): void {
  const value = password.value;
  if (!value) {
    localError.value = "请输入主密码";
    passwordRef.value?.focus();
    return;
  }
  localError.value = null;
  attempted.value = true;
  emit("submit", value);
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      attempted.value = false;
      localError.value = null;
      return;
    }
    password.value = "";
    attempted.value = false;
    localError.value = null;
  },
);

watch(password, () => {
  localError.value = null;
});

useModalFocus({
  open: () => props.open,
  container: panelRef,
  close,
  initialFocus: () => passwordRef.value,
});
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="vault-unlock-layer">
      <button
        class="vault-unlock-backdrop"
        type="button"
        aria-label="关闭密码库解锁窗口"
        @click="close"
      />
      <section
        ref="panel"
        class="vault-unlock-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vault-unlock-title"
        tabindex="-1"
      >
        <header class="vault-unlock-dialog__header">
          <div>
            <LockKeyhole :size="17" />
            <h2 id="vault-unlock-title">解锁密码库</h2>
          </div>
          <button class="icon-button" type="button" aria-label="关闭解锁窗口" @click="close">
            <X :size="17" />
          </button>
        </header>

        <form class="vault-unlock-dialog__form" @submit.prevent="submit">
          <label for="account-vault-password">主密码</label>
          <input
            id="account-vault-password"
            ref="passwordInput"
            v-model="password"
            class="input"
            type="password"
            autocomplete="current-password"
            placeholder="输入主密码"
            :disabled="loading"
          />
          <p v-if="visibleError" class="vault-unlock-dialog__error" role="alert">
            {{ visibleError }}
          </p>
          <div class="vault-unlock-dialog__actions">
            <button class="button button--ghost" type="button" @click="close">取消</button>
            <button
              class="button button--primary"
              type="submit"
              :disabled="loading"
              :aria-busy="loading"
            >
              {{ loading ? "正在解锁…" : "解锁" }}
            </button>
          </div>
        </form>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.vault-unlock-layer {
  position: fixed;
  z-index: 1100;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 20px;
}

.vault-unlock-backdrop {
  position: absolute;
  border: 0;
  inset: 0;
  background: rgba(22, 31, 28, 0.36);
  backdrop-filter: blur(2px);
}

.vault-unlock-dialog {
  position: relative;
  width: min(360px, calc(100vw - 32px));
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--surface);
  box-shadow: 0 20px 56px rgba(24, 43, 36, 0.22);
}

.vault-unlock-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 15px 16px 10px;
}

.vault-unlock-dialog__header > div {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--brand-strong);
}

.vault-unlock-dialog__header h2 {
  margin: 0;
  font-size: 16px;
}

.vault-unlock-dialog__form {
  display: grid;
  gap: 8px;
  padding: 8px 16px 16px;
}

.vault-unlock-dialog__form label {
  color: var(--ink-muted);
  font-size: 12px;
  font-weight: 650;
}

.vault-unlock-dialog__error {
  margin: 0;
  color: var(--danger);
  font-size: 12px;
}

.vault-unlock-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 6px;
}
</style>
