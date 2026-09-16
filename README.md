# USB Relay Console

基于 Vue 3、TypeScript 和 Electron 的 USB 继电器控制台，同时支持：

- Windows 桌面版：通过 Electron 主进程中的 Node SerialPort 访问串口，安装后可直接使用。
- 浏览器版：通过 Chromium Web Serial API 访问串口，无需独立后端服务。

项目当前针对 CH340 + LCUS-1 1 路 USB 继电器验证了以下控制指令：

- `A0 01 01 A2`：Relay 1 ON
- `A0 01 00 A1`：Relay 1 OFF

LCUS-1 当前未验证可用的状态回读协议。因此界面中的 ON/OFF 状态表示软件最近一次成功发送的控制命令，不代表硬件状态已被回读确认。

## 功能

- 自动扫描和识别 CH340 串口设备
- 支持自动连接与异常断开后的自动重连
- 支持自定义 ON/OFF HEX 指令
- 支持串口参数配置：波特率、数据位、校验位、停止位和流控
- 支持浏览器和 Electron 桌面版共用同一套界面
- 桌面版配置保存在用户目录，不依赖管理员权限

## 架构

```text
Vue 3 Dashboard
      │
      ├── Electron 桌面版
      │     Renderer ── IPC ── Electron Main ── Node SerialPort
      │
      └── 浏览器版
            Browser ── Web Serial API ── Serial Port
                              │
                              ▼
                         CH340 / LCUS-1
```

主要代码边界：

- `frontend/src/api/relay.ts`：UI 使用的统一服务门面。
- `frontend/src/services/RelayService.ts`：继电器业务逻辑和 HEX 指令发送。
- `frontend/src/services/serial/`：Web Serial 与 Electron IPC 两种串口适配器。
- `frontend/electron/main/`：Electron 主进程、串口服务和配置持久化。
- `frontend/electron/preload/`：通过 contextBridge 暴露受限 IPC API。

## 环境要求

桌面版用户：

- Windows 10/11 x64
- CH340 驱动
- USB 继电器设备

开发环境：

- Windows 10/11
- Node.js 20 或更高版本
- npm 10 或更高版本
- Chrome 或 Edge 89+（仅浏览器版需要）

## 开发

```powershell
cd D:\GitHub\USB-Relay-Web\frontend
npm ci
npm run dev
```

`npm run dev` 会启动 Vite 和 Electron 开发环境。

浏览器版联调可访问：

```text
http://localhost:5173
```

Web Serial API 只能在安全上下文中使用，即 `https://` 或 `http://localhost`。

## 验证

```powershell
cd D:\GitHub\USB-Relay-Web\frontend
npm test
npm run typecheck
npm run build
npm audit --omit=dev
```

## 构建 Windows 发布包

```powershell
cd D:\GitHub\USB-Relay-Web\frontend
npm ci
npm run dist
```

构建过程会先清理旧产物，再执行类型检查、Vite/Electron 生产构建和 electron-builder 打包。输出目录为 `frontend/release`：

- `USB-Relay-Console-0.4.0-x64.exe`：NSIS 安装程序。
- `USB-Relay-Console-0.4.0-x64.zip`：免安装压缩包，解压后运行 `USB Relay Console.exe`。

版本号以 `frontend/package.json` 中的 `version` 为准。

## 使用流程

1. 安装 CH340 驱动并插入 USB 继电器。
2. 打开桌面版应用，或使用 Chrome/Edge 打开浏览器版。
3. 扫描并选择目标串口。
4. 点击“连接”。
5. 使用界面开关发送 ON/OFF 指令。
6. 不使用时点击“断开”释放串口。

同一串口不能被多个程序同时打开。使用前应关闭 SSCOM、Arduino 串口监视器或其他串口工具。

## 状态说明

- `ON`：软件最近一次成功发送了 ON 指令。
- `OFF`：软件最近一次成功发送了 OFF 指令。
- `UNKNOWN`：尚未控制、串口已断开或最近一次写入失败。

关闭应用或页面不会自动发送 OFF，也不会恢复上次 ON 状态。连接真实负载时，应确认负载电压、电流、隔离要求和设备额定参数。

## 常见错误

| 错误代码 | 原因 | 处理方式 |
| --- | --- | --- |
| `WEB_SERIAL_UNSUPPORTED` | 当前浏览器不支持 Web Serial API | 使用 Chrome/Edge 89+，或安装桌面版 |
| `SERIAL_USER_CANCELLED` | 用户取消串口选择 | 重新选择串口 |
| `SERIAL_PORT_BUSY` | 串口被其他程序占用 | 关闭占用串口的程序后重试 |
| `SERIAL_PORT_NOT_FOUND` | 串口不存在或已移除 | 检查设备和驱动，重新扫描 |
| `SERIAL_NOT_CONNECTED` | 尚未连接串口 | 先连接目标串口 |
| `SERIAL_WRITE_FAILED` | USB 被拔出或串口写入失败 | 检查 USB，重新连接设备 |
