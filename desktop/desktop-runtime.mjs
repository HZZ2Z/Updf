import { spawn } from "node:child_process";
import { dirname } from "node:path";

import {
  extractPdfPaths,
  isTrustedRendererUrl,
  readValidatedPdf,
} from "./desktop-core.mjs";

export const APP_HOST = "127.0.0.1";
export const APP_PORT = "32147";
export const APP_ORIGIN = `http://${APP_HOST}:${APP_PORT}`;

export function createPdfOpenQueue() {
  const paths = [];
  const known = new Set();

  return {
    enqueue(values) {
      for (const value of values) {
        if (typeof value !== "string" || !value || known.has(value)) continue;
        known.add(value);
        paths.push(value);
      }
    },
    take() {
      const value = paths.shift();
      if (value) known.delete(value);
      return value;
    },
    get size() {
      return paths.length;
    },
  };
}

export function resolveSecondInstancePdfPaths({ additionalData, argv, cwd }) {
  const forwarded = Array.isArray(additionalData?.pdfPaths)
    ? additionalData.pdfPaths
    : argv;
  return extractPdfPaths(forwarded, cwd);
}

export function createSecureWindowOptions(preload) {
  return {
    width: 1440,
    height: 900,
    minWidth: 860,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#f4f6f8",
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  };
}

export function removeApplicationMenu(menu) {
  menu.setApplicationMenu(null);
}

export function createServerLaunchOptions({
  executablePath,
  serverPath,
  currentEnv = process.env,
}) {
  return {
    command: executablePath,
    args: [serverPath],
    cwd: dirname(serverPath),
    env: {
      ...currentEnv,
      ELECTRON_RUN_AS_NODE: "1",
      HOSTNAME: APP_HOST,
      PORT: APP_PORT,
      NODE_ENV: "production",
    },
  };
}

async function isOriginOccupied(fetchImpl) {
  try {
    await fetchImpl(APP_ORIGIN, {
      method: "HEAD",
      cache: "no-store",
      signal: AbortSignal.timeout(700),
    });
    return true;
  } catch {
    return false;
  }
}

export async function startLocalNextServer(options) {
  const fetchImpl = options.fetchImpl ?? fetch;
  if (await isOriginOccupied(fetchImpl)) {
    throw new Error("端口 32147 已被占用，请关闭占用该端口的程序后重试");
  }

  const launch = createServerLaunchOptions(options);
  const child = (options.spawnProcess ?? spawn)(launch.command, launch.args, {
    cwd: launch.cwd,
    env: launch.env,
    stdio: "ignore",
  });
  let earlyFailure;
  child.once("error", (error) => {
    earlyFailure = `本地服务无法启动：${error.message}`;
  });
  child.once("exit", (code, signal) => {
    earlyFailure = `本地服务提前退出（${signal || `状态码 ${code}`}）`;
  });

  const deadline = Date.now() + (options.timeoutMs ?? 30_000);
  while (Date.now() < deadline) {
    if (earlyFailure) throw new Error(earlyFailure);
    try {
      const response = await fetchImpl(APP_ORIGIN, {
        method: "HEAD",
        cache: "no-store",
      });
      if (response.ok) return child;
    } catch {
      // The standalone server is not ready yet.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }

  child.kill("SIGTERM");
  throw new Error("本地服务启动超时");
}

export function registerDesktopIpc({
  ipcMain,
  queue,
  origin,
  getDefaultStatus,
  setDefault,
  getUpdateState,
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  getTranslationApiKey,
  saveTranslationApiKey,
  clearTranslationApiKey,
  onOpenError = () => {},
}) {
  const assertTrusted = (event) => {
    if (!isTrustedRendererUrl(event.senderFrame?.url ?? "", origin)) {
      throw new Error("拒绝未授权的桌面请求");
    }
  };

  ipcMain.handle("desktop:consume-launch-pdf", async (event) => {
    assertTrusted(event);
    for (;;) {
      const path = queue.take();
      if (!path) return null;
      try {
        return await readValidatedPdf(path);
      } catch (error) {
        onOpenError(path, error);
      }
    }
  });
  ipcMain.handle("desktop:get-pdf-default-status", async (event) => {
    assertTrusted(event);
    return getDefaultStatus();
  });
  ipcMain.handle("desktop:set-pdf-default", async (event) => {
    assertTrusted(event);
    return setDefault();
  });
  ipcMain.handle("desktop:get-update-state", async (event) => {
    assertTrusted(event);
    return getUpdateState();
  });
  ipcMain.handle("desktop:check-for-updates", async (event) => {
    assertTrusted(event);
    return checkForUpdates();
  });
  ipcMain.handle("desktop:download-update", async (event) => {
    assertTrusted(event);
    return downloadUpdate();
  });
  ipcMain.handle("desktop:install-update", async (event) => {
    assertTrusted(event);
    return installUpdate();
  });
  ipcMain.handle("desktop:get-translation-api-key", async (event, provider) => {
    assertTrusted(event);
    return getTranslationApiKey(provider);
  });
  ipcMain.handle("desktop:save-translation-api-key", async (event, provider, value) => {
    assertTrusted(event);
    return saveTranslationApiKey(provider, value);
  });
  ipcMain.handle("desktop:clear-translation-api-key", async (event, provider) => {
    assertTrusted(event);
    return clearTranslationApiKey(provider);
  });
}
