<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Connection, Setting, WarningFilled } from "@element-plus/icons-vue";

import {
  clearAuditLogs,
  connectRelay,
  disconnectRelay,
  getApiErrorMessage,
  getAppConfig,
  getHealth,
  getRelayStatus,
  getSerialStatus,
  initApp,
  isWebSerialSupported,
  listAuditLogs,
  listSerialPorts,
  requestSerialPort,
  tryAutoConnect,
  turnRelayOff,
  turnRelayOn,
  type AuditLogEntry,
  type AppConfig,
  type RelayActionResponse,
  type RelayStatus,
  type SerialConnectionState,
  type SerialPortInfo,
  type SerialStatus,
} from "../api/relay";
import OperationLog from "../components/OperationLog.vue";
import RelayCard from "../components/RelayCard.vue";
import SerialPanel from "../components/SerialPanel.vue";
import SettingsPanel from "../components/SettingsPanel.vue";

const settingsVisible = ref(false);
const appConfig = ref<AppConfig>(getAppConfig());

type ActiveOperation = "connect" | "disconnect" | "on" | "off" | null;
type OperationStatus = "idle" | "pending" | "success" | "failed";
type UiSerialConnectionState = SerialConnectionState | "device_lost";

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

const emptySerialStatus: SerialStatus = {
  state: "disconnected",
  port: null,
  device: null,
  baudrate: 9600,
  connected: false,
  error_code: null,
  detail: null,
};

const ports = ref<SerialPortInfo[]>([]);
const selectedPort = ref("");
const webSerialSupported = ref(isWebSerialSupported());
const scanning = ref(false);
const activeOperation = ref<ActiveOperation>(null);
const connectionState = ref<UiSerialConnectionState>("disconnected");
const connectionMessage = ref("未连接");
const errorMessage = ref("");
const relayStatus = ref<RelayStatus>({ ...emptyRelayStatus });
const serialStatus = ref<SerialStatus>({ ...emptySerialStatus });
const auditLogs = ref<AuditLogEntry[]>([]);
const logsLoading = ref(false);
const logsClearing = ref(false);
const lastOperation = ref<OperationRecord>({
  time: "—",
  target: "—",
  action: "—",
  commandHex: "—",
  result: "尚未执行操作",
  status: "idle",
});

const operationInProgress = computed(
  () => activeOperation.value !== null,
);
const serialLabel = computed(() =>
  webSerialSupported.value ? "可用" : "不支持",
);
const serialTagType = computed<"success" | "danger">(() =>
  webSerialSupported.value ? "success" : "danger",
);
const currentPort = computed(
  () => serialStatus.value.port || selectedPort.value || "—",
);
const currentDevice = computed(() => {
  if (serialStatus.value.device) {
    return serialStatus.value.device;
  }
  return (
    ports.value.find((port) => port.port === selectedPort.value)?.description ??
    "—"
  );
});
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
  connectionMessage.value = serialStatus.value.detail || "串口异常";
}

function applySerialStatus(next: SerialStatus): void {
  serialStatus.value = next;
  if (next.state === "connected") {
    connectionState.value = "connected";
    connectionMessage.value = `已连接 ${next.port ?? ""}`.trim();
  } else if (next.state === "connecting") {
    connectionState.value = "connecting";
    connectionMessage.value = "正在连接串口";
  } else if (next.state === "error") {
    connectionState.value =
      next.error_code === "SERIAL_DEVICE_DISCONNECTED"
        ? "device_lost"
        : "error";
    connectionMessage.value = next.detail || "串口连接异常";
    errorMessage.value = next.detail || "串口连接异常，请重新连接";
  } else {
    connectionState.value = "disconnected";
    connectionMessage.value = "未连接";
  }
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

    const previousStillExists = nextPorts.some(
      (port) => port.port === previousSelection,
    );

    if (!previousSelection) {
      selectedPort.value = nextPorts[0]?.port ?? "";
    } else if (!previousStillExists) {
      selectedPort.value = "";
    }
  } catch (error) {
    showError(getApiErrorMessage(error));
  } finally {
    scanning.value = false;
  }
}

/**
 * Refresh button: open the browser serial-port picker to grant a new device,
 * then reload the granted-port list and auto-select the newly added port.
 */
async function requestNewPort(): Promise<void> {
  if (scanning.value || !webSerialSupported.value) {
    return;
  }
  scanning.value = true;
  try {
    const added = await requestSerialPort();
    await loadPorts();
    selectedPort.value = added.port;
    errorMessage.value = "";
  } catch (error) {
    // User cancelled the picker — not a real error, just ignore silently
    // unless it was an actual failure.
    const message = getApiErrorMessage(error);
    if (message !== "已取消串口选择") {
      showError(message);
    }
  } finally {
    scanning.value = false;
  }
}

async function loadLogs(): Promise<void> {
  if (logsLoading.value) {
    return;
  }

  logsLoading.value = true;
  try {
    const page = await listAuditLogs(20, 0);
    auditLogs.value = page.items;
  } catch (error) {
    errorMessage.value = getApiErrorMessage(error);
  } finally {
    logsLoading.value = false;
  }
}

function refreshAppConfig(): void {
  appConfig.value = getAppConfig();
}

async function clearOperationLogs(): Promise<void> {
  if (logsClearing.value || auditLogs.value.length === 0) {
    return;
  }

  logsClearing.value = true;
  try {
    await clearAuditLogs();
    auditLogs.value = [];
  } catch (error) {
    errorMessage.value = getApiErrorMessage(error);
  } finally {
    logsClearing.value = false;
  }
}

async function refreshStatus(): Promise<void> {
  try {
    const [health, nextRelayStatus, nextSerialStatus] = await Promise.all([
      getHealth(),
      getRelayStatus(),
      getSerialStatus(),
    ]);
    relayStatus.value = nextRelayStatus;
    applySerialStatus(nextSerialStatus);
    webSerialSupported.value = health.status === "ok";
  } catch (error) {
    relayStatus.value = { ...emptyRelayStatus };
    serialStatus.value = { ...emptySerialStatus };
    connectionState.value = "error";
    connectionMessage.value = "状态读取失败";
    errorMessage.value = getApiErrorMessage(error);
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
    connectionState.value = "connected";
    connectionMessage.value = `已连接 ${relayStatus.value.port ?? port}`;
    errorMessage.value = "";
    recordOperation("串口设备", "CONNECT", "—", `已连接 ${port}`, "success");
    await refreshStatus();
    await loadLogs();
  } catch (error) {
    const message = getApiErrorMessage(error);
    await refreshStatus();
    showError(message);
    recordOperation("串口设备", "CONNECT", "—", message, "failed");
    await loadLogs();
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
    await refreshStatus();
    await loadLogs();
  } catch (error) {
    const message = getApiErrorMessage(error);
    await refreshStatus();
    showError(message);
    recordOperation("串口设备", "DISCONNECT", "—", message, "failed");
    await loadLogs();
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
  recordOperation("继电器 1", actionName, commandHex, "发送中", "pending");

  try {
    const result = await request();
    relayStatus.value = result.status;
    connectionState.value = "connected";
    connectionMessage.value = `已连接 ${result.status.port ?? ""}`.trim();
    errorMessage.value = "";
    recordOperation(
      "继电器 1",
      actionName,
      result.command,
      result.message,
      "success",
    );
    await loadLogs();
  } catch (error) {
    const message = getApiErrorMessage(error);
    recordOperation("继电器 1", actionName, commandHex, message, "failed");
    await refreshStatus();
    showError(message);
    await loadLogs();
  } finally {
    activeOperation.value = null;
  }
}

onMounted(async () => {
  await initApp();
  refreshAppConfig();
  await Promise.all([loadPorts(), refreshStatus(), loadLogs()]);
  // Attempt auto-connect if enabled in config (non-blocking).
  tryAutoConnect().catch(() => {
    /* auto-connect is best-effort */
  });
});
</script>

<template>
  <div class="dashboard-shell">
    <header class="topbar">
      <div class="topbar-title">
        <span class="brand-mark"><Connection /></span>
        <div>
          <p class="section-label">本地硬件控制</p>
          <h1>USB 继电器控制台</h1>
          <p class="topbar-subtitle">浏览器串口控制 · 无需后端服务</p>
        </div>
      </div>
      <div class="topbar-summary">
        <div class="summary-item">
          <span>当前串口</span>
          <strong>{{ currentPort }}</strong>
        </div>
        <div class="summary-item">
          <span>当前设备</span>
          <strong>{{ currentDevice }}</strong>
        </div>
        <div class="backend-state">
          <span>浏览器串口</span>
          <el-tag :type="serialTagType" effect="dark">
            {{ serialLabel }}
          </el-tag>
        </div>
        <el-tooltip content="打开设备设置" placement="bottom">
          <el-button
            class="settings-btn"
            :icon="Setting"
            circle
            aria-label="打开设备设置"
            @click="settingsVisible = true"
          />
        </el-tooltip>
      </div>
    </header>

    <section v-if="errorMessage" class="error-banner" role="alert">
      <WarningFilled class="error-icon" />
      <div>
        <strong>操作失败</strong>
        <p>{{ errorMessage }}</p>
      </div>
    </section>

    <section v-if="!webSerialSupported" class="error-banner" role="alert">
      <WarningFilled class="error-icon" />
      <div>
        <strong>浏览器不支持 Web Serial API</strong>
        <p>
          请使用 Chrome 或 Edge (89+)，并通过 https 或 localhost 访问本页面。
        </p>
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
        :serial-options="appConfig.relay.serial"
        :active-operation="
          activeOperation === 'connect' || activeOperation === 'disconnect'
            ? activeOperation
            : null
        "
        @refresh="requestNewPort"
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

    <OperationLog
      :entries="auditLogs"
      :loading="logsLoading"
      :clearing="logsClearing"
      @refresh="loadLogs"
      @clear="clearOperationLogs"
    />

    <SettingsPanel
      v-model:visible="settingsVisible"
      @saved="refreshAppConfig"
    />
  </div>
</template>
