# USB Relay Web Backend

FastAPI 后端负责串口发现、串口生命周期、LCUS-1 指令发送和 API 响应。API 层不直接操作 PySerial，所有硬件访问都通过 `SerialService`，继电器业务由 `RelayService` 完成。

FastAPI 路由使用同步函数，阻塞式 PySerial 操作由框架在线程池中执行，不阻塞事件循环。

## 目录职责

```text
app/
├── main.py                     FastAPI 应用、CORS、异常处理和生命周期
├── config.py                   pydantic-settings 配置
├── api/
│   ├── serial.py               串口查询路由
│   ├── relay.py                连接、断开、ON、OFF、状态路由
│   ├── logs.py                 内存审计日志读取与清空
│   └── health.py               服务健康检查
├── models/
│   ├── serial.py               串口响应模型
│   ├── relay.py                继电器请求、状态、操作和错误模型
│   ├── audit.py                审计日志模型
│   └── health.py               健康检查模型
└── services/
    ├── serial_service.py       PySerial 生命周期与串行化写入
    ├── relay_service.py        LCUS-1 业务、固定指令和软件状态
    ├── audit_log_service.py    线程安全的内存日志存储
    └── exceptions.py           可安全映射到 HTTP 的服务异常
```

## 一键启动

首次在 `backend` 目录安装依赖：

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

前端依赖也已安装后，以后只需运行：

```powershell
python app\main.py
```

该入口会同时启动或复用 FastAPI `127.0.0.1:8000` 和 Vite
`127.0.0.1:5173`，待服务就绪后自动打开浏览器。

Swagger：<http://127.0.0.1:8000/docs>

`app\main.py` 使用单进程 Uvicorn 并禁用自动重载。项目控制真实 USB
继电器，`--reload` 会产生监控子进程并重新导入应用，可能重复初始化
`SerialService`，因此不作为本项目推荐启动方式。按 `Ctrl+C` 会停止本次
启动创建的 Vite，并触发 FastAPI shutdown。

## API

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/serial/ports` | 扫描本机串口 |
| `GET` | `/api/serial/status` | 返回串口状态机快照 |
| `POST` | `/api/relay/connect` | 连接串口，JSON 示例：`{"port":"COM3"}` |
| `POST` | `/api/relay/disconnect` | 断开当前串口 |
| `POST` | `/api/relay/on` | 发送 `A0 01 01 A2` |
| `POST` | `/api/relay/off` | 发送 `A0 01 00 A1` |
| `GET` | `/api/relay/status` | 返回连接和软件最近状态 |
| `GET` | `/api/logs` | 返回分页后的内存操作日志 |
| `DELETE` | `/api/logs` | 清空内存操作日志 |
| `GET` | `/api/health` | 返回服务和串口连接状态 |

`GET /api/serial/ports` 返回 `port`、`device`、`description`、`manufacturer`、`hwid` 和 `is_current`。业务异常统一返回 `detail` 与稳定 `code`，未处理异常统一返回 `INTERNAL_SERVER_ERROR`，不会向客户端输出 traceback。

## 连接与日志

- 同一端口重复连接直接返回当前状态，不创建第二个串口对象。
- 连接另一个端口时先释放旧连接，再打开新端口。
- 写入失败会立即清理失效连接，后续状态返回 `connected=false`。
- 每次 ON/OFF 都输出结构化 `relay_command` JSON 日志，包含时间、动作、命令、HEX、端口、结果和错误代码。
- 应用 lifespan 结束时会关闭串口，测试覆盖 shutdown cleanup。

## 串口状态

`SerialService` 维护 `disconnected`、`connecting`、`connected`、`error` 四种状态。`GET /api/serial/status` 返回 `state`、`port`、`device`、`baudrate`、`connected`、`error_code` 和 `detail`。异常写出后会清除串口对象，但保留最近端口用于诊断。

## 内存日志

`AuditLogService` 最多保存 500 条记录，使用时间倒序分页。记录包含 `timestamp`、`action`、`command`、`hex`、`port`、`result`、`error_code` 和 `detail`。日志不会持久化，后端进程退出后清空。

## 安全行为

- 浏览器刷新或关闭不会自动发送 ON。
- 后端启动时继电器软件状态固定为 `unknown`。
- 不自动恢复上次 ON 状态，不自动重连。
- OFF 使用已验证命令 `A0 01 00 A1`，不增加未知查询协议。

## 状态语义

LCUS-1 当前验证的功能是接收控制指令，没有验证硬件状态回读。API 中的 `relay_state` 因此只代表软件最近一次成功发送的状态，并由 `state_source=software_last_command` 明确标识。未发送过指令、已断开或最近写入失败时，状态为 `unknown`，不冒充硬件真实状态。

## 测试

测试使用 fake serial，不会访问真实 COM 口。使用仓库内虚拟环境运行：

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

在仓库根目录执行 Pyright：

```powershell
npx --yes pyright@latest
```

根目录 `pyrightconfig.json` 已设置源码路径、虚拟环境和 Python 版本。
