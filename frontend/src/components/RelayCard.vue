<script setup lang="ts">
import { computed } from "vue";
import {
  SwitchButton,
  VideoPause,
  VideoPlay,
} from "@element-plus/icons-vue";

import type { RelayStatus } from "../api/relay";

const props = defineProps<{
  status: RelayStatus;
  activeOperation: "on" | "off" | null;
  channel: number;
}>();

const emit = defineEmits<{
  on: [];
  off: [];
}>();

const stateLabel = computed(() => {
  if (props.status.relay_state === "on") {
    return "ON";
  }
  if (props.status.relay_state === "off") {
    return "OFF";
  }
  return "UNKNOWN";
});
const busy = computed(() => props.activeOperation !== null);
const switchChecked = computed(() => {
  if (props.activeOperation === "on") {
    return true;
  }
  if (props.activeOperation === "off") {
    return false;
  }
  return props.status.relay_state === "on";
});
const switchDisabled = computed(
  () => !props.status.connected || busy.value,
);
const switchLabel = computed(() => {
  if (!props.status.connected) {
    return "连接串口后控制";
  }
  if (props.activeOperation === "on") {
    return "正在接通继电器 1";
  }
  if (props.activeOperation === "off") {
    return "正在关闭继电器 1";
  }
  if (switchChecked.value) {
    return "点击关闭继电器 1";
  }
  return "点击接通继电器 1";
});
const switchStateText = computed(() => {
  if (props.status.relay_state === "on") {
    return "当前 ON";
  }
  if (props.status.relay_state === "off") {
    return "当前 OFF";
  }
  return "STATUS UNKNOWN";
});

const stateTagType = computed<"success" | "danger" | "info">(() => {
  if (props.status.relay_state === "on") {
    return "success";
  }
  if (props.status.relay_state === "off") {
    return "danger";
  }
  return "info";
});

function toggleRelay(): void {
  if (switchDisabled.value) {
    return;
  }
  if (switchChecked.value) {
    emit("off");
    return;
  }
  emit("on");
}
</script>

<template>
  <section class="panel relay-panel">
    <header class="panel-header">
      <div>
        <p class="section-label">输出通道</p>
        <h2>继电器 {{ channel }}</h2>
      </div>
      <el-tag :type="stateTagType" effect="dark">
        {{ stateLabel }}
      </el-tag>
    </header>

    <div class="relay-hero" :class="`relay-${status.relay_state}`">
      <div class="relay-state">
        <span class="state-indicator" :class="status.relay_state">
          <SwitchButton />
        </span>
        <div>
          <span class="relay-state-kicker">继电器输出</span>
          <strong>{{ stateLabel }}</strong>
          <p v-if="status.state_source === 'software_last_command'">
            状态来源：软件最近一次指令
          </p>
          <p v-else>等待首次控制命令</p>
        </div>
      </div>

      <button
        class="relay-switch"
        :class="{
          'is-on': switchChecked,
          'is-busy': busy,
          'is-disabled': !status.connected,
        }"
        type="button"
        role="switch"
        :aria-checked="switchChecked"
        :aria-label="switchLabel"
        :disabled="switchDisabled"
        @click="toggleRelay"
      >
        <span class="relay-switch-track" aria-hidden="true">
          <VideoPause class="switch-state-icon switch-state-off" />
          <VideoPlay class="switch-state-icon switch-state-on" />
          <span class="relay-switch-thumb">
            <SwitchButton />
          </span>
        </span>
        <span class="relay-switch-copy">
          <strong>{{ switchChecked ? "ON" : "OFF" }}</strong>
          <span>{{ switchStateText }}</span>
        </span>
      </button>
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

    <div
      v-if="status.connected && status.relay_state === 'unknown'"
      class="relay-unknown-actions"
    >
      <span>状态未知时，可直接发送已实机验证的安全关闭指令。</span>
      <el-button
        type="danger"
        plain
        size="small"
        :icon="VideoPause"
        :disabled="busy"
        :loading="activeOperation === 'off'"
        @click="emit('off')"
      >
        安全关闭
      </el-button>
    </div>

    <p class="relay-control-note">
      开关发送已实机验证的 LCUS-1 ON/OFF 指令，不执行状态回读。
    </p>
  </section>
</template>
