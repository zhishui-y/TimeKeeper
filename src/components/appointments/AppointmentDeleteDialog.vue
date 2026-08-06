<script setup lang="ts">
import { TriangleAlert, X } from "@lucide/vue";
import { useTemplateRef } from "vue";
import { useModalFocus } from "../../composables/useModalFocus";
import type { Appointment } from "../../types/domain";

const props = defineProps<{
  open: boolean;
  appointment: Appointment | null;
  busy: boolean;
}>();

const emit = defineEmits<{
  close: [];
  cancelAppointment: [];
  permanentDelete: [];
}>();

const panelRef = useTemplateRef("panel");
const returnRef = useTemplateRef("returnButton");

function close(): void {
  if (!props.busy) emit("close");
}

useModalFocus({
  open: () => props.open,
  container: panelRef,
  close,
  initialFocus: () => returnRef.value,
});
</script>

<template>
  <Teleport to="body">
    <div v-if="open && appointment" class="appointment-delete-layer">
      <button
        class="appointment-delete-backdrop"
        type="button"
        aria-label="关闭预约处理窗口"
        :disabled="busy"
        @click="close"
      />
      <section
        ref="panel"
        class="appointment-delete-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="appointment-delete-title"
        aria-describedby="appointment-delete-description"
        tabindex="-1"
      >
        <header class="appointment-delete-dialog__header">
          <div>
            <TriangleAlert :size="18" />
            <h2 id="appointment-delete-title">处理预约记录</h2>
          </div>
          <button
            class="icon-button"
            type="button"
            aria-label="关闭预约处理窗口"
            :disabled="busy"
            @click="close"
          >
            <X :size="17" />
          </button>
        </header>

        <div class="appointment-delete-dialog__body">
          <strong>{{ appointment.contactName }}</strong>
          <p id="appointment-delete-description">
            取消预约会保留历史记录；永久删除不可恢复，并会删除该预约保存的密码。
          </p>
        </div>

        <footer class="appointment-delete-dialog__actions">
          <button
            ref="returnButton"
            class="button button--ghost"
            type="button"
            :disabled="busy"
            @click="close"
          >
            返回
          </button>
          <button
            class="button button--ghost"
            type="button"
            :disabled="busy || appointment.serviceStatus === 'cancelled'"
            @click="emit('cancelAppointment')"
          >
            {{ appointment.serviceStatus === "cancelled" ? "已取消" : "取消预约" }}
          </button>
          <button
            class="button appointment-delete-dialog__danger"
            type="button"
            :disabled="busy"
            :aria-busy="busy"
            @click="emit('permanentDelete')"
          >
            {{ busy ? "处理中…" : "永久删除" }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.appointment-delete-layer {
  position: fixed;
  z-index: 1100;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 20px;
}

.appointment-delete-backdrop {
  position: absolute;
  border: 0;
  inset: 0;
  background: rgba(22, 31, 28, 0.36);
  backdrop-filter: blur(2px);
}

.appointment-delete-dialog {
  position: relative;
  width: min(440px, calc(100vw - 32px));
  overflow: hidden;
  border: 1px solid #dfb8ae;
  border-radius: 16px;
  background: var(--surface);
  box-shadow: 0 20px 56px rgba(24, 43, 36, 0.22);
}

.appointment-delete-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px 10px;
}

.appointment-delete-dialog__header > div {
  display: flex;
  align-items: center;
  gap: 9px;
  color: var(--danger);
}

.appointment-delete-dialog__header h2 {
  margin: 0;
  color: var(--ink-strong);
  font-size: calc(16px + var(--app-font-size-offset, 0px));
}

.appointment-delete-dialog__body {
  display: grid;
  gap: 7px;
  padding: 8px 18px 18px;
}

.appointment-delete-dialog__body strong {
  color: var(--ink-strong);
  font-size: calc(13px + var(--app-font-size-offset, 0px));
}

.appointment-delete-dialog__body p {
  margin: 0;
  color: var(--ink-muted);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  line-height: 1.65;
}

.appointment-delete-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 18px 17px;
}

.appointment-delete-dialog__danger {
  border-color: color-mix(in srgb, var(--danger) 32%, var(--line));
  color: #fff;
  background: var(--danger);
}

.appointment-delete-dialog__danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--danger) 88%, #000);
}

@media (max-width: 520px) {
  .appointment-delete-dialog__actions {
    flex-wrap: wrap;
  }
}
</style>
