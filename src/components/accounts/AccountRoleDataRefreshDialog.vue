<script setup lang="ts">
import { CheckCircle2, CircleAlert, X } from "@lucide/vue";
import { computed, useTemplateRef } from "vue";
import { useModalFocus } from "../../composables/useModalFocus";
import type { AccountRoleDataRefreshResult } from "../../types/domain";

const props = defineProps<{
  result: AccountRoleDataRefreshResult | null;
  error: string | null;
  returnFocus: { focus(): void } | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

const panelRef = useTemplateRef("panel");
const closeButtonRef = useTemplateRef("closeButton");
const open = computed(() => Boolean(props.result || props.error));
const tone = computed<"success" | "warning" | "danger">(() => {
  if (props.error || (props.result?.failedCount ?? 0) > 0) return "danger";
  if ((props.result?.noRecordCount ?? 0) > 0 || (props.result?.skippedCount ?? 0) > 0) {
    return "warning";
  }
  return "success";
});
const title = computed(() => (props.error ? "角色数据更新失败" : "角色数据更新完成"));
const icon = computed(() => (tone.value === "success" ? CheckCircle2 : CircleAlert));

function close(): void {
  emit("close");
}

useModalFocus({
  open: () => open.value,
  container: panelRef,
  close,
  initialFocus: () => closeButtonRef.value,
  restoreFocus: () => props.returnFocus,
});
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="role-refresh-layer">
      <button
        class="role-refresh-backdrop"
        type="button"
        aria-label="关闭角色数据更新结果"
        @click="close"
      />
      <section
        ref="panel"
        class="role-refresh-dialog"
        :class="`is-${tone}`"
        role="dialog"
        aria-modal="true"
        aria-labelledby="role-refresh-dialog-title"
        tabindex="-1"
      >
        <header class="role-refresh-dialog__header">
          <div class="role-refresh-dialog__title">
            <component :is="icon" :size="19" />
            <h2 id="role-refresh-dialog-title">{{ title }}</h2>
          </div>
          <button
            class="icon-button"
            type="button"
            aria-label="关闭角色数据更新结果"
            @click="close"
          >
            <X :size="17" />
          </button>
        </header>

        <div v-if="result" class="role-refresh-dialog__summary" aria-live="polite">
          <div>
            <span>更新</span>
            <strong>{{ result.updatedCount }}</strong>
          </div>
          <div>
            <span>无战绩</span>
            <strong>{{ result.noRecordCount }}</strong>
          </div>
          <div>
            <span>跳过</span>
            <strong>{{ result.skippedCount }}</strong>
          </div>
          <div>
            <span>失败</span>
            <strong>{{ result.failedCount }}</strong>
          </div>
        </div>
        <p v-if="error" class="role-refresh-dialog__error" role="alert">{{ error }}</p>

        <footer class="role-refresh-dialog__footer">
          <button
            ref="closeButton"
            class="button button--primary"
            data-role-refresh-close
            type="button"
            @click="close"
          >
            知道了
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.role-refresh-layer {
  position: fixed;
  z-index: 1100;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 20px;
}

.role-refresh-backdrop {
  position: absolute;
  border: 0;
  inset: 0;
  background: rgba(22, 31, 28, 0.36);
  backdrop-filter: blur(2px);
}

.role-refresh-dialog {
  position: relative;
  width: min(440px, calc(100vw - 32px));
  overflow: hidden;
  border: 1px solid var(--brand-border);
  border-radius: 16px;
  background: var(--surface);
  box-shadow: 0 20px 56px rgba(24, 43, 36, 0.22);
}

.role-refresh-dialog.is-warning {
  border-color: var(--amber-border);
}

.role-refresh-dialog.is-danger {
  border-color: #dfb8ae;
}

.role-refresh-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 17px 18px 12px;
}

.role-refresh-dialog__title {
  display: flex;
  align-items: center;
  gap: 9px;
  color: var(--brand-strong);
}

.is-warning .role-refresh-dialog__title {
  color: var(--amber);
}

.is-danger .role-refresh-dialog__title {
  color: var(--danger);
}

.role-refresh-dialog__title h2 {
  margin: 0;
  color: var(--ink-strong);
  font-size: calc(16px + var(--app-font-size-offset, 0px));
}

.role-refresh-dialog__summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  padding: 8px 18px 16px;
}

.role-refresh-dialog__summary > div {
  display: grid;
  gap: 4px;
  padding: 10px 8px;
  border-radius: 10px;
  background: var(--surface-soft);
  text-align: center;
}

.role-refresh-dialog__summary span {
  color: var(--ink-muted);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.role-refresh-dialog__summary strong {
  color: var(--ink-strong);
  font-size: calc(17px + var(--app-font-size-offset, 0px));
}

.role-refresh-dialog__error {
  margin: 4px 18px 16px;
  padding: 11px 12px;
  border-radius: 10px;
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 8%, var(--surface));
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  line-height: 1.55;
}

.role-refresh-dialog__footer {
  display: flex;
  justify-content: flex-end;
  padding: 0 18px 17px;
}

@media (max-width: 520px) {
  .role-refresh-dialog__summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
