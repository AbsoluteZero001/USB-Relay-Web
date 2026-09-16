import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SerialService } from "./serial-service";
import { loadConfig, saveConfig } from "./config-service";
import type { SerialOpenOptions } from "../../src/services/serial/types";
import type { AppConfig } from "../../src/services/config/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isDev = !app.isPackaged;
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];

let mainWindow: BrowserWindow | null = null;
const serialService = new SerialService();

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: "USB 继电器控制台",
    backgroundColor: "#20272b",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow?.webContents.send("main-process:ready");
  });

  mainWindow.webContents.on(
    "preload-error",
    (_event, preloadPath, error) => {
      console.error(`[preload] failed to load ${preloadPath}:`, error);
    },
  );

  if (isDev && VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// Forward serial events from the service to the renderer.
serialService.on("data", (data: number[]) => {
  mainWindow?.webContents.send("serial:data", data);
});

serialService.on("status-change", (status) => {
  mainWindow?.webContents.send("serial:status-change", status);
});

// Register IPC handlers.
ipcMain.handle("serial:list-ports", async () => {
  return serialService.listPorts();
});

ipcMain.handle("serial:connect", async (_event, portId: string, options: SerialOpenOptions) => {
  await serialService.connect(portId, options);
  return serialService.getStatus();
});

ipcMain.handle("serial:disconnect", async () => {
  await serialService.disconnect();
});

ipcMain.handle("serial:send", async (_event, data: number[]) => {
  await serialService.send(data);
});

ipcMain.handle("serial:get-status", async () => {
  return serialService.getStatus();
});

// Config persistence IPC.
ipcMain.handle("config:load", async (): Promise<AppConfig> => {
  return loadConfig();
});

ipcMain.handle("config:save", async (_event, config: AppConfig): Promise<void> => {
  saveConfig(config);
});

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
