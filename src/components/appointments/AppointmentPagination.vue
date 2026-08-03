<script setup lang="ts">
import { ChevronLeft, ChevronRight } from "@lucide/vue";
import { computed } from "vue";

const props = defineProps<{
  page: number;
  pageSize: number;
  totalPages: number;
  totalCount: number;
  loading: boolean;
}>();

const emit = defineEmits<{
  changePage: [page: number];
}>();

const firstItem = computed(() => (props.totalCount ? (props.page - 1) * props.pageSize + 1 : 0));
const lastItem = computed(() => Math.min(props.page * props.pageSize, props.totalCount));
</script>

<template>
  <nav class="appointment-pagination" aria-label="预约记录分页">
    <span class="appointment-pagination__range">
      显示 {{ firstItem }}–{{ lastItem }} / 共 {{ totalCount }} 条
    </span>
    <div class="appointment-pagination__actions">
      <button
        class="button button--ghost button--compact"
        type="button"
        :disabled="loading || page <= 1"
        aria-label="上一页"
        @click="emit('changePage', page - 1)"
      >
        <ChevronLeft :size="14" />
        上一页
      </button>
      <span class="appointment-pagination__page">
        第 {{ totalPages ? page : 0 }} / {{ totalPages }} 页
      </span>
      <button
        class="button button--ghost button--compact"
        type="button"
        :disabled="loading || page >= totalPages"
        aria-label="下一页"
        @click="emit('changePage', page + 1)"
      >
        下一页
        <ChevronRight :size="14" />
      </button>
    </div>
  </nav>
</template>

<style scoped>
.appointment-pagination {
  display: flex;
  min-height: 36px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 2px 4px 0;
  color: var(--ink-muted);
  font-size: 11px;
}

.appointment-pagination__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.appointment-pagination__page {
  min-width: 82px;
  color: var(--ink);
  font-family: "Bahnschrift", var(--font-sans);
  text-align: center;
}

.appointment-pagination .button {
  min-width: 76px;
}
</style>
