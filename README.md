# USB Relay Console

USB Relay Console 是一个基于 Vue 3、TypeScript 和 Electron 的 USB 继电器控制台，同时提供：

- **Windows 桌面版**：通过 Electron 主进程和 Node SerialPort 访问串口。
- **浏览器版**：通过 Chromium Web Serial API 访问串口。
- **无需独立后端服务**：应用逻辑和串口通信均在本地运行。

项目当前已使用 CH340 和 LCUS-1 单路 USB 继电器完成实机验证。

## 已验证指令

| 操作 | HEX 指令 | 验证结果 |
| --- | --- | --- |
| Relay 1 ON | `A0 01 01 A2` | 继电器吸合 |
| Relay 1 OFF | `A0 01 00 A1` | 继电器释放 |

> LCUS-1 当前没有经过验证的状态回读协议。界面中的 ON/OFF 表示软件最近一次成功发送的控制命令，不代表已经读取到硬件真实状态。

## 功能特性

- 自动扫描串口并识别 CH340 设备
- 支持自动连接和异常断开后的自动重连
- 支持自定义 ON/OFF HEX 指令
- 支持配置波特率、数据位、校验位、停止位和流控
- 桌面版与浏览器版共用同一套 Vue 界面
- 桌面端使用受限 IPC 接口，Renderer 不直接访问 Node.js
- 桌面版配置保存在当前用户目录，无需管理员权限
- 支持旧版配置格式自动迁移
- 提供 Vitest 单元测试和完整 TypeScript 类型检查

## 运行版本

### Windows 桌面版

桌面版使用 Electron，通过主进程中的 Node SerialPort 访问 Windows COM 端口。

适用场景：

- 不希望依赖浏览器串口授权
- 希望直接安装并运行
- Windows 10/11 x64

### 浏览器版

浏览器版直接调用 Chromium Web Serial API。

要求：

- Chrome 或 Edge 89+
- 通过 `https://` 或 `http://localhost` 访问
- 首次使用时手动授权串口设备

Firefox 和 Safari 当前不支持 Web Serial API。

## 系统架构

```text
                         Vue 3 Dashboard
                                |
             +------------------+------------------+
             |                                     |
             v                                     v
      Electron 桌面版                         浏览器版
             |                                     |
   Renderer <-> IPC <-> Main              Web Serial API
             |                                     |
             +------------- Node SerialPort --------+
                                |
                                v
                         CH340 / LCUS-1
```

主要安全边界：

- `contextIsolation: true`
- `nodeIntegration: false`
- 仅通过 preload 和 IPC 白名单暴露串口与配置接口
- Renderer 无法直接访问 Electron、Node.js 或原生模块

## 下载与安装

请从 GitHub Releases 下载对应版本：

| 文件 | 用途 |
| --- | --- |
| `USB-Relay-Console-<version>-x64.exe` | NSIS 安装程序 |
| `USB-Relay-Console-<version>-x64.zip` | 免安装压缩包 |

免安装版解压后运行：

```text
USB Relay Console.exe
```

当前发行包未配置代码签名。Windows SmartScreen 可能显示“未知发布者”，这不影响程序运行。

## 使用流程

1. 安装 CH340 驱动并插入 USB 继电器。
2. 在设备管理器中确认设备已分配 COM 端口。
3. 打开桌面版，或使用 Chrome/Edge 打开浏览器版。
4. 扫描并选择目标串口。
5. 点击“连接”。
6. 使用界面开关发送 ON/OFF 指令。
7. 不使用时点击“断开”，释放串口。

同一个 COM 端口不能被多个程序同时打开。使用前请关闭 SSCOM、Arduino 串口监视器以及其他串口工具。

## 默认串口参数

| 参数 | 默认值 |
| --- | --- |
| 波特率 | `9600` |
| 数据位 | `8` |
| 校验位 | `None` |
| 停止位 | `1` |
| 流控 | `None` |

默认参数可以在应用设置页面中修改。

## 开发环境

推荐环境：

- Windows 10/11
- Node.js 20 或更高版本
- npm 10 或更高版本
- CH340 驱动
- Chrome 或 Edge 89+（仅浏览器版需要）

安装依赖：

```powershell
cd D:\GitHub\USB-Relay-Web\frontend
npm ci
```

`postinstall` 会调用 `electron-builder install-app-deps`，为当前 Electron 版本重建原生模块。

启动开发环境：

```powershell
npm run dev
```

该命令会启动 Vite 和 Electron 开发窗口。浏览器版联调地址：

```text
http://localhost:5173
```

技术栈：

- Vue 3
- TypeScript
- Vite
- Element Plus
- Electron
- Node SerialPort
- Vitest
- electron-builder

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动 Vite 和 Electron 开发环境 |
| `npm test` | 运行 Vitest 测试 |
| `npm run typecheck` | 检查前端和 Electron TypeScript 代码 |
| `npm run build` | 执行类型检查并生成生产文件 |
| `npm run preview` | 预览 Vite 构建结果 |
| `npm run clean` | 清理构建目录和发布目录 |
| `npm run dist` | 构建 Windows EXE 和 ZIP 发布包 |
| `npm audit` | 检查依赖安全漏洞 |

## 项目结构

```text
USB-Relay-Web/
├─ README.md
└─ frontend/
   ├─ electron/
   │  ├─ main/
   │  │  ├─ index.ts
   │  │  ├─ serial-service.ts
   │  │  └─ config-service.ts
   │  └─ preload/
   │     └─ index.ts
   ├─ scripts/
   │  └─ clean.cjs
   ├─ src/
   │  ├─ api/
   │  ├─ components/
   │  ├─ services/
   │  │  ├─ config/
   │  │  ├─ serial/
   │  │  ├─ RelayService.ts
   │  │  ├─ device-rules.ts
   │  │  ├─ errors.ts
   │  │  └─ hex.ts
   │  ├─ views/
   │  ├─ App.vue
   │  └─ main.ts
   ├─ package.json
   ├─ tsconfig.json
   └─ vite.config.ts
```

关键模块：

- `src/api/relay.ts`：UI 使用的统一服务门面。
- `src/services/RelayService.ts`：继电器业务逻辑和指令发送。
- `src/services/serial/WebSerialAdapter.ts`：浏览器 Web Serial 适配器。
- `src/services/serial/ElectronSerialAdapter.ts`：Electron IPC 串口适配器。
- `electron/main/serial-service.ts`：桌面版 Node SerialPort 服务。
- `electron/main/config-service.ts`：桌面版配置持久化。

## 配置持久化

桌面版使用 `electron-store`，配置保存在当前用户的 Electron 应用数据目录中，不会写入安装目录。

浏览器版使用 `localStorage`，存储键为：

```text
usb-relay-config
```

配置内容包括：

- 上次选择的串口
- ON/OFF HEX 指令
- 串口通信参数
- 自动连接和自动重连设置
- 串口设备匹配规则

旧版扁平配置会在加载时自动转换，无需手动迁移。

## 继电器状态说明

| 状态 | 含义 |
| --- | --- |
| `ON` | 软件最近一次成功发送了 ON 指令 |
| `OFF` | 软件最近一次成功发送了 OFF 指令 |
| `UNKNOWN` | 尚未控制、串口已断开或最近一次写入失败 |

关闭应用或浏览器页面不会自动发送 OFF，也不会恢复上次 ON 状态。

LCUS-1 当前不支持已验证的状态回读，因此界面不会声称硬件状态已经确认。

## 测试与构建

运行完整验证：

```powershell
cd D:\GitHub\USB-Relay-Web\frontend
npm test
npm run typecheck
npm run build
npm audit --audit-level=high
```

构建 Windows 发布包：

```powershell
npm run dist
```

输出目录：

```text
frontend/release/
├─ USB-Relay-Console-<version>-x64.exe
├─ USB-Relay-Console-<version>-x64.exe.blockmap
├─ USB-Relay-Console-<version>-x64.zip
└─ win-unpacked/
```

版本号来自 `frontend/package.json` 中的 `version` 字段。

## 常见错误

| 错误代码 | 原因 | 处理方式 |
| --- | --- | --- |
| `WEB_SERIAL_UNSUPPORTED` | 浏览器不支持 Web Serial API | 使用 Chrome/Edge 89+，或安装桌面版 |
| `SERIAL_USER_CANCELLED` | 用户取消串口授权 | 重新选择并授权串口 |
| `SERIAL_PORT_BUSY` | COM 端口被其他程序占用 | 关闭 SSCOM、串口监视器等程序 |
| `SERIAL_PORT_NOT_FOUND` | 串口不存在或设备已移除 | 检查驱动和 USB 连接后重新扫描 |
| `SERIAL_NOT_CONNECTED` | 尚未连接串口 | 先连接目标串口 |
| `SERIAL_WRITE_FAILED` | USB 被拔出或写入失败 | 检查设备并重新连接 |

## 构建问题排查

### `No JSON content found in output`

electron-builder 会调用 `npm list` 收集生产依赖。如果 Windows CMD 的 `AutoRun` 配置了 `fastfetch` 或其他会输出文本的命令，这些内容可能混入 JSON 并导致构建失败。

处理方式：

1. 临时关闭 CMD `AutoRun` 后重新执行 `npm run dist`。
2. 构建完成后恢复原配置。

### 原生模块加载失败

重新为当前 Electron 版本安装并重建原生依赖：

```powershell
npm ci
npm run postinstall
```

### 串口被占用

确认以下程序没有占用目标 COM 端口：

- SSCOM
- Arduino IDE 串口监视器
- PuTTY
- 其他串口调试或自动化程序

## 已知限制

- 当前仅验证 CH340 与 LCUS-1 单路继电器。
- LCUS-1 的真实硬件状态无法回读。
- 当前发布包仅提供 Windows x64。
- 应用和安装包尚未配置代码签名。
- 当前使用 Electron 默认应用图标。

## 安全提示

继电器可能连接真实负载。接线和通电测试前，请确认：

- 负载电压和电流在设备额定范围内
- 高压与低压部分满足隔离要求
- 接线端子连接牢固
- 测试环境具备必要的过流和断电保护

应用会发送真实的串口控制指令，请勿将本项目用于未经授权或存在安全风险的设备控制。
