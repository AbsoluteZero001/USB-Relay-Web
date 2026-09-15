<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";

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

const ports = ref<SerialPortInfo[]>([]);
const selectedPort = ref("");
const backendOnline = ref(false);
const scanning = ref(false);
const busy = ref(false);
const relayStatus = ref<RelayStatus>({
  connected: false,
  port: null,
  relay_state: "unknown",
  state_source: "unknown",
});
const lastOperation = ref("尚未执行操作");
const lastCommand = ref("—");

let statusTimer: number | undefined;

const backendLabel = computed(() => (backendOnline.value ? "在线" : "离线"));
const backendTagType = computed<"success" | "danger">(() =>
  backendOnline.value ? "success" : "danger",
);

async function loadPorts(): Promise<void> {
  scanning.value = true;
  try {
    ports.value = await listSerialPorts();
    backendOnline.value = true;
    if (
      !selectedPort.value ||
      !ports.value.some((port) => port.port === selectedPort.value)
    ) {
      selectedPort.value = ports.value[0]?.port ?? "";
    }
    lastOperation.value = `已发现 ${ports.value.length} 个串口`;
  } catch (error) {
    backendOnline.value = false;
    lastOperation.value = getApiErrorMessage(error);
  } finally {
    scanning.value = false;
  }
}

async function refreshStatus(showError = false): Promise<void> {
  try {
    relayStatus.value = await getRelayStatus();
    backendOnline.value = true;
  } catch (error) {
    backendOnline.value = false;
    relayStatus.value = {
      connected: false,
      port: null,
      relay_state: "unknown",
      state_source: "unknown",
    };
    if (showError) {
      lastOperation.value = getApiErrorMessage(error);
    }
  }
}

async function connect(): Promise<void> {
  if (!selectedPort.value) {
    lastOperation.value = "请先选择串口";
    return;
  }

  busy.value = true;
  try {
    relayStatus.value = await connectRelay(selectedPort.value);
    backendOnline.value = true;
    lastOperation.value = `已连接 ${selectedPort.value}`;
    lastCommand.value = "—";
  } catch (error) {
    lastOperation.value = getApiErrorMessage(error);
  } finally {
    busy.value = false;
  }
}

async function disconnect(): Promise<void> {
  busy.value = true;
  try {
    relayStatus.value = await disconnectRelay();
    backendOnline.value = true;
    lastOperation.value = "串口已断开";
    lastCommand.value = "—";
  } catch (error) {
    lastOperation.value = getApiErrorMessage(error);
  } finally {
    busy.value = false;
  }
}

async function runRelayAction(
  action: () => Promise<RelayActionResponse>,
): Promise<void> {
  busy.value = true;
  try {
    const result = await action();
    relayStatus.value = result.status;
    backendOnline.value = true;
    lastOperation.value = result.message;
    lastCommand.value = result.command;
  } catch (error) {
    lastOperation.value = getApiErrorMessage(error);
    lastCommand.value = "发送失败";
    await refreshStatus();
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  await Promise.all([loadPorts(), refreshStatus()]);
  statusTimer = window.setInterval(() => {
    void refreshStatus();
  }, 3000);
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
        <h1>USB Relay Console</h1>
      </div>
      <div class="backend-state">
        <span>后端</span>
        <el-tag :type="backendTagType" effect="dark">
          {{ backendLabel }}
        </el-tag>
      </div>
    </header>

    <main class="dashboard-grid">
      <SerialPanel
        v-model:selected-port="selectedPort"
        :ports="ports"
        :connected-port="relayStatus.port"
        :connected="relayStatus.connected"
        :busy="busy"
        :scanning="scanning"
        @refresh="loadPorts"
        @connect="connect"
        @disconnect="disconnect"
      />

      <RelayCard
        :status="relayStatus"
        :busy="busy"
        @on="runRelayAction(turnRelayOn)"
        @off="runRelayAction(turnRelayOff)"
      />
    </main>

    <section class="operation-result" aria-live="polite">
      <div>
        <p class="section-label">LAST OPERATION</p>
        <strong>{{ lastOperation }}</strong>
      </div>
      <div class="command-result">
        <span>TX</span>
        <code>{{ lastCommand }}</code>
      </div>
    </section>
  </div>
</template>
