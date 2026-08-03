<script setup lang="ts">
import { ClipboardCopy, FileKey2, UserRoundX } from "@lucide/vue";
import { computed } from "vue";
import type { AccountProfile, AppointmentAccountDetails } from "../../types/domain";
import type { AppointmentAccountDraft } from "../../composables/useAppointmentDraft";

const props = withDefaults(
  defineProps<{
    accounts: readonly AccountProfile[];
    accountsLoading?: boolean;
    appointmentId?: string | null;
  }>(),
  { accountsLoading: false, appointmentId: null },
);

const model = defineModel<AppointmentAccountDraft>({ required: true });
const emit = defineEmits<{
  copyPassword: [appointmentId: string];
}>();

const selectedProfile = computed(() =>
  props.accounts.find((account) => account.id === model.value.profileId),
);
const canCopyExistingPassword = computed(() => Boolean(model.value.passwordAvailable));

function profileOptionLabel(account: AccountProfile): string {
  return [
    account.characterName?.trim() || "角色名待补",
    account.server?.trim() || "服务器待补",
    `当前分 ${account.currentScore ?? "—"}`,
    `最高分 ${account.highestScore ?? "—"}`,
  ].join(" · ");
}

function emptyDetails(): AppointmentAccountDetails {
  return { accountName: "", specialization: null, gearScore: null, server: null };
}

function selectKind(kind: AppointmentAccountDraft["kind"]): void {
  if (kind === model.value.kind) return;
  model.value = {
    kind,
    profileId: "",
    details: emptyDetails(),
    credentialKind: "replace",
    password: "",
    sourceAppointmentId: "",
    passwordAvailable: false,
  };
}

function updateProfileId(profileId: string): void {
  model.value = { ...model.value, profileId, password: "" };
}

function updateDetail(key: keyof AppointmentAccountDetails, value: string): void {
  model.value = {
    ...model.value,
    details: { ...model.value.details, [key]: value },
  };
}

function replacePassword(password: string): void {
  model.value = {
    ...model.value,
    credentialKind: "replace",
    password,
    sourceAppointmentId: "",
  };
}

function chooseNewPassword(): void {
  replacePassword("");
}
</script>

<template>
  <div class="account-fields">
    <div class="account-kind" role="radiogroup" aria-label="预约账号来源">
      <button
        class="account-kind__item"
        :class="{ 'is-active': model.kind === 'none' }"
        type="button"
        @click="selectKind('none')"
      >
        <UserRoundX :size="15" />不使用账号
      </button>
      <button
        class="account-kind__item"
        :class="{ 'is-active': model.kind === 'profile' }"
        type="button"
        @click="selectKind('profile')"
      >
        从档案选择
      </button>
      <button
        class="account-kind__item"
        :class="{ 'is-active': model.kind === 'embedded' }"
        type="button"
        @click="selectKind('embedded')"
      >
        <FileKey2 :size="15" />一次性账号
      </button>
    </div>

    <div v-if="model.kind === 'profile'" class="profile-picker">
      <label class="field">
        <span class="field__label">账号档案 *</span>
        <select
          class="select"
          :value="model.profileId"
          :disabled="accountsLoading"
          @change="updateProfileId(($event.target as HTMLSelectElement).value)"
        >
          <option value="">{{ accountsLoading ? "账号加载中…" : "请选择账号档案" }}</option>
          <option v-for="account in accounts" :key="account.id" :value="account.id">
            {{ profileOptionLabel(account) }}
          </option>
        </select>
      </label>
      <p v-if="selectedProfile" class="profile-picker__preview">
        保存时将复制 {{ selectedProfile.accountName }} 的当前资料与密码；之后档案变化不会改写预约。
      </p>
    </div>

    <div v-if="model.kind === 'embedded'" class="embedded-account">
      <div class="embedded-account__grid">
        <label class="field">
          <span class="field__label">职业</span>
          <input
            class="input"
            :value="model.details.specialization ?? ''"
            placeholder="职业/心法"
            @input="updateDetail('specialization', ($event.target as HTMLInputElement).value)"
          />
        </label>
        <label class="field">
          <span class="field__label">装分</span>
          <input
            class="input"
            :value="model.details.gearScore ?? ''"
            placeholder="例如：19.8万"
            @input="updateDetail('gearScore', ($event.target as HTMLInputElement).value)"
          />
        </label>
        <label class="field">
          <span class="field__label">区服</span>
          <input
            class="input"
            :value="model.details.server ?? ''"
            placeholder="所在区服"
            @input="updateDetail('server', ($event.target as HTMLInputElement).value)"
          />
        </label>
        <label class="field">
          <span class="field__label">账号 *</span>
          <input
            class="input"
            :value="model.details.accountName"
            autocomplete="off"
            placeholder="登录账号"
            @input="updateDetail('accountName', ($event.target as HTMLInputElement).value)"
          />
        </label>
      </div>

      <div v-if="model.credentialKind === 'keep'" class="credential-note">
        <span>
          {{
            model.passwordAvailable
              ? "保留这条预约已有的密码"
              : "这条预约当前没有密码，保存时保持不变"
          }}
        </span>
        <button
          class="button button--compact button--ghost"
          type="button"
          @click="chooseNewPassword"
        >
          {{ model.passwordAvailable ? "更换密码" : "补充密码" }}
        </button>
      </div>
      <div v-else-if="model.credentialKind === 'copyFromAppointment'" class="credential-note">
        <span>保存时沿用该联系人上次预约的密码</span>
        <button
          class="button button--compact button--ghost"
          type="button"
          @click="chooseNewPassword"
        >
          改填密码
        </button>
      </div>
      <label v-else class="field">
        <span class="field__label">密码 *</span>
        <input
          class="input"
          type="password"
          :value="model.password"
          autocomplete="new-password"
          placeholder="仅写入本条预约的加密保险库"
          @input="replacePassword(($event.target as HTMLInputElement).value)"
        />
      </label>

      <button
        v-if="appointmentId"
        class="copy-password-button"
        type="button"
        :disabled="!canCopyExistingPassword"
        @click="emit('copyPassword', appointmentId!)"
      >
        <ClipboardCopy :size="14" />复制本预约密码
      </button>
    </div>
  </div>
</template>

<style scoped>
.account-fields {
  display: grid;
  gap: 12px;
}

.account-kind {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 7px;
}

.account-kind__item {
  display: inline-flex;
  min-height: 36px;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 7px 9px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm, 8px);
  color: var(--ink-muted);
  background: var(--surface);
  font-size: 11px;
  font-weight: 650;
  cursor: pointer;
}

.account-kind__item.is-active {
  border-color: var(--brand-border);
  color: var(--brand-strong);
  background: var(--brand-soft);
  box-shadow: inset 0 -2px 0 var(--brand);
}

.profile-picker,
.embedded-account {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid color-mix(in srgb, var(--brand) 16%, var(--line));
  border-radius: var(--radius, 12px);
  background: color-mix(in srgb, var(--brand-soft) 28%, var(--surface));
}

.profile-picker__preview,
.credential-note {
  margin: 0;
  color: var(--ink-muted);
  font-size: 10px;
  line-height: 1.5;
}

.embedded-account__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.credential-note {
  display: flex;
  min-height: 34px;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 9px;
  border: 1px solid var(--gold-border);
  border-radius: var(--radius-sm, 8px);
  color: var(--gold-strong);
  background: var(--gold-soft);
}

.copy-password-button {
  display: inline-flex;
  width: fit-content;
  align-items: center;
  gap: 5px;
  padding: 0;
  border: 0;
  color: var(--brand-strong);
  background: transparent;
  font-size: 11px;
  font-weight: 650;
  cursor: pointer;
}

.copy-password-button:disabled {
  cursor: default;
  opacity: 0.45;
}

@media (max-width: 520px) {
  .account-kind,
  .embedded-account__grid {
    grid-template-columns: 1fr;
  }
}
</style>
