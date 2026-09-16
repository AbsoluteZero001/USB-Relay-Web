<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { Close } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";

import {
  getAppConfig,
  updateAppConfig,
  type AppConfig,
} from "../api/relay";
import type { Parity, FlowControl } from "../services/serial/types";
import type { DeviceMatchRule } from "../services/device-rules";

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  "update:visible": [value: boolean];
  saved: [];
}>();

const baudRateOptions = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];
const dataBitsOptions: Array<5 | 6 | 7 | 8> = [5, 6, 7, 8];
const stopBitsOptions: Array<1 | 1.5 | 2> = [1, 1.5, 2];
const parityOptions: { value: Parity; label: string }[] = [
  { value: "none", label: "无校验" },
  { value: "even", label: "偶校验" },
  { value: "odd", label: "奇校验" },
  { value: "mark", label: "标记校验" },
  { value: "space", label: "空格校验" },
];
const flowControlOptions: { value: FlowControl; label: string }[] = [
  { value: "none", label: "无流控制" },
  { value: "software", label: "软件流控制 (XON/XOFF)" },
  { value: "hardware", label: "硬件流控制 (RTS/CTS)" },
];

const form = reactive<AppConfig>(getAppConfig());

const onCommandHex = ref(bytesToHex(form.relay.onCommand));
const offCommandHex = ref(bytesToHex(form.relay.offCommand));

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      Object.assign(form, getAppConfig());
      onCommandHex.value = bytesToHex(form.relay.onCommand);
      offCommandHex.value = bytesToHex(form.relay.offCommand);
    }
  },
);

const onCommandValid = computed(() => parseHexBytes(onCommandHex.value) !== null);
const offCommandValid = computed(() => parseHexBytes(offCommandHex.value) !== null);

function bytesToHex(bytes: number[]): string {
  return bytes
    .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
    .join(" ");
}

function parseHexBytes(text: string): number[] | null {
  const cleaned = text.trim().replace(/\s+/g, " ");
  if (!cleaned) return null;
  const parts = cleaned.split(" ");
  const result: number[] = [];
  for (const part of parts) {
    if (!/^[0-9a-fA-F]{1,2}$/.test(part)) return null;
    result.push(Number.parseInt(part, 16));
  }
  return result.length > 0 ? result : null;
}

function addRule(): void {
  form.deviceRules.push({
    name: "新设备",
    vendorId: "",
    productId: "",
  });
}

function removeRule(index: number): void {
  form.deviceRules.splice(index, 1);
}

async function handleSave(): Promise<void> {
  const onBytes = parseHexBytes(onCommandHex.value);
  const offBytes = parseHexBytes(offCommandHex.value);
  if (!onBytes || !offBytes) {
    ElMessage.error("HEX 指令格式不正确，请使用空格分隔的十六进制字节");
    return;
  }

  form.relay.onCommand = onBytes;
  form.relay.offCommand = offBytes;

  try {
    await updateAppConfig({ ...form });
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
    width="640px"
    :close-on-click-modal="false"
    @update:model-value="(v: boolean) => emit('update:visible', v)"
  >
    <el-form label-width="110px" label-position="left">
      <el-divider content-position="left">串口参数</el-divider>
      <div class="settings-parameter-grid">
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
        <el-form-item label="校验位">
          <el-select v-model="form.relay.serial.parity">
            <el-option
              v-for="opt in parityOptions"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="流控制" class="parameter-wide">
          <el-select v-model="form.relay.serial.flowControl">
            <el-option
              v-for="opt in flowControlOptions"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
        </el-form-item>
      </div>

      <el-divider content-position="left">继电器参数</el-divider>
      <el-form-item label="继电器路数">
        <el-input-number
          v-model="form.relay.channels"
          :min="1"
          :max="32"
        />
      </el-form-item>
      <el-form-item label="ON 指令 (HEX)">
        <el-input
          v-model="onCommandHex"
          placeholder="A0 01 01 A2"
          :status="onCommandValid ? '' : 'error'"
        />
        <p class="form-hint">空格分隔的十六进制字节，例如 A0 01 01 A2</p>
      </el-form-item>
      <el-form-item label="OFF 指令 (HEX)">
        <el-input
          v-model="offCommandHex"
          placeholder="A0 01 00 A1"
          :status="offCommandValid ? '' : 'error'"
        />
        <p class="form-hint">空格分隔的十六进制字节，例如 A0 01 00 A1</p>
      </el-form-item>

      <el-divider content-position="left">设备识别规则</el-divider>
      <div
        v-for="(rule, index) in form.deviceRules"
        :key="index"
        class="rule-row"
      >
        <el-input
          v-model="rule.name"
          placeholder="设备名称"
          style="width: 140px"
        />
        <el-input
          v-model="rule.vendorId"
          placeholder="厂商编号 (VID)"
          style="width: 110px"
        />
        <el-input
          v-model="rule.productId"
          placeholder="产品编号 (PID)"
          style="width: 110px"
        />
        <el-button
          type="danger"
          text
          :icon="Close"
          @click="removeRule(index)"
        />
      </div>
      <el-button text type="primary" @click="addRule">+ 添加识别规则</el-button>

      <el-divider content-position="left">连接行为</el-divider>
      <el-form-item label="自动连接">
        <el-switch v-model="form.autoConnect" />
        <span class="form-hint-inline">启动或插入设备时自动连接</span>
      </el-form-item>
      <el-form-item label="自动重连">
        <el-switch v-model="form.autoReconnect" />
        <span class="form-hint-inline">设备断开后自动重连</span>
      </el-form-item>
      <el-form-item label="重连间隔 (ms)">
        <el-input-number
          v-model="form.reconnectIntervalMs"
          :min="500"
          :max="60000"
          :step="500"
          style="width: 140px"
        />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="handleClose">取消</el-button>
      <el-button type="primary" @click="handleSave">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.form-hint {
  margin: 4px 0 0;
  font-size: 12px;
  color: #8fa09e;
}

.form-hint-inline {
  margin-left: 12px;
  font-size: 13px;
  color: #8fa09e;
}

.rule-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}

.settings-parameter-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 18px;
}

.settings-parameter-grid :deep(.el-select) {
  width: 100%;
}

.parameter-wide {
  grid-column: 1 / -1;
}

@media (max-width: 560px) {
  .settings-parameter-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .parameter-wide {
    grid-column: auto;
  }
}
</style>
