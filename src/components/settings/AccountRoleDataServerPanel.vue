<script setup lang="ts">
import { computed } from "vue";
import { validateAccountRoleDataServerUrl } from "../../utils/accountRoleData";

const serverUrl = defineModel<string>("serverUrl", { required: true });
const apiKey = defineModel<string>("apiKey", { required: true });
const validationError = computed(() => validateAccountRoleDataServerUrl(serverUrl.value));
</script>

<template>
  <div class="settings-form">
    <label class="field">
      <span class="field__label">基础 URL</span>
      <input
        v-model="serverUrl"
        class="input mono-number"
        type="url"
        inputmode="url"
        autocomplete="off"
        spellcheck="false"
        aria-label="角色数据服务器基础 URL"
        :aria-invalid="Boolean(validationError)"
      />
    </label>
    <label class="field">
      <span class="field__label">API 密钥</span>
      <input
        v-model="apiKey"
        class="input mono-number"
        type="password"
        autocomplete="off"
        spellcheck="false"
        aria-label="角色数据 API 密钥"
      />
    </label>
    <p v-if="validationError" class="server-url-error" role="alert">{{ validationError }}</p>
    <p v-else class="settings-note">
      更新时追加编码后的服务器、角色名和 API 密钥；密钥保存在本机设置并随完整备份保存。
    </p>
  </div>
</template>

<style scoped>
.server-url-error {
  color: var(--danger);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}
</style>
