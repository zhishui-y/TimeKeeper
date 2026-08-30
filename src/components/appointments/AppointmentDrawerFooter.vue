<script setup lang="ts">
import { CheckCircle2, ChevronDown, Copy, Save, Trash2, X } from "@lucide/vue";
import { nextTick, onMounted, onUnmounted, shallowRef, useTemplateRef, watch } from "vue";
import type { AppointmentProgressStatus } from "../../types/domain";

const props = withDefaults(
  defineProps<{
    editing: boolean;
    progressStatus: AppointmentProgressStatus;
    formId?: string;
    saving?: boolean;
    deleting?: boolean;
  }>(),
  {
    formId: "appointment-form",
    saving: false,
    deleting: false,
  },
);

const emit = defineEmits<{
  close: [];
  delete: [];
  duplicate: [];
  complete: [];
  cancel: [];
  menuOpenChange: [open: boolean];
}>();

const menuOpen = shallowRef(false);
const menuContainerRef = useTemplateRef<HTMLElement>("menuContainer");
const menuTriggerRef = useTemplateRef<HTMLButtonElement>("menuTrigger");
const firstMenuItemRef = useTemplateRef<HTMLButtonElement>("firstMenuItem");

function closeMenu(restoreFocus = false): void {
  if (!menuOpen.value) return;
  menuOpen.value = false;
  emit("menuOpenChange", false);
  if (restoreFocus) void nextTick(() => menuTriggerRef.value?.focus());
}

function toggleMenu(): void {
  menuOpen.value = !menuOpen.value;
  emit("menuOpenChange", menuOpen.value);
  if (menuOpen.value) void nextTick(() => firstMenuItemRef.value?.focus());
}

function runMenuAction(action: "cancel" | "delete"): void {
  closeMenu(true);
  if (action === "cancel") emit("cancel");
  else emit("delete");
}

function handleMenuKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  event.preventDefault();
  event.stopPropagation();
  closeMenu(true);
}

function handleDocumentKeydown(event: KeyboardEvent): void {
  if (!menuOpen.value || event.key !== "Escape") return;
  event.preventDefault();
  event.stopImmediatePropagation();
  closeMenu(true);
}

function handleDocumentPointerDown(event: PointerEvent): void {
  if (!menuOpen.value || !(event.target instanceof Node)) return;
  if (!menuContainerRef.value?.contains(event.target)) closeMenu();
}

watch(
  () => [props.editing, props.saving, props.deleting],
  ([editing, saving, deleting]) => {
    if (!editing || saving || deleting) closeMenu();
  },
);

onMounted(() => {
  document.addEventListener("keydown", handleDocumentKeydown, true);
  document.addEventListener("pointerdown", handleDocumentPointerDown);
});
onUnmounted(() => {
  document.removeEventListener("keydown", handleDocumentKeydown, true);
  document.removeEventListener("pointerdown", handleDocumentPointerDown);
});
</script>

<template>
  <footer class="drawer-footer">
    <div v-if="editing" class="drawer-footer__actions drawer-footer__actions--edit">
      <button
        class="button"
        type="button"
        aria-label="复制为今日预约"
        :disabled="saving || deleting"
        @click="emit('duplicate')"
      >
        <Copy :size="16" />
        复制
      </button>
      <button
        class="button drawer-footer__complete"
        type="button"
        aria-label="完成预约"
        :disabled="saving || deleting || progressStatus === 'completed'"
        @click="emit('complete')"
      >
        <CheckCircle2 :size="16" />
        标记完成
      </button>
      <div ref="menuContainer" class="drawer-footer__menu-container">
        <button
          ref="menuTrigger"
          class="button"
          type="button"
          aria-haspopup="menu"
          :aria-expanded="menuOpen"
          :disabled="saving || deleting"
          @click="toggleMenu"
        >
          更多操作
          <ChevronDown :size="15" />
        </button>
        <div
          v-if="menuOpen"
          class="drawer-footer__menu"
          role="menu"
          aria-label="更多预约操作"
          @keydown="handleMenuKeydown"
        >
          <button
            ref="firstMenuItem"
            class="drawer-footer__menu-item"
            type="button"
            role="menuitem"
            :disabled="progressStatus === 'cancelled'"
            @click="runMenuAction('cancel')"
          >
            <X :size="16" />
            取消预约
          </button>
          <span class="drawer-footer__menu-divider" role="separator" />
          <button
            class="drawer-footer__menu-item drawer-footer__menu-item--danger"
            type="button"
            role="menuitem"
            @click="runMenuAction('delete')"
          >
            <Trash2 :size="16" />
            {{ deleting ? "删除中…" : "永久删除" }}
          </button>
        </div>
      </div>
    </div>

    <div class="drawer-footer__actions drawer-footer__actions--primary">
      <button
        class="button"
        type="button"
        aria-label="关闭预约编辑"
        :disabled="saving || deleting"
        @click="emit('close')"
      >
        关闭
      </button>
      <button
        class="button button--primary"
        type="submit"
        :form="formId"
        :aria-label="editing ? '保存修改' : '保存预约'"
        :disabled="saving || deleting"
      >
        <Save :size="16" />
        {{ saving ? "保存中…" : editing ? "保存修改" : "保存预约" }}
      </button>
    </div>
  </footer>
</template>

<style scoped>
.drawer-footer {
  position: relative;
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 24px;
  border-top: 1px solid var(--line);
  background: color-mix(in srgb, var(--surface) 94%, transparent);
}

.drawer-footer__actions {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.drawer-footer__actions--primary {
  margin-left: auto;
}

.drawer-footer__complete {
  border-color: color-mix(in srgb, var(--brand) 42%, var(--line));
  color: var(--brand-strong);
  background: color-mix(in srgb, var(--brand-soft) 58%, var(--surface));
}

.drawer-footer__complete:hover:not(:disabled) {
  border-color: var(--brand);
  background: var(--brand-soft);
}

.drawer-footer__menu-container {
  position: relative;
}

.drawer-footer__menu {
  position: absolute;
  z-index: 2;
  bottom: calc(100% + 8px);
  left: 0;
  display: grid;
  width: 164px;
  gap: 3px;
  padding: 6px;
  border: 1px solid var(--line);
  border-radius: var(--radius, 12px);
  background: var(--surface);
  box-shadow: 0 14px 32px rgba(18, 34, 28, 0.18);
}

.drawer-footer__menu-item {
  display: flex;
  min-height: 36px;
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  border: 0;
  border-radius: var(--radius-sm, 8px);
  color: var(--ink);
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.drawer-footer__menu-item:hover:not(:disabled),
.drawer-footer__menu-item:focus-visible {
  outline: 0;
  background: var(--surface-soft);
}

.drawer-footer__menu-item:disabled {
  cursor: default;
  opacity: 0.45;
}

.drawer-footer__menu-item--danger {
  color: var(--danger);
}

.drawer-footer__menu-divider {
  height: 1px;
  background: var(--line);
}

@media (max-width: 760px) {
  .drawer-footer {
    align-items: stretch;
    flex-direction: column;
    justify-content: center;
    padding-block: 8px;
  }

  .drawer-footer__actions,
  .drawer-footer__actions--primary {
    width: 100%;
    margin-left: 0;
    justify-content: flex-end;
  }
}
</style>
