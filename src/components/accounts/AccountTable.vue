<script setup lang="ts">
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Copy,
  Eye,
  EyeOff,
  GripVertical,
  Pencil,
  Trash2,
  TriangleAlert,
} from "@lucide/vue";
import { computed, shallowRef, useTemplateRef, watch } from "vue";
import type { AccountProfile } from "../../types/domain";
import type {
  AccountDropPlacement,
  AccountProfileSortKey,
  SortDirection,
} from "../../utils/accounts";
import { formatShortDate } from "../../utils/formatters";

interface AccountDragEvent {
  clientY: number;
  currentTarget: unknown;
  dataTransfer?: {
    effectAllowed: string;
    dropEffect: string;
    setData(type: string, data: string): void;
  } | null;
  preventDefault(): void;
}

const props = defineProps<{
  profiles: readonly AccountProfile[];
  revealedPasswords: Readonly<Record<string, string>>;
  vaultUnlocked: boolean;
  sortKey: AccountProfileSortKey | null;
  sortDirection: SortDirection;
  reorderEnabled: boolean;
  reorderDisabledReason: string;
}>();
const selectedIds = defineModel<string[]>("selectedIds", { required: true });

const emit = defineEmits<{
  edit: [profile: AccountProfile];
  reveal: [profile: AccountProfile];
  hide: [profile: AccountProfile];
  copy: [profile: AccountProfile];
  copyAccount: [profile: AccountProfile];
  delete: [profile: AccountProfile];
  sort: [sortKey: AccountProfileSortKey];
  reorder: [sourceId: string, targetId: string, placement: AccountDropPlacement];
}>();

const allSelectRef = useTemplateRef("all-select");
const draggedId = shallowRef<string | null>(null);
const dropTarget = shallowRef<{ id: string; placement: AccountDropPlacement } | null>(null);
const selectedIdSet = computed(() => new Set(selectedIds.value));
const allChecked = computed(
  () =>
    props.profiles.length > 0 &&
    props.profiles.every((profile) => selectedIdSet.value.has(profile.id)),
);
const indeterminate = computed(() => selectedIds.value.length > 0 && !allChecked.value);

watch(indeterminate, (value) => {
  if (allSelectRef.value) {
    allSelectRef.value.indeterminate = value;
  }
});

function isChecked(event: unknown): boolean {
  const target = (event as { target?: { checked?: boolean } } | null)?.target;
  return target?.checked ?? false;
}

function toggleAll(event: unknown): void {
  selectedIds.value = isChecked(event) ? props.profiles.map((profile) => profile.id) : [];
}

function toggleOne(profileId: string, event: unknown): void {
  const next = new Set(selectedIds.value);
  if (isChecked(event)) {
    next.add(profileId);
  } else {
    next.delete(profileId);
  }
  selectedIds.value = [...next];
}

function ariaSort(sortKey: AccountProfileSortKey): "ascending" | "descending" | "none" {
  if (props.sortKey !== sortKey) return "none";
  return props.sortDirection === "asc" ? "ascending" : "descending";
}

function startDrag(profileId: string, event: AccountDragEvent): void {
  if (!props.reorderEnabled) {
    event.preventDefault();
    return;
  }
  draggedId.value = profileId;
  dropTarget.value = null;
  event.dataTransfer?.setData("text/plain", profileId);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
}

function dragOver(targetId: string, event: AccountDragEvent): void {
  if (!draggedId.value || draggedId.value === targetId) return;
  event.preventDefault();
  const row = event.currentTarget as {
    getBoundingClientRect(): { top: number; height: number };
  };
  const bounds = row.getBoundingClientRect();
  const placement: AccountDropPlacement =
    event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
  dropTarget.value = { id: targetId, placement };
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
}

function dropOn(targetId: string, event: AccountDragEvent): void {
  event.preventDefault();
  const sourceId = draggedId.value;
  const placement = dropTarget.value?.id === targetId ? dropTarget.value.placement : "before";
  draggedId.value = null;
  dropTarget.value = null;
  if (sourceId && sourceId !== targetId) emit("reorder", sourceId, targetId, placement);
}

function finishDrag(): void {
  draggedId.value = null;
  dropTarget.value = null;
}
</script>

<template>
  <div class="data-surface account-table">
    <div v-if="profiles.length" class="table-scroll">
      <table class="data-table">
        <colgroup>
          <col style="width: 58px" />
          <col style="width: 90px" />
          <col style="width: 86px" />
          <col style="width: 86px" />
          <col style="width: 82px" />
          <col style="width: 68px" />
          <col style="width: 132px" />
          <col style="width: 148px" />
          <col style="width: 62px" />
          <col style="width: 62px" />
          <col style="width: 102px" />
          <col style="width: 72px" />
        </colgroup>
        <thead>
          <tr>
            <th>
              <input
                ref="all-select"
                type="checkbox"
                :checked="allChecked"
                aria-label="全选当前列表账号"
                @change="toggleAll"
                @click.stop
              />
            </th>
            <th :aria-sort="ariaSort('contactName')">
              <button
                class="sort-button"
                type="button"
                data-sort-key="contactName"
                title="按联系人排序"
                @click="emit('sort', 'contactName')"
              >
                联系人
                <ArrowUp v-if="sortKey === 'contactName' && sortDirection === 'asc'" :size="12" />
                <ArrowDown
                  v-else-if="sortKey === 'contactName' && sortDirection === 'desc'"
                  :size="12"
                />
                <ArrowUpDown v-else :size="12" />
              </button>
            </th>
            <th :aria-sort="ariaSort('server')">
              <button
                class="sort-button"
                type="button"
                data-sort-key="server"
                title="按服务器排序"
                @click="emit('sort', 'server')"
              >
                服务器
                <ArrowUp v-if="sortKey === 'server' && sortDirection === 'asc'" :size="12" />
                <ArrowDown
                  v-else-if="sortKey === 'server' && sortDirection === 'desc'"
                  :size="12"
                />
                <ArrowUpDown v-else :size="12" />
              </button>
            </th>
            <th>角色名</th>
            <th :aria-sort="ariaSort('specialization')">
              <button
                class="sort-button"
                type="button"
                data-sort-key="specialization"
                title="按职业或心法排序"
                @click="emit('sort', 'specialization')"
              >
                职业 / 心法
                <ArrowUp
                  v-if="sortKey === 'specialization' && sortDirection === 'asc'"
                  :size="12"
                />
                <ArrowDown
                  v-else-if="sortKey === 'specialization' && sortDirection === 'desc'"
                  :size="12"
                />
                <ArrowUpDown v-else :size="12" />
              </button>
            </th>
            <th :aria-sort="ariaSort('gearScore')">
              <button
                class="sort-button"
                type="button"
                data-sort-key="gearScore"
                title="按装分排序"
                @click="emit('sort', 'gearScore')"
              >
                装分
                <ArrowUp v-if="sortKey === 'gearScore' && sortDirection === 'asc'" :size="12" />
                <ArrowDown
                  v-else-if="sortKey === 'gearScore' && sortDirection === 'desc'"
                  :size="12"
                />
                <ArrowUpDown v-else :size="12" />
              </button>
            </th>
            <th>账号</th>
            <th>密码</th>
            <th :aria-sort="ariaSort('currentScore')">
              <button
                class="sort-button"
                type="button"
                data-sort-key="currentScore"
                title="按当前分排序"
                @click="emit('sort', 'currentScore')"
              >
                当前分
                <ArrowUp v-if="sortKey === 'currentScore' && sortDirection === 'asc'" :size="12" />
                <ArrowDown
                  v-else-if="sortKey === 'currentScore' && sortDirection === 'desc'"
                  :size="12"
                />
                <ArrowUpDown v-else :size="12" />
              </button>
            </th>
            <th :aria-sort="ariaSort('highestScore')">
              <button
                class="sort-button"
                type="button"
                data-sort-key="highestScore"
                title="按最高分排序"
                @click="emit('sort', 'highestScore')"
              >
                最高分
                <ArrowUp v-if="sortKey === 'highestScore' && sortDirection === 'asc'" :size="12" />
                <ArrowDown
                  v-else-if="sortKey === 'highestScore' && sortDirection === 'desc'"
                  :size="12"
                />
                <ArrowUpDown v-else :size="12" />
              </button>
            </th>
            <th>更新日期</th>
            <th aria-label="操作" />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="profile in profiles"
            :key="profile.id"
            v-memo="[
              profile,
              revealedPasswords[profile.id],
              vaultUnlocked,
              selectedIdSet.has(profile.id),
              reorderEnabled,
              draggedId,
              dropTarget?.id,
              dropTarget?.placement,
            ]"
            :class="{
              'needs-review': profile.needsReview,
              'is-dragging': draggedId === profile.id,
              'is-drop-before': dropTarget?.id === profile.id && dropTarget.placement === 'before',
              'is-drop-after': dropTarget?.id === profile.id && dropTarget.placement === 'after',
            }"
            @dragover="dragOver(profile.id, $event)"
            @drop="dropOn(profile.id, $event)"
          >
            <td class="select-cell">
              <button
                class="drag-handle"
                type="button"
                :draggable="reorderEnabled"
                :disabled="!reorderEnabled"
                :title="
                  reorderEnabled
                    ? `拖动账号 ${profile.accountName} 调整顺序`
                    : reorderDisabledReason
                "
                :aria-label="`拖动账号 ${profile.accountName} 调整顺序`"
                @dragstart="startDrag(profile.id, $event)"
                @dragend="finishDrag"
                @click.stop
              >
                <GripVertical :size="13" />
              </button>
              <input
                type="checkbox"
                :checked="selectedIdSet.has(profile.id)"
                :aria-label="`选择账号 ${profile.accountName}`"
                @change="toggleOne(profile.id, $event)"
                @click.stop
              />
            </td>
            <td>
              <div class="contact-cell">
                <TriangleAlert v-if="profile.needsReview" :size="13" />
                <strong class="truncate">{{ profile.contactName || "待补充" }}</strong>
              </div>
            </td>
            <td class="truncate">{{ profile.server || "—" }}</td>
            <td class="truncate">{{ profile.characterName || "—" }}</td>
            <td class="truncate">{{ profile.specialization || "—" }}</td>
            <td class="mono-number">{{ profile.gearScore || "—" }}</td>
            <td>
              <div class="account-name-cell">
                <strong class="account-name truncate">{{ profile.accountName }}</strong>
                <button
                  class="icon-button"
                  type="button"
                  title="复制账号"
                  :aria-label="`复制账号 ${profile.accountName}`"
                  @click="emit('copyAccount', profile)"
                >
                  <Copy :size="12" />
                </button>
              </div>
            </td>
            <td>
              <div class="password-cell">
                <code class="truncate">{{ revealedPasswords[profile.id] || "••••••••••" }}</code>
                <button
                  class="icon-button"
                  type="button"
                  :disabled="!vaultUnlocked"
                  :title="revealedPasswords[profile.id] ? '隐藏密码' : '查看15秒'"
                  :aria-label="revealedPasswords[profile.id] ? '隐藏密码' : '查看密码15秒'"
                  @click="
                    revealedPasswords[profile.id] ? emit('hide', profile) : emit('reveal', profile)
                  "
                >
                  <EyeOff v-if="revealedPasswords[profile.id]" :size="13" />
                  <Eye v-else :size="13" />
                </button>
                <button
                  class="icon-button"
                  type="button"
                  :disabled="!vaultUnlocked"
                  title="复制密码"
                  aria-label="复制密码"
                  @click="emit('copy', profile)"
                >
                  <Copy :size="13" />
                </button>
              </div>
            </td>
            <td class="mono-number score-cell">{{ profile.currentScore ?? "—" }}</td>
            <td class="mono-number score-cell">{{ profile.highestScore ?? "—" }}</td>
            <td class="muted">
              {{ profile.scoreUpdatedAt ? formatShortDate(profile.scoreUpdatedAt) : "—" }}
            </td>
            <td>
              <div class="row-actions">
                <button
                  class="icon-button"
                  type="button"
                  title="编辑"
                  aria-label="编辑账号"
                  @click="emit('edit', profile)"
                >
                  <Pencil :size="14" />
                </button>
                <button
                  class="icon-button action-danger"
                  type="button"
                  :disabled="!vaultUnlocked"
                  :title="vaultUnlocked ? '删除' : '删除账号前需要解锁密码库'"
                  aria-label="删除账号"
                  @click="emit('delete', profile)"
                >
                  <Trash2 :size="14" />
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-else class="empty-state">没有符合条件的账号档案</div>
  </div>
</template>

<style scoped>
.account-table {
  flex: 1;
}

.account-table .data-table {
  min-width: 1048px;
}

.select-cell {
  display: flex;
  align-items: center;
  gap: 3px;
}

.drag-handle {
  display: grid;
  width: 22px;
  height: 26px;
  flex: 0 0 22px;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 5px;
  color: var(--ink-muted);
  background: transparent;
  cursor: grab;
}

.drag-handle:hover:not(:disabled),
.drag-handle:focus-visible {
  color: var(--brand);
  background: var(--brand-soft);
}

.drag-handle:active:not(:disabled) {
  cursor: grabbing;
}

.drag-handle:disabled {
  cursor: not-allowed;
  opacity: 0.3;
}

.sort-button {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 0;
  border: 0;
  color: inherit;
  background: transparent;
  font: inherit;
  cursor: pointer;
}

.sort-button svg {
  flex: 0 0 auto;
  color: var(--ink-muted);
  opacity: 0.72;
}

.sort-button:hover,
.sort-button:focus-visible {
  color: var(--brand-strong);
}

.sort-button:focus-visible {
  border-radius: 4px;
  outline: 2px solid color-mix(in srgb, var(--brand) 30%, transparent);
  outline-offset: 3px;
}

.account-table th[aria-sort="ascending"] .sort-button svg,
.account-table th[aria-sort="descending"] .sort-button svg {
  color: var(--brand);
  opacity: 1;
}

.needs-review {
  background: color-mix(in srgb, var(--amber-soft) 46%, var(--surface));
}

.contact-cell {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 5px;
}

.contact-cell svg {
  flex: 0 0 auto;
  color: var(--amber);
}

.contact-cell strong,
.account-name {
  display: block;
  color: var(--ink-strong);
  font-size: 12px;
  font-weight: 700;
}

.account-name-cell {
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(0, 1fr) 26px;
  align-items: center;
  gap: 2px;
}

.account-name-cell .icon-button {
  width: 26px;
  height: 26px;
}

.password-cell {
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(0, 1fr) 25px 25px;
  align-items: center;
  gap: 2px;
}

.password-cell code {
  display: block;
  color: var(--ink);
  font-family: "Cascadia Mono", monospace;
  font-size: 11px;
  letter-spacing: 0.025em;
}

.password-cell .icon-button,
.row-actions .icon-button {
  width: 28px;
  height: 28px;
  flex-basis: 28px;
}

.score-cell {
  color: var(--ink-strong);
  font-weight: 650;
}

.row-actions {
  display: flex;
  justify-content: flex-end;
}

.action-danger:hover {
  color: var(--accent);
  background: var(--accent-soft);
}

.account-table th:last-child,
.account-table td:last-child {
  position: sticky;
  z-index: 2;
  right: 0;
  background: var(--surface);
  box-shadow: -10px 0 18px rgba(28, 45, 38, 0.05);
}

.account-table th:last-child {
  z-index: 3;
  background: var(--surface-soft);
}

.account-table tr.needs-review td:last-child {
  background: color-mix(in srgb, var(--amber-soft) 46%, var(--surface));
}

.account-table tbody tr:hover td:last-child {
  background: var(--surface-soft);
}

.account-table tbody tr {
  transition:
    background-color 140ms ease,
    box-shadow 140ms ease;
}

.account-table tbody tr:hover {
  box-shadow: inset 3px 0 0 color-mix(in srgb, var(--brand) 72%, transparent);
}

.account-table tbody tr.is-dragging {
  opacity: 0.45;
}

.account-table tbody tr.is-drop-before {
  box-shadow: inset 0 3px 0 var(--brand);
}

.account-table tbody tr.is-drop-after {
  box-shadow: inset 0 -3px 0 var(--brand);
}
</style>
