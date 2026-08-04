<script setup lang="ts">
import { ClipboardCopy, Copy } from "@lucide/vue";
import type { AppointmentAccount } from "../../types/domain";

defineProps<{
  account?: AppointmentAccount | null;
  contactName: string;
}>();

const emit = defineEmits<{
  copyAccount: [];
  copyPassword: [];
}>();
</script>

<template>
  <div v-if="account" class="appointment-account-summary">
    <div class="appointment-account-summary__line">
      <span class="appointment-account-summary__value">
        {{ account.specialization || "—" }}
      </span>
      <span aria-hidden="true">·</span>
      <span class="appointment-account-summary__value">{{ account.gearScore || "—" }}</span>
    </div>
    <div class="appointment-account-summary__line appointment-account-summary__line--secondary">
      <span class="appointment-account-summary__value">{{ account.server || "—" }}</span>
      <span aria-hidden="true">·</span>
      <span v-if="account.source === 'profile'" class="appointment-account-summary__value">
        {{ account.characterName || "—" }}
      </span>
      <span v-if="account.source === 'profile'" aria-hidden="true">·</span>
      <button
        v-if="account.source === 'profile'"
        class="appointment-account-summary__copy"
        type="button"
        :title="`复制账号 ${account.accountName}`"
        :aria-label="`复制账号 ${account.accountName}`"
        @click="emit('copyAccount')"
      >
        <Copy :size="13" />
      </button>
      <button
        v-else
        class="appointment-account-summary__account"
        type="button"
        :title="`复制账号 ${account.accountName}`"
        :aria-label="`复制账号 ${account.accountName}`"
        @click="emit('copyAccount')"
      >
        {{ account.accountName }}
      </button>
      <span aria-hidden="true">·</span>
      <button
        class="appointment-account-summary__copy"
        type="button"
        :disabled="!account.password"
        :title="account.password ? `复制${contactName} 的预约密码` : '未保存预约密码'"
        :aria-label="`复制${contactName} 的预约密码`"
        @click="emit('copyPassword')"
      >
        <ClipboardCopy :size="13" />
      </button>
    </div>
  </div>
  <span v-else class="appointment-account-summary__empty">未使用账号</span>
</template>

<style scoped>
.appointment-account-summary {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.appointment-account-summary__line {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 5px;
  color: var(--ink-strong);
  font-size: 11px;
  font-weight: 650;
}

.appointment-account-summary__line--secondary,
.appointment-account-summary__empty {
  color: var(--ink-muted);
  font-size: 10px;
  font-weight: 500;
}

.appointment-account-summary__value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.appointment-account-summary__copy {
  display: grid;
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 5px;
  color: var(--brand-strong);
  background: transparent;
  cursor: copy;
}

.appointment-account-summary__account {
  min-width: 0;
  padding: 0;
  overflow: hidden;
  border: 0;
  color: var(--brand-strong);
  background: transparent;
  font: inherit;
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, currentColor 36%, transparent);
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: copy;
}

.appointment-account-summary__account:hover,
.appointment-account-summary__account:focus-visible {
  text-decoration-color: currentColor;
  outline: none;
}

.appointment-account-summary__copy:hover:not(:disabled),
.appointment-account-summary__copy:focus-visible {
  background: var(--brand-soft);
  outline: none;
}

.appointment-account-summary__copy:disabled {
  cursor: not-allowed;
  opacity: 0.32;
}
</style>
