<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus";

import {
  getAppConfig,
  updateAppConfig,
  type AppConfig,
  type SerialPortInfo,
} from "../api/relay";
import {
  formatHexBytes,
  HexValidationError,
  parseHexBytes,
} from "../services/hex";
import type {
  FlowControl,
  Parity,
} from "../services/serial/types";

const props = defineProps<{
  visible: boolean;
  ports: SerialPortInfo[];
  selectedPort: string;
}>();

const emit = defineEmits<{
  "update:visible": [value: boolean];
  "update:selectedPort": [value: string];
  saved: [];
}>();

const baudRateOptions = [
  1200,
  2400,
  4800,
  9600,
  19200,
  38400,
  57600,
  115200,
];
const dataBitsOptions: Array<5 | 6 | 7 | 8> = [5, 6, 7, 8];
const stopBitsOptions: Array<1 | 1.5 | 2> = [1, 1.5, 2];
const parityOptions: { value: Parity; label: string }[] = [
  { value: "none", label: "无" },
  { value: "even", label: "偶校验" },
  { value: "odd", label: "奇校验" },
];
const flowControlOptions: { value: FlowControl; label: string }[] = [
  { value: "none", label: "无" },
  { value: "hardware", label: "RTS/CTS" },
  { value: "software", label: "XON/XOFF" },
];

const form = reactive<AppConfig>(getAppConfig());
const selectedPortValue = ref(props.selectedPort);
const onCommandHex = ref(formatHexBytes(form.relay.onCommand));
const offCommandHex = ref(formatHexBytes(form.relay.offCommand));

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      Object.assign(form, getAppConfig());
      selectedPortValue.value = props.selectedPort;
      onCommandHex.value = formatHexBytes(form.relay.onCommand);
      offCommandHex.value = formatHexBytes(form.relay.offCommand);
    }
  },
);

watch(
  () => props.selectedPort,
  (value) => {
    if (props.visible) {
      selectedPortValue.value = value;
    }
  },
);

const onCommandError = computed(() => hexError(onCommandHex.value));
const offCommandError = computed(() => hexError(offCommandHex.value));

function hexError(value: string): string {
  try {
    parseHexBytes(value);
    return "";
  } catch (error) {
    return error instanceof HexValidationError
      ? error.message
      : "HEX 指令不合法";
  }
}

function parseRequiredHex(
  value: string,
  label: string,
): number[] | null {
  try {
    return parseHexBytes(value);
  } catch (error) {
    const detail =
      error instanceof HexValidationError ? error.message : "HEX 指令不合法";
    ElMessage.error(`${label}：${detail}`);
    return null;
  }
}

async function handleSave(): Promise<void> {
  const onBytes = parseRequiredHex(onCommandHex.value, "ON 指令");
  if (!onBytes) return;
  const offBytes = parseRequiredHex(offCommandHex.value, "OFF 指令");
  if (!offBytes) return;

  const channels = Math.min(
    32,
    Math.max(1, Math.trunc(form.relay.channels || 1)),
  );
  form.relay.channels = channels;
  form.relay.currentChannel = Math.min(
    channels,
    Math.max(1, Math.trunc(form.relay.currentChannel || 1)),
  );
  form.relay.onCommand = onBytes;
  form.relay.offCommand = offBytes;
  form.selectedPort = selectedPortValue.value || null;

  try {
    await updateAppConfig({ ...form });
    emit("update:selectedPort", selectedPortValue.value);
    ElMessage.success("配置已保存");
    emit("saved");
    emit("update:visible", false);
  } catch (error) {
    ElMessage.error(
      error instanceof Error ? error.message : "保存配置失败",
    );
  }
}

function handleClose(): void {
  emit("update:visible", false);
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="设备 / 继电器设置"
    class="settings-dialog"
    width="680px"
    :close-on-click-modal="false"
    @update:model-value="(v: boolean) => emit('update:visible', v)"
  >
    <el-form label-width="104px" label-position="left">
      <el-divider content-position="left">串口参数</el-divider>
      <div class="settings-parameter-grid">
        <el-form-item label="串口" class="parameter-wide">
          <el-select
            v-model="selectedPortValue"
            placeholder="选择串口"
            filterable
          >
            <el-option
              v-for="port in ports"
              :key="port.port"
              :label="`${port.port} · ${port.description}`"
              :value="port.port"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="波特率">
          <el-select v-model="form.relay.serial.baudRate">
            <el-option
              v-for="rate in baudRateOptions"
              :key="rate"
              :label="rate"
              :value="rate"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="数据位">
          <el-select v-model="form.relay.serial.dataBits">
            <el-option
              v-for="bits in dataBitsOptions"
              :key="bits"
              :label="bits"
              :value="bits"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="校验位">
          <el-select v-model="form.relay.serial.parity">
            <el-option
              v-for="option in parityOptions"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="停止位">
          <el-select v-model="form.relay.serial.stopBits">
            <el-option
              v-for="bits in stopBitsOptions"
              :key="bits"
              :label="bits"
              :value="bits"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="流控" class="parameter-wide">
          <el-select v-model="form.relay.serial.flowControl">
            <el-option
              v-for="option in flowControlOptions"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </el-select>
        </el-form-item>
      </div>

      <el-divider content-position="left">继电器参数</el-divider>
      <el-form-item label="协议模式">
        <el-select v-model="form.relay.protocol">
          <el-option label="自定义 HEX" value="custom_hex" />
          <el-option label="Modbus RTU（暂未实现）" disabled value="modbus_rtu" />
        </el-select>
      </el-form-item>
      <div class="settings-parameter-grid">
        <el-form-item label="通道数">
          <el-input-number
            v-model="form.relay.channels"
            :min="1"
            :max="32"
          />
        </el-form-item>
        <el-form-item label="当前通道">
          <el-input-number
            v-model="form.relay.currentChannel"
            :min="1"
            :max="form.relay.channels"
          />
        </el-form-item>
      </div>
      <el-form-item label="ON 指令" :error="onCommandError">
        <el-input
          v-model="onCommandHex"
          placeholder="A0 01 01 A2"
          :status="onCommandError ? 'error' : ''"
        />
      </el-form-item>
      <el-form-item label="OFF 指令" :error="offCommandError">
        <el-input
          v-model="offCommandHex"
          placeholder="A0 01 00 A1"
          :status="offCommandError ? 'error' : ''"
        />
      </el-form-item>

      <el-divider content-position="left">连接行为</el-divider>
      <el-form-item label="自动连接">
        <el-switch v-model="form.autoConnect" />
        <span class="form-hint-inline">启动或插入设备时自动连接</span>
      </el-form-item>
      <el-form-item label="自动重连">
        <el-switch v-model="form.autoReconnect" />
        <span class="form-hint-inline">设备断开后自动重连</span>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="handleClose">取消</el-button>
      <el-button type="primary" @click="handleSave">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.form-hint-inline {
  margin-left: 12px;
  font-size: 13px;
  color: #8fa09e;
}

.settings-parameter-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 18px;
}

.parameter-wide {
  grid-column: 1 / -1;
}

@media (max-width: 600px) {
  .settings-parameter-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .parameter-wide {
    grid-column: auto;
  }
}
</style>
