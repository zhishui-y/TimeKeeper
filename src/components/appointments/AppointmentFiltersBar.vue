<script setup lang="ts">
import { ListFilter, RotateCcw, Search } from "@lucide/vue";
import { reactive, watch } from "vue";
import type { AccountProfile, AppointmentFilters } from "../../types/domain";

const props = defineProps<{
  filters: AppointmentFilters;
  accounts: readonly AccountProfile[];
}>();

const emit = defineEmits<{
  apply: [filters: AppointmentFilters];
  reset: [];
}>();

const draft = reactive<AppointmentFilters>({ ...props.filters });

watch(
  () => props.filters,
  (value) => Object.assign(draft, value),
  { deep: true },
);

function reset(): void {
  Object.keys(draft).forEach((key) => delete draft[key as keyof AppointmentFilters]);
  emit("reset");
}
</script>

<template>
  <form class="filters" @submit.prevent="emit('apply', { ...draft })">
    <label class="search-field">
      <Search class="search-field__icon" :size="15" />
      <input v-model="draft.query" class="input" placeholder="搜索联系人、内容或账号" />
    </label>
    <input v-model="draft.from" class="input filters__date" type="date" aria-label="开始日期" />
    <span class="filters__separator">至</span>
    <input v-model="draft.to" class="input filters__date" type="date" aria-label="结束日期" />
    <select v-model="draft.mode" class="select filters__select" aria-label="预约模式">
      <option :value="undefined">全部模式</option>
      <option value="business">业务</option>
      <option value="entertainment">娱乐</option>
    </select>
    <select v-model="draft.serviceStatus" class="select filters__select" aria-label="预约进度">
      <option :value="undefined">全部进度</option>
      <option value="scheduled">已预约</option>
      <option value="in_progress">进行中</option>
      <option value="completed">已完成</option>
      <option value="cancelled">已取消</option>
    </select>
    <select v-model="draft.accountProfileId" class="select filters__account" aria-label="关联账号">
      <option :value="undefined">全部账号</option>
      <option v-for="account in accounts" :key="account.id" :value="account.id">
        {{ account.contactName || account.accountName }}
      </option>
    </select>
    <button class="button button--compact" type="submit">
      <ListFilter :size="14" />
      筛选
    </button>
    <button class="icon-button" type="button" title="重置筛选" aria-label="重置筛选" @click="reset">
      <RotateCcw :size="15" />
    </button>
  </form>
</template>

<style scoped>
.filters {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
}

.filters__date {
  width: 132px;
}

.filters__separator {
  color: var(--ink-muted);
  font-size: 10px;
}

.filters__select {
  width: 104px;
}

.filters__account {
  width: 112px;
}

@media (max-width: 1270px) {
  .search-field {
    width: 190px;
  }

  .filters__account {
    display: none;
  }
}
</style>
