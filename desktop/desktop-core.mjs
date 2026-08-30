import { open, readFile, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

export function extractPdfPaths(argv, cwd) {
  const seen = new Set();
  const paths = [];

  for (const value of argv) {
    if (
      typeof value !== "string"
      || value.startsWith("-")
      || extname(value).toLowerCase() !== ".pdf"
    ) {
      continue;
    }
    const path = resolve(cwd, value);
    if (seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }

  return paths;
}

export async function readValidatedPdf(path) {
  if (extname(path).toLowerCase() !== ".pdf") {
    throw new Error("只能打开 PDF 文件");
  }

  const details = await stat(path);
  if (!details.isFile()) {
    throw new Error("该路径不是普通文件");
  }

  const handle = await open(path, "r");
  const signature = Buffer.alloc(5);
  try {
    await handle.read(signature, 0, signature.length, 0);
  } finally {
    await handle.close();
  }

  if (signature.toString("ascii") !== "%PDF-") {
    throw new Error("不是有效的 PDF 文件");
  }

  const bytes = await readFile(path);
  return {
    name: basename(path),
    sourcePath: path,
    bytes: Uint8Array.from(bytes),
  };
}

export function isTrustedRendererUrl(value, origin) {
  try {
    return new URL(value).origin === origin;
  } catch {
    return false;
  }
}

export function quoteDesktopExecArg(value) {
  if (/\r|\n/.test(value)) {
    throw new Error("桌面应用路径不合法");
  }
  const escaped = value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("`", "\\`")
    .replaceAll("$", "\\$");
  return `"${escaped}"`;
}

export function renderDesktopEntry({ executablePath, iconPath }) {
  if (/\r|\n/.test(iconPath)) {
    throw new Error("桌面应用图标路径不合法");
  }
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=墨读",
    "Comment=本地优先 PDF 深度阅读器",
    `Exec=${quoteDesktopExecArg(executablePath)} %F`,
    `Icon=${iconPath}`,
    "Terminal=false",
    "Categories=Office;Education;",
    "MimeType=application/pdf;",
    "StartupWMClass=com.hzz2z.modureader",
    "",
  ].join("\n");
}

export function parsePdfDefaultStatus(stdout, desktopName) {
  return stdout.trim() === desktopName;
}
