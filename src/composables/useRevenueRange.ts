import { computed, readonly, shallowRef } from "vue";
import type { ReportGranularity } from "../types/domain";
import {
  isRevenueDate,
  isRevenueRange,
  revenueNaturalRange,
  shiftRevenueRange,
  type RevenuePeriodRange,
  type RevenueRangeKind,
} from "../utils/revenue";

export type RevenueCustomDateField = "from" | "to";

export interface UseRevenueRangeOptions {
  referenceDate?: Date;
}

function copyRange(range: RevenuePeriodRange): RevenuePeriodRange {
  return { from: range.from, to: range.to };
}

export function useRevenueRange(options: UseRevenueRangeOptions = {}) {
  const referenceDate = new Date(options.referenceDate ?? new Date());
  const initialRange = revenueNaturalRange("week", referenceDate);
  const rangeKind = shallowRef<RevenueRangeKind>("week");
  const appliedRange = shallowRef<RevenuePeriodRange>(initialRange);
  const resolvedAllRange = shallowRef<RevenuePeriodRange | null>(null);
  const customDraft = shallowRef<RevenuePeriodRange>(copyRange(initialRange));
  const customError = shallowRef<string | null>(null);
  const granularity = shallowRef<ReportGranularity>("day");

  const requestRange = computed<RevenuePeriodRange>(() =>
    rangeKind.value === "all" ? { from: "", to: "" } : appliedRange.value,
  );
  const displayRange = computed<RevenuePeriodRange | null>(() =>
    rangeKind.value === "all" ? resolvedAllRange.value : appliedRange.value,
  );
  const isCurrentPeriod = computed(() => {
    if (rangeKind.value !== "week" && rangeKind.value !== "month") return false;
    const current = revenueNaturalRange(rangeKind.value, referenceDate);
    return appliedRange.value.from === current.from && appliedRange.value.to === current.to;
  });

  function validateAndApplyCustomDraft(): void {
    const draft = customDraft.value;
    if (!draft.from || !draft.to) {
      customError.value = "请选择完整的开始和结束日期";
      return;
    }
    if (!isRevenueDate(draft.from) || !isRevenueDate(draft.to)) {
      customError.value = "请输入有效的开始和结束日期";
      return;
    }
    if (draft.from > draft.to) {
      customError.value = "开始日期不能晚于结束日期";
      return;
    }

    appliedRange.value = copyRange(draft);
    customError.value = null;
  }

  function selectRange(kind: RevenueRangeKind): void {
    if (kind === "custom") {
      if (rangeKind.value === "custom") return;
      const seed =
        rangeKind.value === "all"
          ? (resolvedAllRange.value ?? appliedRange.value)
          : appliedRange.value;
      customDraft.value = copyRange(seed);
      appliedRange.value = copyRange(seed);
      customError.value = null;
      rangeKind.value = kind;
      return;
    }

    customError.value = null;
    rangeKind.value = kind;
    if (kind === "week" || kind === "month") {
      appliedRange.value = revenueNaturalRange(kind, referenceDate);
    }
  }

  function navigatePeriod(offset: -1 | 1): void {
    const kind = rangeKind.value;
    if (kind !== "week" && kind !== "month") return;
    const nextRange = shiftRevenueRange(appliedRange.value.from, kind, offset);
    if (nextRange) appliedRange.value = nextRange;
  }

  function returnToCurrentPeriod(): void {
    const kind = rangeKind.value;
    if (kind !== "week" && kind !== "month") return;
    appliedRange.value = revenueNaturalRange(kind, referenceDate);
  }

  function updateCustomDate(field: RevenueCustomDateField, value: string): void {
    customDraft.value = { ...customDraft.value, [field]: value };
    validateAndApplyCustomDraft();
  }

  function resolveAllRange(range: RevenuePeriodRange): boolean {
    if (!isRevenueRange(range)) return false;
    resolvedAllRange.value = copyRange(range);
    return true;
  }

  function setGranularity(value: ReportGranularity): void {
    granularity.value = value;
  }

  return {
    rangeKind: readonly(rangeKind),
    appliedRange: readonly(appliedRange),
    resolvedAllRange: readonly(resolvedAllRange),
    displayRange: readonly(displayRange),
    requestRange: readonly(requestRange),
    customDraft: readonly(customDraft),
    customError: readonly(customError),
    granularity: readonly(granularity),
    isCurrentPeriod: readonly(isCurrentPeriod),
    selectRange,
    navigatePeriod,
    returnToCurrentPeriod,
    updateCustomDate,
    resolveAllRange,
    setGranularity,
  };
}
