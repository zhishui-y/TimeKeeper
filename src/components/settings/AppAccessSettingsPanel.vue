<script setup lang="ts">
import { DatabaseZap, LockKeyhole } from "@lucide/vue";
import { shallowRef } from "vue";
import { useAppAccessStore } from "../../stores/appAccess";
import { useUiStore } from "../../stores/ui";
import AppAccessPasswordChangeForm from "./AppAccessPasswordChangeForm.vue";
import AppAccessRecoverySettingsForm from "./AppAccessRecoverySettingsForm.vue";

const access = useAppAccessStore();
const ui = useUiStore();
const legacyPassword = shallowRef("");

async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const result = await access.changePassword(currentPassword, newPassword);
  if (result) ui.notify("入口密码已修改", "success");
}

async function migrateLegacyCredentials(): Promise<void> {
  if (!legacyPassword.value || access.loading) return;
  const result = await access.migrateLegacyCredentials(legacyPassword.value);
  legacyPassword.value = "";
  if (!result) return;
  ui.notify(
    `已迁移 ${result.migratedCount} 条旧密码，缺失 ${result.missingCount} 条，仍待处理 ${result.pendingCount} 条`,
    result.pendingCount > 0 ? "warning" : "success",
  );
}

async function lockApplication(): Promise<void> {
  await access.lock();
}

async function setRecovery(
  currentPassword: string,
  question: string,
  answer: string,
): Promise<void> {
  const result = await access.setRecovery(currentPassword, { question, answer });
  if (result) ui.notify("恢复问题已保存", "success");
}
</script>

<template>
  <div class="access-settings">
    <div class="access-settings__summary">
      <div>
        <strong>本次运行已解锁</strong>
        <span>关闭进程后，下次启动会再次要求入口密码；托盘隐藏不会自动锁定。</span>
      </div>
      <button class="button button--ghost button--compact" type="button" @click="lockApplication">
        <LockKeyhole :size="14" />
        立即锁定
      </button>
    </div>

    <div v-if="access.legacyMigrationPendingCount > 0" class="access-settings__migration">
      <DatabaseZap :size="18" />
      <div>
        <strong>仍有 {{ access.legacyMigrationPendingCount }} 条旧密码待迁移</strong>
        <span>输入原主密码继续迁移；已有的新密码不会被覆盖。</span>
      </div>
      <input
        v-model="legacyPassword"
        class="input"
        type="password"
        autocomplete="current-password"
        placeholder="原主密码"
        :disabled="access.loading"
      />
      <button
        class="button button--ghost button--compact"
        type="button"
        :disabled="access.loading || !legacyPassword"
        @click="migrateLegacyCredentials"
      >
        继续迁移
      </button>
    </div>

    <AppAccessPasswordChangeForm
      :loading="access.loading"
      :error="access.error"
      @submit="changePassword"
    />

    <AppAccessRecoverySettingsForm
      :current-question="access.recoveryQuestion"
      :loading="access.loading"
      :error="access.error"
      @submit="setRecovery"
    />
  </div>
</template>

<style scoped>
.access-settings {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.access-settings__summary,
.access-settings__migration {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius, 12px);
  background: var(--surface-soft);
}

.access-settings__summary > div,
.access-settings__migration > div {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 3px;
}

.access-settings strong {
  color: var(--ink-strong);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.access-settings span {
  color: var(--ink-muted);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  line-height: 1.45;
}

.access-settings__migration > svg {
  color: var(--amber);
}

.access-settings__migration .input {
  width: 170px;
}
</style>
