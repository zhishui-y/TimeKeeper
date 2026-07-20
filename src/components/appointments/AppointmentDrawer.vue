<script setup lang="ts">
import { BriefcaseBusiness, Gamepad2, Save, X } from "@lucide/vue";
import { reactive, shallowRef, watch } from "vue";
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

const props = defineProps<{
  open: boolean;
  appointment: Appointment | null;
  requestedDate: string;
  requestedStartTime: string | null;
  accounts: readonly AccountProfile[];
}>();

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
    reminderMinutes: source?.reminderMinutes ?? 30,
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

function submit(): void {
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
        <aside class="drawer" aria-label="预约编辑">
          <header class="drawer__header">
            <div>
              <span class="section-kicker">APPOINTMENT</span>
              <h2>{{ appointment ? "编辑预约" : "新建预约" }}</h2>
            </div>
            <button class="icon-button" type="button" aria-label="关闭" @click="emit('close')">
              <X :size="18" />
            </button>
          </header>

          <form class="drawer__body" @submit.prevent="submit">
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
                <label class="field">
                  <span class="field__label">开始时间</span>
                  <input v-model="draft.startTime" class="input" type="time" />
                </label>
                <label class="field">
                  <span class="field__label">结束时间</span>
                  <input v-model="draft.endTime" class="input" type="time" />
                </label>
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
                  <select v-model="draft.accountProfileId" class="select">
                    <option value="">不关联账号</option>
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
            <button class="button button--primary" type="button" @click="submit">
              <Save :size="16" />
              保存预约
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
  background: rgba(31, 42, 38, 0.28);
  cursor: default;
}

.drawer {
  position: absolute;
  top: 0;
  right: 0;
  display: grid;
  width: min(580px, 52vw);
  height: 100%;
  grid-template-rows: 72px minmax(0, 1fr) 64px;
  border-left: 1px solid var(--line-strong);
  background: #fbfcfa;
  box-shadow: -18px 0 42px rgba(24, 36, 31, 0.16);
}

.drawer__header,
.drawer__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 22px;
  border-bottom: 1px solid var(--line);
  background: var(--surface);
}

.drawer__header h2 {
  margin-top: 2px;
  color: var(--ink-strong);
  font-size: 18px;
}

.drawer__body {
  min-height: 0;
  overflow-y: auto;
  padding: 18px 22px 28px;
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
  gap: 8px;
  margin-bottom: 18px;
}

.mode-switch__item {
  display: flex;
  min-height: 58px;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  color: var(--ink-muted);
  background: var(--surface);
  text-align: left;
  cursor: pointer;
}

.mode-switch__item.is-active {
  border-color: #93b5a6;
  color: var(--brand-strong);
  background: var(--brand-soft);
  box-shadow: inset 3px 0 0 var(--brand);
}

.mode-switch__item span {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.mode-switch__item strong {
  font-size: 12px;
}

.mode-switch__item small {
  color: inherit;
  font-size: 10px;
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
  gap: 12px;
  padding: 16px 0;
  border-top: 1px solid var(--line);
}

.form-section:first-of-type {
  border-top: 0;
}

.form-section h3 {
  color: var(--ink-strong);
  font-size: 12px;
  font-weight: 750;
}

.form-section--billing {
  margin: 0 -10px;
  padding: 16px 10px;
  border: 1px solid #dbe6dd;
  border-radius: var(--radius);
  background: #f5f8f4;
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
  transition: transform 180ms ease;
}

.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
}

.drawer-enter-from .drawer,
.drawer-leave-to .drawer {
  transform: translateX(24px);
}
</style>
