<script setup lang="ts">
import { DatabaseZap, LockKeyhole } from "@lucide/vue";
import { shallowRef } from "vue";
import { api, errorMessage } from "../../api/client";
import { useLockApplication } from "../../composables/useLockApplication";
import { router } from "../../router";
import { useAppAccessStore } from "../../stores/appAccess";
import { useUiStore } from "../../stores/ui";
import AppAccessPasswordChangeForm from "./AppAccessPasswordChangeForm.vue";
import AppAccessRecoverySettingsForm from "./AppAccessRecoverySettingsForm.vue";

const access = useAppAccessStore();
const ui = useUiStore();
const { lockApplication } = useLockApplication();
const legacyPassword = shallowRef("");
const passwordError = shallowRef<string | null>(null);
const recoveryError = shallowRef<string | null>(null);
const migrationError = shallowRef<string | null>(null);

async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  passwordError.value = null;
  const result = await access.changePassword(currentPassword, newPassword);
  if (result) {
    ui.notify("入口密码已修改", "success");
  } else {
    passwordError.value = access.error;
  }
}

async function migrateLegacyCredentials(): Promise<void> {
  if (!legacyPassword.value || access.loading) return;
  migrationError.value = null;
  const result = await access.migrateLegacyCredentials(legacyPassword.value);
  legacyPassword.value = "";
  if (!result) {
    migrationError.value = access.error;
    return;
  }
  ui.notify(
    `已迁移 ${result.migratedCount} 条旧密码，缺失 ${result.missingCount} 条，仍待处理 ${result.pendingCount} 条`,
    result.pendingCount > 0 ? "warning" : "success",
  );
}

async function openRepairIssue(entityKind: "account_profile" | "appointment", entityId: string) {
  try {
    if (entityKind === "appointment") {
      ui.openEditAppointment(await api.getAppointment(entityId));
      return;
    }
    ui.requestAccountProfile(entityId);
    await router.push({ name: "accounts" });
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
  }
}

async function setRecovery(
  currentPassword: string,
  question: string,
  answer: string,
): Promise<void> {
  recoveryError.value = null;
  const result = await access.setRecovery(currentPassword, { question, answer });
  if (result) {
    ui.notify("恢复问题已保存", "success");
  } else {
    recoveryError.value = access.error;
  }
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
      <span v-if="migrationError" class="field-error" role="alert">{{ migrationError }}</span>
    </div>

    <section
      v-if="access.dataRepairIssueCount > 0"
      id="data-repair-issues"
      class="access-settings__repairs"
    >
      <div>
        <strong>旧数据修复（{{ access.dataRepairIssueCount }} 项）</strong>
        <span>原始数值已保留在修复记录中；修正对应档案后会自动标记为已解决。</span>
      </div>
      <button
        v-for="issue in access.dataRepairIssues"
        :key="issue.id"
        class="access-settings__repair"
        type="button"
        @click="openRepairIssue(issue.entityKind, issue.entityId)"
      >
        <strong>{{ issue.displayName }}</strong>
        <span>{{ issue.fieldName }}：{{ issue.originalValue }}</span>
        <small>{{ issue.entityKind === "appointment" ? "打开预约" : "打开账号档案" }}</small>
      </button>
    </section>

    <AppAccessPasswordChangeForm
      :loading="access.loading"
      :error="passwordError"
      @submit="changePassword"
    />

    <AppAccessRecoverySettingsForm
      :current-question="access.recoveryQuestion"
      :loading="access.loading"
      :error="recoveryError"
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

.access-settings__repairs {
  display: grid;
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid var(--amber-border);
  border-radius: var(--radius, 12px);
  background: var(--amber-soft);
}

.access-settings__repairs > div {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.access-settings__repair {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 3px 12px;
  padding: 9px 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm, 8px);
  color: var(--ink);
  background: var(--surface);
  text-align: left;
  cursor: pointer;
}

.access-settings__repair span {
  grid-column: 1;
}

.access-settings__repair small {
  grid-row: 1 / 3;
  grid-column: 2;
  align-self: center;
  color: var(--brand-strong);
}
</style>
