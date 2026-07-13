<script setup lang="ts">
import { LockKeyhole, Plus, Search, ShieldCheck, UnlockKeyhole } from "@lucide/vue";
import { onMounted, shallowRef } from "vue";
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
  await load(query.value, needsReviewOnly.value ? true : undefined);
}

async function save(input: AccountProfileInput): Promise<void> {
  try {
    if (activeProfile.value) {
      await api.updateAccountProfile(activeProfile.value.id, input);
    } else {
      await api.createAccountProfile(input);
    }
    drawerOpen.value = false;
    activeProfile.value = null;
    await search();
    ui.notify("账号档案已保存", "success");
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
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
  if (!globalThis.confirm(`确定删除账号 ${profile.accountName} 吗？`)) return;
  try {
    await api.deleteAccountProfile(profile.id);
    await search();
    ui.notify("账号档案已删除", "success");
  } catch (cause) {
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
  await lock();
  revealedPasswords.value = {};
  ui.notify("密码库已锁定", "success");
}

onMounted(() => void loadVault());
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
              ? `${vaultStatus.autoLockMinutes}分钟无操作后自动锁定`
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
      <button
        class="button button--primary"
        type="button"
        :disabled="!vaultStatus.unlocked"
        @click="openCreate"
      >
        <Plus :size="15" />新建账号
      </button>
    </div>
    <div class="account-summary">
      <span>共 {{ items.length }} 个账号</span>
      <span>{{ items.filter((item) => item.needsReview).length }} 个待完善</span>
    </div>
    <div v-if="loading" class="loading-line" />
    <div v-if="error" class="error-banner">{{ error }}</div>
    <AccountTable
      :profiles="items"
      :revealed-passwords="revealedPasswords"
      :vault-unlocked="vaultStatus.unlocked"
      @edit="openEdit"
      @reveal="reveal"
      @hide="hide"
      @copy="copy"
      @delete="remove"
    />
    <AccountDrawer
      :open="drawerOpen"
      :profile="activeProfile"
      @close="drawerOpen = false"
      @save="save"
    />
  </div>
</template>

<style scoped>
.accounts-workspace {
  height: 100%;
  gap: 10px;
}

.vault-strip {
  display: flex;
  min-height: 54px;
  flex: 0 0 54px;
  align-items: center;
  justify-content: space-between;
  padding: 0 13px;
  border: 1px solid #bfd5c8;
  border-radius: var(--radius);
  color: var(--brand-strong);
  background: var(--brand-soft);
}

.vault-strip.is-locked {
  border-color: #e1caa0;
  color: #815414;
  background: var(--amber-soft);
}

.vault-strip__state {
  display: flex;
  align-items: center;
  gap: 9px;
}

.vault-strip__state div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.vault-strip__state strong {
  font-size: 11px;
}

.vault-strip__state span {
  font-size: 9px;
  opacity: 0.76;
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

.review-filter {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--ink-muted);
  font-size: 11px;
}

.review-filter input {
  accent-color: var(--amber);
}

.account-summary {
  display: flex;
  min-height: 22px;
  align-items: center;
  gap: 14px;
  color: var(--ink-muted);
  font-size: 10px;
}
</style>
