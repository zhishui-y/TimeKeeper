<script setup lang="ts">
import { computed } from "vue";
import type { AccountProfile, AccountRoleDataRefreshResult } from "../../types/domain";

const props = defineProps<{
  result: AccountRoleDataRefreshResult;
  profiles: readonly AccountProfile[];
}>();

const accountLabels = computed(
  () => new Map(props.profiles.map((profile) => [profile.id, profile.accountName])),
);
const nonSuccessItems = computed(() =>
  props.result.items.filter((item) => item.status !== "updated"),
);
const statusLabels = {
  noRecord: "无战绩",
  skipped: "已跳过",
  failed: "失败",
} as const;
</script>

<template>
  <section class="role-refresh-feedback" aria-live="polite">
    <div class="role-refresh-feedback__summary">
      <strong>角色数据更新完成</strong>
      <span>更新 {{ result.updatedCount }}</span>
      <span>无战绩 {{ result.noRecordCount }}</span>
      <span>跳过 {{ result.skippedCount }}</span>
      <span>失败 {{ result.failedCount }}</span>
    </div>
    <ul v-if="nonSuccessItems.length" class="role-refresh-feedback__details">
      <li v-for="item in nonSuccessItems" :key="item.accountId">
        <strong>{{ accountLabels.get(item.accountId) || item.accountId }}</strong>
        <span>{{ statusLabels[item.status as keyof typeof statusLabels] }}</span>
        <span>{{ item.message || "未提供原因" }}</span>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.role-refresh-feedback {
  display: grid;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--brand) 24%, var(--line));
  border-radius: 10px;
  background: color-mix(in srgb, var(--brand-soft) 52%, var(--surface));
}

.role-refresh-feedback__summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px 14px;
  color: var(--ink-muted);
  font-size: 12px;
}

.role-refresh-feedback__summary strong {
  color: var(--ink-strong);
}

.role-refresh-feedback__details {
  display: grid;
  gap: 5px;
  max-height: 112px;
  padding: 8px 10px;
  overflow-y: auto;
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface) 88%, transparent);
  font-size: 12px;
}

.role-refresh-feedback__details li {
  display: grid;
  grid-template-columns: minmax(90px, 0.6fr) 58px minmax(160px, 1fr);
  gap: 10px;
}

@media (max-width: 700px) {
  .role-refresh-feedback__details li {
    grid-template-columns: 1fr;
    gap: 2px;
  }
}
</style>
