<script setup lang="ts">
import { computed } from "vue";
import { Connection, Refresh, SwitchButton } from "@element-plus/icons-vue";

import type { SerialPortInfo } from "../api/relay";

const props = defineProps<{
  ports: SerialPortInfo[];
  selectedPort: string;
  connectedPort: string | null;
  connected: boolean;
  busy: boolean;
  scanning: boolean;
}>();

const emit = defineEmits<{
  "update:selectedPort": [value: string];
  refresh: [];
  connect: [];
  disconnect: [];
}>();

const selectedPortInfo = computed(
  () => props.ports.find((port) => port.port === props.selectedPort) ?? null,
);

function handlePortChange(value: string): void {
  emit("update:selectedPort", value);
}
</script>

<template>
  <section class="panel">
    <header class="panel-header">
      <div>
        <p class="section-label">SERIAL LINK</p>
        <h2>串口连接</h2>
      </div>
      <el-tag :type="connected ? 'success' : 'info'" effect="dark" size="small">
        {{ connected ? "已连接" : "未连接" }}
      </el-tag>
    </header>

    <div class="field-group">
      <label for="serial-port">串口设备</label>
      <div class="port-row">
        <el-select
          id="serial-port"
          :model-value="selectedPort"
          placeholder="选择串口"
          :disabled="connected || busy"
          filterable
          class="port-select"
          @update:model-value="handlePortChange"
        >
          <el-option
            v-for="port in ports"
            :key="port.port"
            :label="`${port.port} · ${port.description}`"
            :value="port.port"
          />
        </el-select>
        <el-tooltip content="刷新串口列表" placement="top">
          <el-button
            :icon="Refresh"
            :loading="scanning"
            :disabled="connected || busy"
            aria-label="刷新串口列表"
            @click="emit('refresh')"
          />
        </el-tooltip>
      </div>
    </div>

    <dl class="device-meta">
      <div>
        <dt>设备</dt>
        <dd>{{ selectedPortInfo?.port || "未选择" }}</dd>
      </div>
      <div>
        <dt>型号</dt>
        <dd>{{ selectedPortInfo?.description || "—" }}</dd>
      </div>
      <div>
        <dt>参数</dt>
        <dd>9600 / 8N1</dd>
      </div>
      <div>
        <dt>制造商</dt>
        <dd>{{ selectedPortInfo?.manufacturer || "—" }}</dd>
      </div>
    </dl>

    <div class="panel-actions">
      <el-button
        v-if="!connected"
        type="primary"
        :icon="Connection"
        :loading="busy"
        :disabled="!selectedPort"
        @click="emit('connect')"
      >
        连接
      </el-button>
      <el-button
        v-else
        :icon="SwitchButton"
        :loading="busy"
        @click="emit('disconnect')"
      >
        断开
      </el-button>
    </div>
  </section>
</template>
