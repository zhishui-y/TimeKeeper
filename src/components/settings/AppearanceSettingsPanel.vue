<script setup lang="ts">
import { computed, shallowRef, watch } from "vue";
import type { AppearanceSettings } from "../../types/domain";
import { DEFAULT_APPEARANCE, FONT_PRESETS, normalizeAppearance } from "../../utils/appearance";
import TypographyPreview from "./TypographyPreview.vue";

const props = defineProps<{
  modelValue: AppearanceSettings;
  fallbackMessage?: string | null;
}>();

const emit = defineEmits<{
  update: [value: AppearanceSettings];
}>();

const fontFamilyDraft = shallowRef(props.modelValue.fontFamily);
const baseFontSizeDraft = shallowRef(String(props.modelValue.baseFontSize));

const selectedPreset = computed(() =>
  FONT_PRESETS.some((preset) => preset.value === fontFamilyDraft.value.trim())
    ? fontFamilyDraft.value.trim()
    : "custom",
);

watch(
  () => props.modelValue.fontFamily,
  (value) => {
    if (value !== fontFamilyDraft.value.trim()) fontFamilyDraft.value = value;
  },
);

watch(
  () => props.modelValue.baseFontSize,
  (value) => {
    if (String(value) !== baseFontSizeDraft.value) baseFontSizeDraft.value = String(value);
  },
);

function updateFontFamily(value: string): void {
  fontFamilyDraft.value = value;
  const fontFamily = value.trim();
  if (!fontFamily) return;
  emit("update", normalizeAppearance({ ...props.modelValue, fontFamily }));
}

function finishFontFamily(): void {
  if (!fontFamilyDraft.value.trim()) fontFamilyDraft.value = props.modelValue.fontFamily;
}

function updateBaseFontSize(value: string): void {
  baseFontSizeDraft.value = value;
  const baseFontSize = Number(value);
  if (!Number.isInteger(baseFontSize) || baseFontSize < 14 || baseFontSize > 18) return;
  emit("update", { ...props.modelValue, baseFontSize });
}

function finishBaseFontSize(): void {
  const value = Number(baseFontSizeDraft.value);
  if (!Number.isInteger(value) || value < 14 || value > 18) {
    baseFontSizeDraft.value = String(props.modelValue.baseFontSize);
  }
}

function selectPreset(value: string): void {
  if (value === "custom") return;
  fontFamilyDraft.value = value;
  emit("update", normalizeAppearance({ ...props.modelValue, fontFamily: value }));
}

function reset(): void {
  fontFamilyDraft.value = DEFAULT_APPEARANCE.fontFamily;
  baseFontSizeDraft.value = String(DEFAULT_APPEARANCE.baseFontSize);
  emit("update", { ...DEFAULT_APPEARANCE });
}
</script>

<template>
  <div class="appearance-panel">
    <div class="appearance-panel__fields">
      <label class="field">
        <span class="field__label">字体预设</span>
        <select
          class="input"
          :value="selectedPreset"
          @change="selectPreset(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="preset in FONT_PRESETS" :key="preset.value" :value="preset.value">
            {{ preset.label }}
          </option>
          <option value="custom">手动输入系统字体</option>
        </select>
      </label>
      <label class="field">
        <span class="field__label">已安装的单一字体名</span>
        <input
          class="input"
          :value="fontFamilyDraft"
          aria-label="已安装的单一系统字体名"
          placeholder="例如 Microsoft YaHei UI"
          @input="updateFontFamily(($event.target as HTMLInputElement).value)"
          @blur="finishFontFamily"
        />
      </label>
      <label class="field appearance-panel__size">
        <span class="field__label">基础字号</span>
        <div class="unit-input">
          <input
            class="input mono-number"
            :value="baseFontSizeDraft"
            aria-label="基础字号"
            type="number"
            min="14"
            max="18"
            @input="updateBaseFontSize(($event.target as HTMLInputElement).value)"
            @blur="finishBaseFontSize"
          />
          <span>px</span>
        </div>
      </label>
    </div>
    <TypographyPreview :appearance="modelValue" />
    <div class="appearance-panel__footer">
      <span v-if="fallbackMessage" class="appearance-panel__warning" role="status">{{
        fallbackMessage
      }}</span>
      <span v-else>不导入字体文件，只使用本机已安装字体。</span>
      <button class="button button--ghost button--compact" type="button" @click="reset">
        恢复默认
      </button>
    </div>
  </div>
</template>

<style scoped>
.appearance-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.appearance-panel__fields {
  display: grid;
  grid-template-columns: minmax(150px, 0.8fr) minmax(220px, 1.25fr) 132px;
  gap: 10px;
}

.appearance-panel__size {
  min-width: 0;
}

.unit-input {
  display: grid;
  grid-template-columns: minmax(0, 1fr) max-content;
  align-items: center;
  gap: 8px;
}

.unit-input span {
  white-space: nowrap;
  color: var(--ink-muted);
}

.appearance-panel__footer {
  display: flex;
  min-height: 28px;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--ink-muted);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.appearance-panel__warning {
  color: var(--amber);
}

@media (max-width: 1180px) {
  .appearance-panel__fields {
    grid-template-columns: 1fr 1fr;
  }

  .appearance-panel__size {
    grid-column: 1 / -1;
  }
}
</style>
