<script setup lang="ts">
import { Delete, Refresh } from "@element-plus/icons-vue";

import type { AuditLogEntry } from "../api/relay";

defineProps<{
  entries: AuditLogEntry[];
  loading: boolean;
  clearing: boolean;
}>();

const emit = defineEmits<{
  refresh: [];
  clear: [];
}>();

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function actionTagType(
  action: string,
): "success" | "danger" | "warning" | "info" {
  if (action === "ON") {
    return "success";
  }
  if (action === "OFF") {
    return "danger";
  }
  if (action === "DISCONNECT") {
    return "warning";
  }
  return "info";
}
</script>

<template>
  <section class="panel log-panel">
    <header class="panel-header">
      <div>
        <p class="section-label">AUDIT TRAIL</p>
        <h2>最近操作日志</h2>
      </div>
      <div class="log-actions">
        <el-tooltip content="刷新日志" placement="top">
          <el-button
            :icon="Refresh"
            :loading="loading"
            :disabled="clearing"
            aria-label="刷新日志"
            @click="emit('refresh')"
          />
        </el-tooltip>
        <el-button
          type="danger"
          plain
          :icon="Delete"
          :loading="clearing"
          :disabled="loading || entries.length === 0"
          @click="emit('clear')"
        >
          清空日志
        </el-button>
      </div>
    </header>

    <div class="log-table-wrap">
      <table class="log-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>动作</th>
            <th>HEX</th>
            <th>端口</th>
            <th>结果</th>
            <th>错误代码</th>
            <th>说明</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="entries.length === 0">
            <td colspan="7" class="empty-log">暂无操作日志</td>
          </tr>
          <tr v-for="(entry, index) in entries" :key="`${entry.timestamp}-${index}`">
            <td class="log-time">{{ formatTimestamp(entry.timestamp) }}</td>
            <td>
              <el-tag :type="actionTagType(entry.action)" size="small">
                {{ entry.action }}
              </el-tag>
            </td>
            <td><code>{{ entry.hex || "—" }}</code></td>
            <td>{{ entry.port || "—" }}</td>
            <td>
              <span :class="['result-label', entry.result]">
                {{ entry.result === "success" ? "成功" : "失败" }}
              </span>
            </td>
            <td class="log-error">{{ entry.error_code || "—" }}</td>
            <td class="log-detail" :title="entry.detail">
              {{ entry.detail }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
