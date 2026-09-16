<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { Connection, Setting, WarningFilled } from "@element-plus/icons-vue";
import { ElMessageBox } from "element-plus";

import {
  connectRelay,
  disconnectRelay,
  getApiErrorMessage,
  getAppConfig,
  getHealth,
  getRelayStatus,
  getSerialStatus,
  initApp,
  isWebSerialSupported,
  listSerialPorts,
  requestSerialPort,
  turnRelayOff,
  turnRelayOn,
  type AppConfig,
  type RelayActionResponse,
  type RelayStatus,
  type SerialConnectionState,
  type SerialPortInfo,
  type SerialStatus,
} from "../api/relay";
import { findMatchingPort } from "../services/device-rules";
import RelayCard from "../components/RelayCard.vue";
import SerialPanel from "../components/SerialPanel.vue";
import SettingsPanel from "../components/SettingsPanel.vue";

const settingsVisible = ref(false);
const appConfig = ref<AppConfig>(getAppConfig());

type ActiveOperation = "connect" | "disconnect" | "on" | "off" | null;
type UiSerialConnectionState = SerialConnectionState | "device_lost";

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

const PORT_POLL_INTERVAL_MS = 500;
const AUTO_CONNECT_RETRY_MS = 2000;
let portsPollTimer: number | null = null;
let portScanInFlight = false;
let autoConnectInFlight = false;
let autoConnectLastFailureAt = 0;
let manualDisconnect = false;

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
const detectedRelayPort = computed(
  () =>
    findMatchingPort(ports.value, appConfig.value.deviceRules)?.port.port ?? null,
);
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

async function autoConnectDetectedPort(port: string): Promise<void> {
  if (
    !appConfig.value.autoConnect ||
    manualDisconnect ||
    autoConnectInFlight ||
    operationInProgress.value
  ) {
    return;
  }
  const connectedPort = relayStatus.value.port ?? serialStatus.value.port;
  if (
    (relayStatus.value.connected || serialStatus.value.connected) &&
    connectedPort === port
  ) {
    return;
  }
  if (Date.now() - autoConnectLastFailureAt < AUTO_CONNECT_RETRY_MS) {
    return;
  }

  autoConnectInFlight = true;
  activeOperation.value = "connect";
  selectedPort.value = port;

  try {
    relayStatus.value = await connectRelay(port);
    connectionState.value = "connected";
    connectionMessage.value = `已自动连接 ${relayStatus.value.port ?? port}`;
    errorMessage.value = "";
    await refreshStatus();
  } catch (error) {
    autoConnectLastFailureAt = Date.now();
    await refreshStatus();
  } finally {
    activeOperation.value = null;
    autoConnectInFlight = false;
  }
}

async function loadPorts(
  background = false,
  force = false,
): Promise<void> {
  if (portScanInFlight || (scanning.value && !force)) {
    return;
  }

  portScanInFlight = true;
  if (!background) {
    scanning.value = true;
  }
  try {
    const nextPorts = await listSerialPorts();
    ports.value = nextPorts;
    const preferredPort =
      findMatchingPort(nextPorts, appConfig.value.deviceRules)?.port.port ?? null;
    selectedPort.value = preferredPort ?? "";

    if (!preferredPort) {
      manualDisconnect = false;
    }

    const connectedPortStillExists =
      !relayStatus.value.connected ||
      nextPorts.some((port) => port.port === relayStatus.value.port);
    if (!connectedPortStillExists) {
      await refreshStatus();
    }

    if (preferredPort) {
      await autoConnectDetectedPort(preferredPort);
    }
  } catch (error) {
    showError(getApiErrorMessage(error));
  } finally {
    portScanInFlight = false;
    if (!background) {
      scanning.value = false;
    }
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
    await requestSerialPort();
    await loadPorts(false, true);
    if (!selectedPort.value) {
      showError("未检测到支持的 USB 继电器设备");
      return;
    }
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

function refreshAppConfig(): void {
  appConfig.value = getAppConfig();
  manualDisconnect = false;
  void refreshStatus();
  void loadPorts(true);
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
    webSerialSupported.value = health.serial_supported;
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
      await ElMessageBox.alert(
        "没有识别到串口设备，请确认 USB 继电器已插入并安装驱动。",
        "无法连接",
        {
          confirmButtonText: "知道了",
          type: "warning",
        },
      );
    }
    return;
  }

  manualDisconnect = false;
  activeOperation.value = "connect";
  const port = selectedPort.value;
  try {
    relayStatus.value = await connectRelay(port);
    connectionState.value = "connected";
    connectionMessage.value = `已连接 ${relayStatus.value.port ?? port}`;
    errorMessage.value = "";
    await refreshStatus();
  } catch (error) {
    const message = getApiErrorMessage(error);
    await refreshStatus();
    showError(message);
  } finally {
    activeOperation.value = null;
  }
}

async function disconnect(): Promise<void> {
  if (operationInProgress.value) {
    return;
  }

  activeOperation.value = "disconnect";
  try {
    relayStatus.value = await disconnectRelay();
    manualDisconnect = true;
    connectionState.value = "disconnected";
    connectionMessage.value = "未连接";
    errorMessage.value = "";
    await refreshStatus();
  } catch (error) {
    const message = getApiErrorMessage(error);
    await refreshStatus();
    showError(message);
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

  activeOperation.value = actionName === "ON" ? "on" : "off";
  try {
    const result = await request();
    relayStatus.value = result.status;
    connectionState.value = "connected";
    connectionMessage.value = `已连接 ${result.status.port ?? ""}`.trim();
    errorMessage.value = "";
  } catch (error) {
    const message = getApiErrorMessage(error);
    await refreshStatus();
    showError(message);
  } finally {
    activeOperation.value = null;
  }
}

onMounted(async () => {
  await initApp();
  refreshAppConfig();
  await Promise.all([loadPorts(), refreshStatus()]);
  portsPollTimer = window.setInterval(() => {
    void loadPorts(true);
  }, PORT_POLL_INTERVAL_MS);
});

onBeforeUnmount(() => {
  if (portsPollTimer !== null) {
    window.clearInterval(portsPollTimer);
    portsPollTimer = null;
  }
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
          <p class="topbar-subtitle">
            Web / 桌面串口控制 · 无需独立后端服务
          </p>
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
          <span>串口服务</span>
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
        <strong>当前环境不支持串口控制</strong>
        <p>
          Web 版请使用 Chrome 或 Edge 89+ 并通过 https 或 localhost
          访问；Windows 用户建议使用桌面版安装包。
        </p>
      </div>
    </section>

    <main class="dashboard-grid">
      <SerialPanel
        :ports="ports"
        :connected-port="relayStatus.port"
        :connected="relayStatus.connected"
        :scanning="scanning"
        :connection-state="connectionState"
        :connection-message="connectionMessage"
        :detected-relay-port="detectedRelayPort"
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
        :channel="appConfig.relay.currentChannel"
        :active-operation="
          activeOperation === 'on' || activeOperation === 'off'
            ? activeOperation
            : null
        "
        @on="runRelayAction('ON', turnRelayOn)"
        @off="runRelayAction('OFF', turnRelayOff)"
      />
    </main>

    <SettingsPanel
      v-model:visible="settingsVisible"
      :selected-port="selectedPort"
      @saved="refreshAppConfig"
    />
  </div>
</template>
