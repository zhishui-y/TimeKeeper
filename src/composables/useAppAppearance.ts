import { readonly, shallowRef } from "vue";
import { api, errorMessage } from "../api/client";
import type { AppSettings, AppearanceSettings } from "../types/domain";
import {
  DEFAULT_APPEARANCE,
  applyAppearanceToDocument,
  normalizeAppearance,
} from "../utils/appearance";

const savedAppearance = shallowRef<AppearanceSettings>({ ...DEFAULT_APPEARANCE });
const activeAppearance = shallowRef<AppearanceSettings>({ ...DEFAULT_APPEARANCE });
const loaded = shallowRef(false);
const fallbackMessage = shallowRef<string | null>(null);
let loadRequest: Promise<void> | null = null;

function apply(next: Partial<AppearanceSettings>): AppearanceSettings {
  const normalized = normalizeAppearance(next);
  const result = applyAppearanceToDocument(normalized);
  activeAppearance.value = {
    ...normalized,
    fontFamily: result.effectiveFontFamily,
  };
  fallbackMessage.value = result.fallback
    ? `未检测到“${normalized.fontFamily}”，已暂时回退到微软雅黑 UI`
    : null;
  return normalized;
}

export function useAppAppearance() {
  async function load(): Promise<void> {
    if (loadRequest) return loadRequest;
    loadRequest = api
      .getAppAppearance()
      .then((next) => {
        const normalized = normalizeAppearance(next);
        savedAppearance.value = normalized;
        apply(normalized);
      })
      .catch(() => {
        savedAppearance.value = { ...DEFAULT_APPEARANCE };
        apply(DEFAULT_APPEARANCE);
      })
      .finally(() => {
        loaded.value = true;
        loadRequest = null;
      });
    return loadRequest;
  }

  function preview(next: Partial<AppearanceSettings>): AppearanceSettings {
    return apply(next);
  }

  function rollback(): AppearanceSettings {
    return apply(savedAppearance.value);
  }

  async function persist(settings: AppSettings): Promise<AppSettings> {
    const saved = await api.updateSettings(settings);
    savedAppearance.value = normalizeAppearance(saved);
    apply(savedAppearance.value);
    return saved;
  }

  return {
    activeAppearance: readonly(activeAppearance),
    fallbackMessage: readonly(fallbackMessage),
    loaded: readonly(loaded),
    load,
    preview,
    rollback,
    persist,
    errorMessage,
  };
}
