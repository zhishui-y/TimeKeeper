<script setup lang="ts">
import { BriefcaseBusiness, Gamepad2, X } from "@lucide/vue";
import { computed, shallowRef, useTemplateRef } from "vue";
import StatusBadge from "../common/StatusBadge.vue";
import AppointmentAccountFields from "./AppointmentAccountFields.vue";
import AppointmentContactFields from "./AppointmentContactFields.vue";
import AppointmentDrawerFooter from "./AppointmentDrawerFooter.vue";
import AppointmentProgressRadioGroup from "./AppointmentProgressRadioGroup.vue";
import {
  useAppointmentDraft,
  type AppointmentAccountDraft,
} from "../../composables/useAppointmentDraft";
import { useModalFocus } from "../../composables/useModalFocus";
import type {
  AccountProfile,
  Appointment,
  AppointmentDraftSeed,
  AppointmentInput,
  AppointmentProgressStatus,
} from "../../types/domain";
import { todayInChina } from "../../utils/appointment";
import { appointmentProgressStatusesForMode } from "../../utils/appointmentProgress";

interface FocusTarget {
  focus(): void;
}

interface FieldTabEvent {
  target: unknown;
  shiftKey: boolean;
  preventDefault(): void;
}

const props = withDefaults(
  defineProps<{
    open: boolean;
    appointment: Appointment | null;
    draftSeed?: AppointmentDraftSeed | null;
    initialFocus?: "default" | "amount";
    requestedDate: string;
    requestedStartTime: string | null;
    accounts: readonly AccountProfile[];
    accountsLoading?: boolean;
    defaultReminderMinutes: number;
    saving?: boolean;
    deleting?: boolean;
  }>(),
  {
    accountsLoading: false,
    deleting: false,
    draftSeed: null,
    initialFocus: "default",
    saving: false,
  },
);

const emit = defineEmits<{
  close: [];
  delete: [];
  duplicate: [seed: AppointmentDraftSeed];
  save: [input: AppointmentInput];
  copyPassword: [appointmentId: string];
}>();
const drawerRef = useTemplateRef("drawer");
const appointmentFormRef = useTemplateRef("appointmentForm");
const dateInputRef = useTemplateRef<FocusTarget>("dateInput");
const amountInputRef = useTemplateRef<FocusTarget>("amountInput");
const footerMenuOpen = shallowRef(false);
const formFieldSelector =
  "input:not([disabled]):not([type='radio']), select:not([disabled]), textarea:not([disabled])";

const {
  draft,
  progressStatus,
  errors,
  applyContactPreset,
  clearEndTime,
  clearSecrets,
  markTimeModified,
  selectMode,
  setCurrentTime,
  submit,
  duplicateAsToday,
} = useAppointmentDraft({
  open: () => props.open,
  appointment: () => props.appointment,
  seed: () => props.draftSeed,
  requestedDate: () => props.requestedDate,
  requestedStartTime: () => props.requestedStartTime,
  defaultReminderMinutes: () => props.defaultReminderMinutes,
  saving: () => props.saving,
  onSave: (input) => emit("save", input),
});

const progressStatusOptions = computed(() => appointmentProgressStatusesForMode(draft.mode));

const accountModel = computed<AppointmentAccountDraft>({
  get: () => draft.account,
  set: (value) => {
    draft.account = value;
  },
});

function close(): void {
  footerMenuOpen.value = false;
  clearSecrets();
  emit("close");
}

function closeFromEscape(): void {
  if (!footerMenuOpen.value) close();
}

function submitWithProgressStatus(status: "completed" | "cancelled"): void {
  progressStatus.value = status;
  submit();
}

function updateProgressStatus(nextStatus: AppointmentProgressStatus): void {
  if (
    draft.settlementStatus === "settled" &&
    nextStatus === "pending_settlement" &&
    !globalThis.confirm("确定改为待结算吗？已填写的金额和收款信息会继续保留。")
  ) {
    return;
  }
  progressStatus.value = nextStatus;
}

function duplicate(): void {
  if (!props.appointment || props.saving || props.deleting) return;
  emit("duplicate", duplicateAsToday(todayInChina(), props.appointment.id));
}

function updateVoiceChannel(value: string): void {
  draft.voiceChannel = value.replace(/\D/g, "");
}

function focusAdjacentField(event: FieldTabEvent): void {
  const fields = Array.from(appointmentFormRef.value?.querySelectorAll(formFieldSelector) ?? []);
  const currentIndex = fields.findIndex((field) => field === event.target);
  if (currentIndex < 0) return;

  const nextIndex = currentIndex + (event.shiftKey ? -1 : 1);
  const nextField = fields[nextIndex];
  if (!nextField) return;

  event.preventDefault();
  (nextField as unknown as FocusTarget).focus();
}

useModalFocus({
  open: () => props.open,
  container: drawerRef,
  close: closeFromEscape,
  initialFocus: () => (props.initialFocus === "amount" ? amountInputRef.value : dateInputRef.value),
});
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div v-if="open" class="drawer-layer">
        <button class="drawer-backdrop" type="button" aria-label="关闭预约编辑" @click="close" />
        <aside
          ref="drawer"
          class="drawer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="appointment-drawer-title"
          tabindex="-1"
        >
          <header class="drawer__header">
            <div class="drawer__heading">
              <span class="section-kicker">APPOINTMENT</span>
              <div class="drawer__title-row">
                <h2 id="appointment-drawer-title">
                  {{ appointment ? "编辑预约" : "新建预约" }}
                </h2>
                <StatusBadge v-if="appointment" :progress-status="progressStatus" />
              </div>
            </div>
            <button class="icon-button" type="button" aria-label="关闭" @click="close">
              <X :size="18" />
            </button>
          </header>

          <form
            id="appointment-form"
            ref="appointmentForm"
            class="drawer__body"
            @keydown.tab="focusAdjacentField"
            @submit.prevent="submit"
          >
            <div class="mode-switch" aria-label="预约模式">
              <label class="mode-switch__item" :class="{ 'is-active': draft.mode === 'business' }">
                <input
                  type="radio"
                  name="appointment-mode"
                  value="business"
                  :checked="draft.mode === 'business'"
                  @change="selectMode('business')"
                />
                <BriefcaseBusiness :size="17" />
                <span><strong>业务模式</strong><small>记录账单并计入收益</small></span>
              </label>
              <label
                class="mode-switch__item"
                :class="{ 'is-active': draft.mode === 'entertainment' }"
              >
                <input
                  type="radio"
                  name="appointment-mode"
                  value="entertainment"
                  :checked="draft.mode === 'entertainment'"
                  @change="selectMode('entertainment')"
                />
                <Gamepad2 :size="17" />
                <span><strong>娱乐模式</strong><small>只保留排班信息</small></span>
              </label>
            </div>

            <div v-if="errors.length" class="form-errors" role="alert">
              <span v-for="error in errors" :key="error">{{ error }}</span>
            </div>

            <div class="appointment-layout">
              <div class="appointment-layout__column">
                <section class="form-card">
                  <h3>时间与内容</h3>
                  <div class="form-grid form-grid--time">
                    <label class="field form-grid__date">
                      <span class="field__label">日期 *</span>
                      <input
                        ref="dateInput"
                        v-model="draft.serviceDate"
                        class="input"
                        type="date"
                      />
                    </label>
                    <div class="field">
                      <label class="field__label" for="appointment-start-time">开始时间</label>
                      <div class="time-field__control">
                        <input
                          id="appointment-start-time"
                          v-model="draft.startTime"
                          class="input"
                          type="time"
                          @input="markTimeModified"
                        />
                        <button
                          class="time-field__button"
                          type="button"
                          aria-label="开始时间选择现在"
                          @click="setCurrentTime('startTime')"
                        >
                          现在
                        </button>
                      </div>
                    </div>
                    <div class="field">
                      <label class="field__label" for="appointment-end-time">
                        结束时间（可留空）
                      </label>
                      <div class="time-field__control time-field__control--end">
                        <input
                          id="appointment-end-time"
                          v-model="draft.endTime"
                          class="input"
                          type="time"
                          @input="markTimeModified"
                        />
                        <button
                          class="time-field__button"
                          type="button"
                          aria-label="结束时间选择现在"
                          @click="setCurrentTime('endTime')"
                        >
                          现在
                        </button>
                        <button
                          class="time-field__button"
                          type="button"
                          aria-label="清空结束时间"
                          :disabled="!draft.endTime"
                          @click="clearEndTime"
                        >
                          清空
                        </button>
                      </div>
                    </div>
                  </div>
                  <div class="form-stack">
                    <AppointmentContactFields
                      v-model="draft.contactName"
                      @select="applyContactPreset"
                    />
                    <label class="field">
                      <span class="field__label">预约内容</span>
                      <input
                        v-model="draft.content"
                        class="input"
                        placeholder="上分、陪练、日常…"
                      />
                    </label>
                  </div>
                </section>

                <section class="form-card">
                  <h3>账号</h3>
                  <AppointmentAccountFields
                    v-model="accountModel"
                    :accounts="accounts"
                    :accounts-loading="accountsLoading"
                    :appointment-id="appointment?.id"
                    @copy-password="emit('copyPassword', $event)"
                  />
                </section>
              </div>

              <div class="appointment-layout__column appointment-layout__column--secondary">
                <section class="form-card">
                  <h3>状态与提醒</h3>
                  <AppointmentProgressRadioGroup
                    :value="progressStatus"
                    :options="progressStatusOptions"
                    :disabled="saving || deleting"
                    @request-change="updateProgressStatus"
                  />
                  <div class="reminder-row">
                    <label class="check-label">
                      <input v-model="draft.reminderEnabled" type="checkbox" />
                      <span>开启提醒</span>
                    </label>
                    <div class="reminder-input">
                      <input
                        v-model.number="draft.reminderMinutes"
                        class="input mono-number"
                        type="number"
                        min="0"
                        max="1440"
                        aria-label="提前提醒分钟数"
                        :disabled="!draft.reminderEnabled"
                      />
                      <span>分钟前</span>
                    </div>
                  </div>
                </section>

                <section v-if="draft.mode === 'business'" class="form-card form-card--billing">
                  <h3>账单信息</h3>
                  <div class="form-grid form-grid--billing-fields">
                    <label class="field">
                      <span class="field__label">金额（元）</span>
                      <input
                        ref="amountInput"
                        v-model="draft.amountYuan"
                        class="input mono-number"
                        type="text"
                        inputmode="decimal"
                        autocomplete="off"
                        placeholder="0.00"
                      />
                    </label>
                    <label class="field">
                      <span class="field__label">收款方式</span>
                      <input v-model="draft.paymentMethod" class="input" list="payment-methods" />
                      <datalist id="payment-methods">
                        <option value="支付宝" />
                        <option value="微信" />
                        <option value="QQ" />
                      </datalist>
                    </label>
                    <label class="field">
                      <span class="field__label">费率说明</span>
                      <input v-model="draft.rateNote" class="input" />
                    </label>
                  </div>
                </section>

                <section class="form-card">
                  <h3>语音与备注</h3>
                  <div class="form-grid form-grid--voice-fields">
                    <label class="field">
                      <span class="field__label">语音</span>
                      <select v-model="draft.voicePlatform" class="select" aria-label="语音平台">
                        <option value="">不使用语音</option>
                        <option value="yy">YY语音</option>
                        <option value="qq">QQ语音</option>
                      </select>
                    </label>
                    <label v-if="draft.voicePlatform === 'yy'" class="field">
                      <span class="field__label">YY频道号码</span>
                      <input
                        class="input mono-number"
                        inputmode="numeric"
                        pattern="[0-9]*"
                        :value="draft.voiceChannel"
                        placeholder="可留空"
                        @input="updateVoiceChannel(($event.target as HTMLInputElement).value)"
                      />
                    </label>
                    <label class="field form-grid__full">
                      <span class="field__label">备注</span>
                      <textarea
                        v-model="draft.notes"
                        class="textarea"
                        placeholder="补充要求、临时约定等"
                      />
                    </label>
                  </div>
                </section>
              </div>
            </div>
          </form>

          <AppointmentDrawerFooter
            :editing="Boolean(appointment)"
            :progress-status="progressStatus"
            :saving="saving"
            :deleting="deleting"
            @close="close"
            @delete="emit('delete')"
            @duplicate="duplicate"
            @complete="submitWithProgressStatus('completed')"
            @cancel="submitWithProgressStatus('cancelled')"
            @menu-open-change="footerMenuOpen = $event"
          />
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.drawer-layer {
  position: fixed;
  z-index: 60;
  inset: 0;
}

.drawer-backdrop {
  position: absolute;
  inset: 0;
  width: 100%;
  border: 0;
  background: rgba(20, 31, 27, 0.42);
  backdrop-filter: blur(4px);
  cursor: default;
}

.drawer {
  position: absolute;
  top: 12px;
  right: 12px;
  bottom: 12px;
  display: grid;
  width: min(900px, calc(100vw - 32px));
  height: auto;
  grid-template-rows: 78px minmax(0, 1fr) 70px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--brand) 18%, var(--line));
  border-radius: var(--radius-lg, 18px);
  background: var(--canvas, #f7f5ef);
  box-shadow: -24px 16px 64px rgba(18, 34, 28, 0.24);
  will-change: transform;
}

.drawer__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--surface) 94%, transparent);
}

.drawer__header h2 {
  margin: 0;
  color: var(--ink-strong);
  font-family: var(--font-serif, "Noto Serif SC", serif);
  font-size: calc(20px + var(--app-font-size-offset, 0px));
  letter-spacing: 0.02em;
}

.drawer__heading {
  display: grid;
  gap: 2px;
}

.drawer__title-row {
  display: flex;
  align-items: center;
  gap: 9px;
}

.drawer__body {
  min-height: 0;
  overflow-y: auto;
  padding: 18px 20px 24px;
}

.mode-switch {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}

.mode-switch__item {
  position: relative;
  display: flex;
  min-height: 60px;
  align-items: center;
  gap: 10px;
  padding: 10px 13px;
  border: 1px solid var(--line);
  border-radius: var(--radius, 12px);
  color: var(--ink-muted);
  background: color-mix(in srgb, var(--surface) 95%, transparent);
  text-align: left;
  cursor: pointer;
}

.mode-switch__item > input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.mode-switch__item:has(input:focus-visible) {
  outline: 2px solid color-mix(in srgb, var(--brand) 66%, transparent);
  outline-offset: 2px;
}

.mode-switch__item.is-active {
  border-color: color-mix(in srgb, var(--brand) 48%, var(--line));
  color: var(--brand-strong);
  background: color-mix(in srgb, var(--brand-soft) 84%, var(--surface));
  box-shadow:
    inset 3px 0 0 var(--brand),
    0 8px 18px rgba(31, 75, 59, 0.08);
}

.mode-switch__item span {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.mode-switch__item strong {
  font-size: calc(13px + var(--app-font-size-offset, 0px));
}

.mode-switch__item small {
  color: inherit;
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  opacity: 0.78;
}

.form-errors {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-bottom: 14px;
  padding: 9px 11px;
  border: 1px solid #e4bdb4;
  border-radius: var(--radius);
  color: #963f2f;
  background: #fff4f1;
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.appointment-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(300px, 1fr);
  align-items: start;
  gap: 12px;
}

.appointment-layout__column {
  display: grid;
  min-width: 0;
  gap: 12px;
}

.form-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 13px;
  padding: 14px;
  border: 1px solid color-mix(in srgb, var(--brand) 14%, var(--line));
  border-radius: var(--radius-lg, 14px);
  background: color-mix(in srgb, var(--surface) 96%, transparent);
}

.form-card h3 {
  color: var(--ink-strong);
  font-family: var(--font-serif, "Noto Serif SC", serif);
  font-size: calc(13px + var(--app-font-size-offset, 0px));
  font-weight: 750;
  letter-spacing: 0.025em;
}

.form-card--billing {
  border: 1px solid color-mix(in srgb, var(--brand) 18%, var(--line));
  background: color-mix(in srgb, var(--brand-soft) 42%, var(--surface));
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 11px;
}

.form-grid--time {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.form-grid--billing-fields {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.form-grid--voice-fields {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.form-grid__full {
  grid-column: 1 / -1;
}

.form-grid__date {
  grid-column: 1 / -1;
  width: min(100%, 220px);
}

.form-stack {
  display: grid;
  gap: 11px;
}

.time-field__control {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 5px;
}

.time-field__control--end {
  grid-template-columns: minmax(0, 1fr) auto auto;
}

.time-field__button {
  min-width: 38px;
  padding: 0 6px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm, 8px);
  color: var(--brand-strong);
  background: var(--surface);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  font-weight: 650;
  cursor: pointer;
}

.time-field__button:hover:not(:disabled) {
  border-color: var(--brand-border);
  background: var(--brand-soft);
}

.time-field__button:disabled {
  color: var(--ink-muted);
  cursor: default;
  opacity: 0.5;
}

.reminder-row {
  display: flex;
  min-height: 36px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}

.check-label {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--ink);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  cursor: pointer;
}

.check-label input {
  accent-color: var(--brand);
}

.reminder-input {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--ink-muted);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.reminder-input .input {
  width: 78px;
}

.drawer-enter-active,
.drawer-leave-active {
  transition: opacity 180ms ease;
}

.drawer-enter-active .drawer,
.drawer-leave-active .drawer {
  transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}

.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
}

.drawer-enter-from .drawer,
.drawer-leave-to .drawer {
  transform: translateX(32px) scale(0.985);
}

@media (max-height: 740px) {
  .drawer {
    top: 8px;
    right: 8px;
    bottom: 8px;
    grid-template-rows: 68px minmax(0, 1fr) 60px;
  }

  .drawer__body {
    padding-top: 14px;
  }
}

@media (max-width: 980px) {
  .appointment-layout {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .drawer {
    grid-template-rows: 68px minmax(0, 1fr) 112px;
  }

  .drawer__header,
  .drawer__body {
    padding-inline: 16px;
  }

  .mode-switch,
  .form-grid--time,
  .form-grid--billing-fields,
  .form-grid--voice-fields {
    grid-template-columns: 1fr;
  }

  .form-grid__date {
    grid-column: auto;
    width: auto;
  }
}
</style>
