<script setup lang="ts">
import { computed, type CSSProperties, type DeepReadonly } from "vue";
import type { RevenueAnalyticsReport, RevenueBreakdownItem } from "../../../types/domain";
import { formatCurrency } from "../../../utils/formatters";
import {
  compactRevenueAnalyticsContacts,
  formatBusinessHours,
} from "../../../utils/revenueAnalytics";

const props = defineProps<{
  report: DeepReadonly<RevenueAnalyticsReport>;
}>();

const contactRows = computed(() => compactRevenueAnalyticsContacts(props.report.contacts));
const maximumPaymentAmount = computed(() =>
  Math.max(0, ...props.report.paymentMethods.map((item) => item.amountMinor)),
);

function paymentStyle(item: DeepReadonly<RevenueBreakdownItem>): CSSProperties {
  const percent =
    maximumPaymentAmount.value > 0 ? (item.amountMinor / maximumPaymentAmount.value) * 100 : 0;
  return { width: `${percent}%` };
}
</script>

<template>
  <section class="contribution-report" aria-labelledby="contribution-report-title">
    <header>
      <div>
        <span class="section-kicker">CONTRIBUTION</span>
        <h3 id="contribution-report-title">顾客贡献与收款方式</h3>
      </div>
      <span>顾客按已结收益排序，最多单列前 10 位</span>
    </header>

    <div class="contribution-report__body">
      <div class="contribution-report__contacts">
        <div class="contribution-report__subheading">
          <strong>顾客贡献榜</strong>
          <span>{{ report.contacts.length }} 位顾客</span>
        </div>
        <div v-if="contactRows.length" class="contribution-report__table-scroll">
          <table>
            <caption class="sr-only">
              顾客已结收益贡献、预约数、工时和平均客单价
            </caption>
            <thead>
              <tr>
                <th scope="col">顾客</th>
                <th scope="col">已结贡献</th>
                <th scope="col">占比</th>
                <th scope="col">预约</th>
                <th scope="col">完成工时</th>
                <th scope="col">平均客单</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="contact in contactRows" :key="contact.name">
                <th scope="row">{{ contact.name }}</th>
                <td class="mono-number contribution-report__money">
                  {{ formatCurrency(contact.settledMinor) }}
                </td>
                <td class="mono-number">{{ (contact.revenueShareBps / 100).toFixed(1) }}%</td>
                <td class="mono-number">{{ contact.appointmentCount }} 场</td>
                <td class="mono-number">{{ formatBusinessHours(contact.businessMinutes) }}</td>
                <td class="mono-number">{{ formatCurrency(contact.averageTicketMinor) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="contribution-report__empty">当前范围没有顾客贡献数据</p>
      </div>

      <aside class="contribution-report__payments" aria-label="收款方式分布">
        <div class="contribution-report__subheading">
          <strong>收款方式</strong>
          <span>仅统计已结收益</span>
        </div>
        <div v-if="report.paymentMethods.length" class="contribution-report__payment-list">
          <article v-for="item in report.paymentMethods" :key="item.name">
            <div>
              <strong>{{ item.name }}</strong>
              <span class="mono-number">{{ formatCurrency(item.amountMinor) }}</span>
            </div>
            <div class="contribution-report__payment-bar" aria-hidden="true">
              <span :style="paymentStyle(item)" />
            </div>
            <small>{{ item.appointmentCount }} 笔已结预约</small>
          </article>
        </div>
        <p v-else class="contribution-report__empty">当前范围没有已结收款记录</p>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.contribution-report {
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg, 16px);
  background: var(--surface);
  box-shadow: var(--shadow-soft);
}

.contribution-report > header {
  display: flex;
  min-height: 62px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 16px;
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--surface-soft) 78%, transparent);
}

.contribution-report h3 {
  margin-top: 2px;
  color: var(--ink-strong);
  font-family: var(--font-serif, "Noto Serif SC", serif);
  font-size: calc(16px + var(--app-font-size-offset, 0px));
}

.contribution-report > header > span,
.contribution-report__subheading span {
  color: var(--ink-muted);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.contribution-report__body {
  display: grid;
  grid-template-columns: minmax(0, 1.8fr) minmax(250px, 0.8fr);
  gap: 0;
}

.contribution-report__contacts,
.contribution-report__payments {
  min-width: 0;
  padding: 14px 16px 16px;
}

.contribution-report__payments {
  border-left: 1px solid var(--line);
}

.contribution-report__subheading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 9px;
}

.contribution-report__subheading strong {
  color: var(--ink-strong);
  font-size: calc(13px + var(--app-font-size-offset, 0px));
}

.contribution-report__table-scroll {
  overflow-x: auto;
}

.contribution-report table {
  width: 100%;
  min-width: 650px;
  border-collapse: collapse;
  color: var(--ink-muted);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.contribution-report th,
.contribution-report td {
  padding: 9px 8px;
  border-bottom: 1px solid var(--line);
  text-align: right;
  white-space: nowrap;
}

.contribution-report th:first-child {
  text-align: left;
}

.contribution-report tbody th {
  color: var(--ink-strong);
}

.contribution-report__money {
  color: var(--brand-strong);
  font-weight: 700;
}

.contribution-report__payment-list {
  display: grid;
  gap: 11px;
}

.contribution-report__payment-list article {
  display: grid;
  gap: 5px;
}

.contribution-report__payment-list article > div:first-child {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--ink-strong);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.contribution-report__payment-list article > div:first-child span {
  color: var(--brand-strong);
  font-weight: 700;
}

.contribution-report__payment-bar {
  height: 8px;
  overflow: hidden;
  border-radius: 99px;
  background: var(--brand-soft);
}

.contribution-report__payment-bar span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--brand);
}

.contribution-report__payment-list small,
.contribution-report__empty {
  color: var(--ink-muted);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.contribution-report__empty {
  padding: 24px 0;
  text-align: center;
}

@media (max-width: 980px) {
  .contribution-report__body {
    grid-template-columns: 1fr;
  }

  .contribution-report__payments {
    border-top: 1px solid var(--line);
    border-left: 0;
  }
}
</style>
