<script setup lang="ts">
import { LoaderCircle, Plus, RefreshCw, RotateCcw, Search, Trash2 } from "@lucide/vue";

defineProps<{
  contactOptions: readonly string[];
  serverOptions: readonly string[];
  specializationOptions: readonly string[];
  visibleCount: number;
  selectedCount: number;
  refreshBusy: boolean;
  deleting: boolean;
  canResetView: boolean;
}>();

const query = defineModel<string>("query", { required: true });
const needsReviewOnly = defineModel<boolean>("needsReviewOnly", { required: true });
const contactName = defineModel<string>("contactName", { required: true });
const server = defineModel<string>("server", { required: true });
const specialization = defineModel<string>("specialization", { required: true });

const emit = defineEmits<{
  search: [];
  resetView: [];
  refreshVisible: [];
  refreshSelected: [];
  deleteSelected: [];
  create: [];
}>();
</script>

<template>
  <section class="account-toolbar" aria-label="账号工具栏">
    <div class="account-toolbar__filters" role="search">
      <label class="account-toolbar__search">
        <Search :size="15" aria-hidden="true" />
        <input
          v-model="query"
          class="input"
          placeholder="搜索联系人、区服、角色或账号"
          aria-label="搜索账号"
        />
      </label>
      <label class="account-toolbar__review">
        <input v-model="needsReviewOnly" type="checkbox" @change="emit('search')" />
        <span>暂不可用</span>
      </label>

      <select
        v-model="contactName"
        class="select account-toolbar__select account-toolbar__select--contact"
        aria-label="按联系人筛选账号"
        title="按联系人筛选账号"
      >
        <option value="">联系人 · 全部</option>
        <option v-for="contact in contactOptions" :key="contact" :value="contact">
          {{ contact }}
        </option>
      </select>
      <select
        v-model="server"
        class="select account-toolbar__select account-toolbar__select--server"
        aria-label="按服务器筛选账号"
        title="按服务器筛选账号"
      >
        <option value="">服务器 · 全部</option>
        <option v-for="item in serverOptions" :key="item" :value="item">{{ item }}</option>
      </select>
      <select
        v-model="specialization"
        class="select account-toolbar__select"
        aria-label="按职业或心法筛选账号"
        title="按职业或心法筛选账号"
      >
        <option value="">职业 · 全部</option>
        <option v-for="item in specializationOptions" :key="item" :value="item">
          {{ item }}
        </option>
      </select>
      <button
        class="button button--ghost button--compact account-toolbar__reset"
        type="button"
        :disabled="!canResetView"
        title="重置筛选和排序"
        aria-label="重置筛选和排序"
        @click="emit('resetView')"
      >
        <RotateCcw :size="14" aria-hidden="true" />
      </button>
    </div>

    <div class="account-toolbar__actions">
      <button
        class="button button--ghost account-toolbar__action"
        type="button"
        :disabled="refreshBusy || visibleCount === 0"
        :aria-busy="refreshBusy"
        title="更新当前搜索和筛选后显示的账号"
        aria-label="更新当前列表"
        @click="emit('refreshVisible')"
      >
        <LoaderCircle v-if="refreshBusy" class="account-toolbar__spinner" :size="15" />
        <RefreshCw v-else :size="15" aria-hidden="true" />
        <span class="account-toolbar__action-label">更新当前列表</span>
      </button>
      <button
        class="button button--ghost account-toolbar__action"
        type="button"
        :disabled="refreshBusy || selectedCount === 0"
        title="更新选中的账号"
        aria-label="更新选中"
        @click="emit('refreshSelected')"
      >
        <RefreshCw :size="15" aria-hidden="true" />
        <span class="account-toolbar__action-label">更新选中</span>
      </button>
      <button
        class="button button--ghost account-toolbar__action"
        type="button"
        :disabled="selectedCount === 0 || deleting"
        :aria-busy="deleting"
        :title="
          deleting
            ? '正在删除选中的账号'
            : selectedCount === 0
              ? '请先选择账号'
              : '永久删除选中的账号'
        "
        aria-label="批量删除"
        @click="emit('deleteSelected')"
      >
        <LoaderCircle v-if="deleting" class="account-toolbar__spinner" :size="15" />
        <Trash2 v-else :size="15" aria-hidden="true" />
        <span class="account-toolbar__action-label">{{ deleting ? "正在删除…" : "批量删除" }}</span>
      </button>
      <button
        class="button button--primary account-toolbar__action"
        type="button"
        title="新建账号"
        aria-label="新建账号"
        @click="emit('create')"
      >
        <Plus :size="15" aria-hidden="true" />
        <span class="account-toolbar__action-label">新建账号</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.account-toolbar {
  container-type: inline-size;
  display: flex;
  min-width: 0;
  min-height: 52px;
  flex: 0 0 auto;
  align-items: center;
  gap: 10px;
  padding: 7px 9px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg, 14px);
  background: color-mix(in srgb, var(--surface) 94%, transparent);
  box-shadow: var(--shadow-xs, 0 3px 14px rgba(31, 49, 42, 0.04));
}

.account-toolbar__filters,
.account-toolbar__actions {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.account-toolbar__filters {
  flex: 1 1 auto;
}

.account-toolbar__actions {
  flex: 0 0 auto;
}

.account-toolbar__search {
  position: relative;
  display: flex;
  min-width: 138px;
  flex: 0 1 220px;
  align-items: center;
}

.account-toolbar__search > svg {
  position: absolute;
  left: 10px;
  z-index: 1;
  color: var(--ink-muted);
  pointer-events: none;
}

.account-toolbar__search .input {
  width: 100%;
  height: 34px;
  padding-left: 31px;
  font-size: 11px;
}

.account-toolbar__review {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 5px;
  color: var(--ink-muted);
  font-size: 11px;
}

.account-toolbar__review input {
  accent-color: var(--amber);
}

.account-toolbar__select {
  width: var(--account-toolbar-select-width, clamp(82px, 8vw, 110px));
  height: 34px;
  padding-inline: 8px 22px;
  font-size: 11px;
}

.account-toolbar .button {
  min-height: 34px;

.account-toolbar__select--contact {
  --account-toolbar-select-width: 140px;
}

.account-toolbar__select--server {
  --account-toolbar-select-width: 130px;
}
  padding-inline: 9px;
  font-size: 11px;
}

.account-toolbar__reset {
  flex: 0 0 auto;
}

.account-toolbar__action {
  flex: 0 0 auto;
}

.account-toolbar__spinner {
  animation: account-toolbar-spin 900ms linear infinite;
}

.account-toolbar__reset {
  width: 34px;
  padding-inline: 0;
}

@keyframes account-toolbar-spin {
  to {
    transform: rotate(360deg);
  }
}

@container (max-width: 1100px) {
  .account-toolbar__filters,
  .account-toolbar__actions {
    gap: 5px;
  }

  .account-toolbar__select {
    width: var(--account-toolbar-select-width, 86px);
  }

  .account-toolbar .button {
    padding-inline: 7px;
  }
}

@container (max-width: 920px) {
  .account-toolbar__action-label {
    display: none;
  }

  .account-toolbar .button {
    width: 34px;
    padding-inline: 0;
@container (max-width: 1160px) {
  .account-toolbar__actions .account-toolbar__action-label {
    display: none;
  }

  .account-toolbar__actions .button {
    width: 34px;
    padding-inline: 0;
  }
}

  }
}

@container (max-width: 820px) {
  .account-toolbar__search {
    min-width: 116px;
  }

  .account-toolbar__search .input::placeholder {
    color: transparent;
  }

  .account-toolbar__review span {
    display: none;
  }

  .account-toolbar__select {
    width: 76px;
  }
}
</style>
