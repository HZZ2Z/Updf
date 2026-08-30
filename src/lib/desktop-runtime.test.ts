// @vitest-environment node

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setAsPdfDefaultApp } from "../../desktop/desktop-integration.mjs";
import {
  createPdfOpenQueue,
  createSecureWindowOptions,
  createServerLaunchOptions,
  registerDesktopIpc,
  resolveSecondInstancePdfPaths,
  startLocalNextServer,
} from "../../desktop/desktop-runtime.mjs";

describe("Electron desktop runtime", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("queues unique paths in launch order", () => {
    const queue = createPdfOpenQueue();

    queue.enqueue(["/a/one.pdf", "/a/two.pdf", "/a/one.pdf"]);

    expect([queue.take(), queue.take(), queue.take()]).toEqual([
      "/a/one.pdf",
      "/a/two.pdf",
      undefined,
    ]);
  });

  it("filters forwarded second-instance data before it reaches the privileged queue", () => {
    expect(resolveSecondInstancePdfPaths({
      additionalData: {
        pdfPaths: ["/course/one.pdf", "/course/readme.txt", "/course/one.pdf"],
      },
      argv: ["electron", ".", "/fallback/two.pdf"],
      cwd: "/fallback",
    })).toEqual(["/course/one.pdf"]);

    expect(resolveSecondInstancePdfPaths({
      additionalData: {},
      argv: ["electron", ".", "two.pdf"],
      cwd: "/fallback",
    })).toEqual(["/fallback/two.pdf"]);
  });

  it("builds an isolated sandboxed browser window", () => {
    expect(createSecureWindowOptions("/app/preload.cjs").webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: "/app/preload.cjs",
    });
  });

  it("starts standalone on the fixed loopback origin using Electron as Node", () => {
    expect(createServerLaunchOptions({
      executablePath: "/opt/modu",
      serverPath: "/resources/app-server/server.js",
      currentEnv: { LANG: "zh_CN.UTF-8" },
    })).toEqual({
      command: "/opt/modu",
      args: ["/resources/app-server/server.js"],
      cwd: "/resources/app-server",
      env: {
        LANG: "zh_CN.UTF-8",
        ELECTRON_RUN_AS_NODE: "1",
        HOSTNAME: "127.0.0.1",
        PORT: "32147",
        NODE_ENV: "production",
      },
    });
  });

  it("refuses to load an unrelated process already using the fixed origin", async () => {
    const spawnProcess = vi.fn();

    await expect(startLocalNextServer({
      executablePath: "/opt/modu",
      serverPath: "/resources/app-server/server.js",
      fetchImpl: vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
      spawnProcess,
    })).rejects.toThrow("端口 32147 已被占用");
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it("delivers queued PDF bytes only to the trusted renderer origin", async () => {
    const root = await mkdtemp(join(tmpdir(), "modu-ipc-"));
    roots.push(root);
    const pdfPath = join(root, "paper.pdf");
    await writeFile(pdfPath, "%PDF-1.7\nbody");
    const queue = createPdfOpenQueue();
    queue.enqueue([pdfPath]);
    const handlers = new Map<
      string,
      (event: { senderFrame: { url: string } }) => Promise<unknown>
    >();
    registerDesktopIpc({
      ipcMain: {
        handle: (channel, handler) => handlers.set(channel, handler),
      },
      queue,
      origin: "http://127.0.0.1:32147",
      getDefaultStatus: vi.fn(),
      setDefault: vi.fn(),
    });
    const consume = handlers.get("desktop:consume-launch-pdf");

    await expect(consume?.({
      senderFrame: { url: "http://127.0.0.1:32147/reader/sha" },
    })).resolves.toMatchObject({ name: "paper.pdf" });
    await expect(consume?.({
      senderFrame: { url: "https://attacker.test/" },
    })).rejects.toThrow("拒绝未授权的桌面请求");
  });

  it("writes a user desktop entry before requesting the PDF default", async () => {
    const dataHome = await mkdtemp(join(tmpdir(), "modu-xdg-"));
    roots.push(dataHome);
    const calls: Array<[string, string[]]> = [];
    const execFile = vi.fn(async (command: string, args: string[]) => {
      calls.push([command, args]);
      return command === "xdg-mime" && args[0] === "query"
        ? { stdout: "com.hzz2z.modureader.desktop\n" }
        : { stdout: "" };
    });

    const status = await setAsPdfDefaultApp({
      dataHome,
      executablePath: "/apps/Modu.AppImage",
      iconSourcePath: "/assets/icon.svg",
      execFile,
      copyFile: vi.fn(),
    });

    expect(status.isDefault).toBe(true);
    expect(await readFile(
      join(dataHome, "applications", "com.hzz2z.modureader.desktop"),
      "utf8",
    )).toContain("MimeType=application/pdf;");
    expect(calls).toContainEqual([
      "xdg-mime",
      ["default", "com.hzz2z.modureader.desktop", "application/pdf"],
    ]);
  });
});
