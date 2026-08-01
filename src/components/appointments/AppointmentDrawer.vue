<script setup lang="ts">
import { BriefcaseBusiness, Gamepad2, Save, X } from "@lucide/vue";
import { format } from "date-fns";
import { reactive, shallowRef, useTemplateRef, watch } from "vue";
import { useModalFocus } from "../../composables/useModalFocus";
import type {
  AccountProfile,
  Appointment,
  AppointmentInput,
  AppointmentMode,
  ServiceStatus,
  SettlementStatus,
} from "../../types/domain";
import { appointmentToInput } from "../../utils/appointment";

interface Draft {
  serviceDate: string;
  startTime: string;
  endTime: string;
  contactName: string;
  content: string;
  mode: AppointmentMode;
  serviceStatus: ServiceStatus;
  settlementStatus: SettlementStatus;
  accountProfileId: string;
  rateNote: string;
  paymentMethod: string;
  amountYuan: string;
  reminderEnabled: boolean;
  reminderMinutes: number;
  notes: string;
}

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
    initialFocus?: "default" | "amount";
    requestedDate: string;
    requestedStartTime: string | null;
    accounts: readonly AccountProfile[];
    accountsLoading?: boolean;
    defaultReminderMinutes: number;
    saving?: boolean;
  }>(),
  { accountsLoading: false, initialFocus: "default", saving: false },
);

const emit = defineEmits<{
  close: [];
  save: [input: AppointmentInput];
}>();

const draft = reactive<Draft>({
  serviceDate: "",
  startTime: "",
  endTime: "",
  contactName: "",
  content: "",
  mode: "business",
  serviceStatus: "scheduled",
  settlementStatus: "unsettled",
  accountProfileId: "",
  rateNote: "",
  paymentMethod: "",
  amountYuan: "",
  reminderEnabled: true,
  reminderMinutes: 30,
  notes: "",
});

const errors = shallowRef<string[]>([]);
const drawerRef = useTemplateRef("drawer");
const appointmentFormRef = useTemplateRef("appointmentForm");
const amountInputRef = useTemplateRef<FocusTarget>("amountInput");
const formFieldSelector = "input:not([disabled]), select:not([disabled]), textarea:not([disabled])";

function resetDraft(): void {
  const source = props.appointment ? appointmentToInput(props.appointment) : null;
  Object.assign(draft, {
    serviceDate: source?.serviceDate ?? props.requestedDate,
    startTime: source?.startTime ?? props.requestedStartTime ?? "",
    endTime: source?.endTime ?? "",
    contactName: source?.contactName ?? "",
    content: source?.content ?? "",
    mode: source?.mode ?? "business",
    serviceStatus: source?.serviceStatus ?? "scheduled",
    settlementStatus: source?.settlementStatus ?? "unsettled",
    accountProfileId: source?.accountProfileId ?? "",
    rateNote: source?.rateNote ?? "",
    paymentMethod: source?.paymentMethod ?? "",
    amountYuan:
      source?.amountMinor === null || source?.amountMinor === undefined
        ? ""
        : String(source.amountMinor / 100),
    reminderEnabled: source?.reminderMinutes !== null,
    reminderMinutes: source?.reminderMinutes ?? props.defaultReminderMinutes,
    notes: source?.notes ?? "",
  });
  errors.value = [];
}

function selectMode(mode: AppointmentMode): void {
  draft.mode = mode;
  if (mode === "entertainment") {
    draft.settlementStatus = "not_applicable";
    draft.rateNote = "";
    draft.paymentMethod = "";
    draft.amountYuan = "";
  } else if (draft.settlementStatus === "not_applicable") {
    draft.settlementStatus = "unsettled";
  }
}

function setCurrentTime(field: "startTime" | "endTime"): void {
  draft[field] = format(new Date(), "HH:mm");
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

function submit(): void {
  if (props.saving) return;
  const nextErrors: string[] = [];
  if (!draft.serviceDate) nextErrors.push("请选择预约日期");
  if (!draft.contactName.trim()) nextErrors.push("请填写联系人");
  if (draft.endTime && !draft.startTime) nextErrors.push("填写结束时间前，需要先填写开始时间");
  if (draft.startTime && draft.endTime && draft.startTime === draft.endTime) {
    nextErrors.push("开始时间和结束时间不能相同");
  }
  const amount = draft.amountYuan ? Number(draft.amountYuan) : null;
  if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
    nextErrors.push("账单金额格式不正确");
  }
  if (draft.mode === "business" && draft.settlementStatus === "settled" && amount === null) {
    nextErrors.push("已结算预约必须填写金额");
  }
  errors.value = nextErrors;
  if (nextErrors.length > 0) return;

  emit("save", {
    serviceDate: draft.serviceDate,
    startTime: draft.startTime || null,
    endTime: draft.endTime || null,
    contactName: draft.contactName.trim(),
    content: draft.content.trim() || null,
    mode: draft.mode,
    serviceStatus: draft.serviceStatus,
    settlementStatus: draft.mode === "entertainment" ? "not_applicable" : draft.settlementStatus,
    accountProfileId: draft.accountProfileId || null,
    rateNote: draft.mode === "business" ? draft.rateNote.trim() || null : null,
    paymentMethod: draft.mode === "business" ? draft.paymentMethod.trim() || null : null,
    amountMinor: draft.mode === "business" && amount !== null ? Math.round(amount * 100) : null,
    reminderMinutes: draft.reminderEnabled ? Number(draft.reminderMinutes) : null,
    notes: draft.notes.trim() || null,
  });
}

watch(
  () => [props.open, props.appointment, props.requestedDate, props.requestedStartTime] as const,
  ([open]) => {
    if (open) resetDraft();
  },
  { immediate: true },
);

useModalFocus({
  open: () => props.open,
  container: drawerRef,
  close: () => emit("close"),
  initialFocus: () => (props.initialFocus === "amount" ? amountInputRef.value : null),
});
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div v-if="open" class="drawer-layer">
        <button
          class="drawer-backdrop"
          type="button"
          aria-label="关闭预约编辑"
          @click="emit('close')"
        />
        <aside
          ref="drawer"
          class="drawer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="appointment-drawer-title"
          tabindex="-1"
        >
          <header class="drawer__header">
            <div>
              <span class="section-kicker">APPOINTMENT</span>
              <h2 id="appointment-drawer-title">{{ appointment ? "编辑预约" : "新建预约" }}</h2>
            </div>
            <button class="icon-button" type="button" aria-label="关闭" @click="emit('close')">
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
            <div class="mode-switch" role="radiogroup" aria-label="预约模式">
              <button
                type="button"
                class="mode-switch__item"
                :class="{ 'is-active': draft.mode === 'business' }"
                @click="selectMode('business')"
              >
                <BriefcaseBusiness :size="17" />
                <span><strong>业务模式</strong><small>记录账单并计入收益</small></span>
              </button>
              <button
                type="button"
                class="mode-switch__item"
                :class="{ 'is-active': draft.mode === 'entertainment' }"
                @click="selectMode('entertainment')"
              >
                <Gamepad2 :size="17" />
                <span><strong>娱乐模式</strong><small>只保留排班信息</small></span>
              </button>
            </div>

            <div v-if="errors.length" class="form-errors" role="alert">
              <span v-for="error in errors" :key="error">{{ error }}</span>
            </div>

            <section class="form-section">
              <h3>时间与内容</h3>
              <div class="form-grid form-grid--3">
                <label class="field form-grid__wide">
                  <span class="field__label">日期 *</span>
                  <input v-model="draft.serviceDate" class="input" type="date" />
                </label>
                <div class="field">
                  <label class="field__label" for="appointment-start-time">开始时间</label>
                  <div class="time-field__control">
                    <input
                      id="appointment-start-time"
                      v-model="draft.startTime"
                      class="input"
                      type="time"
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
                  <label class="field__label" for="appointment-end-time">结束时间（可留空）</label>
                  <div class="time-field__control time-field__control--end">
                    <input
                      id="appointment-end-time"
                      v-model="draft.endTime"
                      class="input"
                      type="time"
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
                      @click="draft.endTime = ''"
                    >
                      清空
                    </button>
                  </div>
                </div>
              </div>
              <div class="form-grid">
                <label class="field">
                  <span class="field__label">联系人 *</span>
                  <input v-model="draft.contactName" class="input" placeholder="谁约的" />
                </label>
                <label class="field">
                  <span class="field__label">预约内容</span>
                  <input v-model="draft.content" class="input" placeholder="上分、陪练、日常…" />
                </label>
              </div>
            </section>

            <section class="form-section">
              <h3>进度与账号</h3>
              <div class="form-grid">
                <label class="field">
                  <span class="field__label">预约进度</span>
                  <select v-model="draft.serviceStatus" class="select">
                    <option value="scheduled">已预约</option>
                    <option value="in_progress">进行中</option>
                    <option value="completed">已完成</option>
                    <option value="cancelled">已取消</option>
                  </select>
                </label>
                <label class="field">
                  <span class="field__label">关联账号</span>
                  <select
                    v-model="draft.accountProfileId"
                    class="select"
                    :disabled="accountsLoading"
                  >
                    <option value="">{{ accountsLoading ? "账号加载中…" : "不关联账号" }}</option>
                    <option v-for="account in accounts" :key="account.id" :value="account.id">
                      {{ account.contactName || account.accountName }} ·
                      {{ account.server || "区服待补" }}
                    </option>
                  </select>
                </label>
              </div>
            </section>

            <section v-if="draft.mode === 'business'" class="form-section form-section--billing">
              <h3>账单信息</h3>
              <div class="form-grid form-grid--3">
                <label class="field">
                  <span class="field__label">结算状态</span>
                  <select v-model="draft.settlementStatus" class="select">
                    <option value="unsettled">待结算</option>
                    <option value="settled">已结算</option>
                  </select>
                </label>
                <label class="field">
                  <span class="field__label">金额（元）</span>
                  <input
                    ref="amountInput"
                    v-model="draft.amountYuan"
                    class="input mono-number"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                  />
                </label>
                <label class="field">
                  <span class="field__label">收款方式</span>
                  <input
                    v-model="draft.paymentMethod"
                    class="input"
                    list="payment-methods"
                    placeholder="支付宝/微信/QQ"
                  />
                  <datalist id="payment-methods">
                    <option value="支付宝" />
                    <option value="微信" />
                    <option value="QQ" />
                  </datalist>
                </label>
              </div>
              <label class="field">
                <span class="field__label">费率说明</span>
                <input
                  v-model="draft.rateNote"
                  class="input"
                  placeholder="例如：180元/小时，平台抽成20%"
                />
              </label>
            </section>

            <section class="form-section">
              <h3>提醒与备注</h3>
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
              <label class="field">
                <span class="field__label">备注</span>
                <textarea
                  v-model="draft.notes"
                  class="textarea"
                  placeholder="补充要求、临时约定等"
                />
              </label>
            </section>
          </form>

          <footer class="drawer__footer">
            <button class="button" type="button" @click="emit('close')">取消</button>
            <button
              class="button button--primary"
              type="submit"
              form="appointment-form"
              :disabled="saving"
            >
              <Save :size="16" />
              {{ saving ? "保存中…" : "保存预约" }}
            </button>
          </footer>
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
  width: min(600px, calc(100vw - 32px));
  height: auto;
  grid-template-rows: 78px minmax(0, 1fr) 70px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--brand) 18%, var(--line));
  border-radius: var(--radius-lg, 18px);
  background: var(--canvas, #f7f5ef);
  box-shadow: -24px 16px 64px rgba(18, 34, 28, 0.24);
  will-change: transform;
}

.drawer__header,
.drawer__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--surface) 94%, transparent);
}

.drawer__header h2 {
  margin-top: 2px;
  color: var(--ink-strong);
  font-family: var(--font-serif, "Noto Serif SC", serif);
  font-size: 20px;
  letter-spacing: 0.02em;
}

.drawer__body {
  min-height: 0;
  overflow-y: auto;
  padding: 20px 24px 30px;
}

.drawer__footer {
  justify-content: flex-end;
  gap: 8px;
  border-top: 1px solid var(--line);
  border-bottom: 0;
}

.mode-switch {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 20px;
}

.mode-switch__item {
  display: flex;
  min-height: 66px;
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
  font-size: 13px;
}

.mode-switch__item small {
  color: inherit;
  font-size: 11px;
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
  font-size: 11px;
}

.form-section {
  display: flex;
  flex-direction: column;
  gap: 13px;
  padding: 18px 0;
  border-top: 1px solid var(--line);
}

.form-section:first-of-type {
  border-top: 0;
}

.form-section h3 {
  color: var(--ink-strong);
  font-family: var(--font-serif, "Noto Serif SC", serif);
  font-size: 13px;
  font-weight: 750;
  letter-spacing: 0.025em;
}

.form-section--billing {
  margin: 0 -12px;
  padding: 18px 12px;
  border: 1px solid color-mix(in srgb, var(--brand) 18%, var(--line));
  border-radius: var(--radius-lg, 14px);
  background: color-mix(in srgb, var(--brand-soft) 42%, var(--surface));
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 11px;
}

.form-grid--3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.form-grid__wide {
  grid-column: span 1;
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
  font-size: 11px;
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
}

.check-label {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--ink);
  font-size: 12px;
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
  font-size: 11px;
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
</style>
