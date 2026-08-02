<script setup lang="ts">
import { computed } from "vue";
import { validateAccountRoleDataServerUrl } from "../../utils/accountRoleData";

const serverUrl = defineModel<string>({ required: true });
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
    <p v-if="validationError" class="server-url-error" role="alert">{{ validationError }}</p>
    <p v-else class="settings-note">
      更新时只会追加编码后的服务器和角色名路径；不支持认证信息、查询参数或片段。
    </p>
  </div>
</template>

<style scoped>
.server-url-error {
  color: var(--danger);
  font-size: 12px;
}
</style>
