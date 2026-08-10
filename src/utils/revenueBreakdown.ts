import type { RevenueBreakdownItem } from "../types/domain";

const OTHER_NAME = "其他";

function compareBreakdownItems(left: RevenueBreakdownItem, right: RevenueBreakdownItem) {
  return (
    right.amountMinor - left.amountMinor ||
    (left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
  );
}

export function compactRevenueBreakdownItems(
  items: readonly RevenueBreakdownItem[],
): RevenueBreakdownItem[] {
  const positiveItems = items.filter((item) => item.amountMinor > 0);
  const totalAmountMinor = positiveItems.reduce((total, item) => total + item.amountMinor, 0);

  if (totalAmountMinor === 0) return [];

  const visibleItems: RevenueBreakdownItem[] = [];
  let otherAmountMinor = 0;
  let otherAppointmentCount = 0;

  for (const item of positiveItems) {
    if (item.name === OTHER_NAME || item.amountMinor * 100 < totalAmountMinor) {
      otherAmountMinor += item.amountMinor;
      otherAppointmentCount += item.appointmentCount;
      continue;
    }

    visibleItems.push({ ...item });
  }

  if (otherAmountMinor > 0) {
    visibleItems.push({
      name: OTHER_NAME,
      amountMinor: otherAmountMinor,
      appointmentCount: otherAppointmentCount,
    });
  }

  return visibleItems.sort(compareBreakdownItems);
}
