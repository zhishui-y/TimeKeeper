<script setup lang="ts">
import { ChevronDown, ClipboardCopy, FileKey2, UserRoundX } from "@lucide/vue";
import { computed, shallowRef } from "vue";
import { useRecentEmbeddedAccountPresets } from "../../composables/useRecentEmbeddedAccountPresets";
import type {
  AccountProfile,
  AppointmentAccountDetails,
  EmbeddedAccountPreset,
} from "../../types/domain";
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
const canCopyExistingPassword = computed(() => model.value.hasPassword);
const embeddedPresetsEnabled = computed(() => model.value.kind === "embedded");
const embeddedPresetsExpanded = shallowRef(false);
const {
  items: embeddedPresets,
  loading: embeddedPresetsLoading,
  error: embeddedPresetsError,
} = useRecentEmbeddedAccountPresets(embeddedPresetsEnabled);

function profileOptionLabel(account: AccountProfile): string {
  return [
    account.server?.trim() || "服务器待补",
    account.characterName?.trim() || "角色名待补",
    account.currentScore ?? "—",
    account.highestScore ?? "—",
  ].join(" · ");
}

function emptyDetails(): AppointmentAccountDetails {
  return { accountName: "", specialization: null, gearScore: null, server: null };
}

function selectKind(kind: AppointmentAccountDraft["kind"]): void {
  if (kind === model.value.kind) {
    if (kind === "embedded" && model.value.preservesSnapshot) {
      model.value = {
        ...model.value,
        source: "embedded",
        characterName: null,
        preservesSnapshot: false,
      };
    }
    return;
  }
  model.value = {
    kind,
    profileId: "",
    details: emptyDetails(),
    credentialKind: "replace",
    password: "",
    sourceAppointmentId: "",
    hasPassword: false,
    source: "embedded",
    characterName: null,
    preservesSnapshot: false,
  };
}

function activateKind(kind: AppointmentAccountDraft["kind"]): void {
  if (kind === "embedded" && model.value.kind === "embedded" && model.value.preservesSnapshot) {
    model.value = {
      ...model.value,
      source: "embedded",
      characterName: null,
      preservesSnapshot: false,
    };
    return;
  }
  selectKind(kind);
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

function embeddedPresetLabel(preset: EmbeddedAccountPreset): string {
  return [
    preset.specialization?.trim() || "职业未填",
    preset.server?.trim() || "区服未填",
    preset.gearScore?.trim() || "装分未填",
    preset.accountName,
  ].join("-");
}

function selectEmbeddedPreset(preset: EmbeddedAccountPreset): void {
  model.value = {
    kind: "embedded",
    profileId: "",
    details: {
      accountName: preset.accountName,
      specialization: preset.specialization ?? null,
      gearScore: preset.gearScore ?? null,
      server: preset.server ?? null,
    },
    credentialKind: preset.hasPassword ? "copyFromAppointment" : "replace",
    password: "",
    sourceAppointmentId: preset.hasPassword ? preset.sourceAppointmentId : "",
    hasPassword: model.value.hasPassword,
    source: "embedded",
    characterName: null,
    preservesSnapshot: false,
  };
}
</script>

<template>
  <div class="account-fields">
    <div class="account-kind" aria-label="预约账号来源">
      <label class="account-kind__item" :class="{ 'is-active': model.kind === 'none' }">
        <input
          type="radio"
          name="appointment-account-kind"
          value="none"
          :checked="model.kind === 'none'"
          @change="activateKind('none')"
        />
        <UserRoundX :size="15" />不使用账号
      </label>
      <label class="account-kind__item" :class="{ 'is-active': model.kind === 'profile' }">
        <input
          type="radio"
          name="appointment-account-kind"
          value="profile"
          :checked="model.kind === 'profile'"
          @change="activateKind('profile')"
        />
        从档案选择
      </label>
      <label
        class="account-kind__item"
        :class="{ 'is-active': model.kind === 'embedded' }"
        :aria-label="
          model.preservesSnapshot && model.source === 'profile'
            ? '档案账号快照，点击改为一次性账号'
            : '一次性账号'
        "
      >
        <input
          type="radio"
          name="appointment-account-kind"
          value="embedded"
          :checked="model.kind === 'embedded'"
          @click="activateKind('embedded')"
          @change="activateKind('embedded')"
        />
        <FileKey2 :size="15" />
        {{ model.preservesSnapshot && model.source === "profile" ? "档案账号快照" : "一次性账号" }}
      </label>
    </div>

    <section
      v-if="model.kind === 'embedded'"
      class="embedded-presets"
      aria-label="最近使用的一次性账号"
    >
      <button
        class="embedded-presets__toggle"
        type="button"
        :aria-expanded="embeddedPresetsExpanded"
        aria-controls="embedded-presets-panel"
        :aria-label="embeddedPresetsExpanded ? '收起最近使用' : '展开最近使用'"
        @click="embeddedPresetsExpanded = !embeddedPresetsExpanded"
      >
        <span class="embedded-presets__title">最近使用</span>
        <ChevronDown
          class="embedded-presets__chevron"
          :class="{ 'is-expanded': embeddedPresetsExpanded }"
          :size="16"
          aria-hidden="true"
        />
      </button>
      <div v-if="embeddedPresetsExpanded" id="embedded-presets-panel">
        <p v-if="embeddedPresetsLoading" class="embedded-presets__state">账号加载中…</p>
        <p v-else-if="embeddedPresetsError" class="embedded-presets__state is-error">
          {{ embeddedPresetsError }}
        </p>
        <ul v-else-if="embeddedPresets.length" class="embedded-presets__list">
          <li v-for="preset in embeddedPresets" :key="preset.sourceAppointmentId">
            <button
              class="embedded-preset"
              type="button"
              :title="embeddedPresetLabel(preset)"
              @click="selectEmbeddedPreset(preset)"
            >
              {{ embeddedPresetLabel(preset) }}
            </button>
          </li>
        </ul>
        <p v-else class="embedded-presets__state">暂无使用过的一次性账号</p>
      </div>
    </section>

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
            model.hasPassword ? "保留这条预约已有的密码" : "这条预约当前没有密码，保存时保持不变"
          }}
        </span>
        <button
          class="button button--compact button--ghost"
          type="button"
          @click="chooseNewPassword"
        >
          {{ model.hasPassword ? "更换密码" : "补充密码" }}
        </button>
      </div>
      <div v-else-if="model.credentialKind === 'copyFromAppointment'" class="credential-note">
        <span>保存时沿用所选历史预约的密码</span>
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
          placeholder="仅保存到本条预约，不跟随账号档案更新"
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
  position: relative;
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
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  font-weight: 650;
  cursor: pointer;
}

.account-kind__item > input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.account-kind__item:has(input:focus-visible) {
  outline: 2px solid color-mix(in srgb, var(--brand) 66%, transparent);
  outline-offset: 2px;
}

.account-kind__item.is-active {
  border-color: var(--brand-border);
  color: var(--brand-strong);
  background: var(--brand-soft);
  box-shadow: inset 0 -2px 0 var(--brand);
}

.embedded-presets {
  display: grid;
  gap: 7px;
  padding: 10px;
  border: 1px solid color-mix(in srgb, var(--brand) 16%, var(--line));
  border-radius: var(--radius, 12px);
  background: color-mix(in srgb, var(--surface) 96%, var(--brand-soft));
}

.embedded-presets__title {
  color: var(--ink-strong);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  font-weight: 700;
}

.embedded-presets__toggle {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  padding: 0;
  border: 0;
  color: inherit;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.embedded-presets__toggle:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--brand) 66%, transparent);
  outline-offset: 3px;
}

.embedded-presets__chevron {
  flex: 0 0 auto;
  color: var(--ink-muted);
  transition: transform 160ms ease;
}

.embedded-presets__chevron.is-expanded {
  transform: rotate(180deg);
}

.embedded-presets__list {
  display: grid;
  max-height: 116px;
  gap: 5px;
  margin: 0;
  overflow-y: auto;
  padding: 0;
  list-style: none;
}

.embedded-preset {
  width: 100%;
  overflow: hidden;
  padding: 7px 9px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm, 8px);
  color: var(--ink);
  background: var(--surface);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.embedded-preset:hover,
.embedded-preset:focus-visible {
  border-color: var(--brand-border);
  background: var(--brand-soft);
}

.embedded-presets__state {
  margin: 0;
  padding: 5px 0;
  color: var(--ink-muted);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  text-align: center;
}

.embedded-presets__state.is-error {
  color: var(--danger);
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
  font-size: calc(12px + var(--app-font-size-offset, 0px));
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
  font-size: calc(12px + var(--app-font-size-offset, 0px));
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
