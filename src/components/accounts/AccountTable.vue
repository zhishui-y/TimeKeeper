<script setup lang="ts">
import { Copy, Eye, EyeOff, Pencil, Trash2, TriangleAlert } from "@lucide/vue";
import type { AccountProfile } from "../../types/domain";
import { formatShortDate } from "../../utils/formatters";

defineProps<{
  profiles: readonly AccountProfile[];
  revealedPasswords: Readonly<Record<string, string>>;
  vaultUnlocked: boolean;
}>();

const emit = defineEmits<{
  edit: [profile: AccountProfile];
  reveal: [profile: AccountProfile];
  hide: [profile: AccountProfile];
  copy: [profile: AccountProfile];
  delete: [profile: AccountProfile];
}>();
</script>

<template>
  <div class="data-surface account-table">
    <div v-if="profiles.length" class="table-scroll">
      <table class="data-table">
        <colgroup>
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
            :class="{ 'needs-review': profile.needsReview }"
          >
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

.account-table .data-table {
  min-width: 990px;
}

.needs-review {
  background: #fffaf2;
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
  font-size: 11px;
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
  color: #4f5d58;
  font-family: "Cascadia Mono", monospace;
  font-size: 10px;
}

.password-cell .icon-button,
.row-actions .icon-button {
  width: 25px;
  height: 25px;
  flex-basis: 25px;
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
</style>
