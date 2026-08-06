<script setup lang="ts">
import { computed } from "vue";
import type { AppearanceSettings } from "../../types/domain";

const props = defineProps<{
  appearance: AppearanceSettings;
}>();

const previewStyle = computed(() => ({
  fontFamily: `'${props.appearance.fontFamily.replace(/["']/g, "")}', var(--font-sans)`,
  fontSize: `${props.appearance.baseFontSize}px`,
}));
</script>

<template>
  <div class="typography-preview" :style="previewStyle" aria-label="字体即时预览">
    <span class="typography-preview__eyebrow">青瓷案台 · Typography</span>
    <strong>今日有约，心中有数</strong>
    <p>清晰的文字层级让预约、账号和收益都保持从容可读。</p>
    <div class="typography-preview__meta">
      <span>正文 {{ appearance.baseFontSize }}px</span><span>说明 12px</span>
    </div>
  </div>
</template>

<style scoped>
.typography-preview {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 16px;
  border: 1px solid var(--brand-border);
  border-radius: var(--radius);
  color: var(--ink);
  background: linear-gradient(135deg, var(--brand-soft), var(--surface));
}

.typography-preview__eyebrow,
.typography-preview__meta {
  color: var(--ink-muted);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.typography-preview strong {
  color: var(--ink-strong);
  font-family: var(--font-serif);
  font-size: 1.35em;
}

.typography-preview p {
  line-height: 1.65;
}

.typography-preview__meta {
  display: flex;
  gap: 12px;
  padding-top: 4px;
  border-top: 1px solid color-mix(in srgb, var(--brand-border) 60%, transparent);
}
</style>
