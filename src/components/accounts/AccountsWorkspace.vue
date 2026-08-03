<script setup lang="ts">
import { Eraser, LoaderCircle } from "@lucide/vue";
import { computed, onMounted, onUnmounted, reactive, ref, shallowRef, watch } from "vue";
import { api, errorMessage } from "../../api/client";
import { useAccounts } from "../../composables/useAccounts";
import { useAccountRoleDataRefresh } from "../../composables/useAccountRoleDataRefresh";
import { useUiStore } from "../../stores/ui";
import type {
  AccountProfile,
  AccountProfileInput,
  AccountTableColumnWidths,
} from "../../types/domain";
import {
  DEFAULT_ACCOUNT_TABLE_COLUMN_WIDTHS,
  accountTableColumnWidthsEqual,
  clampAccountTableColumnWidth,
  cloneAccountTableColumnWidths,
  type AccountTableColumnKey,
} from "../../utils/accountTableColumns";
import {
  filterAndSortAccountProfiles,
  moveAccountProfileId,
  orderAccountProfilesByIds,
  uniqueAccountValues,
  type AccountDropPlacement,
  type AccountProfileFilters,
  type AccountProfileSortKey,
  type SortDirection,
} from "../../utils/accounts";
import AccountDrawer from "./AccountDrawer.vue";
import AccountRoleDataRefreshDialog from "./AccountRoleDataRefreshDialog.vue";
import AccountTable from "./AccountTable.vue";
import AccountToolbar from "./AccountToolbar.vue";

const ui = useUiStore();
const { items, loading, error, load } = useAccounts({ immediate: false });
const query = shallowRef("");
const needsReviewOnly = shallowRef(false);
const accountFilters = reactive<AccountProfileFilters>({
  contactName: "",
  server: "",
  specialization: "",
});
const sortKey = shallowRef<AccountProfileSortKey | null>(null);
const sortDirection = shallowRef<SortDirection>("asc");
const manualOrderIds = shallowRef<string[]>([]);
const savingOrder = shallowRef(false);
const drawerOpen = shallowRef(false);
const activeProfile = shallowRef<AccountProfile | null>(null);
const savingAccount = shallowRef(false);
const usageDrafts = reactive<Record<string, string>>({});
const dirtyUsageIds = new Set<string>();
const savingUsageIds = shallowRef<ReadonlySet<string>>(new Set());
const columnWidths = shallowRef<AccountTableColumnWidths>(
  cloneAccountTableColumnWidths(DEFAULT_ACCOUNT_TABLE_COLUMN_WIDTHS),
);
const persistedColumnWidths = shallowRef<AccountTableColumnWidths>(
  cloneAccountTableColumnWidths(DEFAULT_ACCOUNT_TABLE_COLUMN_WIDTHS),
);
const savingColumnWidths = shallowRef(false);
const clearingWeekly = shallowRef(false);
const syncingWeekly = shallowRef(false);
const selectedIds = ref<string[]>([]);
const passwordResetKey = shallowRef(0);
const selectedCount = computed(() => selectedIds.value.length);
const roleDataRefreshReturnFocus = shallowRef<{ focus(): void } | null>(null);
const deletingAccounts = shallowRef(false);
const batchDeleteFeedback = shallowRef<{
  message: string;
  tone: "neutral" | "success" | "warning" | "danger";
} | null>(null);
let weeklySyncTimer: ReturnType<typeof globalThis.setInterval> | undefined;
let weeklySyncErrorReported = false;
const contactOptions = computed(() => uniqueAccountValues(items.value, "contactName"));
const serverOptions = computed(() => uniqueAccountValues(items.value, "server"));
const specializationOptions = computed(() => uniqueAccountValues(items.value, "specialization"));
const manuallyOrderedProfiles = computed(() =>
  orderAccountProfilesByIds(items.value, manualOrderIds.value),
);
const visibleProfiles = computed(() =>
  filterAndSortAccountProfiles(
    manuallyOrderedProfiles.value,
    accountFilters,
    sortKey.value,
    sortDirection.value,
  ),
);
const roleDataRefresh = useAccountRoleDataRefresh({
  async afterRefresh() {
    await load(query.value, needsReviewOnly.value ? true : undefined);
    ui.markAccountsChanged();
  },
});
const activeFilterCount = computed(() => Object.values(accountFilters).filter(Boolean).length);
const manualReorderEnabled = computed(() => {
  return (
    !savingOrder.value &&
    !query.value.trim() &&
    !needsReviewOnly.value &&
    activeFilterCount.value === 0 &&
    sortKey.value === null
  );
});
const reorderDisabledReason = computed(() => {
  if (savingOrder.value) return "正在保存账号顺序";
  return "清除搜索和筛选并恢复默认排序后可拖动";
});
async function refreshRoleData(ids: readonly string[]): Promise<void> {
  const activeElement = globalThis.document.activeElement;
  if (activeElement && "focus" in activeElement && typeof activeElement.focus === "function") {
    const restoreFocus = activeElement.focus.bind(activeElement);
    roleDataRefreshReturnFocus.value = { focus: restoreFocus };
  } else {
    roleDataRefreshReturnFocus.value = null;
  }
  await roleDataRefresh.refresh(ids);
}

function refreshVisibleRoleData(): void {
  void refreshRoleData(visibleProfiles.value.map((profile) => profile.id));
}

function refreshSelectedRoleData(): void {
  void refreshRoleData(selectedIds.value);
}

function refreshSingleRoleData(profile: AccountProfile): void {
  void refreshRoleData([profile.id]);
}

function openCreate(): void {
  activeProfile.value = null;
  drawerOpen.value = true;
}

function openEdit(profile: AccountProfile): void {
  activeProfile.value = profile;
  drawerOpen.value = true;
}

async function search(): Promise<void> {
  selectedIds.value = [];
  passwordResetKey.value += 1;
  await load(query.value, needsReviewOnly.value ? true : undefined);
}

async function loadColumnWidths(): Promise<void> {
  try {
    const settings = await api.getSettings();
    const widths = cloneAccountTableColumnWidths(settings.accountTableColumnWidths);
    columnWidths.value = widths;
    persistedColumnWidths.value = cloneAccountTableColumnWidths(widths);
  } catch (cause) {
    ui.notify(`加载账号表格列宽失败：${errorMessage(cause)}`, "danger");
  }
}

function previewColumnWidth(columnKey: AccountTableColumnKey, width: number): void {
  columnWidths.value = {
    ...columnWidths.value,
    [columnKey]: clampAccountTableColumnWidth(columnKey, width),
  };
}

function cancelColumnResize(columnKey: AccountTableColumnKey, width: number): void {
  previewColumnWidth(columnKey, width);
}

async function persistColumnWidths(nextWidths: AccountTableColumnWidths): Promise<void> {
  if (savingColumnWidths.value) return;
  const normalized = cloneAccountTableColumnWidths(nextWidths);
  if (accountTableColumnWidthsEqual(normalized, persistedColumnWidths.value)) {
    columnWidths.value = normalized;
    return;
  }

  const previous = cloneAccountTableColumnWidths(persistedColumnWidths.value);
  columnWidths.value = normalized;
  savingColumnWidths.value = true;
  try {
    const saved = await api.updateAccountTableColumnWidths(normalized);
    columnWidths.value = cloneAccountTableColumnWidths(saved);
    persistedColumnWidths.value = cloneAccountTableColumnWidths(saved);
  } catch (cause) {
    columnWidths.value = previous;
    ui.notify(errorMessage(cause), "danger");
  } finally {
    savingColumnWidths.value = false;
  }
}

function commitColumnWidth(columnKey: AccountTableColumnKey, width: number): void {
  const next = {
    ...columnWidths.value,
    [columnKey]: clampAccountTableColumnWidth(columnKey, width),
  };
  void persistColumnWidths(next);
}

async function syncWeeklyUsage({ reload = true }: { reload?: boolean } = {}): Promise<void> {
  if (syncingWeekly.value || clearingWeekly.value) return;
  syncingWeekly.value = true;
  try {
    const result = await api.syncAccountProfileUsageWeek();
    weeklySyncErrorReported = false;
    if (result.clearedCount > 0) {
      if (reload) await load(query.value, needsReviewOnly.value ? true : undefined);
      ui.markAccountsChanged();
      ui.notify(`新的一周已开始，已清空 ${result.clearedCount} 个账号的本周内容`, "success");
    }
  } catch (cause) {
    if (!weeklySyncErrorReported) {
      ui.notify(`自动清空本周失败：${errorMessage(cause)}`, "danger");
      weeklySyncErrorReported = true;
    }
  } finally {
    syncingWeekly.value = false;
  }
}

async function clearWeeklyUsage(): Promise<void> {
  if (clearingWeekly.value || syncingWeekly.value || savingUsageIds.value.size > 0) return;
  if (
    !globalThis.confirm(
      "确定清空全部账号的本周内容吗？此操作无法撤销，未保存的本周输入也会被丢弃。",
    )
  ) {
    return;
  }

  clearingWeekly.value = true;
  try {
    const clearedCount = await api.clearAccountProfileUsage();
    dirtyUsageIds.clear();
    for (const profileId of Object.keys(usageDrafts)) usageDrafts[profileId] = "";
    await load(query.value, needsReviewOnly.value ? true : undefined);
    ui.markAccountsChanged();
    ui.notify(
      clearedCount > 0 ? `已清空 ${clearedCount} 个账号的本周内容` : "全部账号的本周内容已为空",
      "success",
    );
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
  } finally {
    clearingWeekly.value = false;
  }
}

function changeSort(nextSortKey: AccountProfileSortKey): void {
  passwordResetKey.value += 1;
  if (sortKey.value === nextSortKey) {
    sortDirection.value = sortDirection.value === "asc" ? "desc" : "asc";
    return;
  }

  sortKey.value = nextSortKey;
  sortDirection.value =
    nextSortKey === "gearScore" || nextSortKey === "currentScore" || nextSortKey === "highestScore"
      ? "desc"
      : "asc";
}

function resetListView(): void {
  passwordResetKey.value += 1;
  Object.assign(accountFilters, {
    contactName: "",
    server: "",
    specialization: "",
  });
  sortKey.value = null;
  sortDirection.value = "asc";
}

async function reorderProfiles(
  sourceId: string,
  targetId: string,
  placement: AccountDropPlacement,
): Promise<void> {
  if (!manualReorderEnabled.value) return;
  const previousOrder = [...manualOrderIds.value];
  const nextOrder = moveAccountProfileId(previousOrder, sourceId, targetId, placement);
  if (nextOrder.every((id, index) => id === previousOrder[index])) return;

  manualOrderIds.value = nextOrder;
  savingOrder.value = true;
  try {
    await api.reorderAccountProfiles(nextOrder);
    ui.notify("账号顺序已保存", "success");
  } catch (cause) {
    manualOrderIds.value = previousOrder;
    ui.notify(errorMessage(cause), "danger");
  } finally {
    savingOrder.value = false;
  }
}

async function copyAccount(profile: AccountProfile): Promise<void> {
  try {
    await api.copyAccountName(profile.id);
    ui.notify("账号已复制", "success");
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
  }
}

async function copyCharacterName(profile: AccountProfile): Promise<void> {
  try {
    await api.copyAccountCharacterName(profile.id);
    ui.notify("角色名已复制", "success");
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
  }
}

function updateUsageDraft(profileId: string, value: string): void {
  usageDrafts[profileId] = value;
  const profile = items.value.find((item) => item.id === profileId);
  if (value === (profile?.usageInfo ?? "")) {
    dirtyUsageIds.delete(profileId);
  } else {
    dirtyUsageIds.add(profileId);
  }
}

function cancelUsage(profile: AccountProfile): void {
  usageDrafts[profile.id] = profile.usageInfo ?? "";
  dirtyUsageIds.delete(profile.id);
}

function setUsageSaving(profileId: string, saving: boolean): void {
  const next = new Set(savingUsageIds.value);
  if (saving) next.add(profileId);
  else next.delete(profileId);
  savingUsageIds.value = next;
}

async function saveUsage(profile: AccountProfile, draft: string): Promise<void> {
  if (savingUsageIds.value.has(profile.id)) return;
  const usageInfo = draft.trim() || null;
  if (usageInfo === (profile.usageInfo ?? null)) {
    cancelUsage(profile);
    return;
  }

  setUsageSaving(profile.id, true);
  try {
    const updated = await api.updateAccountProfileUsage(profile.id, usageInfo);
    usageDrafts[profile.id] = updated.usageInfo ?? "";
    dirtyUsageIds.delete(profile.id);
    await load(query.value, needsReviewOnly.value ? true : undefined);
    ui.markAccountsChanged();
    ui.notify("本周已保存", "success");
  } catch (cause) {
    usageDrafts[profile.id] = profile.usageInfo ?? "";
    dirtyUsageIds.delete(profile.id);
    ui.notify(errorMessage(cause), "danger");
  } finally {
    setUsageSaving(profile.id, false);
  }
}

async function save(input: AccountProfileInput): Promise<void> {
  if (savingAccount.value) return;
  savingAccount.value = true;
  try {
    if (activeProfile.value) {
      await api.updateAccountProfile(activeProfile.value.id, input);
    } else {
      await api.createAccountProfile(input);
    }
    drawerOpen.value = false;
    activeProfile.value = null;
    await search();
    ui.markAccountsChanged();
    ui.notify("账号档案已保存", "success");
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
  } finally {
    savingAccount.value = false;
  }
}

async function copy(profile: AccountProfile): Promise<void> {
  try {
    await api.copyAccountPassword(profile.id);
    ui.notify("密码已复制，剪贴板将在30秒后清空", "success");
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
  }
}

async function remove(profile: AccountProfile): Promise<void> {
  if (!globalThis.confirm(`确定永久删除账号 ${profile.accountName} 及其密码吗？`)) return;
  try {
    await api.deleteAccountProfile(profile.id);
    selectedIds.value = selectedIds.value.filter((id) => id !== profile.id);
    await search();
    ui.markAccountsChanged();
    ui.notify("账号档案已删除", "success");
  } catch (cause) {
    await search();
    ui.markAccountsChanged();
    ui.notify(errorMessage(cause), "danger");
  }
}

async function removeBatch(): Promise<void> {
  if (selectedCount.value === 0 || deletingAccounts.value) return;
  if (!globalThis.confirm(`确定永久删除选中的 ${selectedCount.value} 个账号档案及其密码吗？`)) {
    return;
  }

  const ids = [...selectedIds.value];
  deletingAccounts.value = true;
  batchDeleteFeedback.value = {
    message: `正在永久删除 ${ids.length} 个账号档案，请稍候…`,
    tone: "neutral",
  };
  try {
    const deletedCount = await api.deleteAccountProfiles(ids);
    selectedIds.value = [];
    await load(query.value, needsReviewOnly.value ? true : undefined);
    ui.markAccountsChanged();
    if (deletedCount > 0) {
      const message = `已永久删除 ${deletedCount} 个账号档案`;
      batchDeleteFeedback.value = { message, tone: "success" };
      ui.notify(message, "success");
    } else {
      const message = "未找到可删除的账号档案";
      batchDeleteFeedback.value = { message, tone: "warning" };
      ui.notify(message, "warning");
    }
  } catch (cause) {
    const message = errorMessage(cause);
    await load(query.value, needsReviewOnly.value ? true : undefined);
    batchDeleteFeedback.value = { message, tone: "danger" };
    ui.notify(message, "danger");
  } finally {
    deletingAccounts.value = false;
  }
}

async function initializeWorkspace(): Promise<void> {
  await loadColumnWidths();
  await syncWeeklyUsage({ reload: false });
  await load();
}

onMounted(() => {
  void initializeWorkspace();
  weeklySyncTimer = globalThis.setInterval(() => void syncWeeklyUsage(), 60_000);
});

onUnmounted(() => {
  if (weeklySyncTimer !== undefined) globalThis.clearInterval(weeklySyncTimer);
});

watch(
  () => items.value,
  (currentItems) => {
    manualOrderIds.value = currentItems.map((item) => item.id);
    const validIds = new Set(currentItems.map((item) => item.id));
    const next = selectedIds.value.filter((id) => validIds.has(id));
    if (next.length !== selectedIds.value.length) {
      selectedIds.value = next;
    }
    if (
      accountFilters.contactName &&
      !currentItems.some((item) => item.contactName === accountFilters.contactName)
    ) {
      accountFilters.contactName = "";
    }
    if (
      accountFilters.server &&
      !currentItems.some((item) => item.server === accountFilters.server)
    ) {
      accountFilters.server = "";
    }
    if (
      accountFilters.specialization &&
      !currentItems.some((item) => item.specialization === accountFilters.specialization)
    ) {
      accountFilters.specialization = "";
    }
  },
);

watch(
  () => [accountFilters.contactName, accountFilters.server, accountFilters.specialization],
  () => {
    selectedIds.value = [];
    passwordResetKey.value += 1;
  },
);

watch(
  items,
  (profiles) => {
    const profileIds = new Set(profiles.map((profile) => profile.id));
    for (const profile of profiles) {
      if (!dirtyUsageIds.has(profile.id) && !savingUsageIds.value.has(profile.id)) {
        usageDrafts[profile.id] = profile.usageInfo ?? "";
      }
    }
    for (const profileId of Object.keys(usageDrafts)) {
      if (!profileIds.has(profileId)) {
        delete usageDrafts[profileId];
        dirtyUsageIds.delete(profileId);
      }
    }
  },
  { immediate: true },
);

watch(
  () => selectedIds.value,
  (ids) => {
    if (ids.length > 0 && !deletingAccounts.value) {
      batchDeleteFeedback.value = null;
    }
  },
);
</script>

<template>
  <div class="accounts-workspace page-stack">
    <AccountToolbar
      v-model:query="query"
      v-model:needs-review-only="needsReviewOnly"
      v-model:contact-name="accountFilters.contactName"
      v-model:server="accountFilters.server"
      v-model:specialization="accountFilters.specialization"
      :contact-options="contactOptions"
      :server-options="serverOptions"
      :specialization-options="specializationOptions"
      :visible-count="visibleProfiles.length"
      :selected-count="selectedCount"
      :refresh-busy="roleDataRefresh.busy.value"
      :deleting="deletingAccounts"
      :can-reset-view="activeFilterCount > 0 || sortKey !== null"
      @search="search"
      @reset-view="resetListView"
      @refresh-visible="refreshVisibleRoleData"
      @refresh-selected="refreshSelectedRoleData"
      @delete-selected="removeBatch"
      @create="openCreate"
    />
    <div class="account-summary">
      <span v-if="visibleProfiles.length === items.length">共 {{ items.length }} 个账号</span>
      <span v-else>显示 {{ visibleProfiles.length }} / 共 {{ items.length }} 个账号</span>
      <span v-if="selectedCount > 0">{{ selectedCount }} 个已选中</span>
      <span v-else>{{ items.filter((item) => item.needsReview).length }} 个暂不可用</span>
      <span
        v-if="batchDeleteFeedback"
        class="account-summary__feedback"
        :class="`is-${batchDeleteFeedback.tone}`"
        role="status"
        aria-live="polite"
      >
        {{ batchDeleteFeedback.message }}
      </span>
      <div class="account-summary__actions">
        <button
          class="button button--ghost button--compact account-summary__clear"
          type="button"
          :disabled="clearingWeekly || syncingWeekly || savingUsageIds.size > 0"
          :aria-busy="clearingWeekly"
          title="清空全部账号的本周内容"
          @pointerdown.prevent
          @click="clearWeeklyUsage"
        >
          <LoaderCircle v-if="clearingWeekly" class="account-actions__spinner" :size="13" />
          <Eraser v-else :size="13" />
          {{ clearingWeekly ? "正在清空…" : "清空本周" }}
        </button>
      </div>
    </div>
    <div v-if="loading" class="loading-line" />
    <div v-if="error" class="error-banner">{{ error }}</div>
    <AccountRoleDataRefreshDialog
      :result="roleDataRefresh.result.value"
      :error="roleDataRefresh.error.value"
      :return-focus="roleDataRefreshReturnFocus"
      @close="roleDataRefresh.clearResult"
    />
    <AccountTable
      :profiles="visibleProfiles"
      :sort-key="sortKey"
      :sort-direction="sortDirection"
      :reorder-enabled="manualReorderEnabled"
      :reorder-disabled-reason="reorderDisabledReason"
      :usage-drafts="usageDrafts"
      :saving-usage-ids="savingUsageIds"
      :column-widths="columnWidths"
      :saving-column-widths="savingColumnWidths"
      :clearing-weekly="clearingWeekly"
      :password-reset-key="passwordResetKey"
      :role-refresh-busy="roleDataRefresh.busy.value"
      :refreshing-ids="roleDataRefresh.targetIds.value"
      v-model:selected-ids="selectedIds"
      @edit="openEdit"
      @copy="copy"
      @copy-account="copyAccount"
      @copy-character-name="copyCharacterName"
      @refresh-role-data="refreshSingleRoleData"
      @update-usage-draft="updateUsageDraft"
      @save-usage="saveUsage"
      @cancel-usage="cancelUsage"
      @preview-column-width="previewColumnWidth"
      @commit-column-width="commitColumnWidth"
      @cancel-column-resize="cancelColumnResize"
      @delete="remove"
      @sort="changeSort"
      @reorder="reorderProfiles"
    />
    <AccountDrawer
      :open="drawerOpen"
      :profile="activeProfile"
      :saving="savingAccount"
      @close="drawerOpen = false"
      @save="save"
    />
  </div>
</template>

<style scoped>
.accounts-workspace {
  height: 100%;
  gap: 12px;
}

.account-actions__spinner {
  animation: account-action-spin 900ms linear infinite;
}

.account-summary {
  display: flex;
  min-height: 20px;
  padding: 0 4px;
  align-items: center;
  gap: 14px;
  color: var(--ink-muted);
  font-size: 11px;
}

.account-summary__feedback {
  color: var(--brand-strong);
  font-weight: 650;
}

.account-summary__actions {
  display: flex;
  margin-left: auto;
  align-items: center;
  gap: 6px;
}

.account-summary__actions .button {
  min-height: 28px;
  padding-inline: 9px;
  font-size: 10px;
}

.account-summary__clear:hover:not(:disabled) {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 8%, var(--surface));
}

.account-summary__feedback.is-success {
  color: var(--brand);
}

.account-summary__feedback.is-warning {
  color: #9a6214;
}

.account-summary__feedback.is-danger {
  color: var(--danger);
}

@keyframes account-action-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
