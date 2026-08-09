<script setup lang="ts">
import appIconUrl from "../../../src-tauri/icons/app-icon.svg?url";
</script>

<template>
  <img class="app-brand-icon" :src="appIconUrl" alt="" aria-hidden="true" draggable="false" />
</template>

<style scoped>
.app-brand-icon {
  display: block;
  object-fit: contain;
  user-select: none;
}
</style>
