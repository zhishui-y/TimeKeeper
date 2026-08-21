<script setup lang="ts">
import { Clock3, Search } from "@lucide/vue";
import { computed, nextTick, shallowRef, watch } from "vue";
import { useContactPresets } from "../../composables/useContactPresets";
import type { ContactPreset } from "../../types/domain";
import { formatCompactDate } from "../../utils/formatters";

const contactName = defineModel<string>({ required: true });
const emit = defineEmits<{
  select: [preset: ContactPreset];
}>();

const focused = shallowRef(false);
const activeIndex = shallowRef(-1);
const suggestionsOpen = computed(() => focused.value);
const activeOptionId = computed(() =>
  activeIndex.value >= 0 ? `contact-preset-${activeIndex.value}` : undefined,
);
const { items, loading, error } = useContactPresets(contactName, suggestionsOpen);

function focus(): void {
  focused.value = true;
}

function blur(): void {
  globalThis.setTimeout(() => {
    focused.value = false;
    activeIndex.value = -1;
  }, 0);
}

function select(preset: ContactPreset): void {
  contactName.value = preset.contactName;
  focused.value = false;
  emit("select", preset);
}

function moveActive(direction: 1 | -1): void {
  if (!focused.value) focused.value = true;
  if (items.value.length === 0) return;
  activeIndex.value =
    activeIndex.value < 0
      ? direction === 1
        ? 0
        : items.value.length - 1
      : (activeIndex.value + direction + items.value.length) % items.value.length;
  void nextTick(() =>
    globalThis.document
      .getElementById(activeOptionId.value ?? "")
      ?.scrollIntoView?.({ block: "nearest" }),
  );
}

function selectActive(): void {
  if (loading.value || error.value) return;
  const preset = items.value[activeIndex.value];
  if (preset) select(preset);
}

function closeSuggestions(): void {
  focused.value = false;
  activeIndex.value = -1;
}

watch(contactName, () => {
  activeIndex.value = -1;
});

watch(items, () => {
  activeIndex.value = -1;
});
</script>

<template>
  <label class="field contact-field">
    <span class="field__label">联系人 *</span>
    <span class="contact-field__control">
      <Search :size="14" aria-hidden="true" />
      <input
        v-model="contactName"
        class="input"
        placeholder="谁约的"
        role="combobox"
        aria-label="联系人"
        aria-autocomplete="list"
        :aria-expanded="suggestionsOpen"
        :aria-activedescendant="activeOptionId"
        aria-controls="contact-preset-list"
        autocomplete="off"
        @focus="focus"
        @blur="blur"
        @keydown.down.prevent="moveActive(1)"
        @keydown.up.prevent="moveActive(-1)"
        @keydown.enter.prevent="selectActive"
        @keydown.esc.prevent="closeSuggestions"
      />
    </span>
    <div v-if="suggestionsOpen" id="contact-preset-list" class="contact-presets" role="listbox">
      <p v-if="loading" class="contact-presets__state">联系人加载中…</p>
      <p v-else-if="error" class="contact-presets__state contact-presets__state--error">
        {{ error }}
      </p>
      <template v-else>
        <button
          v-for="(preset, index) in items"
          :id="`contact-preset-${index}`"
          :key="preset.sourceAppointmentId"
          class="contact-preset"
          type="button"
          role="option"
          :aria-selected="activeIndex === index"
          :class="{ 'is-active': activeIndex === index }"
          @mousemove="activeIndex = index"
          @mousedown.prevent="select(preset)"
        >
          <span>
            <strong>{{ preset.contactName }}</strong>
            <small>{{ preset.content || "未填写预约内容" }}</small>
          </span>
          <span class="contact-preset__meta">
            <Clock3 :size="12" />
            {{ formatCompactDate(preset.serviceDate) }} · {{ preset.startTime || "待定" }}
            <small v-if="preset.account?.password">可沿用密码</small>
          </span>
        </button>
      </template>
      <p v-if="!loading && !error && items.length === 0" class="contact-presets__state">
        没有匹配的历史联系人
      </p>
    </div>
  </label>
</template>

<style scoped>
.contact-field {
  position: relative;
  z-index: 3;
}

.contact-field__control {
  position: relative;
  display: block;
}

.contact-field__control > svg {
  position: absolute;
  z-index: 1;
  top: 50%;
  left: 10px;
  color: var(--ink-muted);
  pointer-events: none;
  transform: translateY(-50%);
}

.contact-field__control .input {
  padding-left: 31px;
}

.contact-presets {
  position: absolute;
  z-index: 20;
  top: calc(100% + 5px);
  right: 0;
  left: 0;
  max-height: 250px;
  overflow-y: auto;
  border: 1px solid var(--line);
  border-radius: var(--radius, 12px);
  background: var(--surface);
  box-shadow: 0 14px 36px rgba(24, 43, 36, 0.17);
}

.contact-preset {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 11px;
  border: 0;
  border-bottom: 1px solid var(--line);
  color: var(--ink);
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.contact-preset:last-of-type {
  border-bottom: 0;
}

.contact-preset:hover,
.contact-preset.is-active {
  background: var(--brand-soft);
}

.contact-preset > span:first-child {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.contact-preset strong,
.contact-preset small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.contact-preset strong {
  color: var(--ink-strong);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.contact-preset small {
  color: var(--ink-muted);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.contact-preset__meta {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
  color: var(--brand-strong);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.contact-preset__meta small {
  margin-left: 3px;
  color: var(--gold-strong);
}

.contact-presets__state {
  margin: 0;
  padding: 12px;
  color: var(--ink-muted);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  text-align: center;
}

.contact-presets__state--error {
  color: var(--danger);
}
</style>
