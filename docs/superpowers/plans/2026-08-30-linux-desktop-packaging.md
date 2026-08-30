# 墨读 Linux 桌面应用 1.0.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有墨读 Next.js 应用封装为 Linux x86_64 Electron 桌面应用，支持双击 PDF 导入/去重打开、用户主动设置 PDF 默认应用，并产出 `.deb` 和 `.AppImage`。

**Architecture:** Electron 主进程作为唯一特权边界，管理单实例、固定回环端口的 Next.js standalone 子进程、系统 PDF 路径和 xdg-mime。受限 preload 只交付经验证的 PDF 字节和桌面集成状态；根布局协调器复用新的 PDF 导入服务，写入现有 Dexie/IndexedDB 并导航到阅读器。

**Tech Stack:** Electron, electron-builder, Next.js 16 App Router standalone output, React, TypeScript, Dexie, Vitest, Testing Library, Playwright Electron.

**Spec:** `docs/superpowers/specs/2026-08-30-linux-desktop-packaging-design.md`

## Global Constraints

- Linux 桌面包版本固定为 `1.0.0`；不重写现有 `v1.0.0`，桌面发布标签使用 `linux-v1.0.0`。
- 首版只构建 Linux `x86_64` 的 AppImage 和 deb，不实现 Windows、macOS、自动更新或代码签名。
- Electron `appId` 为 `com.hzz2z.modureader`，`productName` 为 `墨读`，可执行名为 `modu-reader`。
- Next.js 服务只监听 `127.0.0.1:32147`，不在端口占用时随机换端口。
- `BrowserWindow` 必须使用 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`，且所有 IPC 都校验发送页的 origin。
- 渲染层不获得任意路径读写 API；只有系统启动参数中经验证的 PDF 可被主进程读取。
- 安装和首次启动不强制改变 PDF 默认应用；只在用户点击设置页按钮时执行 `xdg-mime default`。
- 现有 Dexie schema、PDF 渲染、翻译、批注、词汇和浏览器启动器行为保持兼容。
- API Key 仍只存在 `sessionStorage`，不写入 Electron 配置、日志、IndexedDB 或导出包。

---

## File map

- `desktop/desktop-core.mjs`: 无 Electron 依赖的命令行、PDF 文件、URL 与 desktop entry 纯逻辑。
- `desktop/desktop-core.d.mts`: 为 TypeScript 测试提供上述 ESM 接口的类型。
- `desktop/desktop-integration.mjs`: 使用结构化子进程调用查询/设置 xdg-mime，并写用户级 desktop entry 与图标。
- `desktop/desktop-runtime.mjs`: PDF 路径队列、Next.js 子进程、IPC 注册和安全窗口选项。
- `desktop/main.mjs`: Electron app 生命周期、单实例和 BrowserWindow 编排。
- `desktop/preload.cjs`: 通过 `contextBridge` 暴露固定白名单 API。
- `src/lib/pdf-library-import.ts`: 手动导入与桌面打开共用的 PDF 导入/去重服务。
- `src/components/desktop/desktop-pdf-open-coordinator.tsx`: 全局消费桌面 PDF 队列、导入、导航和显示错误。
- `src/types/desktop.d.ts`: `window.moduDesktop` 渲染层类型契约。
- `scripts/prepare-desktop-runtime.mjs`: 将 Next standalone、`.next/static` 和 `public` 复制到可打包运行目录。
- `scripts/verify-linux-package.mjs`: 检查产物、deb desktop entry、MIME 和不应入包的文件。
- `electron-builder.yml`: Linux 产品标识、图标、MIME、AppImage/deb 和 artifact 命名。
- `build/icon.svg`: 使用现有深蓝与“墨”字品牌的矢量桌面图标。

---

### Task 1: Desktop boundary core

**Files:**
- Create: `desktop/desktop-core.mjs`
- Create: `desktop/desktop-core.d.mts`
- Test: `src/lib/desktop-core.test.ts`

**Interfaces:**
- Consumes: Node.js `path` and `fs/promises` only.
- Produces: `extractPdfPaths(argv, cwd)`, `readValidatedPdf(path)`, `isTrustedRendererUrl(value, origin)`, `quoteDesktopExecArg(value)`, `renderDesktopEntry(options)`, `parsePdfDefaultStatus(stdout, desktopName)`.

- [ ] **Step 1: Write failing tests for argv filtering, signature validation, URL trust and desktop entry escaping**

```ts
// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  extractPdfPaths,
  isTrustedRendererUrl,
  parsePdfDefaultStatus,
  quoteDesktopExecArg,
  readValidatedPdf,
  renderDesktopEntry,
} from "../../desktop/desktop-core.mjs";

describe("desktop security boundary", () => {
  const roots: string[] = [];
  afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

  it("keeps only unique PDF launch arguments and resolves relative paths", () => {
    expect(extractPdfPaths(["electron", ".", "--no-sandbox", "notes.pdf", "notes.pdf", "readme.txt"], "/course"))
      .toEqual(["/course/notes.pdf"]);
  });

  it("reads a regular file only when extension and signature are PDF", async () => {
    const root = await mkdtemp(join(tmpdir(), "modu-pdf-"));
    roots.push(root);
    const valid = join(root, "paper.pdf");
    const invalid = join(root, "fake.pdf");
    await writeFile(valid, "%PDF-1.7\nbody");
    await writeFile(invalid, "plain text");
    await expect(readValidatedPdf(valid)).resolves.toMatchObject({ name: "paper.pdf" });
    await expect(readValidatedPdf(invalid)).rejects.toThrow("不是有效的 PDF 文件");
  });

  it("accepts only the fixed local application origin", () => {
    expect(isTrustedRendererUrl("http://127.0.0.1:32147/settings", "http://127.0.0.1:32147")).toBe(true);
    expect(isTrustedRendererUrl("http://127.0.0.1:32147.evil.test/", "http://127.0.0.1:32147")).toBe(false);
  });

  it("creates a PDF desktop entry without shell interpolation", () => {
    const executable = "/home/A $book/Modu.AppImage";
    expect(quoteDesktopExecArg(executable)).toBe('"/home/A \\$book/Modu.AppImage"');
    expect(renderDesktopEntry({ executablePath: executable, iconPath: "/home/A/icon.svg" }))
      .toContain('Exec="/home/A \\$book/Modu.AppImage" %F');
  });

  it("recognizes the exact registered desktop id", () => {
    expect(parsePdfDefaultStatus("com.hzz2z.modureader.desktop\n", "com.hzz2z.modureader.desktop")).toBe(true);
    expect(parsePdfDefaultStatus("org.gnome.Evince.desktop\n", "com.hzz2z.modureader.desktop")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the core test and verify RED**

Run: `npm run test:run -- src/lib/desktop-core.test.ts`

Expected: FAIL because `desktop/desktop-core.mjs` does not exist.

- [ ] **Step 3: Implement the minimal core with explicit validation**

```js
import { open, readFile, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

export function extractPdfPaths(argv, cwd) {
  const seen = new Set();
  return argv.flatMap((value) => {
    if (typeof value !== "string" || value.startsWith("-") || extname(value).toLowerCase() !== ".pdf") return [];
    const path = resolve(cwd, value);
    if (seen.has(path)) return [];
    seen.add(path);
    return [path];
  });
}

export async function readValidatedPdf(path) {
  if (extname(path).toLowerCase() !== ".pdf") throw new Error("只能打开 PDF 文件");
  const details = await stat(path);
  if (!details.isFile()) throw new Error("该路径不是普通文件");
  const handle = await open(path, "r");
  const signature = Buffer.alloc(5);
  try { await handle.read(signature, 0, 5, 0); } finally { await handle.close(); }
  if (signature.toString("ascii") !== "%PDF-") throw new Error("不是有效的 PDF 文件");
  const bytes = await readFile(path);
  return { name: basename(path), sourcePath: path, bytes: new Uint8Array(bytes) };
}

export function isTrustedRendererUrl(value, origin) {
  try { return new URL(value).origin === origin; } catch { return false; }
}

export function quoteDesktopExecArg(value) {
  if (/\r|\n/.test(value)) throw new Error("桌面应用路径不合法");
  return `"${value.replace(/[\\"`$]/g, "\\$&")}"`;
}

export function renderDesktopEntry({ executablePath, iconPath }) {
  return [
    "[Desktop Entry]", "Type=Application", "Name=墨读", "Comment=本地优先 PDF 深度阅读器",
    `Exec=${quoteDesktopExecArg(executablePath)} %F`, `Icon=${iconPath}`, "Terminal=false",
    "Categories=Office;Education;", "MimeType=application/pdf;", "StartupWMClass=com.hzz2z.modureader", "",
  ].join("\n");
}

export function parsePdfDefaultStatus(stdout, desktopName) {
  return stdout.trim() === desktopName;
}
```

`desktop-core.d.mts` exports matching declarations:

```ts
export interface DesktopPdfFile { name: string; sourcePath: string; bytes: Uint8Array }
export function extractPdfPaths(argv: string[], cwd: string): string[];
export function readValidatedPdf(path: string): Promise<DesktopPdfFile>;
export function isTrustedRendererUrl(value: string, origin: string): boolean;
export function quoteDesktopExecArg(value: string): string;
export function renderDesktopEntry(options: { executablePath: string; iconPath: string }): string;
export function parsePdfDefaultStatus(stdout: string, desktopName: string): boolean;
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm run test:run -- src/lib/desktop-core.test.ts`

Expected: PASS with all desktop boundary cases green.

- [ ] **Step 5: Commit the desktop boundary**

```bash
git add desktop/desktop-core.mjs desktop/desktop-core.d.mts src/lib/desktop-core.test.ts
git commit -m "feat: add secure Linux desktop boundary"
```

---

### Task 2: Reusable PDF library import service

**Files:**
- Create: `src/lib/pdf-library-import.ts`
- Create: `src/lib/pdf-library-import.test.ts`
- Modify: `src/lib/pdf-import.ts`
- Modify: `src/lib/pdf-import.test.ts`
- Modify: `src/components/library/library-client.tsx`
- Modify: `src/components/library/library-client.test.tsx`

**Interfaces:**
- Consumes: `ReaderDatabase`, `inspectPdfFile`, `createDocumentRecord`, ephemeral document helpers and `applyBundleToDatabase`.
- Produces: `importPdfIntoLibrary(file, options?): Promise<PdfLibraryImportResult>` where result contains `documentId`, `title`, `outcome: "created" | "existing"`, `storage: "persistent" | "session"`, and `attachedPendingBundle`.

- [ ] **Step 1: Write failing service tests for create, duplicate and pending-note merge**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReaderDatabase } from "@/lib/database";
import { fingerprintFile } from "@/lib/pdf-import";
import { importPdfIntoLibrary } from "@/lib/pdf-library-import";

describe("importPdfIntoLibrary", () => {
  const databases: ReaderDatabase[] = [];
  afterEach(async () => Promise.all(databases.splice(0).map((database) => database.delete())));

  it("returns the new document id after persisting an inspected PDF", async () => {
    const database = new ReaderDatabase(`import-${crypto.randomUUID()}`);
    databases.push(database);
    const file = new File(["%PDF-1.7\nbody"], "paper.pdf", { type: "application/pdf" });
    const result = await importPdfIntoLibrary(file, {
      database,
      inspect: vi.fn().mockResolvedValue({ title: "Paper", pageCount: 3, persisted: true }),
      requestPersistence: vi.fn().mockResolvedValue(true),
    });
    expect(result).toMatchObject({ title: "Paper", outcome: "created", storage: "persistent" });
    await expect(database.documents.get(result.documentId)).resolves.toMatchObject({ title: "Paper" });
  });

  it("opens an existing fingerprint without replacing reading state", async () => {
    const database = new ReaderDatabase(`duplicate-${crypto.randomUUID()}`);
    databases.push(database);
    const file = new File(["%PDF-1.7\nsame"], "paper.pdf", { type: "application/pdf" });
    const first = await importPdfIntoLibrary(file, { database, inspect: async () => ({ pageCount: 3, persisted: true }) });
    await database.documents.update(first.documentId, { currentPage: 3, progress: 0.8 });
    const second = await importPdfIntoLibrary(file, { database, inspect: vi.fn() });
    expect(second).toMatchObject({ documentId: first.documentId, outcome: "existing" });
    await expect(database.documents.get(first.documentId)).resolves.toMatchObject({ currentPage: 3, progress: 0.8 });
  });

  it("attaches a waiting notes bundle after the matching PDF is persisted", async () => {
    const database = new ReaderDatabase(`pending-${crypto.randomUUID()}`);
    databases.push(database);
    const file = new File(["%PDF-1.7\nwaiting"], "waiting.pdf", { type: "application/pdf" });
    const fingerprint = await fingerprintFile(file);
    await database.pendingBundles.put({
      id: fingerprint,
      fingerprint,
      title: "Waiting",
      importedAt: "2026-08-30T00:00:00.000Z",
      bundle: {
        schemaVersion: 1,
        appVersion: "1.0.0",
        exportedAt: "2026-08-30T00:00:00.000Z",
        document: { fingerprint, title: "Waiting", fileName: "waiting.pdf", pageCount: 1 },
        translations: [], translationMarks: [], annotations: [], vocabulary: [],
      },
    });
    const result = await importPdfIntoLibrary(file, { database, inspect: async () => ({ pageCount: 1, persisted: true }) });
    expect(result.attachedPendingBundle).toBe(true);
    await expect(database.pendingBundles.get(fingerprint)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the service test and verify RED**

Run: `npm run test:run -- src/lib/pdf-library-import.test.ts`

Expected: FAIL because `@/lib/pdf-library-import` cannot be resolved.

- [ ] **Step 3: Let `createDocumentRecord` reuse a verified fingerprint**

Add this failing assertion to `src/lib/pdf-import.test.ts` before modifying the function:

```ts
it("reuses a caller-supplied verified fingerprint", async () => {
  const file = new File(["%PDF-1.7"], "paper.pdf", { type: "application/pdf" });
  const record = await createDocumentRecord(file, { pageCount: 1, persisted: true }, "verified-sha");
  expect(record.id).toBe("verified-sha");
  expect(record.fingerprint).toBe("verified-sha");
});
```

Run: `npm run test:run -- src/lib/pdf-import.test.ts`

Expected: FAIL because the current implementation ignores the third argument and hashes the PDF again.

Change the function as follows, then run the same test again and expect PASS:

```ts
export async function createDocumentRecord(
  file: File,
  metadata: InspectedPdfMetadata,
  verifiedFingerprint?: string,
): Promise<DocumentRecord> {
  await validatePdfFile(file);
  const fingerprint = verifiedFingerprint ?? await fingerprintFile(file);
  const now = new Date().toISOString();
  return {
    id: fingerprint,
    fingerprint,
    title: metadata.title?.trim() || file.name.replace(/\.pdf$/i, ""),
    fileName: file.name,
    file,
    pageCount: metadata.pageCount,
    coverDataUrl: metadata.coverDataUrl,
    author: metadata.author,
    createdAt: now,
    lastOpenedAt: now,
    currentPage: 1,
    continuousPage: 1,
    bookPage: 1,
    continuousZoom: 1,
    bookZoom: 1,
    progress: 0,
    persisted: metadata.persisted,
    hasTextLayer: metadata.hasTextLayer,
  };
}
```

- [ ] **Step 4: Implement the import service and preserve quota fallback**

```ts
export interface PdfLibraryImportOptions {
  database?: ReaderDatabase;
  inspect?: typeof inspectPdfFile;
  requestPersistence?: () => Promise<boolean>;
}

export interface PdfLibraryImportResult {
  documentId: string;
  title: string;
  outcome: "created" | "existing";
  storage: "persistent" | "session";
  attachedPendingBundle: boolean;
}

export async function importPdfIntoLibrary(file: File, options: PdfLibraryImportOptions = {}): Promise<PdfLibraryImportResult> {
  const database = options.database ?? getReaderDatabase();
  await validatePdfFile(file);
  const fingerprint = await fingerprintFile(file);
  const existing = await database.documents.get(fingerprint) ?? getEphemeralDocument(fingerprint);
  if (existing) {
    const lastOpenedAt = new Date().toISOString();
    if (existing.persisted) await database.documents.update(existing.id, { lastOpenedAt });
    else updateEphemeralDocument(existing.id, { lastOpenedAt });
    return { documentId: existing.id, title: existing.title, outcome: "existing", storage: existing.persisted ? "persistent" : "session", attachedPendingBundle: false };
  }
  const inspection = await (options.inspect ?? inspectPdfFile)(file);
  const record = await createDocumentRecord(file, { ...inspection, persisted: true }, fingerprint);
  let storage: "persistent" | "session" = "persistent";
  try {
    await options.requestPersistence?.();
    await database.documents.put(record);
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== "QuotaExceededError") throw error;
    record.persisted = false;
    rememberEphemeralDocument(record);
    storage = "session";
  }
  const waiting = storage === "persistent" ? await database.pendingBundles.get(fingerprint) : undefined;
  if (waiting) await applyBundleToDatabase(database, waiting.bundle);
  return { documentId: record.id, title: record.title, outcome: "created", storage, attachedPendingBundle: Boolean(waiting) };
}
```

- [ ] **Step 5: Refactor `LibraryClient` to call the service once per file**

```tsx
for (const file of files) {
  const result = await importPdfIntoLibrary(file, {
    requestPersistence: async () => Boolean(await navigator.storage?.persist?.()),
  });
  if (result.outcome === "existing") {
    setMessage(`“${result.title}”已在资料库中，已保留原有阅读记录。`);
  } else if (result.storage === "session") {
    setMessage("本地空间不足，文件仅在当前会话中可用；笔记仍会尝试保存。");
  } else {
    imported += 1;
  }
}
```

- [ ] **Step 6: Run import and library component tests**

Run: `npm run test:run -- src/lib/pdf-import.test.ts src/lib/pdf-library-import.test.ts src/components/library/library-client.test.tsx`

Expected: PASS; the existing delete/folder flows remain green and imports preserve duplicate state.

- [ ] **Step 7: Commit the reusable import service**

```bash
git add src/lib/pdf-import.ts src/lib/pdf-import.test.ts src/lib/pdf-library-import.ts src/lib/pdf-library-import.test.ts src/components/library/library-client.tsx src/components/library/library-client.test.tsx
git commit -m "refactor: share PDF library import flow"
```

---

### Task 3: Renderer desktop bridge and global PDF-open coordinator

**Files:**
- Create: `src/types/desktop.d.ts`
- Create: `src/components/desktop/desktop-pdf-open-coordinator.tsx`
- Create: `src/components/desktop/desktop-pdf-open-coordinator.test.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `window.moduDesktop.consumeLaunchPdf()`, `window.moduDesktop.onOpenPdfAvailable(listener)`, dynamic import of `importPdfIntoLibrary`, and Next `useRouter()`.
- Produces: a root-mounted coordinator that drains PDF items serially, routes to `/reader/{documentId}`, unsubscribes on unmount and shows a compact status/error toast.

- [ ] **Step 1: Write failing coordinator tests for initial launch, duplicate navigation and bridge absence**

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopPdfOpenCoordinator } from "@/components/desktop/desktop-pdf-open-coordinator";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/pdf-library-import", () => ({
  importPdfIntoLibrary: vi.fn().mockResolvedValue({ documentId: "sha", title: "Robotics", outcome: "existing", storage: "persistent", attachedPendingBundle: false }),
}));

describe("DesktopPdfOpenCoordinator", () => {
  beforeEach(() => { push.mockReset(); delete window.moduDesktop; });

  it("consumes a launch PDF and routes to its existing reader record", async () => {
    const consumeLaunchPdf = vi.fn()
      .mockResolvedValueOnce({ name: "robotics.pdf", bytes: new Uint8Array(new TextEncoder().encode("%PDF-1.7")) })
      .mockResolvedValueOnce(null);
    window.moduDesktop = { isDesktop: true, consumeLaunchPdf, onOpenPdfAvailable: () => () => {}, getPdfDefaultAppStatus: vi.fn(), setAsPdfDefaultApp: vi.fn() };
    render(<DesktopPdfOpenCoordinator />);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/reader/sha"));
    expect(await screen.findByRole("status")).toHaveTextContent("正在打开 Robotics");
  });

  it("does nothing in a normal browser", () => {
    render(<DesktopPdfOpenCoordinator />);
    expect(push).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the coordinator test and verify RED**

Run: `npm run test:run -- src/components/desktop/desktop-pdf-open-coordinator.test.tsx`

Expected: FAIL because the component and global bridge type do not exist.

- [ ] **Step 3: Add the exact bridge type contract**

```ts
export interface DesktopPdfFile { name: string; sourcePath?: string; bytes: Uint8Array }
export interface DesktopIntegrationStatus { available: boolean; isDefault: boolean; defaultApplication?: string; error?: string }
export interface ModuDesktopBridge {
  isDesktop: true;
  consumeLaunchPdf(): Promise<DesktopPdfFile | null>;
  onOpenPdfAvailable(listener: () => void): () => void;
  getPdfDefaultAppStatus(): Promise<DesktopIntegrationStatus>;
  setAsPdfDefaultApp(): Promise<DesktopIntegrationStatus>;
}
declare global { interface Window { moduDesktop?: ModuDesktopBridge } }
export {};
```

- [ ] **Step 4: Implement a serial drain guarded by a ref and lazy-load the heavy import path**

```tsx
"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

export function DesktopPdfOpenCoordinator() {
  const router = useRouter();
  const draining = useRef(false);
  const [message, setMessage] = useState("");
  const drain = useCallback(async () => {
    const bridge = window.moduDesktop;
    if (!bridge || draining.current) return;
    draining.current = true;
    try {
      for (;;) {
        let incoming;
        try {
          incoming = await bridge.consumeLaunchPdf();
        } catch (error) {
          setMessage(error instanceof Error ? error.message : "PDF 无法打开");
          break;
        }
        if (!incoming) break;
        try {
          const file = new File([incoming.bytes], incoming.name, { type: "application/pdf" });
          const { importPdfIntoLibrary } = await import("@/lib/pdf-library-import");
          const result = await importPdfIntoLibrary(file);
          setMessage(`正在打开 ${result.title}`);
          router.push(`/reader/${encodeURIComponent(result.documentId)}`);
        } catch (error) {
          setMessage(error instanceof Error ? error.message : "PDF 导入失败");
        }
      }
    } finally { draining.current = false; }
  }, [router]);
  useEffect(() => {
    const bridge = window.moduDesktop;
    if (!bridge) return;
    const unsubscribe = bridge.onOpenPdfAvailable(() => void drain());
    void drain();
    return unsubscribe;
  }, [drain]);
  return message ? <div className="desktop-open-toast" role="status">{message}</div> : null;
}
```

- [ ] **Step 5: Mount the coordinator once in the root layout and add non-blocking toast styles**

```tsx
<body>
  <DesktopPdfOpenCoordinator />
  {children}
</body>
```

The `.desktop-open-toast` rule uses `position: fixed`, `z-index: 200`, a maximum width, the existing navy/surface tokens and `pointer-events: none`, so it never blocks the reader.

- [ ] **Step 6: Run coordinator, typecheck and current component tests**

Run: `npm run test:run -- src/components/desktop/desktop-pdf-open-coordinator.test.tsx && npm run typecheck`

Expected: PASS with no browser-only regression or eager PDF.js bundle import from the root coordinator.

- [ ] **Step 7: Commit the renderer bridge**

```bash
git add src/types/desktop.d.ts src/components/desktop/desktop-pdf-open-coordinator.tsx src/components/desktop/desktop-pdf-open-coordinator.test.tsx src/app/layout.tsx src/app/globals.css
git commit -m "feat: open desktop PDFs in the reader"
```

---

### Task 4: Settings page desktop integration

**Files:**
- Modify: `src/components/settings/settings-client.tsx`
- Modify: `src/components/settings/settings-screen.tsx`
- Create: `src/components/settings/settings-client.test.tsx`
- Modify: `src/components/settings/settings-screen.test.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `DesktopIntegrationStatus` and the two default-app bridge methods.
- Produces: optional `desktopIntegration`, `desktopIntegrationBusy` and `onSetPdfDefaultApp` screen props; the section is absent in a browser.

- [ ] **Step 1: Write failing screen tests for desktop-only status and explicit user action**

```tsx
const baseProps = {
  hasApiKey: false,
  hasGoogleApiKey: false,
  translationProvider: "deepseek" as const,
  targetLanguage: "zh-CN",
  documentCount: 0,
  recordCount: 0,
  onSaveApiKey: vi.fn(),
  onClearApiKey: vi.fn(),
  onSaveGoogleApiKey: vi.fn(),
  onClearGoogleApiKey: vi.fn(),
  onTranslationProviderChange: vi.fn(),
  onTargetLanguageChange: vi.fn(),
  onExportAll: vi.fn(),
  onImportArchive: vi.fn(),
  onClearLibrary: vi.fn(),
};

it("shows desktop integration only when the desktop bridge is available", async () => {
  const onSetPdfDefaultApp = vi.fn();
  render(<SettingsScreen {...baseProps} desktopIntegration={{ available: true, isDefault: false, defaultApplication: "org.gnome.Evince.desktop" }} desktopIntegrationBusy={false} onSetPdfDefaultApp={onSetPdfDefaultApp} />);
  expect(screen.getByRole("heading", { name: "PDF 默认应用" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "设为 PDF 默认应用" }));
  expect(onSetPdfDefaultApp).toHaveBeenCalledOnce();
});

it("hides desktop integration in a normal browser", () => {
  render(<SettingsScreen {...baseProps} />);
  expect(screen.queryByRole("heading", { name: "PDF 默认应用" })).not.toBeInTheDocument();
});
```

Create `src/components/settings/settings-client.test.tsx` with the real bridge interaction:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsClient } from "@/components/settings/settings-client";

describe("SettingsClient desktop integration", () => {
  afterEach(() => { delete window.moduDesktop; });

  it("queries status and changes the default only after a click", async () => {
    const setAsPdfDefaultApp = vi.fn().mockResolvedValue({ available: true, isDefault: true, defaultApplication: "com.hzz2z.modureader.desktop" });
    window.moduDesktop = {
      isDesktop: true,
      consumeLaunchPdf: vi.fn(),
      onOpenPdfAvailable: () => () => {},
      getPdfDefaultAppStatus: vi.fn().mockResolvedValue({ available: true, isDefault: false }),
      setAsPdfDefaultApp,
    };
    render(<SettingsClient />);
    await userEvent.click(await screen.findByRole("button", { name: "设为 PDF 默认应用" }));
    expect(setAsPdfDefaultApp).toHaveBeenCalledOnce();
    expect(await screen.findByText("墨读已是 PDF 默认应用")).toBeInTheDocument();
  });
});
```

Add these styles with the screen change:

```css
.desktop-integration-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 18px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-soft);
}
.settings-inline-error { margin: 12px 0 0; color: var(--danger); }
```

- [ ] **Step 2: Run the settings test and verify RED**

Run: `npm run test:run -- src/components/settings/settings-screen.test.tsx src/components/settings/settings-client.test.tsx`

Expected: FAIL because the desktop integration props and section are missing.

- [ ] **Step 3: Add the desktop integration card to `SettingsScreen`**

```tsx
{desktopIntegration ? (
  <section className="settings-section">
    <div className="settings-section-heading"><FileCheck2 /><div><h2>PDF 默认应用</h2><p>从文件管理器双击 PDF 时直接使用墨读打开。</p></div></div>
    <div className="desktop-integration-row">
      <span>{desktopIntegration.isDefault ? "墨读已是 PDF 默认应用" : "当前尚未设为默认"}</span>
      <button className="primary-button" type="button" disabled={!desktopIntegration.available || desktopIntegrationBusy || desktopIntegration.isDefault} onClick={onSetPdfDefaultApp}>
        {desktopIntegration.isDefault ? "已设为默认" : "设为 PDF 默认应用"}
      </button>
    </div>
    {desktopIntegration.error ? <p className="settings-inline-error">{desktopIntegration.error}</p> : null}
  </section>
) : null}
```

- [ ] **Step 4: Query and mutate integration state in `SettingsClient`**

```tsx
const [desktopIntegration, setDesktopIntegration] = useState<DesktopIntegrationStatus>();
const [desktopIntegrationBusy, setDesktopIntegrationBusy] = useState(false);

useEffect(() => {
  if (!window.moduDesktop) return;
  void window.moduDesktop.getPdfDefaultAppStatus().then(setDesktopIntegration);
}, []);

const setPdfDefaultApp = useCallback(async () => {
  if (!window.moduDesktop) return;
  setDesktopIntegrationBusy(true);
  try {
    const status = await window.moduDesktop.setAsPdfDefaultApp();
    setDesktopIntegration(status);
    setMessage(status.isDefault ? "墨读已设为 PDF 默认应用。" : status.error ?? "默认应用设置未生效。");
  } finally { setDesktopIntegrationBusy(false); }
}, []);
```

- [ ] **Step 5: Run settings and type tests**

Run: `npm run test:run -- src/components/settings/settings-screen.test.tsx src/components/settings/settings-client.test.tsx && npm run typecheck`

Expected: PASS; API key and local data tests remain unchanged.

- [ ] **Step 6: Commit settings integration**

```bash
git add src/components/settings/settings-client.tsx src/components/settings/settings-screen.tsx src/components/settings/settings-client.test.tsx src/components/settings/settings-screen.test.tsx src/app/globals.css
git commit -m "feat: add PDF default app settings"
```

---

### Task 5: Electron runtime, preload and single-instance orchestration

**Files:**
- Create: `desktop/desktop-integration.mjs`
- Create: `desktop/desktop-integration.d.mts`
- Create: `desktop/desktop-runtime.mjs`
- Create: `desktop/desktop-runtime.d.mts`
- Create: `desktop/preload.cjs`
- Create: `desktop/main.mjs`
- Create: `src/lib/desktop-runtime.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: Task 1 core helpers, Electron `app`, `BrowserWindow`, `ipcMain`, `shell`, `dialog`; Node `spawn`, `execFile`, `fs/promises`.
- Produces: `createPdfOpenQueue()`, `createSecureWindowOptions(preloadPath)`, `startLocalNextServer(options)`, `registerDesktopIpc(options)`, `getPdfDefaultAppStatus(options)`, `setAsPdfDefaultApp(options)` and the packaged entrypoint.

- [ ] **Step 1: Install pinned Electron tooling into the lockfile**

Run: `npm install --save-dev electron@latest electron-builder@latest`

Expected: `package-lock.json` records concrete Electron and electron-builder versions while `package.json` retains the project version `1.0.0`.

- [ ] **Step 2: Write failing runtime tests for queueing, secure options, MIME integration and server launch environment**

```ts
// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getPdfDefaultAppStatus, setAsPdfDefaultApp } from "../../desktop/desktop-integration.mjs";
import { createPdfOpenQueue, createSecureWindowOptions, createServerLaunchOptions, registerDesktopIpc, startLocalNextServer } from "../../desktop/desktop-runtime.mjs";

describe("Electron desktop runtime", () => {
  const roots: string[] = [];
  afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

  it("queues unique paths and preserves order", () => {
    const queue = createPdfOpenQueue();
    queue.enqueue(["/a/one.pdf", "/a/two.pdf", "/a/one.pdf"]);
    expect([queue.take(), queue.take(), queue.take()]).toEqual(["/a/one.pdf", "/a/two.pdf", undefined]);
  });

  it("builds an isolated sandboxed browser window", () => {
    expect(createSecureWindowOptions("/app/preload.cjs").webPreferences).toMatchObject({ contextIsolation: true, nodeIntegration: false, sandbox: true, preload: "/app/preload.cjs" });
  });

  it("starts standalone on the fixed loopback origin using Electron as Node", () => {
    expect(createServerLaunchOptions({ executablePath: "/opt/modu", serverPath: "/resources/app-server/server.js" })).toMatchObject({
      command: "/opt/modu",
      args: ["/resources/app-server/server.js"],
      env: expect.objectContaining({ ELECTRON_RUN_AS_NODE: "1", HOSTNAME: "127.0.0.1", PORT: "32147" }),
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
    const handlers = new Map<string, (event: { senderFrame: { url: string } }) => Promise<unknown>>();
    registerDesktopIpc({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      queue,
      origin: "http://127.0.0.1:32147",
      getDefaultStatus: vi.fn(),
      setDefault: vi.fn(),
    });
    const consume = handlers.get("desktop:consume-launch-pdf");
    await expect(consume?.({ senderFrame: { url: "http://127.0.0.1:32147/" } })).resolves.toMatchObject({ name: "paper.pdf" });
    await expect(consume?.({ senderFrame: { url: "https://attacker.test/" } })).rejects.toThrow("拒绝未授权的桌面请求");
  });

  it("writes a user desktop entry before requesting the PDF default", async () => {
    const dataHome = await mkdtemp(join(tmpdir(), "modu-xdg-"));
    roots.push(dataHome);
    const execFile = vi.fn(async (command: string, args: string[]) => command === "xdg-mime" && args[0] === "query" ? { stdout: "com.hzz2z.modureader.desktop\n" } : { stdout: "" });
    const status = await setAsPdfDefaultApp({ dataHome, executablePath: "/apps/Modu.AppImage", iconSourcePath: "/assets/icon.svg", execFile, copyFile: vi.fn() });
    expect(status.isDefault).toBe(true);
    expect(await readFile(join(dataHome, "applications", "com.hzz2z.modureader.desktop"), "utf8")).toContain("MimeType=application/pdf;");
    expect(execFile).toHaveBeenCalledWith("xdg-mime", ["default", "com.hzz2z.modureader.desktop", "application/pdf"]);
  });
});
```

- [ ] **Step 3: Run the runtime test and verify RED**

Run: `npm run test:run -- src/lib/desktop-runtime.test.ts`

Expected: FAIL because runtime and integration modules do not exist.

- [ ] **Step 4: Implement xdg integration without shell strings**

```js
export async function getPdfDefaultAppStatus({ execFile }) {
  try {
    const { stdout } = await execFile("xdg-mime", ["query", "default", "application/pdf"]);
    return { available: true, isDefault: parsePdfDefaultStatus(stdout, DESKTOP_NAME), defaultApplication: stdout.trim() || undefined };
  } catch (error) {
    return { available: false, isDefault: false, error: `无法调用 xdg-mime：${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function setAsPdfDefaultApp(options) {
  const applications = join(options.dataHome, "applications");
  const icons = join(options.dataHome, "icons", "hicolor", "scalable", "apps");
  await Promise.all([mkdir(applications, { recursive: true }), mkdir(icons, { recursive: true })]);
  const iconPath = join(icons, "com.hzz2z.modureader.svg");
  await options.copyFile(options.iconSourcePath, iconPath);
  await writeFile(join(applications, DESKTOP_NAME), renderDesktopEntry({ executablePath: options.executablePath, iconPath }), "utf8");
  await options.execFile("xdg-mime", ["default", DESKTOP_NAME, "application/pdf"]);
  try { await options.execFile("update-desktop-database", [applications]); } catch {}
  return getPdfDefaultAppStatus(options);
}
```

- [ ] **Step 5: Implement queue, standalone process and IPC sender checks**

```js
export function createPdfOpenQueue() {
  const paths = [];
  const known = new Set();
  return {
    enqueue(values) { for (const value of values) if (!known.has(value)) { known.add(value); paths.push(value); } },
    take() { const value = paths.shift(); if (value) known.delete(value); return value; },
    get size() { return paths.length; },
  };
}

export function createSecureWindowOptions(preload) {
  return { width: 1440, height: 900, show: false, backgroundColor: "#eef2f7", webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } };
}

export function createServerLaunchOptions({ executablePath, serverPath, currentEnv = process.env }) {
  return { command: executablePath, args: [serverPath], cwd: dirname(serverPath), env: { ...currentEnv, ELECTRON_RUN_AS_NODE: "1", HOSTNAME: "127.0.0.1", PORT: "32147", NODE_ENV: "production" } };
}

export async function startLocalNextServer(options) {
  const fetchImpl = options.fetchImpl ?? fetch;
  let portOccupied = false;
  try {
    const response = await fetchImpl("http://127.0.0.1:32147", { method: "HEAD", cache: "no-store", signal: AbortSignal.timeout(700) });
    portOccupied = response.status > 0;
  } catch {}
  if (portOccupied) throw new Error("端口 32147 已被占用，请关闭占用该端口的程序后重试");
  const launch = createServerLaunchOptions(options);
  const child = (options.spawnProcess ?? spawn)(launch.command, launch.args, { cwd: launch.cwd, env: launch.env, stdio: "ignore" });
  let earlyExit;
  child.once("exit", (code, signal) => { earlyExit = `本地服务提前退出（${signal || `状态码 ${code}`} ）`; });
  const deadline = Date.now() + (options.timeoutMs ?? 30_000);
  while (Date.now() < deadline) {
    if (earlyExit) throw new Error(earlyExit);
    try {
      const response = await fetchImpl("http://127.0.0.1:32147", { method: "HEAD", cache: "no-store" });
      if (response.ok) return child;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  child.kill("SIGTERM");
  throw new Error("本地服务启动超时");
}

export function registerDesktopIpc({ ipcMain, queue, origin, getDefaultStatus, setDefault, onOpenError = () => {} }) {
  const assertTrusted = (event) => {
    if (!isTrustedRendererUrl(event.senderFrame?.url ?? "", origin)) throw new Error("拒绝未授权的桌面请求");
  };
  ipcMain.handle("desktop:consume-launch-pdf", async (event) => {
    assertTrusted(event);
    for (;;) {
      const path = queue.take();
      if (!path) return null;
      try { return await readValidatedPdf(path); }
      catch (error) { onOpenError(path, error); }
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
}
```

The main-process `setDefault` closure passes `process.env.APPIMAGE || process.execPath` to `setAsPdfDefaultApp`; `onOpenError` shows a native message box containing the rejected filename and reason, then the consume handler continues to the next queued PDF.

- [ ] **Step 6: Implement a fixed preload bridge**

```js
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("moduDesktop", {
  isDesktop: true,
  consumeLaunchPdf: () => ipcRenderer.invoke("desktop:consume-launch-pdf"),
  onOpenPdfAvailable: (listener) => {
    const wrapped = () => listener();
    ipcRenderer.on("desktop:pdf-available", wrapped);
    return () => ipcRenderer.removeListener("desktop:pdf-available", wrapped);
  },
  getPdfDefaultAppStatus: () => ipcRenderer.invoke("desktop:get-pdf-default-status"),
  setAsPdfDefaultApp: () => ipcRenderer.invoke("desktop:set-pdf-default"),
});
```

- [ ] **Step 7: Implement `main.mjs` lifecycle and single-instance forwarding**

```js
const launchPaths = extractPdfPaths(process.argv, process.cwd());
const gotLock = app.requestSingleInstanceLock({ pdfPaths: launchPaths });
if (!gotLock) app.quit();
else {
  queue.enqueue(launchPaths);
  app.on("second-instance", (_event, argv, cwd, additionalData) => {
    const paths = Array.isArray(additionalData?.pdfPaths) ? additionalData.pdfPaths : extractPdfPaths(argv, cwd);
    queue.enqueue(paths);
    focusMainWindow();
    notifyPdfAvailable();
  });
  app.whenReady().then(startApplication).catch(showStartupErrorAndQuit);
}
```

`startApplication` starts the server, waits until it responds or its child exits, creates the secure window, restricts `will-navigate` to the exact origin, opens validated `https:` links through `shell.openExternal`, registers IPC, loads the local URL and only shows on `ready-to-show`. `before-quit` terminates the owned Next child.

Use this concrete startup structure:

```js
function defaultIntegrationOptions() {
  return {
    dataHome: process.env.XDG_DATA_HOME || join(app.getPath("home"), ".local", "share"),
    executablePath: process.env.APPIMAGE || process.execPath,
    iconSourcePath: app.isPackaged ? join(process.resourcesPath, "assets", "icon.svg") : join(app.getAppPath(), "build", "icon.svg"),
    execFile: promisify(execFile),
    copyFile,
  };
}

function focusMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function notifyPdfAvailable() {
  if (mainWindow && !mainWindow.isDestroyed() && queue.size > 0) mainWindow.webContents.send("desktop:pdf-available");
}

function showStartupErrorAndQuit(error) {
  dialog.showErrorBox("墨读启动失败", error instanceof Error ? error.message : String(error));
  app.quit();
}

async function startApplication() {
  const serverPath = app.isPackaged
    ? join(process.resourcesPath, "app-server", "server.js")
    : join(app.getAppPath(), ".desktop-runtime", "server", "server.js");
  serverProcess = await startLocalNextServer({ executablePath: process.execPath, serverPath });
  mainWindow = new BrowserWindow(createSecureWindowOptions(join(dirname(fileURLToPath(import.meta.url)), "preload.cjs")));
  mainWindow.webContents.on("will-navigate", (event, target) => {
    if (!isTrustedRendererUrl(target, APP_ORIGIN)) event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (new URL(url).protocol === "https:") void shell.openExternal(url);
    return { action: "deny" };
  });
  registerDesktopIpc({
    ipcMain,
    queue,
    origin: APP_ORIGIN,
    getDefaultStatus: () => getPdfDefaultAppStatus(defaultIntegrationOptions()),
    setDefault: () => setAsPdfDefaultApp(defaultIntegrationOptions()),
    onOpenError: (path, error) => void dialog.showMessageBox(mainWindow, { type: "error", title: "PDF 无法打开", message: basename(path), detail: error instanceof Error ? error.message : String(error) }),
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  await mainWindow.loadURL(APP_ORIGIN);
  if (queue.size > 0) mainWindow.webContents.send("desktop:pdf-available");
}

app.on("before-quit", () => {
  if (serverProcess && !serverProcess.killed) serverProcess.kill("SIGTERM");
});
app.on("window-all-closed", () => app.quit());
```

- [ ] **Step 8: Run runtime and core tests**

Run: `npm run test:run -- src/lib/desktop-core.test.ts src/lib/desktop-runtime.test.ts`

Expected: PASS without Electron GUI startup in Vitest.

- [ ] **Step 9: Commit the Electron runtime**

```bash
git add package.json package-lock.json desktop src/lib/desktop-runtime.test.ts
git commit -m "feat: add Electron desktop runtime"
```

---

### Task 6: Next standalone staging and Linux packaging configuration

**Files:**
- Create: `scripts/prepare-desktop-runtime.mjs`
- Create: `scripts/prepare-desktop-runtime.d.mts`
- Create: `src/lib/desktop-packaging.test.ts`
- Create: `electron-builder.yml`
- Create: `build/icon.svg`
- Modify: `next.config.mjs`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `.next/standalone`, `.next/static`, `public`, Electron main/preload and root `package.json` version.
- Produces: `.desktop-runtime/server`, `npm run desktop:run`, `npm run build:linux`, builder metadata and deterministic Linux artifact names.

- [ ] **Step 1: Write failing tests for standalone staging and package metadata**

```ts
// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareDesktopRuntime } from "../../scripts/prepare-desktop-runtime.mjs";

describe("Linux desktop packaging", () => {
  const roots: string[] = [];
  afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

  it("stages standalone server, static assets and public files", async () => {
    const root = await mkdtemp(join(tmpdir(), "modu-stage-"));
    roots.push(root);
    await Promise.all([
      mkdir(join(root, ".next", "standalone"), { recursive: true }),
      mkdir(join(root, ".next", "static"), { recursive: true }),
      mkdir(join(root, "public"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(root, ".next", "standalone", "server.js"), "server"),
      writeFile(join(root, ".next", "static", "chunk.js"), "chunk"),
      writeFile(join(root, "public", "pdf.worker.min.mjs"), "worker"),
    ]);
    await prepareDesktopRuntime(root);
    await expect(readFile(join(root, ".desktop-runtime", "server", "server.js"), "utf8")).resolves.toBe("server");
    await expect(readFile(join(root, ".desktop-runtime", "server", ".next", "static", "chunk.js"), "utf8")).resolves.toBe("chunk");
    await expect(readFile(join(root, ".desktop-runtime", "server", "public", "pdf.worker.min.mjs"), "utf8")).resolves.toBe("worker");
  });

  it("keeps Linux package identity and build scripts at version 1.0.0", async () => {
    const packageJson = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8"));
    expect(packageJson).toMatchObject({ version: "1.0.0", main: "desktop/main.mjs", desktopName: "com.hzz2z.modureader" });
    expect(packageJson.scripts).toHaveProperty("build:linux");
  });
});
```

- [ ] **Step 2: Run the packaging test and verify RED**

Run: `npm run test:run -- src/lib/desktop-packaging.test.ts`

Expected: FAIL because the staging script and desktop package metadata are absent.

- [ ] **Step 3: Enable official Next standalone output and implement cross-platform staging**

```js
// next.config.mjs
const nextConfig = { reactStrictMode: true, output: "standalone" };
```

```js
import { access, cp, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function prepareDesktopRuntime(rootDir) {
  const source = join(rootDir, ".next", "standalone");
  const target = join(rootDir, ".desktop-runtime", "server");
  await access(join(source, "server.js"));
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  await cp(source, target, { recursive: true });
  await mkdir(join(target, ".next"), { recursive: true });
  await cp(join(rootDir, ".next", "static"), join(target, ".next", "static"), { recursive: true });
  await cp(join(rootDir, "public"), join(target, "public"), { recursive: true });
}

const launchedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (launchedDirectly) {
  prepareDesktopRuntime(resolve(dirname(fileURLToPath(import.meta.url)), ".."))
    .catch((error) => { console.error(error); process.exitCode = 1; });
}
```

`scripts/prepare-desktop-runtime.d.mts` contains:

```ts
export function prepareDesktopRuntime(rootDir: string): Promise<void>;
```

- [ ] **Step 4: Add builder configuration and the brand SVG**

```yaml
appId: com.hzz2z.modureader
productName: 墨读
asar: true
directories:
  output: dist
  buildResources: build
files:
  - desktop/**/*
  - package.json
  - "!node_modules/**/*"
extraResources:
  - from: .desktop-runtime/server
    to: app-server
  - from: build/icon.svg
    to: assets/icon.svg
linux:
  target:
    - AppImage
    - deb
  executableName: modu-reader
  icon: build/icon.svg
  category: Office
  maintainer: HZZ2Z <HZZ2Z@users.noreply.github.com>
  mimeTypes:
    - application/pdf
  desktop:
    entry:
      Name: 墨读
      Comment: 本地优先 PDF 深度阅读器
      Exec: /opt/墨读/modu-reader-launcher %F
      Categories: Office;Education;
      MimeType: application/pdf;
      Terminal: false
artifactName: "墨读-${version}-x86_64.${ext}"
```

Use this dependency-free vector as `build/icon.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#10223f"/>
  <path d="M118 84h276a34 34 0 0 1 34 34v276a34 34 0 0 1-34 34H118a34 34 0 0 1-34-34V118a34 34 0 0 1 34-34Z" fill="#fff"/>
  <path d="M350 84h44a34 34 0 0 1 34 34v116l-39-25-39 25V84Z" fill="#2f6fed"/>
  <text x="256" y="326" text-anchor="middle" font-size="190" font-weight="700" font-family="Noto Sans CJK SC, Source Han Sans SC, sans-serif" fill="#10223f">墨</text>
</svg>
```

- [ ] **Step 5: Add root package entrypoints and ignore generated output**

```json
{
  "main": "desktop/main.mjs",
  "desktopName": "com.hzz2z.modureader",
  "description": "本地优先 PDF 深度阅读器",
  "author": "HZZ2Z <HZZ2Z@users.noreply.github.com>",
  "scripts": {
    "prepare:desktop": "node scripts/prepare-desktop-runtime.mjs",
    "desktop:run": "npm run build && npm run prepare:desktop && electron .",
    "build:linux": "npm run build && npm run prepare:desktop && electron-builder --linux AppImage deb --x64"
  }
}
```

Append `/.desktop-runtime/` and `/dist/` to `.gitignore`.

- [ ] **Step 6: Run packaging test, Next build and staged-server health check**

Run: `npm run test:run -- src/lib/desktop-packaging.test.ts && npm run build && npm run prepare:desktop`

Expected: PASS; `.desktop-runtime/server/server.js`, `.next/static` and `public/pdfjs` exist.

- [ ] **Step 7: Commit standalone and packaging configuration**

```bash
git add scripts/prepare-desktop-runtime.mjs scripts/prepare-desktop-runtime.d.mts src/lib/desktop-packaging.test.ts electron-builder.yml build/icon.svg next.config.mjs package.json package-lock.json .gitignore
git commit -m "build: package Linux desktop application"
```

---

### Task 7: Package verification, Linux documentation and final artifacts

**Files:**
- Create: `scripts/verify-linux-package.mjs`
- Create: `scripts/verify-linux-package.d.mts`
- Create: `src/lib/linux-package-verifier.test.ts`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `dist/墨读-1.0.0-x86_64.AppImage`, `dist/墨读-1.0.0-x86_64.deb`, `dpkg-deb`, `desktop-file-validate`.
- Produces: `npm run verify:linux` and documented installation/default-app/recovery steps.

- [ ] **Step 1: Write failing verifier tests for artifact naming and desktop metadata**

```ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { expectedLinuxArtifacts, validateDesktopEntryContent } from "../../scripts/verify-linux-package.mjs";

describe("Linux package verifier", () => {
  it("requires both 1.0.0 x86_64 deliverables", () => {
    expect(expectedLinuxArtifacts("1.0.0")).toEqual([
      "墨读-1.0.0-x86_64.AppImage",
      "墨读-1.0.0-x86_64.deb",
    ]);
  });

  it("requires PDF MIME, a file placeholder and the stable desktop id", () => {
    expect(() => validateDesktopEntryContent("[Desktop Entry]\nName=墨读\nExec=modu-reader-launcher %F\nMimeType=application/pdf;\nStartupWMClass=com.hzz2z.modureader\n"))
      .not.toThrow();
    expect(() => validateDesktopEntryContent("[Desktop Entry]\nExec=modu-reader\n"))
      .toThrow("缺少 application/pdf");
  });
});
```

- [ ] **Step 2: Run verifier tests and verify RED**

Run: `npm run test:run -- src/lib/linux-package-verifier.test.ts`

Expected: FAIL because the verifier module does not exist.

- [ ] **Step 3: Implement package verification with an isolated extraction directory**

```js
import { spawnSync } from "node:child_process";
import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function run(command, args, capture = false) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: capture ? "pipe" : "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} 执行失败（状态码 ${result.status}）`);
  return result.stdout ?? "";
}

export function expectedLinuxArtifacts(version) {
  return [`墨读-${version}-x86_64.AppImage`, `墨读-${version}-x86_64.deb`];
}

export function validateDesktopEntryContent(content) {
  if (!content.includes("MimeType=application/pdf;")) throw new Error("缺少 application/pdf MIME 关联");
  if (!/^Exec=.*%F$/m.test(content)) throw new Error("缺少 PDF 文件参数占位符");
  if (!content.includes("StartupWMClass=com.hzz2z.modureader")) throw new Error("缺少稳定窗口标识");
}

export async function verifyLinuxPackage(rootDir) {
  const packageJson = JSON.parse(await readFile(join(rootDir, "package.json"), "utf8"));
  const [appImageName, debName] = expectedLinuxArtifacts(packageJson.version);
  const appImagePath = join(rootDir, "dist", appImageName);
  const debPath = join(rootDir, "dist", debName);
  const appImageDetails = await stat(appImagePath);
  if ((appImageDetails.mode & 0o111) === 0) throw new Error("AppImage 没有可执行权限");
  await access(debPath);

  const extractionRoot = await mkdtemp(join(tmpdir(), "modu-deb-"));
  try {
    run("dpkg-deb", ["-x", debPath, extractionRoot]);
    const desktopPath = join(extractionRoot, "usr", "share", "applications", "com.hzz2z.modureader.desktop");
    const desktopContent = await readFile(desktopPath, "utf8");
    run("desktop-file-validate", [desktopPath]);
    validateDesktopEntryContent(desktopContent);
    await access(join(extractionRoot, "opt", "墨读", "resources", "app-server", "server.js"));
    await access(join(extractionRoot, "opt", "墨读", "resources", "assets", "icon.svg"));
    const listing = run("dpkg-deb", ["-c", debPath], true);
    if (/reader-e2e-sample|\.env|api[-_]?key|test-results/i.test(listing)) throw new Error("安装包含有测试或敏感文件");
  } finally {
    await rm(extractionRoot, { recursive: true, force: true });
  }
}

const launchedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (launchedDirectly) verifyLinuxPackage(process.cwd()).catch((error) => { console.error(error); process.exitCode = 1; });
```

`scripts/verify-linux-package.d.mts` contains:

```ts
export function expectedLinuxArtifacts(version: string): string[];
export function validateDesktopEntryContent(content: string): void;
export function verifyLinuxPackage(rootDir: string): Promise<void>;
```

- [ ] **Step 4: Add `verify:linux` and Linux 1.0.0 documentation**

Package script: `"verify:linux": "node scripts/verify-linux-package.mjs"`.

README gains:

````md
## Linux 桌面应用 1.0.0

```bash
npm run build:linux
```

构建产物位于 `dist/`。AppImage 首次运行前执行 `chmod +x "dist/墨读-1.0.0-x86_64.AppImage"`；Debian/Ubuntu 可使用 `sudo apt install ./dist/墨读-1.0.0-x86_64.deb`。打开“设置 → PDF 默认应用”并主动点击按钮后，双击 PDF 会自动导入并进入阅读器。
````

CHANGELOG 的 `1.0.0` 条目增加 Linux Electron AppImage/deb、单实例 PDF 打开和可选默认应用。

- [ ] **Step 5: Run all non-package verification**

Run: `npm run typecheck && npm run test:run && npm run build && npm run test:e2e`

Expected: all TypeScript, unit/component, browser E2E and Next production tests PASS.

- [ ] **Step 6: Build and inspect Linux artifacts**

Run: `npm run build:linux && npm run verify:linux`

Expected: PASS with exactly the two named 1.0.0 artifacts plus builder metadata; deb desktop entry validates and contains PDF MIME/file placeholder.

- [ ] **Step 7: Inspect repository diff and artifact sizes**

Run: `git diff --check && git status --short && du -h dist/墨读-1.0.0-x86_64.AppImage dist/墨读-1.0.0-x86_64.deb`

Expected: no whitespace errors, only intended source/docs changes, and both artifacts report non-zero sizes.

- [ ] **Step 8: Commit Linux 1.0.0 delivery**

```bash
git add scripts/verify-linux-package.mjs scripts/verify-linux-package.d.mts src/lib/linux-package-verifier.test.ts package.json package-lock.json README.md CHANGELOG.md
git commit -m "release: prepare Linux desktop 1.0.0"
```

- [ ] **Step 9: Do not tag or push until the user reviews the local artifacts**

Report the absolute paths, checksums and verification results. After explicit user approval, create `linux-v1.0.0` and publish the two packages without modifying `v1.0.0`.
