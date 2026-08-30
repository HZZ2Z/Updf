import type { DesktopPdfFile } from "./desktop-core.mjs";

export interface PdfOpenQueue {
  enqueue(values: string[]): void;
  take(): string | undefined;
  readonly size: number;
}

export interface ServerLaunchOptions {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
}

export interface StartLocalNextServerOptions {
  executablePath: string;
  serverPath: string;
  currentEnv?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  spawnProcess?: (...args: any[]) => any;
  timeoutMs?: number;
}

export interface DesktopIpcOptions {
  ipcMain: {
    handle(
      channel: string,
      handler: (event: any) => Promise<unknown>,
    ): unknown;
  };
  queue: PdfOpenQueue;
  origin: string;
  getDefaultStatus: () => Promise<unknown> | unknown;
  setDefault: () => Promise<unknown> | unknown;
  onOpenError?: (path: string, error: unknown) => void;
}

export const APP_HOST: "127.0.0.1";
export const APP_PORT: "32147";
export const APP_ORIGIN: "http://127.0.0.1:32147";
export function createPdfOpenQueue(): PdfOpenQueue;
export function resolveSecondInstancePdfPaths(options: {
  additionalData?: { pdfPaths?: unknown };
  argv: string[];
  cwd: string;
}): string[];
export function createSecureWindowOptions(preload: string): {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  show: boolean;
  backgroundColor: string;
  webPreferences: {
    preload: string;
    contextIsolation: true;
    nodeIntegration: false;
    sandbox: true;
    webSecurity: true;
  };
};
export function createServerLaunchOptions(options: {
  executablePath: string;
  serverPath: string;
  currentEnv?: Record<string, string | undefined>;
}): ServerLaunchOptions;
export function startLocalNextServer(
  options: StartLocalNextServerOptions,
): Promise<any>;
export function registerDesktopIpc(options: DesktopIpcOptions): void;
export type { DesktopPdfFile };
