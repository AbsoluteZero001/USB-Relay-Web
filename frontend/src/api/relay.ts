import axios from "axios";

export type RelayState = "on" | "off" | "unknown";
export type RelayStateSource = "software_last_command" | "unknown";
export type SerialConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface SerialPortInfo {
  port: string;
  device: string;
  description: string;
  manufacturer: string | null;
  hwid: string | null;
  is_current: boolean;
}

export interface RelayStatus {
  connected: boolean;
  port: string | null;
  relay_state: RelayState;
  state_source: RelayStateSource;
}

export interface RelayActionResponse {
  success: boolean;
  message: string;
  command: string;
  status: RelayStatus;
}

export interface SerialStatus {
  state: SerialConnectionState;
  port: string | null;
  device: string | null;
  baudrate: number;
  connected: boolean;
  error_code: string | null;
  detail: string | null;
}

export interface HealthResponse {
  status: "ok";
  service: string;
  serial_connected: boolean;
}

export interface AuditLogEntry {
  timestamp: string;
  action: string;
  command: string | null;
  hex: string | null;
  port: string | null;
  result: "success" | "failed";
  error_code: string | null;
  detail: string;
}

export interface AuditLogPage {
  items: AuditLogEntry[];
  total: number;
  limit: number;
  offset: number;
}

interface ApiErrorResponse {
  detail?: string;
  code?: string;
}

const api = axios.create({
  baseURL:
    import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000/api",
  timeout: 5000,
});

export async function listSerialPorts(): Promise<SerialPortInfo[]> {
  const response = await api.get<SerialPortInfo[]>("/serial/ports");
  return response.data;
}

export async function connectRelay(port: string): Promise<RelayStatus> {
  const response = await api.post<RelayStatus>("/relay/connect", { port });
  return response.data;
}

export async function disconnectRelay(): Promise<RelayStatus> {
  const response = await api.post<RelayStatus>("/relay/disconnect");
  return response.data;
}

export async function turnRelayOn(): Promise<RelayActionResponse> {
  const response = await api.post<RelayActionResponse>("/relay/on");
  return response.data;
}

export async function turnRelayOff(): Promise<RelayActionResponse> {
  const response = await api.post<RelayActionResponse>("/relay/off");
  return response.data;
}

export async function getRelayStatus(): Promise<RelayStatus> {
  const response = await api.get<RelayStatus>("/relay/status");
  return response.data;
}

export async function getSerialStatus(): Promise<SerialStatus> {
  const response = await api.get<SerialStatus>("/serial/status");
  return response.data;
}

export async function getHealth(): Promise<HealthResponse> {
  const response = await api.get<HealthResponse>("/health");
  return response.data;
}

export async function listAuditLogs(
  limit = 20,
  offset = 0,
): Promise<AuditLogPage> {
  const response = await api.get<AuditLogPage>("/logs", {
    params: { limit, offset },
  });
  return response.data;
}

export async function clearAuditLogs(): Promise<{ deleted: number }> {
  const response = await api.delete<{ deleted: number }>("/logs");
  return response.data;
}

export function getApiErrorMessage(error: unknown): string {
  if (axios.isAxiosError<ApiErrorResponse>(error)) {
    if (!error.response) {
      return "无法连接后端，请确认 FastAPI 已在 8000 端口启动";
    }

    const detail = error.response.data?.detail;
    if (typeof detail === "string" && detail) {
      return detail;
    }
    if (error.response.status === 422) {
      return "请求参数不合法";
    }
    return `请求失败 (HTTP ${error.response.status})`;
  }

  return error instanceof Error ? error.message : "发生未知错误";
}
