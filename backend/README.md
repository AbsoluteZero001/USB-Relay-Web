# USB Relay Web Backend

FastAPI 后端负责串口发现、串口生命周期、LCUS-1 指令发送和 API 响应。API 层不直接操作 PySerial，所有硬件访问都通过 `SerialService`，继电器业务由 `RelayService` 完成。

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

## 状态语义

LCUS-1 当前验证的功能是接收控制指令，没有验证硬件状态回读。API 中的 `relay_state` 因此只代表软件最近一次成功发送的状态，并由 `state_source=software_last_command` 明确标识。未发送过指令、已断开或最近写入失败时，状态为 `unknown`，不冒充硬件真实状态。

## 测试

测试使用 fake serial，不会访问真实 COM 口：

```powershell
python -m pytest
```
