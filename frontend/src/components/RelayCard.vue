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
    return "CONNECT SERIAL TO CONTROL";
  }
  if (props.activeOperation === "on") {
    return "TURNING RELAY 1 ON";
  }
  if (props.activeOperation === "off") {
    return "TURNING RELAY 1 OFF";
  }
  if (switchChecked.value) {
    return "CLICK TO TURN RELAY 1 OFF";
  }
  return "CLICK TO TURN RELAY 1 ON";
});
const switchStateText = computed(() => {
  if (props.status.relay_state === "on") {
    return "CURRENT ON";
  }
  if (props.status.relay_state === "off") {
    return "CURRENT OFF";
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
        <p class="section-label">OUTPUT CHANNEL</p>
        <h2>Relay 1</h2>
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
          <span class="relay-state-kicker">RELAY OUTPUT</span>
          <strong>{{ stateLabel }}</strong>
          <p v-if="status.state_source === 'software_last_command'">
            SOURCE: LAST SOFTWARE COMMAND
          </p>
          <p v-else>WAITING FOR FIRST COMMAND</p>
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
      <span>UNKNOWN state: send the verified safe OFF command.</span>
      <el-button
        type="danger"
        plain
        size="small"
        :icon="VideoPause"
        :disabled="busy"
        :loading="activeOperation === 'off'"
        @click="emit('off')"
      >
        SAFE OFF
      </el-button>
    </div>

    <p class="relay-control-note">
      Sends verified LCUS-1 ON/OFF commands without hardware status readback.
    </p>
  </section>
</template>
