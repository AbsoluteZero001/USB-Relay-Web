# USB-Relay-Web

运行在 Windows 本机上的 USB 继电器 Web 控制系统。浏览器中的 Vue 3 Dashboard 调用 FastAPI，服务层通过 PySerial 打开 CH340 串口，并使用已经实机验证的 LCUS-1 HEX 指令控制 1 路继电器。

本项目第一阶段只实现基础框架、串口层、继电器控制核心、基础 API 和最小 Dashboard，不包含登录、数据库、权限、WebSocket、Docker 或云端控制。

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
      │
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

当 `state_source` 为 `software_last_command` 时，响应表示软件记录，不代表硬件确认回读。

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
| `GET` | `/api/serial/ports` | 返回当前串口、描述、制造商和 HWID |
| `POST` | `/api/relay/connect` | 请求体示例：`{"port":"COM3"}` |
| `POST` | `/api/relay/disconnect` | 关闭当前串口 |
| `POST` | `/api/relay/on` | 实际发送 `A0 01 01 A2` |
| `POST` | `/api/relay/off` | 实际发送 `A0 01 00 A1` |
| `GET` | `/api/relay/status` | 返回连接、端口及软件状态 |

## 测试真实 COM3 + LCUS-1

1. 关闭 SSCOM、串口助手或其他占用 `COM3` 的程序。
2. 在 Windows“设备管理器 → 端口”确认设备显示为 `USB-SERIAL CH340 (COM3)`。
3. 启动后端，打开 Swagger。
4. 调用 `GET /api/serial/ports`，确认列表中的 `port` 为 `COM3`。
5. 调用 `POST /api/relay/connect`，请求体使用 `{"port":"COM3"}`，确认返回 `connected=true`。
6. 调用 `POST /api/relay/on`。预期后端日志出现 `TX A0 01 01 A2`，继电器吸合并亮红灯。
7. 调用 `POST /api/relay/off`。预期后端日志出现 `TX A0 01 00 A1`，继电器关闭。
8. 启动前端，在页面中选择 `COM3`，连接后使用“打开继电器”和“关闭继电器”完成相同操作。
9. 在串口连接时拔掉 USB，再尝试 ON/OFF。后端会返回可读的写入失败信息，清除失联连接，进程不会崩溃。

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
python -m pytest
```

前端类型检查和生产构建：

```powershell
cd D:\GitHub\USB-Relay-Web\frontend
npm run build
```

## Windows 使用注意事项

- CH340 必须已安装正确驱动；设备管理器中应能看到对应 COM 端口。
- 同一个 COM 口在同一时间只能由一个程序打开。运行本服务前先关闭 SSCOM、Arduino 串口监视器等程序，否则会返回端口占用错误。
- COM 号由 Windows 分配，更换 USB 口后可能改变。项目通过扫描动态发现端口，不把 `COM3` 写死为唯一设备。
- 后端必须在 `backend` 目录启动，否则 `app.main:app` 无法导入。
- 页面显示 `UNKNOWN` 是预期行为，因为当前协议没有状态回读。只有在本次连接中成功发送 ON/OFF 后，软件状态才会变为 `ON/OFF`。
- 拔掉 USB 后在下次通信时服务会捕获异常并清理失效连接；重新插入设备后需刷新端口并再次连接。
- 继电器可能连接真实负载。进行接线和通电测试前，应确认负载电压、电流和隔离要求，并遵守设备额定参数。

## 环境变量

后端支持 `USB_RELAY_` 前缀配置，示例见 `backend/.env.example`。硬件通信参数默认值已按实机验证结果设置，不应随意修改。

## 第一阶段边界

当前未实现用户登录、数据库、Redis、WebSocket、Docker、权限系统、多设备管理、云端控制、自动重连、定时任务和复杂主题。多路继电器所需的协议级扩展尚未加入，因为当前只验证了 Relay 1 的两条控制指令。
