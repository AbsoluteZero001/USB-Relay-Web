<script setup lang="ts">
import { computed } from "vue";
import { VideoPause, VideoPlay } from "@element-plus/icons-vue";

import type { RelayStatus } from "../api/relay";

const props = defineProps<{
  status: RelayStatus;
  activeOperation: "on" | "off" | null;
}>();

const emit = defineEmits<{
  on: [];
  off: [];
}>();

const stateLabel = computed(() => props.status.relay_state.toUpperCase());
const busy = computed(() => props.activeOperation !== null);

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
          状态来源：软件最后一次命令
        </p>
        <p v-else>状态来源：未知</p>
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
        :loading="activeOperation === 'on'"
        aria-label="打开继电器"
        @click="emit('on')"
      >
        ON
      </el-button>
      <el-button
        type="danger"
        size="large"
        :icon="VideoPause"
        :disabled="!status.connected || busy"
        :loading="activeOperation === 'off'"
        aria-label="关闭继电器"
        @click="emit('off')"
      >
        OFF
      </el-button>
    </div>
  </section>
</template>
