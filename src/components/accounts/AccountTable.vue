<script setup lang="ts">
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ClipboardCopy,
  Copy,
  GripVertical,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Trash2,
  TriangleAlert,
} from "@lucide/vue";
import { computed, shallowRef, useTemplateRef, watch } from "vue";
import type { AccountProfile, AccountTableColumnWidths } from "../../types/domain";
import {
  accountTableTotalWidth,
  type AccountTableColumnKey,
} from "../../utils/accountTableColumns";
import type {
  AccountDropPlacement,
  AccountProfileSortKey,
  SortDirection,
} from "../../utils/accounts";
import { formatShortDate } from "../../utils/formatters";
import AccountColumnResizeHandle from "./AccountColumnResizeHandle.vue";

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

const props = withDefaults(
  defineProps<{
    profiles: readonly AccountProfile[];
    sortKey: AccountProfileSortKey | null;
    sortDirection: SortDirection;
    reorderEnabled: boolean;
    reorderDisabledReason: string;
    usageDrafts: Readonly<Record<string, string>>;
    savingUsageIds: ReadonlySet<string>;
    columnWidths: AccountTableColumnWidths;
    savingColumnWidths: boolean;
    clearingWeekly: boolean;
    roleRefreshBusy?: boolean;
    refreshingIds?: ReadonlySet<string>;
  }>(),
  {
    roleRefreshBusy: false,
    refreshingIds: () => new Set<string>(),
  },
);
const selectedIds = defineModel<string[]>("selectedIds", { required: true });

const emit = defineEmits<{
  edit: [profile: AccountProfile];
  copy: [profile: AccountProfile];
  copyAccount: [profile: AccountProfile];
  copyCharacterName: [profile: AccountProfile];
  delete: [profile: AccountProfile];
  refreshRoleData: [profile: AccountProfile];
  updateUsageDraft: [profileId: string, value: string];
  saveUsage: [profile: AccountProfile, value: string];
  cancelUsage: [profile: AccountProfile];
  previewColumnWidth: [columnKey: AccountTableColumnKey, width: number];
  commitColumnWidth: [columnKey: AccountTableColumnKey, width: number];
  cancelColumnResize: [columnKey: AccountTableColumnKey, width: number];
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
const tableMinimumWidth = computed(() => accountTableTotalWidth(props.columnWidths));

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

function inputValue(event: unknown): string {
  return (event as { target?: { value?: string } } | null)?.target?.value ?? "";
}

function cancelUsage(profile: AccountProfile, event: unknown): void {
  emit("cancelUsage", profile);
  (event as { target?: { blur?: () => void } } | null)?.target?.blur?.();
}

function previewColumnWidth(columnKey: AccountTableColumnKey, width: number): void {
  emit("previewColumnWidth", columnKey, width);
}

function commitColumnWidth(columnKey: AccountTableColumnKey, width: number): void {
  emit("commitColumnWidth", columnKey, width);
}

function cancelColumnResize(columnKey: AccountTableColumnKey, width: number): void {
  emit("cancelColumnResize", columnKey, width);
}
</script>

<template>
  <div class="data-surface account-table">
    <div v-if="profiles.length" class="table-scroll">
      <table class="data-table" :style="{ minWidth: `${tableMinimumWidth}px` }">
        <colgroup>
          <col style="width: 58px" />
          <col :style="{ width: `${columnWidths.contactName}px` }" />
          <col :style="{ width: `${columnWidths.server}px` }" />
          <col :style="{ width: `${columnWidths.characterName}px` }" />
          <col :style="{ width: `${columnWidths.specialization}px` }" />
          <col :style="{ width: `${columnWidths.gearScore}px` }" />
          <col :style="{ width: `${columnWidths.accountName}px` }" />
          <col :style="{ width: `${columnWidths.password}px` }" />
          <col :style="{ width: `${columnWidths.currentScore}px` }" />
          <col :style="{ width: `${columnWidths.highestScore}px` }" />
          <col :style="{ width: `${columnWidths.scoreUpdatedAt}px` }" />
          <col :style="{ width: `${columnWidths.weekly}px` }" />
          <col :style="{ width: `${columnWidths.notes}px` }" />
          <col style="width: 108px" />
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
            <th class="resizable-header" :aria-sort="ariaSort('contactName')">
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
              <AccountColumnResizeHandle
                column-key="contactName"
                label="联系人"
                :width="columnWidths.contactName"
                :disabled="savingColumnWidths"
                @preview="previewColumnWidth"
                @commit="commitColumnWidth"
                @cancel="cancelColumnResize"
              />
            </th>
            <th class="resizable-header" :aria-sort="ariaSort('server')">
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
              <AccountColumnResizeHandle
                column-key="server"
                label="服务器"
                :width="columnWidths.server"
                :disabled="savingColumnWidths"
                @preview="previewColumnWidth"
                @commit="commitColumnWidth"
                @cancel="cancelColumnResize"
              />
            </th>
            <th class="resizable-header">
              角色名
              <AccountColumnResizeHandle
                column-key="characterName"
                label="角色名"
                :width="columnWidths.characterName"
                :disabled="savingColumnWidths"
                @preview="previewColumnWidth"
                @commit="commitColumnWidth"
                @cancel="cancelColumnResize"
              />
            </th>
            <th class="resizable-header" :aria-sort="ariaSort('specialization')">
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
              <AccountColumnResizeHandle
                column-key="specialization"
                label="职业 / 心法"
                :width="columnWidths.specialization"
                :disabled="savingColumnWidths"
                @preview="previewColumnWidth"
                @commit="commitColumnWidth"
                @cancel="cancelColumnResize"
              />
            </th>
            <th class="resizable-header" :aria-sort="ariaSort('gearScore')">
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
              <AccountColumnResizeHandle
                column-key="gearScore"
                label="装分"
                :width="columnWidths.gearScore"
                :disabled="savingColumnWidths"
                @preview="previewColumnWidth"
                @commit="commitColumnWidth"
                @cancel="cancelColumnResize"
              />
            </th>
            <th class="resizable-header">
              账号
              <AccountColumnResizeHandle
                column-key="accountName"
                label="账号"
                :width="columnWidths.accountName"
                :disabled="savingColumnWidths"
                @preview="previewColumnWidth"
                @commit="commitColumnWidth"
                @cancel="cancelColumnResize"
              />
            </th>
            <th class="resizable-header">
              密码
              <AccountColumnResizeHandle
                column-key="password"
                label="密码"
                :width="columnWidths.password"
                :disabled="savingColumnWidths"
                @preview="previewColumnWidth"
                @commit="commitColumnWidth"
                @cancel="cancelColumnResize"
              />
            </th>
            <th class="resizable-header" :aria-sort="ariaSort('currentScore')">
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
              <AccountColumnResizeHandle
                column-key="currentScore"
                label="当前分"
                :width="columnWidths.currentScore"
                :disabled="savingColumnWidths"
                @preview="previewColumnWidth"
                @commit="commitColumnWidth"
                @cancel="cancelColumnResize"
              />
            </th>
            <th class="resizable-header" :aria-sort="ariaSort('highestScore')">
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
              <AccountColumnResizeHandle
                column-key="highestScore"
                label="最高分"
                :width="columnWidths.highestScore"
                :disabled="savingColumnWidths"
                @preview="previewColumnWidth"
                @commit="commitColumnWidth"
                @cancel="cancelColumnResize"
              />
            </th>
            <th class="resizable-header">
              更新日期
              <AccountColumnResizeHandle
                column-key="scoreUpdatedAt"
                label="更新日期"
                :width="columnWidths.scoreUpdatedAt"
                :disabled="savingColumnWidths"
                @preview="previewColumnWidth"
                @commit="commitColumnWidth"
                @cancel="cancelColumnResize"
              />
            </th>
            <th class="resizable-header">
              本周
              <AccountColumnResizeHandle
                column-key="weekly"
                label="本周"
                :width="columnWidths.weekly"
                :disabled="savingColumnWidths"
                @preview="previewColumnWidth"
                @commit="commitColumnWidth"
                @cancel="cancelColumnResize"
              />
            </th>
            <th class="resizable-header">
              备注
              <AccountColumnResizeHandle
                column-key="notes"
                label="备注"
                :width="columnWidths.notes"
                :disabled="savingColumnWidths"
                @preview="previewColumnWidth"
                @commit="commitColumnWidth"
                @cancel="cancelColumnResize"
              />
            </th>
            <th aria-label="操作" />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="profile in profiles"
            :key="profile.id"
            v-memo="[
              profile,
              selectedIdSet.has(profile.id),
              reorderEnabled,
              draggedId,
              dropTarget?.id,
              dropTarget?.placement,
              usageDrafts[profile.id],
              savingUsageIds.has(profile.id),
              clearingWeekly,
              roleRefreshBusy,
              refreshingIds.has(profile.id),
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
            <td class="truncate">
              <button
                v-if="profile.characterName"
                class="character-name-copy"
                type="button"
                :title="`复制角色名 ${profile.characterName}`"
                :aria-label="`复制角色名 ${profile.characterName}`"
                @click.stop="emit('copyCharacterName', profile)"
              >
                {{ profile.characterName }}
              </button>
              <span v-else>—</span>
            </td>
            <td class="truncate">{{ profile.specialization || "—" }}</td>
            <td class="mono-number">{{ profile.gearScore || "—" }}</td>
            <td class="copy-cell">
              <button
                class="icon-button copy-button"
                type="button"
                title="复制账号"
                :aria-label="`复制账号 ${profile.accountName}`"
                @click="emit('copyAccount', profile)"
              >
                <Copy :size="15" />
              </button>
            </td>
            <td class="copy-cell">
              <button
                class="icon-button copy-button"
                type="button"
                :disabled="!profile.password"
                :title="profile.password ? `复制${profile.accountName} 的密码` : '未保存账号密码'"
                :aria-label="`复制${profile.accountName} 的密码`"
                @click="emit('copy', profile)"
              >
                <ClipboardCopy :size="15" />
              </button>
            </td>
            <td class="mono-number score-cell">{{ profile.currentScore ?? "—" }}</td>
            <td class="mono-number score-cell">{{ profile.highestScore ?? "—" }}</td>
            <td class="muted">
              {{ profile.scoreUpdatedAt ? formatShortDate(profile.scoreUpdatedAt) : "—" }}
            </td>
            <td class="usage-cell">
              <input
                class="usage-input"
                type="text"
                :value="usageDrafts[profile.id] ?? ''"
                :disabled="savingUsageIds.has(profile.id) || clearingWeekly"
                :aria-busy="savingUsageIds.has(profile.id) || clearingWeekly"
                :aria-label="`编辑本周 ${profile.accountName}`"
                :title="usageDrafts[profile.id] || undefined"
                @input="emit('updateUsageDraft', profile.id, inputValue($event))"
                @keydown.enter.prevent="emit('saveUsage', profile, usageDrafts[profile.id] ?? '')"
                @keydown.esc.prevent="cancelUsage(profile, $event)"
                @blur="emit('saveUsage', profile, usageDrafts[profile.id] ?? '')"
              />
            </td>
            <td
              class="notes-cell truncate"
              :class="{ muted: !profile.notes }"
              :title="profile.notes || undefined"
            >
              {{ profile.notes || "—" }}
            </td>
            <td>
              <div class="row-actions">
                <button
                  class="icon-button"
                  type="button"
                  :disabled="roleRefreshBusy"
                  :title="refreshingIds.has(profile.id) ? '正在更新角色数据' : '更新角色数据'"
                  :aria-label="`更新角色数据 ${profile.accountName}`"
                  :aria-busy="refreshingIds.has(profile.id)"
                  @click="emit('refreshRoleData', profile)"
                >
                  <LoaderCircle
                    v-if="refreshingIds.has(profile.id)"
                    class="role-refresh-spinner"
                    :size="14"
                  />
                  <RefreshCw v-else :size="14" />
                </button>
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
                  title="删除"
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

.role-refresh-spinner {
  animation: role-refresh-spin 0.9s linear infinite;
}

@keyframes role-refresh-spin {
  to {
    transform: rotate(360deg);
  }
}

.resizable-header {
  position: sticky;
  overflow: hidden;
  white-space: nowrap;
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
  max-width: calc(100% - 6px);
  align-items: center;
  gap: 3px;
  padding: 0;
  overflow: hidden;
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

.contact-cell strong {
  display: block;
  color: var(--ink-strong);
  font-size: 12px;
  font-weight: 700;
}

.character-name-copy {
  max-width: 100%;
  padding: 2px 4px;
  overflow: hidden;
  border: 0;
  border-radius: 4px;
  color: var(--brand-strong);
  background: transparent;
  font: inherit;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: copy;
}

.character-name-copy:hover,
.character-name-copy:focus-visible {
  background: var(--brand-soft);
  outline: none;
}

.account-table .copy-cell {
  padding-inline: 6px;
  text-align: center;
}

.account-table .copy-button {
  width: 28px;
  height: 28px;
  margin-inline: auto;
}

.usage-cell {
  padding-inline: 6px;
}

.usage-input {
  width: 100%;
  height: 28px;
  padding: 0 7px;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--ink);
  background: transparent;
  font: inherit;
  text-overflow: ellipsis;
}

.usage-input:hover:not(:disabled) {
  border-color: var(--line);
  background: var(--surface);
}

.usage-input:focus {
  border-color: var(--brand-border);
  outline: 2px solid color-mix(in srgb, var(--brand) 18%, transparent);
  outline-offset: 1px;
  background: var(--surface);
}

.usage-input:disabled {
  cursor: wait;
  opacity: 0.58;
}

.notes-cell {
  max-width: 0;
}

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

.account-table tbody tr.needs-review:hover,
.account-table tbody tr.needs-review:hover td:last-child {
  background: color-mix(in srgb, var(--amber-soft) 46%, var(--surface));
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
