# USB-Relay-Web（纯前端 Web Serial 版）

运行在浏览器中的 USB 继电器 Web 控制系统，采用 **Vue 3 + TypeScript + Web Serial API** 构建。浏览器直接通过 Web Serial API 打开 CH340 串口，并使用已经实机验证的 LCUS-1 HEX 指令控制 1 路继电器，**无需后端服务**。

> 本分支为纯前端方案，已移除 FastAPI / PySerial 后端。如需后端版本，请切换到 `main` 分支。

已实机验证 Relay 1 的 ON/OFF 控制指令：

- `A0 01 01 A2` — Relay 1 ON
- `A0 01 00 A1` — Relay 1 OFF

需要说明的是，LCUS-1 当前未验证可用的继电器状态回读协议，因此页面中的继电器状态仅表示软件最后一次成功发送的 ON/OFF 命令，不代表硬件实际状态。

## 技术栈

- 前端：Vue 3、TypeScript、Vite、Element Plus
- 串口通信：Web Serial API（浏览器原生，无第三方串口库）
- 无后端、无数据库、无构建产物以外的运行时依赖

## 系统架构

```text
Vue 3 Dashboard
      │ Web Serial API (navigator.serial)
      ▼
Browser Serial Port
      │ HEX 指令
      ▼
Windows COM3 / CH340
      │
      ▼
LCUS-1 Relay 1
```

代码边界：

- `api/relay.ts` 封装 Web Serial API 调用、LCUS-1 指令、内存审计日志和统一错误码。
- 组件层（`Dashboard.vue`、`SerialPanel.vue`、`RelayCard.vue`、`OperationLog.vue`）只负责 UI 和交互，不直接操作 `navigator.serial`。
- 写入由 UI 层的 `activeOperation` 防重入保护，避免并发请求把指令字节交错发送。
- 操作日志仅存在于浏览器内存，页面刷新后清空。

## 浏览器要求

| 要求 | 说明 |
| --- | --- |
| 浏览器 | Chrome / Edge 89 及以上（Chromium 内核） |
| 访问方式 | `https://` 或 `http://localhost`（Web Serial 安全上下文要求） |
| 驱动 | CH340 驱动已安装，设备管理器中可见对应 COM 口 |

Firefox、Safari 不支持 Web Serial API，页面会显示"浏览器不支持"提示。

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

## 状态说明

LCUS-1 当前没有经过验证的状态回读协议，因此不声称从硬件读取到了继电器状态。`relay_state` 仅表示"软件最近一次成功发送的 ON/OFF 指令"：

- `on`：软件最近一次成功发送了 ON。
- `off`：软件最近一次成功发送了 OFF。
- `unknown`：尚未发送、串口已断开，或最近一次写入失败。

当 `state_source` 为 `software_last_command` 时，响应表示软件记录，不代表硬件确认回读。

断开串口、写入失败或页面刷新后，继电器状态回到 `unknown`。项目明确禁止自动恢复上次 ON 状态。

## 开发环境

- Windows 10/11
- Node.js 20 或更高版本
- CH340 驱动
- Chrome 或 Edge 89+

## 启动

```powershell
cd D:\GitHub\USB-Relay-Web\frontend
npm install
npm run dev
```

浏览器打开 <http://localhost:5173>。

## 真实测试流程

1. 插入 USB 继电器。
2. 确认 Windows 已安装 CH340 驱动。
3. 关闭 SSCOM、Arduino 串口监视器及其他串口工具。
4. 在 Chrome / Edge 中打开 <http://localhost:5173>。
5. 点击串口面板右侧的"选择并添加串口设备"按钮，在浏览器弹窗中选择 CH340 对应的串口。
6. 点击"连接"，确认设备状态显示"已连接"。
7. 点击 `ON`，页面显示发送成功，命令为 `A0 01 01 A2`。
8. 确认继电器发出"啪"的吸合声。
9. 确认 Relay 1 LED 状态变化。
10. 点击 `OFF`，页面显示发送成功，命令为 `A0 01 00 A1`。
11. 确认继电器释放，LED 恢复关闭状态。
12. 点击"断开"，确认串口释放。

软件当前无法读取 LCUS-1 的真实硬件状态。页面中的 ON/OFF 是"软件最后一次命令"记录，不是硬件回读结果。

关闭浏览器不会发送 OFF，也不会恢复上次 ON；需要关闭继电器时应点击页面中的"关闭继电器 / OFF"。

## 前端类型检查和生产构建

```powershell
cd D:\GitHub\USB-Relay-Web\frontend
npm run typecheck
npm run build
```

## Windows 使用注意事项

- CH340 必须已安装正确驱动；设备管理器中应能看到对应 COM 端口。
- 同一个 COM 口在同一时间只能由一个程序打开。使用本页面前先关闭 SSCOM、Arduino 串口监视器等程序，否则会返回端口占用错误。
- COM 号由 Windows 分配，更换 USB 口后可能改变。Web Serial 无法静默枚举所有 COM 口，需通过"选择并添加串口设备"按钮主动授权。
- 页面显示 `UNKNOWN` 是预期行为，因为当前协议没有状态回读。只有在本次连接中成功发送 ON/OFF 后，软件状态才会变为 `ON/OFF`。
- 拔掉 USB 后在下次通信时页面会捕获异常并清理失效连接；重新插入设备后需重新选择串口并连接。
- 继电器可能连接真实负载。进行接线和通电测试前，应确认负载电压、电流和隔离要求，并遵守设备额定参数。

## 常见错误

| 错误代码 | 原因 | 处理方式 |
| --- | --- | --- |
| `WEB_SERIAL_UNSUPPORTED` | 当前浏览器不支持 Web Serial API | 使用 Chrome 或 Edge 89+，并通过 https 或 localhost 访问 |
| `SERIAL_USER_CANCELLED` | 用户取消了串口选择弹窗 | 重新点击"选择并添加串口设备" |
| `SERIAL_PORT_BUSY` | COM 口被 SSCOM 等程序占用 | 关闭占用程序，重新连接 |
| `SERIAL_PORT_NOT_FOUND` | 所选串口不存在或已移除 | 重新选择串口设备 |
| `SERIAL_NOT_CONNECTED` | 尚未连接或连接已经释放 | 先连接目标串口，再执行 ON/OFF |
| `SERIAL_WRITE_FAILED` | USB 被拔出或串口写入失败 | 检查 USB，重新选择串口并连接 |
