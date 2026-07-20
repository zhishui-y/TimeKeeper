<script setup lang="ts">
import {
  BookUser,
  CalendarDays,
  CircleDollarSign,
  Clock3,
  DatabaseBackup,
  LayoutDashboard,
} from "@lucide/vue";

defineProps<{
  vaultUnlocked: boolean;
}>();

const navigation = [
  { name: "today", label: "今日", icon: LayoutDashboard },
  { name: "calendar", label: "排班日历", icon: CalendarDays },
  { name: "appointments", label: "预约记录", icon: Clock3 },
  { name: "accounts", label: "账号档案", icon: BookUser },
  { name: "revenue", label: "收益总结", icon: CircleDollarSign },
  { name: "settings", label: "数据与设置", icon: DatabaseBackup },
] as const;
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <div class="brand__seal" aria-hidden="true">时</div>
      <div class="brand__copy">
        <strong>时约管家</strong>
        <span>TIMEKEEPER</span>
      </div>
    </div>

    <nav class="nav" aria-label="主导航">
      <RouterLink
        v-for="item in navigation"
        :key="item.name"
        class="nav__item"
        :to="{ name: item.name }"
      >
        <component :is="item.icon" :size="17" :stroke-width="1.8" />
        <span>{{ item.label }}</span>
      </RouterLink>
    </nav>

    <div class="sidebar__footer">
      <span class="vault-dot" :class="{ 'is-unlocked': vaultUnlocked }" />
      <div>
        <strong>{{ vaultUnlocked ? "密码库已解锁" : "密码库已锁定" }}</strong>
        <span>本地加密存储</span>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex;
  width: 206px;
  height: 100%;
  flex: 0 0 206px;
  flex-direction: column;
  border-right: 1px solid #d5dbd5;
  background: #f4f6f2;
}

.brand {
  display: flex;
  height: 78px;
  align-items: center;
  gap: 11px;
  padding: 0 20px;
  border-bottom: 1px solid var(--line);
}

.brand__seal {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  place-items: center;
  border-radius: 4px;
  color: #fff;
  background: var(--brand);
  font-family: "STSong", "SimSun", serif;
  font-size: 19px;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18);
}

.brand__copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.brand__copy strong {
  color: var(--ink-strong);
  font-size: 15px;
  font-weight: 750;
}

.brand__copy span {
  color: var(--ink-muted);
  font-family: "Bahnschrift", sans-serif;
  font-size: 10px;
  letter-spacing: 0;
}

.nav {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 4px;
  padding: 16px 12px;
}

.nav__item {
  position: relative;
  display: flex;
  height: 40px;
  align-items: center;
  gap: 11px;
  padding: 0 12px;
  border-radius: 5px;
  color: var(--ink-muted);
  font-size: 14px;
  font-weight: 620;
  transition:
    color 130ms ease,
    background-color 130ms ease;
}

.nav__item:hover {
  color: var(--ink-strong);
  background: #e9ede8;
}

.nav__item.router-link-active {
  color: var(--brand-strong);
  background: var(--brand-soft);
}

.nav__item.router-link-active::before {
  position: absolute;
  top: 9px;
  bottom: 9px;
  left: -12px;
  width: 3px;
  border-radius: 0 2px 2px 0;
  background: var(--brand);
  content: "";
}

.sidebar__footer {
  display: flex;
  min-height: 66px;
  align-items: center;
  gap: 9px;
  padding: 12px 18px;
  border-top: 1px solid var(--line);
}

.sidebar__footer div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.sidebar__footer strong {
  color: var(--ink);
  font-size: 12px;
}

.sidebar__footer span:not(.vault-dot) {
  color: var(--ink-muted);
  font-size: 11px;
}

.vault-dot {
  width: 8px;
  height: 8px;
  flex: 0 0 8px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}

.vault-dot.is-unlocked {
  background: var(--brand);
  box-shadow: 0 0 0 3px var(--brand-soft);
}

@media (max-width: 1180px) {
  .sidebar {
    width: 178px;
    flex-basis: 178px;
  }

  .brand {
    padding: 0 16px;
  }
}
</style>
