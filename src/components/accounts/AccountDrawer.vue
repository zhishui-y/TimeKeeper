<script setup lang="ts">
import { Save, X } from "@lucide/vue";
import { reactive, shallowRef, useTemplateRef, watch } from "vue";
import { useModalFocus } from "../../composables/useModalFocus";
import type { AccountProfile, AccountProfileInput } from "../../types/domain";

interface Draft {
  contactName: string;
  server: string;
  characterName: string;
  specialization: string;
  gearScore: string;
  accountName: string;
  password: string;
  currentScore: string;
  highestScore: string;
  scoreUpdatedAt: string;
  notes: string;
  needsReview: boolean;
}

const props = withDefaults(
  defineProps<{
    open: boolean;
    profile: AccountProfile | null;
    saving?: boolean;
  }>(),
  { saving: false },
);

const emit = defineEmits<{
  close: [];
  save: [input: AccountProfileInput];
}>();

const draft = reactive<Draft>({
  contactName: "",
  server: "",
  characterName: "",
  specialization: "",
  gearScore: "",
  accountName: "",
  password: "",
  currentScore: "",
  highestScore: "",
  scoreUpdatedAt: "",
  notes: "",
  needsReview: false,
});
const errors = shallowRef<string[]>([]);
const drawerRef = useTemplateRef("accountDrawer");

function reset(): void {
  Object.assign(draft, {
    contactName: props.profile?.contactName ?? "",
    server: props.profile?.server ?? "",
    characterName: props.profile?.characterName ?? "",
    specialization: props.profile?.specialization ?? "",
    gearScore: props.profile?.gearScore ?? "",
    accountName: props.profile?.accountName ?? "",
    password: "",
    currentScore: props.profile?.currentScore?.toString() ?? "",
    highestScore: props.profile?.highestScore?.toString() ?? "",
    scoreUpdatedAt: props.profile?.scoreUpdatedAt ?? "",
    notes: props.profile?.notes ?? "",
    needsReview: props.profile?.needsReview ?? false,
  });
  errors.value = [];
}

function optionalNumber(value: string): number | null {
  if (!value) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function submit(): void {
  if (props.saving) return;
  const nextErrors: string[] = [];
  if (!draft.accountName.trim()) nextErrors.push("请填写登录账号");
  if (!props.profile && !draft.password) nextErrors.push("新建账号必须填写密码");
  if (draft.currentScore && optionalNumber(draft.currentScore) === null)
    nextErrors.push("当前分格式不正确");
  if (draft.highestScore && optionalNumber(draft.highestScore) === null)
    nextErrors.push("最高分格式不正确");
  errors.value = nextErrors;
  if (nextErrors.length) return;

  emit("save", {
    contactName: draft.contactName.trim() || null,
    server: draft.server.trim() || null,
    characterName: draft.characterName.trim() || null,
    specialization: draft.specialization.trim() || null,
    gearScore: draft.gearScore.trim() || null,
    accountName: draft.accountName.trim(),
    password: draft.password || null,
    currentScore: optionalNumber(draft.currentScore),
    highestScore: optionalNumber(draft.highestScore),
    scoreUpdatedAt: draft.scoreUpdatedAt || null,
    notes: draft.notes.trim() || null,
    needsReview: draft.needsReview,
  });
}

watch(
  () => [props.open, props.profile] as const,
  ([open]) => {
    if (open) reset();
  },
  { immediate: true },
);

useModalFocus({
  open: () => props.open,
  container: drawerRef,
  close: () => emit("close"),
});
</script>

<template>
  <Teleport to="body">
    <Transition name="account-drawer">
      <div v-if="open" class="account-layer">
        <button
          class="account-backdrop"
          type="button"
          aria-label="关闭账号编辑"
          @click="emit('close')"
        />
        <aside
          ref="accountDrawer"
          class="account-drawer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="account-drawer-title"
          tabindex="-1"
        >
          <header class="account-drawer__header">
            <div>
              <span class="section-kicker">ACCOUNT PROFILE</span>
              <h2 id="account-drawer-title">
                {{ profile ? "编辑账号档案" : "新建账号档案" }}
              </h2>
            </div>
            <button class="icon-button" type="button" aria-label="关闭" @click="emit('close')">
              <X :size="18" />
            </button>
          </header>
          <form class="account-drawer__body" @submit.prevent="submit">
            <div v-if="errors.length" class="account-errors">
              <span v-for="error in errors" :key="error">{{ error }}</span>
            </div>

            <section class="account-section">
              <h3>登录信息</h3>
              <label class="field">
                <span class="field__label">登录账号 *</span>
                <input v-model="draft.accountName" class="input" autocomplete="off" />
              </label>
              <label class="field">
                <span class="field__label">{{ profile ? "新密码" : "密码 *" }}</span>
                <input
                  v-model="draft.password"
                  class="input"
                  type="password"
                  autocomplete="new-password"
                  :placeholder="profile ? '留空则不修改' : '写入本地加密密码库'"
                />
              </label>
            </section>

            <section class="account-section">
              <h3>角色资料</h3>
              <div class="account-grid">
                <label class="field">
                  <span class="field__label">联系人</span>
                  <input v-model="draft.contactName" class="input" />
                </label>
                <label class="field">
                  <span class="field__label">服务器</span>
                  <input v-model="draft.server" class="input" />
                </label>
                <label class="field">
                  <span class="field__label">角色名</span>
                  <input v-model="draft.characterName" class="input" />
                </label>
                <label class="field">
                  <span class="field__label">职业 / 心法</span>
                  <input v-model="draft.specialization" class="input" />
                </label>
                <label class="field">
                  <span class="field__label">装分</span>
                  <input v-model="draft.gearScore" class="input" placeholder="例如：19.8万" />
                </label>
                <label class="field">
                  <span class="field__label">分数更新日期</span>
                  <input v-model="draft.scoreUpdatedAt" class="input" type="date" />
                </label>
              </div>
            </section>

            <section class="account-section">
              <h3>分数与备注</h3>
              <div class="account-grid">
                <label class="field">
                  <span class="field__label">当前分</span>
                  <input
                    v-model="draft.currentScore"
                    class="input mono-number"
                    type="number"
                    min="0"
                  />
                </label>
                <label class="field">
                  <span class="field__label">最高分</span>
                  <input
                    v-model="draft.highestScore"
                    class="input mono-number"
                    type="number"
                    min="0"
                  />
                </label>
              </div>
              <label class="field">
                <span class="field__label">备注</span>
                <textarea v-model="draft.notes" class="textarea" />
              </label>
              <label class="review-check">
                <input v-model="draft.needsReview" type="checkbox" />
                <span>标记为暂不可用</span>
              </label>
            </section>
          </form>
          <footer class="account-drawer__footer">
            <button class="button" type="button" @click="emit('close')">取消</button>
            <button class="button button--primary" type="button" :disabled="saving" @click="submit">
              <Save :size="16" />{{ saving ? "保存中…" : "保存档案" }}
            </button>
          </footer>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.account-layer {
  position: fixed;
  z-index: 60;
  inset: 0;
}

.account-backdrop {
  position: absolute;
  inset: 0;
  width: 100%;
  border: 0;
  background: rgba(20, 31, 27, 0.42);
  backdrop-filter: blur(4px);
}

.account-drawer {
  position: absolute;
  top: 12px;
  right: 12px;
  bottom: 12px;
  display: grid;
  width: min(540px, calc(100vw - 32px));
  height: auto;
  grid-template-rows: 78px minmax(0, 1fr) 70px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--brand) 18%, var(--line));
  border-radius: var(--radius-lg, 18px);
  background: var(--canvas, #f7f5ef);
  box-shadow: -24px 16px 64px rgba(18, 34, 28, 0.24);
  will-change: transform;
}

.account-drawer__header,
.account-drawer__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--surface) 94%, transparent);
}

.account-drawer__header h2 {
  margin-top: 2px;
  color: var(--ink-strong);
  font-family: var(--font-serif, "Noto Serif SC", serif);
  font-size: 20px;
  letter-spacing: 0.02em;
}

.account-drawer__body {
  overflow-y: auto;
  padding: 8px 24px 28px;
}

.account-drawer__footer {
  justify-content: flex-end;
  gap: 8px;
  border-top: 1px solid var(--line);
  border-bottom: 0;
}

.account-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 19px 0;
  border-bottom: 1px solid var(--line);
}

.account-section:last-child {
  border-bottom: 0;
}

.account-section h3 {
  color: var(--ink-strong);
  font-family: var(--font-serif, "Noto Serif SC", serif);
  font-size: 13px;
  letter-spacing: 0.025em;
}

.account-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.account-errors {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 12px;
  padding: 9px 11px;
  border: 1px solid #e4bdb4;
  border-radius: var(--radius);
  color: #963f2f;
  background: #fff4f1;
  font-size: 11px;
}

.review-check {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--ink);
  font-size: 12px;
}

.review-check input {
  accent-color: var(--amber);
}

.account-drawer-enter-active,
.account-drawer-leave-active {
  transition: opacity 180ms ease;
}

.account-drawer-enter-active .account-drawer,
.account-drawer-leave-active .account-drawer {
  transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}

.account-drawer-enter-from,
.account-drawer-leave-to {
  opacity: 0;
}

.account-drawer-enter-from .account-drawer,
.account-drawer-leave-to .account-drawer {
  transform: translateX(32px) scale(0.985);
}

@media (max-height: 740px) {
  .account-drawer {
    top: 8px;
    right: 8px;
    bottom: 8px;
    grid-template-rows: 68px minmax(0, 1fr) 60px;
  }
}
</style>
