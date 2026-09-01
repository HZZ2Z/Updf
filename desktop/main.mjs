import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  safeStorage,
  shell,
} from "electron";

import { createCredentialStore } from "./credential-store.mjs";

import {
  extractPdfPaths,
  isTrustedRendererUrl,
} from "./desktop-core.mjs";
import {
  getPdfDefaultAppStatus,
  setAsPdfDefaultApp,
} from "./desktop-integration.mjs";
import {
  APP_ORIGIN,
  createPdfOpenQueue,
  createSecureWindowOptions,
  registerDesktopIpc,
  removeApplicationMenu,
  resolveSecondInstancePdfPaths,
  startLocalNextServer,
} from "./desktop-runtime.mjs";
import { createUpdateManager } from "./update-manager.mjs";

const require = createRequire(import.meta.url);

const desktopDirectory = dirname(fileURLToPath(import.meta.url));
const queue = createPdfOpenQueue();
const launchPaths = extractPdfPaths(process.argv, process.cwd());
const gotLock = app.requestSingleInstanceLock({ pdfPaths: launchPaths });

let mainWindow;
let serverProcess;
let isQuitting = false;
let updateManager;
let credentialStore;

function defaultIntegrationOptions() {
  return {
    dataHome: process.env.XDG_DATA_HOME || join(app.getPath("home"), ".local", "share"),
    executablePath: process.env.APPIMAGE || process.execPath,
    iconSourcePath: app.isPackaged
      ? join(process.resourcesPath, "assets", "icon.svg")
      : join(app.getAppPath(), "build", "icon.svg"),
    execFile: promisify(execFile),
    copyFile,
  };
}

function getAutoUpdater() {
  const modulePath = app.isPackaged
    ? join(process.resourcesPath, "updater", "node_modules", "electron-updater")
    : "electron-updater";
  return require(modulePath).autoUpdater;
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function notifyPdfAvailable() {
  if (mainWindow && !mainWindow.isDestroyed() && queue.size > 0) {
    mainWindow.webContents.send("desktop:pdf-available");
  }
}

function notifyUpdateState(state = updateManager?.getState()) {
  if (!state || !mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("desktop:update-state", state);
}

function showStartupErrorAndQuit(error) {
  dialog.showErrorBox(
    "墨读启动失败",
    error instanceof Error ? error.message : String(error),
  );
  app.quit();
}

async function openExternalHttps(value) {
  try {
    const target = new URL(value);
    if (target.protocol === "https:") await shell.openExternal(target.href);
  } catch {
    // Invalid and non-HTTPS URLs stay blocked inside the desktop shell.
  }
}

async function startApplication() {
  removeApplicationMenu(Menu);
  credentialStore = createCredentialStore({
    safeStorage,
    filePath: join(app.getPath("userData"), "credentials.v1.json"),
    readFile,
    writeFile,
    mkdir,
  });
  updateManager = createUpdateManager({
    updater: getAutoUpdater(),
    currentVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    onStateChange: notifyUpdateState,
  });
  const serverPath = app.isPackaged
    ? join(process.resourcesPath, "app-server", "server.js")
    : join(app.getAppPath(), ".desktop-runtime", "server", "server.js");
  serverProcess = await startLocalNextServer({
    executablePath: process.execPath,
    serverPath,
  });
  serverProcess.once("exit", () => {
    if (isQuitting) return;
    dialog.showErrorBox("墨读运行失败", "本地阅读服务已意外停止。");
    app.quit();
  });

  mainWindow = new BrowserWindow(
    createSecureWindowOptions(join(desktopDirectory, "preload.cjs")),
  );
  mainWindow.webContents.on("will-navigate", (event, target) => {
    if (isTrustedRendererUrl(target, APP_ORIGIN)) return;
    event.preventDefault();
    void openExternalHttps(target);
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalHttps(url);
    return { action: "deny" };
  });

  registerDesktopIpc({
    ipcMain,
    queue,
    origin: APP_ORIGIN,
    getDefaultStatus: () => getPdfDefaultAppStatus(defaultIntegrationOptions()),
    setDefault: () => setAsPdfDefaultApp(defaultIntegrationOptions()),
    getUpdateState: () => updateManager.getState(),
    checkForUpdates: () => updateManager.check(),
    downloadUpdate: () => updateManager.download(),
    installUpdate: () => updateManager.install(),
    getTranslationApiKey: (provider) => credentialStore.get(provider),
    saveTranslationApiKey: (provider, value) => credentialStore.set(provider, value),
    clearTranslationApiKey: (provider) => credentialStore.clear(provider),
    onOpenError: (path, error) => {
      void dialog.showMessageBox(mainWindow, {
        type: "error",
        title: "PDF 无法打开",
        message: basename(path),
        detail: error instanceof Error ? error.message : String(error),
      });
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.webContents.once("did-finish-load", () => {
    notifyUpdateState();
    const updateTimer = setTimeout(() => {
      void updateManager?.check();
    }, 12_000);
    updateTimer.unref();
  });
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
  await mainWindow.loadURL(APP_ORIGIN);
  notifyPdfAvailable();
}

if (!gotLock) {
  app.quit();
} else {
  queue.enqueue(launchPaths);
  app.on("second-instance", (_event, argv, cwd, additionalData) => {
    queue.enqueue(resolveSecondInstancePdfPaths({ additionalData, argv, cwd }));
    focusMainWindow();
    notifyPdfAvailable();
  });
  app.whenReady().then(startApplication).catch(showStartupErrorAndQuit);
}

app.on("activate", focusMainWindow);
app.on("before-quit", () => {
  isQuitting = true;
  if (serverProcess && !serverProcess.killed) serverProcess.kill("SIGTERM");
});
app.on("window-all-closed", () => app.quit());
