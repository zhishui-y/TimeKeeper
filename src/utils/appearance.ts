import type { AppearanceSettings } from "../types/domain";

export const DEFAULT_FONT_FAMILY = "Microsoft YaHei UI";
export const DEFAULT_BASE_FONT_SIZE = 15;

export const FONT_PRESETS = [
  { label: "微软雅黑 UI", value: "Microsoft YaHei UI" },
  { label: "等线", value: "DengXian" },
  { label: "思源黑体", value: "Source Han Sans CN" },
  { label: "宋体阅读", value: "SimSun" },
] as const;

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  fontFamily: DEFAULT_FONT_FAMILY,
  baseFontSize: DEFAULT_BASE_FONT_SIZE,
};

export function normalizeAppearance(input: Partial<AppearanceSettings>): AppearanceSettings {
  const baseFontSize = Number(input.baseFontSize);
  return {
    fontFamily: input.fontFamily?.trim() || DEFAULT_FONT_FAMILY,
    baseFontSize: Number.isFinite(baseFontSize)
      ? Math.min(18, Math.max(14, Math.round(baseFontSize)))
      : DEFAULT_BASE_FONT_SIZE,
  };
}

function safeFontFamily(family: string): string {
  return family.replace(/["\\\r\n]/g, "");
}

function canUseFont(family: string, size: number): boolean {
  if (family === DEFAULT_FONT_FAMILY || typeof document === "undefined") return true;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return document.fonts?.check?.(`${size}px "${safeFontFamily(family)}"`) ?? true;

  const sample = "mmmmmmmmmmWWWW天地玄黄0123456789";
  return ["monospace", "serif", "sans-serif"].some((fallback) => {
    context.font = `${size}px ${fallback}`;
    const fallbackWidth = context.measureText(sample).width;
    context.font = `${size}px "${safeFontFamily(family)}", ${fallback}`;
    return context.measureText(sample).width !== fallbackWidth;
  });
}

export function applyAppearanceToDocument(appearance: AppearanceSettings): {
  effectiveFontFamily: string;
  fallback: boolean;
} {
  const normalized = normalizeAppearance(appearance);
  const fallback = !canUseFont(normalized.fontFamily, normalized.baseFontSize);
  const effectiveFontFamily = fallback ? DEFAULT_FONT_FAMILY : normalized.fontFamily;
  const root = document.documentElement;
  root.style.setProperty("--app-font-family", `"${safeFontFamily(effectiveFontFamily)}"`);
  root.style.setProperty("--app-base-font-size", `${normalized.baseFontSize}px`);
  root.style.setProperty(
    "--app-font-size-offset",
    `${normalized.baseFontSize - DEFAULT_BASE_FONT_SIZE}px`,
  );
  root.dataset.fontFallback = fallback ? "true" : "false";
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("timekeeper-appearance-changed", { detail: normalized }));
  }
  return { effectiveFontFamily, fallback };
}
