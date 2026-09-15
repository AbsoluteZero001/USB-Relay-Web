<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { WarningFilled } from "@element-plus/icons-vue";

import {
  connectRelay,
  disconnectRelay,
  getApiErrorMessage,
  getRelayStatus,
  listSerialPorts,
  turnRelayOff,
  turnRelayOn,
  type RelayActionResponse,
  type RelayStatus,
  type SerialPortInfo,
} from "../api/relay";
import RelayCard from "../components/RelayCard.vue";
import SerialPanel from "../components/SerialPanel.vue";

type ActiveOperation = "connect" | "disconnect" | "on" | "off" | null;
type OperationStatus = "idle" | "pending" | "success" | "failed";
type SerialConnectionState =
  | "disconnected"
  | "connected"
  | "device_lost"
  | "error";

interface OperationRecord {
  time: string;
  target: string;
  action: string;
  commandHex: string;
  result: string;
  status: OperationStatus;
}

const emptyRelayStatus: RelayStatus = {
  connected: false,
  port: null,
  relay_state: "unknown",
  state_source: "unknown",
};

const ports = ref<SerialPortInfo[]>([]);
const selectedPort = ref("");
const backendOnline = ref(false);
const scanning = ref(false);
const activeOperation = ref<ActiveOperation>(null);
const connectionState = ref<SerialConnectionState>("disconnected");
const connectionMessage = ref("未连接");
const errorMessage = ref("");
const relayStatus = ref<RelayStatus>({ ...emptyRelayStatus });
const lastOperation = ref<OperationRecord>({
  time: "—",
  target: "—",
  action: "—",
  commandHex: "—",
  result: "尚未执行操作",
  status: "idle",
});

let statusTimer: number | undefined;
let statusRequestInFlight = false;

const operationInProgress = computed(
  () => activeOperation.value !== null,
);
const backendLabel = computed(() => (backendOnline.value ? "在线" : "离线"));
const backendTagType = computed<"success" | "danger">(() =>
  backendOnline.value ? "success" : "danger",
);
const operationTagType = computed<"success" | "danger" | "info">(() => {
  if (lastOperation.value.status === "success") {
    return "success";
  }
  if (lastOperation.value.status === "failed") {
    return "danger";
  }
  return "info";
});
const operationStatusLabel = computed(() => {
  if (lastOperation.value.status === "success") {
    return "成功";
  }
  if (lastOperation.value.status === "failed") {
    return "失败";
  }
  if (lastOperation.value.status === "pending") {
    return "发送中";
  }
  return "未执行";
});

function timeText(): string {
  return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

function recordOperation(
  target: string,
  action: string,
  commandHex: string,
  result: string,
  status: OperationStatus,
): void {
  lastOperation.value = {
    time: timeText(),
    target,
    action,
    commandHex,
    result,
    status,
  };
}

function showError(message: string): void {
  errorMessage.value = message;
  connectionState.value = "error";
  connectionMessage.value = "串口异常";
}

async function loadPorts(): Promise<void> {
  if (scanning.value) {
    return;
  }

  scanning.value = true;
  const previousSelection = selectedPort.value;
  try {
    const nextPorts = await listSerialPorts();
    ports.value = nextPorts;
    backendOnline.value = true;

    const previousStillExists = nextPorts.some(
      (port) => port.port === previousSelection,
    );

    if (!previousSelection) {
      selectedPort.value = nextPorts[0]?.port ?? "";
    } else if (!previousStillExists) {
      errorMessage.value =
        `串口 ${previousSelection} 已不存在，` +
        "请检查设备连接后重试，未自动切换到其他端口";
      connectionState.value = "error";
      connectionMessage.value = "设备已不存在";
      if (!relayStatus.value.connected) {
        selectedPort.value = "";
      }
    }
  } catch (error) {
    backendOnline.value = false;
    showError(getApiErrorMessage(error));
  } finally {
    scanning.value = false;
  }
}

async function refreshStatus(force = false): Promise<void> {
  if (statusRequestInFlight || (operationInProgress.value && !force)) {
    return;
  }

  statusRequestInFlight = true;
  const previousStatus = relayStatus.value;
  try {
    const nextStatus = await getRelayStatus();
    relayStatus.value = nextStatus;
    backendOnline.value = true;

    if (nextStatus.connected) {
      connectionState.value = "connected";
      connectionMessage.value = `已连接 ${nextStatus.port ?? ""}`.trim();
    } else if (previousStatus.connected) {
      connectionState.value = "device_lost";
      connectionMessage.value = "设备已断开";
      if (!errorMessage.value) {
        errorMessage.value =
          `串口 ${previousStatus.port ?? ""} 已断开，` +
          "请检查 USB 连接后重新连接";
      }
    } else if (connectionState.value !== "error") {
      connectionState.value = "disconnected";
      connectionMessage.value = "未连接";
    }
  } catch (error) {
    backendOnline.value = false;
    relayStatus.value = { ...emptyRelayStatus };
    connectionState.value = "error";
    connectionMessage.value = "后端不可用";
    errorMessage.value = getApiErrorMessage(error);
  } finally {
    statusRequestInFlight = false;
  }
}

async function connect(): Promise<void> {
  if (operationInProgress.value || !selectedPort.value) {
    if (!selectedPort.value) {
      showError("请先选择串口");
    }
    return;
  }

  activeOperation.value = "connect";
  const port = selectedPort.value;
  try {
    relayStatus.value = await connectRelay(port);
    backendOnline.value = true;
    connectionState.value = "connected";
    connectionMessage.value = `已连接 ${port}`;
    errorMessage.value = "";
    recordOperation("串口设备", "CONNECT", "—", `已连接 ${port}`, "success");
  } catch (error) {
    const message = getApiErrorMessage(error);
    showError(message);
    recordOperation("串口设备", "CONNECT", "—", message, "failed");
  } finally {
    activeOperation.value = null;
  }
}

async function disconnect(): Promise<void> {
  if (operationInProgress.value) {
    return;
  }

  activeOperation.value = "disconnect";
  const port = relayStatus.value.port ?? selectedPort.value;
  try {
    relayStatus.value = await disconnectRelay();
    backendOnline.value = true;
    connectionState.value = "disconnected";
    connectionMessage.value = "未连接";
    errorMessage.value = "";
    recordOperation(
      "串口设备",
      "DISCONNECT",
      "—",
      `已断开 ${port || "串口"}`,
      "success",
    );
  } catch (error) {
    const message = getApiErrorMessage(error);
    showError(message);
    recordOperation("串口设备", "DISCONNECT", "—", message, "failed");
  } finally {
    activeOperation.value = null;
  }
}

async function runRelayAction(
  actionName: "ON" | "OFF",
  request: () => Promise<RelayActionResponse>,
): Promise<void> {
  if (operationInProgress.value) {
    return;
  }

  const commandHex = actionName === "ON" ? "A0 01 01 A2" : "A0 01 00 A1";
  activeOperation.value = actionName === "ON" ? "on" : "off";
  recordOperation("Relay 1", actionName, commandHex, "发送中", "pending");

  try {
    const result = await request();
    relayStatus.value = result.status;
    backendOnline.value = true;
    connectionState.value = "connected";
    connectionMessage.value = `已连接 ${result.status.port ?? ""}`.trim();
    errorMessage.value = "";
    recordOperation(
      "Relay 1",
      actionName,
      result.command,
      result.message,
      "success",
    );
  } catch (error) {
    const message = getApiErrorMessage(error);
    recordOperation("Relay 1", actionName, commandHex, message, "failed");
    await refreshStatus(true);
    showError(message);
  } finally {
    activeOperation.value = null;
  }
}

onMounted(async () => {
  await Promise.all([loadPorts(), refreshStatus()]);
  statusTimer = window.setInterval(() => {
    void refreshStatus();
  }, 2500);
});

onUnmounted(() => {
  if (statusTimer !== undefined) {
    window.clearInterval(statusTimer);
  }
});
</script>

<template>
  <div class="dashboard-shell">
    <header class="topbar">
      <div>
        <p class="section-label">LOCAL HARDWARE CONTROL</p>
        <h1>USB Relay 控制台</h1>
      </div>
      <div class="backend-state">
        <span>后端</span>
        <el-tag :type="backendTagType" effect="dark">
          {{ backendLabel }}
        </el-tag>
      </div>
    </header>

    <section v-if="errorMessage" class="error-banner" role="alert">
      <WarningFilled class="error-icon" />
      <div>
        <strong>操作失败</strong>
        <p>{{ errorMessage }}</p>
      </div>
    </section>

    <main class="dashboard-grid">
      <SerialPanel
        v-model:selected-port="selectedPort"
        :ports="ports"
        :connected-port="relayStatus.port"
        :connected="relayStatus.connected"
        :scanning="scanning"
        :connection-state="connectionState"
        :connection-message="connectionMessage"
        :active-operation="
          activeOperation === 'connect' || activeOperation === 'disconnect'
            ? activeOperation
            : null
        "
        @refresh="loadPorts"
        @connect="connect"
        @disconnect="disconnect"
      />

      <RelayCard
        :status="relayStatus"
        :active-operation="
          activeOperation === 'on' || activeOperation === 'off'
            ? activeOperation
            : null
        "
        @on="runRelayAction('ON', turnRelayOn)"
        @off="runRelayAction('OFF', turnRelayOff)"
      />
    </main>

    <section
      class="operation-result"
      :class="`operation-${lastOperation.status}`"
      aria-live="polite"
    >
      <header class="operation-header">
        <p class="section-label">最近一次操作</p>
        <el-tag :type="operationTagType" effect="dark" size="small">
          {{ operationStatusLabel }}
        </el-tag>
      </header>
      <dl class="operation-fields">
        <div>
          <dt>时间</dt>
          <dd>{{ lastOperation.time }}</dd>
        </div>
        <div>
          <dt>对象</dt>
          <dd>{{ lastOperation.target }}</dd>
        </div>
        <div>
          <dt>动作</dt>
          <dd>{{ lastOperation.action }}</dd>
        </div>
        <div>
          <dt>命令</dt>
          <dd><code>{{ lastOperation.commandHex }}</code></dd>
        </div>
        <div class="operation-message">
          <dt>结果</dt>
          <dd>{{ lastOperation.result }}</dd>
        </div>
      </dl>
    </section>
  </div>
</template>
