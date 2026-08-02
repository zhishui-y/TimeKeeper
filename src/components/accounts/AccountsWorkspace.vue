<script setup lang="ts">
import {
  Eraser,
  LoaderCircle,
  ListFilter,
  LockKeyhole,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  UnlockKeyhole,
} from "@lucide/vue";
import { computed, onMounted, onUnmounted, reactive, ref, shallowRef, watch } from "vue";
import { api, errorMessage } from "../../api/client";
import { useAccounts } from "../../composables/useAccounts";
import { useVault } from "../../composables/useVault";
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
import AccountTable from "./AccountTable.vue";

const ui = useUiStore();
const { items, loading, error, load } = useAccounts({ immediate: false });
const { status: vaultStatus, load: loadVault, unlock, initialize, lock } = useVault();
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
const selectedCount = computed(() => selectedIds.value.length);
const deletingAccounts = shallowRef(false);
const batchDeleteFeedback = shallowRef<{
  message: string;
  tone: "neutral" | "success" | "warning" | "danger";
} | null>(null);
const masterPassword = shallowRef("");
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
const sortLabels: Record<AccountProfileSortKey, string> = {
  contactName: "联系人",
  server: "服务器",
  specialization: "职业 / 心法",
  gearScore: "装分",
  currentScore: "当前分",
  highestScore: "最高分",
};

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
  if (selectedCount.value === 0 || !vaultStatus.value.unlocked || deletingAccounts.value) return;
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

async function submitVault(): Promise<void> {
  const result = vaultStatus.value.initialized
    ? await unlock(masterPassword.value)
    : await initialize(masterPassword.value);
  if (result) {
    masterPassword.value = "";
    ui.notify("密码库已解锁", "success");
  }
}

async function lockVault(): Promise<void> {
  const result = await lock();
  if (!result) return;
  ui.notify("密码库已锁定", "success");
}

async function initializeWorkspace(): Promise<void> {
  await Promise.all([loadVault(), loadColumnWidths()]);
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
    <section class="vault-strip" :class="{ 'is-locked': !vaultStatus.unlocked }">
      <div class="vault-strip__state">
        <ShieldCheck v-if="vaultStatus.unlocked" :size="18" />
        <LockKeyhole v-else :size="18" />
        <div>
          <strong>{{
            vaultStatus.unlocked
              ? "密码库已解锁"
              : vaultStatus.initialized
                ? "密码库已锁定"
                : "请初始化密码库"
          }}</strong>
          <span>{{
            vaultStatus.unlocked
              ? vaultStatus.autoLockMinutes === 0
                ? "已关闭自动锁定"
                : `${vaultStatus.autoLockMinutes}分钟无操作后自动锁定`
              : "账号密码需要解锁后查看或修改"
          }}</span>
        </div>
      </div>
      <button
        v-if="vaultStatus.unlocked"
        class="button button--compact"
        type="button"
        @click="lockVault"
      >
        <LockKeyhole :size="14" />锁定
      </button>
      <form v-else class="vault-strip__unlock" @submit.prevent="submitVault">
        <input
          v-model="masterPassword"
          class="input"
          type="password"
          :autocomplete="vaultStatus.initialized ? 'current-password' : 'new-password'"
          :placeholder="vaultStatus.initialized ? '输入主密码' : '设置主密码'"
        />
        <button class="button button--primary button--compact" type="submit">
          <UnlockKeyhole :size="14" />{{ vaultStatus.initialized ? "解锁" : "初始化" }}
        </button>
      </form>
    </section>

    <div class="page-toolbar">
      <form class="account-filters" @submit.prevent="search">
        <label class="search-field">
          <Search class="search-field__icon" :size="15" />
          <input v-model="query" class="input" placeholder="搜索联系人、区服、角色或账号" />
        </label>
        <label class="review-filter">
          <input v-model="needsReviewOnly" type="checkbox" @change="search" />
          只看暂不可用
        </label>
        <button class="button button--compact" type="submit">查询</button>
      </form>
      <div class="account-actions">
        <button
          class="button button--ghost"
          type="button"
          :disabled="selectedCount === 0 || !vaultStatus.unlocked || deletingAccounts"
          :aria-busy="deletingAccounts"
          :title="
            !vaultStatus.unlocked
              ? '删除账号前需要解锁密码库'
              : deletingAccounts
                ? '正在删除选中的账号'
                : selectedCount === 0
                  ? '请先选择账号'
                  : '永久删除选中的账号'
          "
          @click="removeBatch"
        >
          <LoaderCircle v-if="deletingAccounts" class="account-actions__spinner" :size="15" />
          <Trash2 v-else :size="15" />
          {{ deletingAccounts ? "正在删除…" : "批量删除" }}
        </button>
        <button
          class="button button--primary"
          type="button"
          :disabled="!vaultStatus.unlocked"
          @click="openCreate"
        >
          <Plus :size="15" />新建账号
        </button>
      </div>
    </div>
    <div class="account-filter-strip" aria-label="账号筛选">
      <span class="account-filter-strip__title">
        <ListFilter :size="14" />
        筛选
      </span>
      <label class="account-filter-control">
        <span>联系人</span>
        <select v-model="accountFilters.contactName" class="select" aria-label="按联系人筛选账号">
          <option value="">全部</option>
          <option v-for="contact in contactOptions" :key="contact" :value="contact">
            {{ contact }}
          </option>
        </select>
      </label>
      <label class="account-filter-control">
        <span>服务器</span>
        <select v-model="accountFilters.server" class="select" aria-label="按服务器筛选账号">
          <option value="">全部</option>
          <option v-for="server in serverOptions" :key="server" :value="server">
            {{ server }}
          </option>
        </select>
      </label>
      <label class="account-filter-control">
        <span>职业 / 心法</span>
        <select
          v-model="accountFilters.specialization"
          class="select"
          aria-label="按职业或心法筛选账号"
        >
          <option value="">全部</option>
          <option
            v-for="specialization in specializationOptions"
            :key="specialization"
            :value="specialization"
          >
            {{ specialization }}
          </option>
        </select>
      </label>
      <span class="account-filter-strip__sort">
        {{
          sortKey
            ? `已按${sortLabels[sortKey]}${sortDirection === "asc" ? "升序" : "降序"}`
            : manualReorderEnabled
              ? "拖动左侧手柄调整默认顺序"
              : reorderDisabledReason
        }}
      </span>
      <button
        v-if="activeFilterCount > 0 || sortKey"
        class="button button--ghost button--compact"
        type="button"
        @click="resetListView"
      >
        重置
      </button>
    </div>
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
    <AccountTable
      :profiles="visibleProfiles"
      :vault-unlocked="vaultStatus.unlocked"
      :sort-key="sortKey"
      :sort-direction="sortDirection"
      :reorder-enabled="manualReorderEnabled"
      :reorder-disabled-reason="reorderDisabledReason"
      :usage-drafts="usageDrafts"
      :saving-usage-ids="savingUsageIds"
      :column-widths="columnWidths"
      :saving-column-widths="savingColumnWidths"
      :clearing-weekly="clearingWeekly"
      v-model:selected-ids="selectedIds"
      @edit="openEdit"
      @copy="copy"
      @copy-account="copyAccount"
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

.vault-strip {
  position: relative;
  display: flex;
  min-height: 62px;
  flex: 0 0 62px;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--brand) 24%, var(--line));
  border-radius: var(--radius-lg, 14px);
  color: var(--brand-strong);
  background:
    linear-gradient(110deg, color-mix(in srgb, var(--brand-soft) 84%, white), transparent 72%),
    var(--surface);
  box-shadow: var(--shadow-sm, 0 8px 24px rgba(31, 49, 42, 0.06));
}

.vault-strip::after {
  position: absolute;
  top: -42px;
  right: 18%;
  width: 132px;
  height: 132px;
  border: 1px solid color-mix(in srgb, currentColor 12%, transparent);
  border-radius: 50%;
  content: "";
  pointer-events: none;
}

.vault-strip.is-locked {
  border-color: color-mix(in srgb, var(--amber) 30%, var(--line));
  color: #815414;
  background:
    linear-gradient(110deg, color-mix(in srgb, var(--amber-soft) 86%, white), transparent 72%),
    var(--surface);
}

.vault-strip__state {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 11px;
}

.vault-strip__state > svg {
  box-sizing: content-box;
  padding: 8px;
  border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, white 72%, transparent);
}

.vault-strip__state div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.vault-strip__state strong {
  font-size: 12px;
  letter-spacing: 0.01em;
}

.vault-strip__state span {
  font-size: 10px;
  opacity: 0.72;
}

.vault-strip__unlock {
  display: flex;
  align-items: center;
  gap: 7px;
}

.vault-strip__unlock .input {
  width: 180px;
  height: 30px;
}

.account-filters {
  display: flex;
  align-items: center;
  gap: 9px;
}

.account-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.account-actions__spinner {
  animation: account-action-spin 900ms linear infinite;
}

.account-filter-strip {
  display: flex;
  min-height: 42px;
  align-items: center;
  gap: 10px;
  padding: 5px 10px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: color-mix(in srgb, var(--surface) 94%, var(--surface-soft));
}

.account-filter-strip__title {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 5px;
  color: var(--brand-strong);
  font-size: 11px;
  font-weight: 700;
}

.account-filter-control {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 5px;
  color: var(--ink-muted);
  font-size: 10px;
  white-space: nowrap;
}

.account-filter-control .select {
  width: 118px;
  height: 30px;
  padding-inline: 8px 24px;
  font-size: 11px;
}

.account-filter-strip__sort {
  margin-left: auto;
  color: var(--ink-muted);
  font-size: 10px;
  white-space: nowrap;
}

.accounts-workspace > .page-toolbar {
  min-height: 54px;
  padding: 7px 9px 7px 11px;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg, 14px);
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  box-shadow: var(--shadow-xs, 0 3px 14px rgba(31, 49, 42, 0.04));
}

.review-filter {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--ink-muted);
  font-size: 12px;
}

.review-filter input {
  accent-color: var(--amber);
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

@media (max-width: 1180px) {
  .vault-strip {
    padding-inline: 13px;
  }

  .vault-strip__state span {
    display: none;
  }

  .account-filters .search-field {
    width: 210px;
  }

  .account-filter-strip {
    gap: 7px;
  }

  .account-filter-control {
    gap: 3px;
  }

  .account-filter-control .select {
    width: 104px;
  }

  .account-filter-strip__sort {
    display: none;
  }
}
</style>
