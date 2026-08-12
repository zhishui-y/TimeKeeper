export const MAX_SAFE_AMOUNT_MINOR = Number.MAX_SAFE_INTEGER;

export function parseAmountMinor(value: string | number): number | null {
  const normalized = String(value).trim();
  if (!normalized) return null;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) throw new Error("账单金额最多保留两位小数");

  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? "").padEnd(2, "0"));
  const amountMinor = whole * 100n + fraction;
  if (amountMinor > BigInt(MAX_SAFE_AMOUNT_MINOR)) {
    throw new Error("账单金额超出安全范围");
  }
  return Number(amountMinor);
}

export function amountMinorInputValue(value?: number | null): string {
  if (value === null || value === undefined) return "";
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("账单金额数据超出安全范围");
  const whole = Math.floor(value / 100);
  const fraction = value % 100;
  if (fraction === 0) return String(whole);
  return `${whole}.${String(fraction).padStart(2, "0").replace(/0$/, "")}`;
}

export function isSafeAmountMinor(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_SAFE_AMOUNT_MINOR;
}
