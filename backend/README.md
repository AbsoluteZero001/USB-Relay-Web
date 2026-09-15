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
│   └── relay.py                连接、断开、ON、OFF、状态路由
├── models/
│   ├── serial.py               串口响应模型
│   └── relay.py                继电器请求、状态、操作和错误模型
└── services/
    ├── serial_service.py       PySerial 生命周期与串行化写入
    ├── relay_service.py        LCUS-1 业务、固定指令和软件状态
    └── exceptions.py           可安全映射到 HTTP 的服务异常
```

## 启动

在 `backend` 目录执行：

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000
```

Swagger：<http://127.0.0.1:8000/docs>

## API

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/serial/ports` | 扫描本机串口 |
| `POST` | `/api/relay/connect` | 连接串口，JSON 示例：`{"port":"COM3"}` |
| `POST` | `/api/relay/disconnect` | 断开当前串口 |
| `POST` | `/api/relay/on` | 发送 `A0 01 01 A2` |
| `POST` | `/api/relay/off` | 发送 `A0 01 00 A1` |
| `GET` | `/api/relay/status` | 返回连接和软件最近状态 |

`GET /api/serial/ports` 返回 `port`、`device`、`description`、`manufacturer`、`hwid` 和 `is_current`。业务异常统一返回 `detail` 与稳定 `code`，未处理异常统一返回 `INTERNAL_SERVER_ERROR`，不会向客户端输出 traceback。

## 连接与日志

- 同一端口重复连接直接返回当前状态，不创建第二个串口对象。
- 连接另一个端口时先释放旧连接，再打开新端口。
- 写入失败会立即清理失效连接，后续状态返回 `connected=false`。
- 每次 ON/OFF 都输出结构化 `relay_command` JSON 日志，包含时间、动作、命令、HEX、端口、结果和错误代码。

## 状态语义

LCUS-1 当前验证的功能是接收控制指令，没有验证硬件状态回读。API 中的 `relay_state` 因此只代表软件最近一次成功发送的状态，并由 `state_source=software_last_command` 明确标识。未发送过指令、已断开或最近写入失败时，状态为 `unknown`，不冒充硬件真实状态。

## 测试

测试使用 fake serial，不会访问真实 COM 口。使用仓库内虚拟环境运行：

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```
