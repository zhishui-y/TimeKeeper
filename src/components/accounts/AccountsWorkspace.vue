<script setup lang="ts">
import { LockKeyhole, Plus, Search, ShieldCheck, Trash2, UnlockKeyhole } from "@lucide/vue";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { api, errorMessage } from "../../api/client";
import { useAccounts } from "../../composables/useAccounts";
import { useVault } from "../../composables/useVault";
import { useUiStore } from "../../stores/ui";
import type { AccountProfile, AccountProfileInput } from "../../types/domain";
import AccountDrawer from "./AccountDrawer.vue";
import AccountTable from "./AccountTable.vue";

const ui = useUiStore();
const { items, loading, error, load } = useAccounts();
const { status: vaultStatus, load: loadVault, unlock, initialize, lock } = useVault();
const query = shallowRef("");
const needsReviewOnly = shallowRef(false);
const drawerOpen = shallowRef(false);
const activeProfile = shallowRef<AccountProfile | null>(null);
const savingAccount = shallowRef(false);
const selectedIds = ref<string[]>([]);
const selectedCount = computed(() => selectedIds.value.length);
const masterPassword = shallowRef("");
const revealedPasswords = shallowRef<Record<string, string>>({});
const revealTimers = new Map<string, ReturnType<typeof globalThis.setTimeout>>();

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

async function reveal(profile: AccountProfile): Promise<void> {
  try {
    const password = await api.revealAccountPassword(profile.id);
    revealedPasswords.value = { ...revealedPasswords.value, [profile.id]: password };
    globalThis.clearTimeout(revealTimers.get(profile.id));
    revealTimers.set(
      profile.id,
      globalThis.setTimeout(() => hide(profile), 15_000),
    );
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
  }
}

function hide(profile: AccountProfile): void {
  const next = { ...revealedPasswords.value };
  delete next[profile.id];
  revealedPasswords.value = next;
  globalThis.clearTimeout(revealTimers.get(profile.id));
  revealTimers.delete(profile.id);
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
    hide(profile);
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
  if (selectedCount.value === 0 || !vaultStatus.value.unlocked) return;
  if (!globalThis.confirm(`确定永久删除选中的 ${selectedCount.value} 个账号档案及其密码吗？`)) {
    return;
  }

  const ids = [...selectedIds.value];
  try {
    const deletedCount = await api.deleteAccountProfiles(ids);
    for (const id of ids) {
      const profile = items.value.find((item) => item.id === id);
      if (profile) hide(profile);
    }
    selectedIds.value = [];
    await search();
    ui.markAccountsChanged();
    if (deletedCount > 0) {
      ui.notify(`已永久删除 ${deletedCount} 个账号档案`, "success");
    } else {
      ui.notify("未找到可删除的账号档案", "warning");
    }
  } catch (cause) {
    await search();
    ui.markAccountsChanged();
    ui.notify(errorMessage(cause), "danger");
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
  revealedPasswords.value = {};
  ui.notify("密码库已锁定", "success");
}

onMounted(() => void loadVault());

watch(
  () => items.value,
  (currentItems) => {
    const validIds = new Set(currentItems.map((item) => item.id));
    const next = selectedIds.value.filter((id) => validIds.has(id));
    if (next.length !== selectedIds.value.length) {
      selectedIds.value = next;
    }
  },
);

onBeforeUnmount(() => {
  revealTimers.forEach((timer) => globalThis.clearTimeout(timer));
  revealTimers.clear();
});
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
          只看待完善
        </label>
        <button class="button button--compact" type="submit">查询</button>
      </form>
      <div class="account-actions">
        <button
          class="button button--ghost"
          type="button"
          :disabled="selectedCount === 0 || !vaultStatus.unlocked"
          :title="
            !vaultStatus.unlocked
              ? '删除账号前需要解锁密码库'
              : selectedCount === 0
                ? '请先选择账号'
                : '永久删除选中的账号'
          "
          @click="removeBatch"
        >
          <Trash2 :size="15" />批量删除
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
    <div class="account-summary">
      <span>共 {{ items.length }} 个账号</span>
      <span v-if="selectedCount > 0">{{ selectedCount }} 个已选中</span>
      <span v-else>{{ items.filter((item) => item.needsReview).length }} 个待完善</span>
    </div>
    <div v-if="loading" class="loading-line" />
    <div v-if="error" class="error-banner">{{ error }}</div>
    <AccountTable
      :profiles="items"
      :revealed-passwords="revealedPasswords"
      :vault-unlocked="vaultStatus.unlocked"
      v-model:selected-ids="selectedIds"
      @edit="openEdit"
      @reveal="reveal"
      @hide="hide"
      @copy="copy"
      @delete="remove"
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
}
</style>
