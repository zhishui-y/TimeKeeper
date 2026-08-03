<script setup lang="ts">
import { CalendarCheck2, Check, ContactRound } from "@lucide/vue";

withDefaults(
  defineProps<{
    appointments: boolean;
    accounts: boolean;
    disabled?: boolean;
  }>(),
  { disabled: false },
);

const emit = defineEmits<{
  "update:appointments": [value: boolean];
  "update:accounts": [value: boolean];
}>();

function checked(event: unknown): boolean {
  return (event as { target: { checked: boolean } }).target.checked;
}
</script>

<template>
  <fieldset class="import-scope" :disabled="disabled">
    <legend>选择导入内容</legend>
    <div class="import-scope__options">
      <label class="scope-option" :class="{ 'is-selected': appointments }">
        <input
          type="checkbox"
          :checked="appointments"
          aria-label="导入预约记录"
          @change="emit('update:appointments', checked($event))"
        />
        <span class="scope-option__icon"><CalendarCheck2 :size="17" /></span>
        <span class="scope-option__copy">
          <strong>预约记录</strong>
          <small>日期、时段、状态与账单</small>
        </span>
        <span class="scope-option__check"><Check :size="13" /></span>
      </label>

      <label class="scope-option" :class="{ 'is-selected': accounts }">
        <input
          type="checkbox"
          :checked="accounts"
          aria-label="导入账号档案"
          @change="emit('update:accounts', checked($event))"
        />
        <span class="scope-option__icon"><ContactRound :size="17" /></span>
        <span class="scope-option__copy">
          <strong>账号档案</strong>
          <small>资料与本地业务密码</small>
        </span>
        <span class="scope-option__check"><Check :size="13" /></span>
      </label>
    </div>
    <p>再次导入相同内容时，将按数据指纹自动跳过。</p>
  </fieldset>
</template>

<style scoped>
.import-scope {
  min-width: 0;
  margin: 13px 0 0;
  padding: 0;
  border: 0;
}

.import-scope legend {
  margin-bottom: 7px;
  color: var(--ink-muted);
  font-size: 11px;
  font-weight: 650;
}

.import-scope__options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.scope-option {
  position: relative;
  display: grid;
  min-width: 0;
  min-height: 62px;
  grid-template-columns: 34px minmax(0, 1fr) 20px;
  align-items: center;
  gap: 9px;
  padding: 9px 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius, 12px);
  color: var(--ink-muted);
  background: color-mix(in srgb, var(--surface-soft) 78%, var(--surface));
  cursor: pointer;
  transition:
    border-color 150ms ease,
    background-color 150ms ease,
    box-shadow 150ms ease,
    color 150ms ease;
}

.scope-option:hover {
  border-color: color-mix(in srgb, var(--brand) 34%, var(--line));
}

.scope-option.is-selected {
  border-color: color-mix(in srgb, var(--brand) 44%, var(--line));
  color: var(--brand-strong);
  background: color-mix(in srgb, var(--brand-soft) 62%, var(--surface));
  box-shadow: inset 3px 0 0 var(--brand);
}

.scope-option input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.scope-option:has(input:focus-visible) {
  outline: 3px solid rgba(45, 104, 84, 0.14);
  outline-offset: 2px;
}

.scope-option__icon {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: 10px;
  color: var(--ink-muted);
  background: var(--surface);
  box-shadow: inset 0 0 0 1px var(--line);
}

.is-selected .scope-option__icon {
  color: var(--brand);
  background: color-mix(in srgb, var(--brand-soft) 70%, var(--surface));
}

.scope-option__copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.scope-option__copy strong {
  color: var(--ink-strong);
  font-size: 12px;
}

.scope-option__copy small {
  overflow: hidden;
  color: var(--ink-muted);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.scope-option__check {
  display: grid;
  width: 18px;
  height: 18px;
  place-items: center;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  color: transparent;
  background: var(--surface);
}

.is-selected .scope-option__check {
  border-color: var(--brand);
  color: white;
  background: var(--brand);
}

.import-scope > p {
  margin-top: 7px;
  color: var(--ink-muted);
  font-size: 10px;
  line-height: 1.45;
}

.import-scope:disabled .scope-option {
  cursor: wait;
  opacity: 0.68;
}
</style>
