<script setup lang="ts">
import { Copy, Eye, EyeOff, Pencil, Trash2, TriangleAlert } from "@lucide/vue";
import { computed, useTemplateRef, watch } from "vue";
import type { AccountProfile } from "../../types/domain";
import { formatShortDate } from "../../utils/formatters";

const props = defineProps<{
  profiles: readonly AccountProfile[];
  revealedPasswords: Readonly<Record<string, string>>;
  vaultUnlocked: boolean;
}>();
const selectedIds = defineModel<string[]>("selectedIds", { required: true });

const emit = defineEmits<{
  edit: [profile: AccountProfile];
  reveal: [profile: AccountProfile];
  hide: [profile: AccountProfile];
  copy: [profile: AccountProfile];
  delete: [profile: AccountProfile];
}>();

const allSelectRef = useTemplateRef("all-select");
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
</script>

<template>
  <div class="data-surface account-table">
    <div v-if="profiles.length" class="table-scroll">
      <table class="data-table">
        <colgroup>
          <col style="width: 44px" />
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
            <th>联系人</th>
            <th>服务器</th>
            <th>角色名</th>
            <th>职业 / 心法</th>
            <th>装分</th>
            <th>账号</th>
            <th>密码</th>
            <th>当前分</th>
            <th>最高分</th>
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
            ]"
            :class="{ 'needs-review': profile.needsReview }"
          >
            <td>
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
              <strong class="account-name truncate">{{ profile.accountName }}</strong>
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
  min-width: 1034px;
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
</style>
