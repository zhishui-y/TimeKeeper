<script setup lang="ts">
import {
  BookUser,
  CalendarDays,
  CircleDollarSign,
  Clock3,
  DatabaseBackup,
  LayoutDashboard,
  LockKeyhole,
} from "@lucide/vue";

const emit = defineEmits<{
  lock: [];
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

    <button class="sidebar__footer" type="button" title="锁定时约管家" @click="emit('lock')">
      <span class="access-dot" />
      <div>
        <strong>本次运行已解锁</strong>
        <span>点击立即锁定</span>
      </div>
      <LockKeyhole :size="14" />
    </button>
  </aside>
</template>

<style scoped>
.sidebar {
  position: relative;
  display: flex;
  width: 216px;
  height: 100%;
  flex: 0 0 216px;
  flex-direction: column;
  overflow: hidden;
  border-right: 1px solid rgba(8, 32, 25, 0.32);
  color: var(--sidebar-ink);
  background:
    radial-gradient(circle at 14% 8%, rgba(255, 245, 222, 0.08), transparent 25%),
    linear-gradient(180deg, var(--sidebar) 0%, var(--sidebar-strong) 100%);
  box-shadow: 8px 0 28px rgba(19, 45, 36, 0.08);
}

.sidebar::after {
  position: absolute;
  right: -72px;
  bottom: 90px;
  width: 170px;
  height: 170px;
  border: 1px solid rgba(245, 239, 226, 0.055);
  border-radius: 50%;
  box-shadow:
    0 0 0 24px rgba(245, 239, 226, 0.022),
    0 0 0 48px rgba(245, 239, 226, 0.014);
  content: "";
  pointer-events: none;
}

.brand {
  position: relative;
  z-index: 1;
  display: flex;
  height: 82px;
  flex: 0 0 82px;
  align-items: center;
  gap: 12px;
  padding: 0 20px;
  border-bottom: 1px solid rgba(244, 239, 226, 0.11);
}

.brand__seal {
  display: grid;
  width: 38px;
  height: 38px;
  flex: 0 0 38px;
  place-items: center;
  border: 1px solid rgba(255, 248, 235, 0.22);
  border-radius: 12px;
  color: #fff8eb;
  background: var(--accent);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.08),
    0 8px 18px rgba(10, 27, 22, 0.24);
  font-family: var(--font-serif);
  font-size: 21px;
  font-weight: 650;
}

.brand__copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.brand__copy strong {
  color: var(--sidebar-ink);
  font-family: var(--font-serif);
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0.06em;
}

.brand__copy span {
  color: var(--sidebar-muted);
  font-family: "Bahnschrift", var(--font-sans);
  font-size: 9px;
  letter-spacing: 0.18em;
}

.nav {
  position: relative;
  z-index: 1;
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 6px;
  padding: 20px 13px;
}

.nav__item {
  position: relative;
  display: flex;
  height: 43px;
  align-items: center;
  gap: 11px;
  padding: 0 13px;
  border: 1px solid transparent;
  border-radius: 11px;
  color: var(--sidebar-muted);
  font-size: 13px;
  font-weight: 620;
  letter-spacing: 0.02em;
  transition:
    border-color 150ms ease,
    color 150ms ease,
    background-color 150ms ease,
    transform 150ms ease;
}

.nav__item svg {
  flex: 0 0 auto;
  opacity: 0.88;
}

.nav__item:hover {
  border-color: rgba(245, 239, 226, 0.08);
  color: #fff9ee;
  background: rgba(245, 239, 226, 0.07);
  transform: translateX(2px);
}

.nav__item.router-link-active {
  border-color: rgba(245, 239, 226, 0.12);
  color: #fffaf0;
  background: rgba(245, 239, 226, 0.13);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

.nav__item.router-link-active::before {
  position: absolute;
  top: 10px;
  bottom: 10px;
  left: 0;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: #d98067;
  box-shadow: 0 0 12px rgba(217, 128, 103, 0.24);
  content: "";
}

.sidebar__footer {
  position: relative;
  z-index: 1;
  display: flex;
  min-height: 74px;
  align-items: center;
  gap: 10px;
  padding: 13px 18px;
  border: 0;
  border-top: 1px solid rgba(244, 239, 226, 0.1);
  color: inherit;
  background: rgba(7, 24, 19, 0.12);
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.sidebar__footer:hover {
  background: rgba(245, 239, 226, 0.07);
}

.sidebar__footer div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.sidebar__footer strong {
  color: #eae8dc;
  font-size: 11px;
  font-weight: 650;
}

.sidebar__footer span:not(.access-dot) {
  color: var(--sidebar-muted);
  font-size: 10px;
}

.access-dot {
  width: 8px;
  height: 8px;
  flex: 0 0 8px;
  border-radius: 50%;
  background: #83b99d;
  box-shadow: 0 0 0 4px rgba(131, 185, 157, 0.14);
}

.sidebar__footer > svg {
  margin-left: auto;
  color: var(--sidebar-muted);
}

@media (max-width: 1180px) {
  .sidebar {
    width: 184px;
    flex-basis: 184px;
  }

  .brand {
    height: 76px;
    flex-basis: 76px;
    gap: 10px;
    padding: 0 14px;
  }

  .brand__seal {
    width: 34px;
    height: 34px;
    flex-basis: 34px;
    border-radius: 10px;
    font-size: 19px;
  }

  .brand__copy strong {
    font-size: 15px;
  }

  .brand__copy span {
    font-size: 8px;
    letter-spacing: 0.14em;
  }

  .nav {
    padding: 16px 10px;
  }

  .nav__item {
    padding-inline: 11px;
  }

  .sidebar__footer {
    min-height: 68px;
    padding-inline: 14px;
  }
}
</style>
