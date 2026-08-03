<script setup lang="ts">
import { onMounted } from "vue";
import AuthenticatedAppShell from "./components/layout/AuthenticatedAppShell.vue";
import AppAccessGate from "./components/security/AppAccessGate.vue";
import { useAppAccessStore } from "./stores/appAccess";

const access = useAppAccessStore();

onMounted(() => {
  void access.bootstrap();
});
</script>

<template>
  <AuthenticatedAppShell v-if="access.ready && access.unlocked" />
  <AppAccessGate v-else />
</template>
