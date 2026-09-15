<script setup lang="ts">
import { computed } from "vue";
import { VideoPause, VideoPlay } from "@element-plus/icons-vue";

import type { RelayStatus } from "../api/relay";

const props = defineProps<{
  status: RelayStatus;
  busy: boolean;
}>();

const emit = defineEmits<{
  on: [];
  off: [];
}>();

const stateLabel = computed(() => props.status.relay_state.toUpperCase());

const stateTagType = computed<"success" | "danger" | "info">(() => {
  if (props.status.relay_state === "on") {
    return "success";
  }
  if (props.status.relay_state === "off") {
    return "danger";
  }
  return "info";
});
</script>

<template>
  <section class="panel relay-panel">
    <header class="panel-header">
      <div>
        <p class="section-label">OUTPUT CHANNEL</p>
        <h2>Relay 1</h2>
      </div>
      <el-tag :type="stateTagType" effect="dark">
        {{ stateLabel }}
      </el-tag>
    </header>

    <div class="relay-state">
      <span class="state-indicator" :class="status.relay_state" />
      <div>
        <strong>{{ stateLabel }}</strong>
        <p v-if="status.state_source === 'software_last_command'">
          软件最近一次成功发送
        </p>
        <p v-else>硬件未返回状态</p>
      </div>
    </div>

    <dl class="device-meta relay-meta">
      <div>
        <dt>连接</dt>
        <dd>{{ status.connected ? "已连接" : "未连接" }}</dd>
      </div>
      <div>
        <dt>端口</dt>
        <dd>{{ status.port || "—" }}</dd>
      </div>
    </dl>

    <div class="relay-actions">
      <el-button
        type="success"
        size="large"
        :icon="VideoPlay"
        :disabled="!status.connected || busy"
        :loading="busy"
        @click="emit('on')"
      >
        打开继电器
      </el-button>
      <el-button
        type="danger"
        size="large"
        :icon="VideoPause"
        :disabled="!status.connected || busy"
        :loading="busy"
        @click="emit('off')"
      >
        关闭继电器
      </el-button>
    </div>
  </section>
</template>
