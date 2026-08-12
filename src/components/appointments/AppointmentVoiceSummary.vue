<script setup lang="ts">
import { computed } from "vue";
import type { VoicePlatform } from "../../types/domain";

const props = defineProps<{
  voicePlatform?: VoicePlatform | null;
  voiceChannel?: string | null;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  copyVoiceChannel: [];
}>();

const validYyChannel = computed(() => {
  if (props.voicePlatform !== "yy") return null;
  const channel = props.voiceChannel?.trim();
  return channel && /^\d+$/.test(channel) ? channel : null;
});
</script>

<template>
  <div v-if="voicePlatform === 'yy'" class="appointment-voice-summary">
    <button
      v-if="validYyChannel"
      class="appointment-voice-summary__channel"
      type="button"
      :disabled="disabled"
      :title="`复制YY频道 ${validYyChannel}`"
      :aria-label="`复制YY频道 ${validYyChannel}`"
      @click="emit('copyVoiceChannel')"
    >
      <span>{{ validYyChannel }}</span>
    </button>
    <span v-else class="appointment-voice-summary__empty">—</span>
  </div>
  <span v-else-if="voicePlatform === 'qq'" class="appointment-voice-summary">QQ</span>
  <span v-else class="appointment-voice-summary__empty">—</span>
</template>

<style scoped>
.appointment-voice-summary {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 4px;
  color: var(--ink-strong);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  font-weight: 650;
}

.appointment-voice-summary__channel {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  padding: 2px 4px;
  border: 0;
  border-radius: 5px;
  color: var(--brand-strong);
  background: transparent;
  font: inherit;
  cursor: copy;
}

.appointment-voice-summary__channel span {
  overflow: hidden;
  text-overflow: ellipsis;
}

.appointment-voice-summary__channel:hover,
.appointment-voice-summary__channel:focus-visible {
  background: var(--brand-soft);
  outline: none;
}

.appointment-voice-summary__empty {
  color: var(--ink-muted);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}
</style>
