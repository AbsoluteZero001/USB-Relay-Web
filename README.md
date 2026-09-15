# USB-Relay-Web

运行在 Windows 本机上的 USB 继电器 Web 控制系统。浏览器中的 Vue 3 Dashboard 调用 FastAPI，服务层通过 PySerial 打开 CH340 串口，并使用已经实机验证的 LCUS-1 HEX 指令控制 1 路继电器。

项目当前完成第三阶段：在真实硬件控制闭环上，增加串口生命周期状态机、健康检查、内存操作审计、前端日志视图和交付级错误处理。仍不包含登录、数据库、权限、WebSocket、Docker 或云端控制。

## 技术栈

- 前端：Vue 3、TypeScript、Vite、Axios、Element Plus
- 后端：Python 3.12+、FastAPI、Uvicorn、PySerial
- 数据模型与配置：Pydantic、pydantic-settings
- 测试：pytest、FastAPI TestClient、fake serial

## 系统架构

```text
Vue 3 Dashboard
      │ HTTP / JSON
      ▼
FastAPI (/api)
      ├── HealthService ── /api/health
      ├── AuditLogService ── /api/logs
      ▼
RelayService
      │ LCUS-1 指令
      ▼
SerialService
      │ 串行化写入
      ▼
PySerial
      │
      ▼
Windows COM3 / CH340
      │
      ▼
LCUS-1 Relay 1
```

代码边界：

- API 层只解析请求、调用服务和返回模型，不直接操作 PySerial。
- `RelayService` 只处理继电器业务和固定协议，不管理串口对象生命周期。
- `SerialService` 只管理串口扫描、连接、断开和写入，不包含继电器业务。
- 写入由 `threading.RLock` 保护，避免并发请求把指令字节交错发送。
- `AuditLogService` 独立维护内存操作记录，API 路由不保存审计数据。
- `SerialService` 只维护一个当前串口对象，并在异常后清除失效句柄。

## 第二阶段功能

- 串口扫描返回 `port`、`device`、`description`、`manufacturer`、`hwid` 和 `is_current`。
- 对同一端口重复执行连接是幂等的，不会创建第二个串口对象。
- 连接另一个端口时，先安全断开旧端口，再尝试打开新端口。
- ON/OFF 请求分别在本地日志中记录时间、动作、端口、HEX、结果和错误代码。
- 前端轮询带防重入保护，不会因为请求慢而叠加状态查询。
- 端口刷新不会自动切换到另一个 COM；原端口消失时会保留明确错误。
- ON/OFF 各自拥有独立 loading，请求结束或失败后都会恢复按钮。
- 前端区分未连接、已连接、设备断开和串口异常，并显示结构化最近操作。

## 第三阶段功能

- 串口生命周期状态为 `disconnected`、`connecting`、`connected`、`error`。
- `GET /api/serial/status` 返回状态、端口、设备名称、波特率和错误信息。
- `GET /api/health` 用于前端判断后端在线，不要求继电器硬件存在。
- `GET /api/logs` 返回最近 20 条操作记录，支持 `limit` 和 `offset`。
- `DELETE /api/logs` 清空当前进程的内存日志。
- FastAPI shutdown 会关闭当前串口，避免后端退出后继续占用 COM。
- 浏览器刷新或重新打开不会自动发送 ON，也不会恢复上次运行状态。

## 已验证硬件与协议

硬件链路：

```text
Windows USB
  → USB-SERIAL CH340
  → COM3
  → 丢石头 LCUS-1 1路 USB 继电器
```

默认串口参数：

| 参数 | 值 |
| --- | --- |
| 波特率 | `9600` |
| 数据位 | `8` |
| 校验位 | `None` |
| 停止位 | `1` |
| 工作方式 | HEX |

已验证的 Relay 1 指令：

| 操作 | HEX | 实机现象 |
| --- | --- | --- |
| Relay 1 ON | `A0 01 01 A2` | 继电器吸合，红灯亮 |
| Relay 1 OFF | `A0 01 00 A1` | Relay 1 关闭 |

这两条指令已经由 SSCOM V5.13.1 实测确认。项目按原值发送，不做协议猜测或额外编码。

## 状态说明

LCUS-1 当前没有经过验证的状态回读协议，因此 API 不声称从硬件读取到了继电器状态。`relay_state` 仅表示“软件最近一次成功发送的 ON/OFF 指令”：

- `on`：软件最近一次成功发送了 ON。
- `off`：软件最近一次成功发送了 OFF。
- `unknown`：尚未发送、串口已断开，或最近一次写入失败。

当 `state_source` 为 `software_last_command` 时，响应表示软件记录，不代表硬件确认回读。Dashboard 对这一项的固定文案是“状态来源：软件最后一次命令”。

后端重新启动、串口断开、写入失败或显式断开后，继电器状态回到 `unknown`。项目明确禁止自动恢复上次 ON 状态。

## 串口生命周期

```text
disconnected
    │ connect
    ▼
connecting
    ├── success ──► connected
    ├── connect error ──► error
    └── explicit disconnect

connected
    ├── write error / unplug ──► error
    └── explicit disconnect ──► disconnected

error
    └── disconnect / new connection attempt ──► disconnected / connecting
```

`error` 状态可能保留最后一次尝试的端口，便于用户识别，但 `connected=false`，且内部串口对象已清除。再次连接前不需要重启后端，但必须先处理设备或占用问题。

## 开发环境

- Windows 10/11
- Python 3.12 或更高版本
- Node.js 20 或更高版本
- CH340 驱动
- 已确认端口号，例如 `COM3`

## 启动后端

在 PowerShell 中执行：

```powershell
cd D:\GitHub\USB-Relay-Web\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000
```

启动后可访问：

- Swagger：<http://127.0.0.1:8000/docs>
- OpenAPI JSON：<http://127.0.0.1:8000/openapi.json>

如果 PowerShell 阻止激活脚本，可以只对当前终端放行：

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

然后重新执行激活命令。

## 启动前端

另开一个 PowerShell：

```powershell
cd D:\GitHub\USB-Relay-Web\frontend
npm install
npm run dev
```

访问 <http://127.0.0.1:5173>。

前端默认请求 `http://127.0.0.1:8000/api`。如需修改，可在 `frontend/.env` 中设置：

```dotenv
VITE_API_BASE_URL=http://127.0.0.1:8000/api
```

后端只允许以下开发来源跨域访问：

- `http://localhost:5173`
- `http://127.0.0.1:5173`

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/serial/ports` | 返回端口、设备、描述、制造商、HWID 和当前连接标记 |
| `GET` | `/api/serial/status` | 返回串口生命周期状态、端口、设备、波特率 |
| `POST` | `/api/relay/connect` | 请求体示例：`{"port":"COM3"}` |
| `POST` | `/api/relay/disconnect` | 关闭当前串口 |
| `POST` | `/api/relay/on` | 实际发送 `A0 01 01 A2` |
| `POST` | `/api/relay/off` | 实际发送 `A0 01 00 A1` |
| `GET` | `/api/relay/status` | 返回连接、端口及软件状态 |
| `GET` | `/api/logs` | 返回内存操作日志，支持 `limit`、`offset` |
| `DELETE` | `/api/logs` | 清空内存操作日志 |
| `GET` | `/api/health` | 返回服务状态和串口连接状态 |

所有业务错误沿用现有统一结构：

```json
{
  "detail": "串口 COM3 正在被其他程序占用，请关闭 SSCOM 等串口软件后重试",
  "code": "SERIAL_PORT_BUSY"
}
```

未知后端异常也会转换为稳定的 `INTERNAL_SERVER_ERROR`，不会把 Python traceback 返回给浏览器。

## TX 日志

每次实际执行 ON/OFF 时，后端会输出一行可检索的 JSON 日志，并写入内存审计服务：

```text
relay_command {"timestamp":"2026-09-15T07:02:11.123456Z","action":"ON","command":"RELAY_ON","hex":"A0 01 01 A2","port":"COM3","result":"success","error_code":null,"detail":"Relay 1 ON 指令发送成功"}
```

失败时会包含 `error_code` 和用户可读的 `detail`，例如 `SERIAL_WRITE_FAILED`。内存日志最多保留最近 500 条，进程退出后自动消失，不引入数据库。

查询示例：

```powershell
Invoke-RestMethod "http://127.0.0.1:8000/api/logs?limit=20&offset=0"
Invoke-RestMethod -Method Delete http://127.0.0.1:8000/api/logs
```

## 真实测试流程

第一次使用 LCUS-1 + CH340 时，按以下顺序操作：

1. 插入 USB 继电器。
2. 确认 Windows 已安装 CH340 驱动。
3. 关闭 SSCOM、Arduino 串口监视器及其他串口工具。
4. 启动 backend。
5. 启动 frontend。
6. 打开 Dashboard。
7. 选择目标端口，当前实机为 `COM3`。
8. 点击“连接”，确认设备状态显示 `已连接 COM3`。
9. 点击 `ON`，页面显示发送成功，命令为 `A0 01 01 A2`。
10. 确认继电器发出“啪”的吸合声。
11. 确认 Relay 1 LED 状态变化。
12. 点击 `OFF`，页面显示发送成功，命令为 `A0 01 00 A1`。
13. 确认继电器释放，LED 恢复关闭状态。
14. 点击“断开”，确认串口释放。
15. 访问 `/api/health`，确认后端在线且 `serial_connected=false`。
16. 打开“最近操作日志”，确认 CONNECT、ON、OFF、DISCONNECT 按时间倒序显示。

软件当前无法读取 LCUS-1 的真实硬件状态。页面中的 ON/OFF 是“软件最后一次命令”记录，不是硬件回读结果。

也可以使用 PowerShell 调用 API：

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/serial/ports
Invoke-RestMethod -Method Post `
  -Uri http://127.0.0.1:8000/api/relay/connect `
  -ContentType "application/json" `
  -Body '{"port":"COM3"}'
Invoke-RestMethod -Method Post http://127.0.0.1:8000/api/relay/on
Invoke-RestMethod -Method Post http://127.0.0.1:8000/api/relay/off
```

## 自动化测试

后端测试不依赖真实继电器：

```powershell
cd D:\GitHub\USB-Relay-Web\backend
.\.venv\Scripts\python.exe -m pytest -q
```

前端类型检查和生产构建：

```powershell
cd D:\GitHub\USB-Relay-Web\frontend
npm run typecheck
npm run build
```

Python 静态检查在仓库根目录执行：

```powershell
npx --yes pyright@latest
```

根目录的 `pyrightconfig.json` 已将 `backend` 配置为源码根，并关联
`backend/.venv`。IDE 如仍显示旧诊断，请将 Python 解释器切换为
`D:\GitHub\USB-Relay-Web\backend\.venv\Scripts\python.exe`，然后重启语言服务器。

## Windows 使用注意事项

- CH340 必须已安装正确驱动；设备管理器中应能看到对应 COM 端口。
- 同一个 COM 口在同一时间只能由一个程序打开。运行本服务前先关闭 SSCOM、Arduino 串口监视器等程序，否则会返回端口占用错误。
- COM 号由 Windows 分配，更换 USB 口后可能改变。项目通过扫描动态发现端口，不把 `COM3` 写死为唯一设备。
- 后端必须在 `backend` 目录启动，否则 `app.main:app` 无法导入。
- 页面显示 `UNKNOWN` 是预期行为，因为当前协议没有状态回读。只有在本次连接中成功发送 ON/OFF 后，软件状态才会变为 `ON/OFF`。
- 拔掉 USB 后在下次通信时服务会捕获异常并清理失效连接；重新插入设备后需刷新端口并再次连接。
- 关闭浏览器不会发送 OFF，也不会恢复上次 ON；需要关闭继电器时应点击页面中的“关闭继电器 / OFF”。
- 后端正常退出会自动释放串口；非正常强制结束进程时，应由操作系统回收句柄。
- 继电器可能连接真实负载。进行接线和通电测试前，应确认负载电压、电流和隔离要求，并遵守设备额定参数。

## 常见错误

| 错误代码 | 原因 | 处理方式 |
| --- | --- | --- |
| `SERIAL_PORT_BUSY` | COM 口被 SSCOM 等程序占用 | 关闭占用程序，点击刷新后重新连接 |
| `SERIAL_PORT_NOT_FOUND` | 设备未插入、驱动异常或 COM 号变化 | 检查设备管理器，刷新串口并重新选择 |
| `SERIAL_NOT_CONNECTED` | 尚未连接或连接已经释放 | 先连接目标 COM，再执行 ON/OFF |
| `SERIAL_WRITE_FAILED` | USB 被拔出或串口写入失败 | 检查 USB，刷新端口并重新连接 |
| `SERIAL_PORT_SCAN_FAILED` | Windows 串口服务或扫描层异常 | 检查系统串口服务并查看后端日志 |
| `INTERNAL_SERVER_ERROR` | 未预期的后端异常 | 查看终端日志，不要向用户展示 traceback |

设备在操作中断开后，前端会收到明确错误，后端会清除失效连接；本阶段没有自动重连。

## 环境变量

后端支持 `USB_RELAY_` 前缀配置，示例见 `backend/.env.example`。硬件通信参数默认值已按实机验证结果设置，不应随意修改。

## 第三阶段边界

当前未实现用户登录、数据库、Redis、WebSocket、Docker、权限系统、多设备管理、云端控制、自动重连、定时任务和复杂主题。操作日志仅存在于后端内存。没有实现硬件状态回读，也没有加入 `FF` 查询、多路协议或未知协议自动探测，因为当前只验证了 Relay 1 的 ON/OFF 两条控制指令。
