<script setup lang="ts">
import { computed } from "vue";
import { Connection, Refresh, SwitchButton } from "@element-plus/icons-vue";

import type { SerialPortInfo } from "../api/relay";
import type { SerialOpenOptions } from "../services/serial/types";

type SerialConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "device_lost"
  | "error";

const props = defineProps<{
  ports: SerialPortInfo[];
  connectedPort: string | null;
  connected: boolean;
  scanning: boolean;
  connectionState: SerialConnectionState;
  connectionMessage: string;
  detectedRelayPort: string | null;
  serialOptions: SerialOpenOptions;
  activeOperation: "connect" | "disconnect" | null;
}>();

const emit = defineEmits<{
  refresh: [];
  connect: [];
  disconnect: [];
}>();

const detectedPortInfo = computed(
  () =>
    props.ports.find((port) => port.port === props.detectedRelayPort) ?? null,
);

const displayPort = computed(
  () => props.connectedPort || props.detectedRelayPort || "未检测到",
);

const deviceDisplayText = computed(() => {
  if (!props.detectedRelayPort) {
    return "没有识别到串口设备";
  }
  const description = detectedPortInfo.value?.description;
  return description
    ? `${props.detectedRelayPort} · ${description}`
    : props.detectedRelayPort;
});

const runningInDesktop = Boolean(window.desktopAPI?.serial);
const scanButtonLabel = runningInDesktop ? "扫描串口" : "添加串口";
const scanButtonTooltip = runningInDesktop
  ? "重新扫描电脑上的串口设备"
  : "选择并授权浏览器可使用的串口设备";

const relayDetectionText = computed(() =>
  props.detectedRelayPort
    ? `已识别 ${props.detectedRelayPort}`
    : "未识别到 CH340 继电器",
);

const parityLabels: Record<SerialOpenOptions["parity"], string> = {
  none: "无校验",
  even: "偶校验",
  odd: "奇校验",
  mark: "标记校验",
  space: "空格校验",
};

const dataFormat = computed(
  () =>
    `${props.serialOptions.dataBits}${props.serialOptions.parity === "none" ? "N" : props.serialOptions.parity[0].toUpperCase()}${props.serialOptions.stopBits}`,
);

const dataFormatDetail = computed(
  () =>
    `${props.serialOptions.dataBits} 数据位 · ${parityLabels[props.serialOptions.parity]} · ${props.serialOptions.stopBits} 停止位`,
);

const busy = computed(() => props.activeOperation !== null);

const stateLabel = computed(() => {
  if (props.connectionState === "connected") {
    return `已连接 ${props.connectedPort ?? ""}`.trim();
  }
  if (props.connectionState === "device_lost") {
    return "设备已断开";
  }
  if (props.connectionState === "connecting") {
    return "正在连接";
  }
  if (props.connectionState === "error") {
    return "串口异常";
  }
  return "未连接";
});

const stateTagType = computed<"success" | "danger" | "info">(() => {
  if (props.connectionState === "connected") {
    return "success";
  }
  if (
    props.connectionState === "device_lost" ||
    props.connectionState === "error"
  ) {
    return "danger";
  }
  return "info";
});

</script>

<template>
  <section class="panel serial-panel">
    <header class="panel-header">
      <div>
        <p class="section-label">串口通信</p>
        <h2>串口连接</h2>
      </div>
      <el-tag :type="stateTagType" effect="dark" size="small">
        {{ stateLabel }}
      </el-tag>
    </header>

    <div class="field-group">
      <label for="serial-device">串口设备</label>
      <div class="port-row">
        <el-input
          id="serial-device"
          :model-value="deviceDisplayText"
          class="port-select"
          readonly
        />
        <el-tooltip :content="scanButtonTooltip" placement="top">
          <el-button
            :icon="Refresh"
            :loading="scanning"
            :disabled="busy || scanning"
            aria-label="重新检测继电器设备"
            @click="emit('refresh')"
          >
            {{ scanButtonLabel }}
          </el-button>
        </el-tooltip>
      </div>
    </div>

    <dl class="device-meta">
      <div>
        <dt>波特率</dt>
        <dd>{{ serialOptions.baudRate }} 波特</dd>
      </div>
      <div>
        <dt>数据格式</dt>
        <dd>
          {{ dataFormat }}
          <small>{{ dataFormatDetail }}</small>
        </dd>
      </div>
      <div>
        <dt>识别结果</dt>
        <dd
          class="relay-detection"
          :class="{ detected: !!detectedRelayPort }"
        >
          {{ relayDetectionText }}
        </dd>
      </div>
      <div>
        <dt>设备</dt>
        <dd>{{ displayPort }}</dd>
      </div>
      <div>
        <dt>型号</dt>
        <dd>{{ detectedPortInfo?.description || "—" }}</dd>
      </div>
      <div class="meta-wide">
        <dt>状态</dt>
        <dd>{{ connectionMessage }}</dd>
      </div>
      <div class="meta-wide">
        <dt>制造商</dt>
        <dd>{{ detectedPortInfo?.manufacturer || "—" }}</dd>
      </div>
    </dl>

    <div class="panel-actions">
      <el-button
        v-if="!connected"
        type="primary"
        :icon="Connection"
        :loading="activeOperation === 'connect'"
        @click="emit('connect')"
      >
        连接
      </el-button>
      <el-button
        v-else
        :icon="SwitchButton"
        :loading="activeOperation === 'disconnect'"
        @click="emit('disconnect')"
      >
        断开
      </el-button>
    </div>
  </section>
</template>
