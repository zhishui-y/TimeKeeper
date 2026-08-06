// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_FONT_FAMILY,
  DEFAULT_BASE_FONT_SIZE,
  applyAppearanceToDocument,
  normalizeAppearance,
} from "./appearance";

describe("appearance utilities", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("style");
    delete document.documentElement.dataset.fontFallback;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      font: "",
      measureText(text: string) {
        const installedFontOffset = this.font.includes('"SimSun"') ? 17 : 0;
        return { width: text.length * 10 + installedFontOffset } as TextMetrics;
      },
    } as CanvasRenderingContext2D);
  });

  it("normalizes a font and clamps the base size to the supported range", () => {
    expect(normalizeAppearance({ fontFamily: "  DengXian  ", baseFontSize: 99 })).toEqual({
      fontFamily: "DengXian",
      baseFontSize: 18,
    });
    expect(normalizeAppearance({ fontFamily: "", baseFontSize: 13 })).toEqual({
      fontFamily: DEFAULT_FONT_FAMILY,
      baseFontSize: 14,
    });
    expect(normalizeAppearance({ baseFontSize: Number.NaN })).toEqual({
      fontFamily: DEFAULT_FONT_FAMILY,
      baseFontSize: DEFAULT_BASE_FONT_SIZE,
    });
  });

  it("falls back atomically when the requested system font is unavailable", () => {
    const changed = vi.fn();
    window.addEventListener("timekeeper-appearance-changed", changed);

    const result = applyAppearanceToDocument({
      fontFamily: "Missing Font",
      baseFontSize: 17,
    });

    expect(result).toEqual({ effectiveFontFamily: DEFAULT_FONT_FAMILY, fallback: true });
    expect(document.documentElement.style.getPropertyValue("--app-font-family")).toBe(
      `"${DEFAULT_FONT_FAMILY}"`,
    );
    expect(document.documentElement.style.getPropertyValue("--app-base-font-size")).toBe("17px");
    expect(document.documentElement.style.getPropertyValue("--app-font-size-offset")).toBe("2px");
    expect(document.documentElement.dataset.fontFallback).toBe("true");
    expect(changed).toHaveBeenCalledTimes(1);
    window.removeEventListener("timekeeper-appearance-changed", changed);
  });

  it("keeps an installed font and publishes the normalized preview", () => {
    const result = applyAppearanceToDocument({ fontFamily: "SimSun", baseFontSize: 14.6 });

    expect(result).toEqual({ effectiveFontFamily: "SimSun", fallback: false });
    expect(document.documentElement.style.getPropertyValue("--app-font-family")).toBe('"SimSun"');
    expect(document.documentElement.style.getPropertyValue("--app-base-font-size")).toBe("15px");
    expect(document.documentElement.style.getPropertyValue("--app-font-size-offset")).toBe("0px");
    expect(document.documentElement.dataset.fontFallback).toBe("false");
  });
});
