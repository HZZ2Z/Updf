import { spawnSync } from "node:child_process";
import {
  access,
  mkdtemp,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function run(command, args, capture = false) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} 执行失败（状态码 ${result.status}）`);
  }
  return result.stdout ?? "";
}

export function expectedLinuxArtifacts(version) {
  return [
    `Modu-${version}-x86_64.AppImage`,
    `Modu-${version}-x86_64.deb`,
  ];
}

export function validateDesktopEntryContent(content) {
  if (!content.includes("MimeType=application/pdf;")) {
    throw new Error("缺少 application/pdf MIME 关联");
  }
  if (!/^Exec=.*%F\s*$/m.test(content)) {
    throw new Error("缺少 PDF 文件参数占位符");
  }
  if (!content.includes("StartupWMClass=com.hzz2z.modureader")) {
    throw new Error("缺少稳定窗口标识");
  }
}

export async function validateStandaloneServerFiles(serverRoot) {
  try {
    await Promise.all([
      access(join(serverRoot, "server.js")),
      access(join(serverRoot, "node_modules", "next", "package.json")),
    ]);
  } catch {
    throw new Error("缺少 Next standalone 运行时");
  }
}

export async function verifyLinuxPackage(rootDir) {
  const packageJson = JSON.parse(await readFile(join(rootDir, "package.json"), "utf8"));
  const [appImageName, debName] = expectedLinuxArtifacts(packageJson.version);
  const appImagePath = join(rootDir, "dist", appImageName);
  const debPath = join(rootDir, "dist", debName);
  const appImageDetails = await stat(appImagePath);
  if ((appImageDetails.mode & 0o111) === 0) {
    throw new Error("AppImage 没有可执行权限");
  }
  await access(debPath);
  await access(join(rootDir, "dist", "latest-linux.yml"));

  const extractionRoot = await mkdtemp(join(tmpdir(), "modu-deb-"));
  try {
    run("dpkg-deb", ["-x", debPath, extractionRoot]);
    const desktopPath = join(
      extractionRoot,
      "usr",
      "share",
      "applications",
      "com.hzz2z.modureader.desktop",
    );
    const desktopContent = await readFile(desktopPath, "utf8");
    run("desktop-file-validate", [desktopPath]);
    validateDesktopEntryContent(desktopContent);
    const serverRoot = join(
      extractionRoot,
      "opt",
      "墨读",
      "resources",
      "app-server",
    );
    await validateStandaloneServerFiles(serverRoot);
    const appAsarPath = join(
      extractionRoot,
      "opt",
      "墨读",
      "resources",
      "app.asar",
    );
    await Promise.all([
      access(join(extractionRoot, "opt", "墨读", "modu-reader")),
      access(appAsarPath),
      access(join(extractionRoot, "opt", "墨读", "resources", "app-update.yml")),
      access(join(
        serverRoot,
        "public",
        "pdf.worker.min.mjs",
      )),
      access(join(
        extractionRoot,
        "opt",
        "墨读",
        "resources",
        "assets",
        "icon.svg",
      )),
    ]);
    await Promise.all([
      access(join(
        extractionRoot,
        "opt",
        "墨读",
        "resources",
        "updater",
        "node_modules",
        "electron-updater",
        "package.json",
      )),
      access(join(
        extractionRoot,
        "opt",
        "墨读",
        "resources",
        "updater",
        "node_modules",
        "builder-util-runtime",
        "package.json",
      )),
    ]).catch(() => {
      throw new Error("安装包缺少 electron-updater 运行时");
    });
    const listing = run("dpkg-deb", ["-c", debPath], true);
    if (/reader-e2e-sample|\.env(?:\.|$)|api[-_]?key|test-results/i.test(listing)) {
      throw new Error("安装包包含测试或敏感文件");
    }
  } finally {
    await rm(extractionRoot, { recursive: true, force: true });
  }
}

const launchedDirectly = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (launchedDirectly) {
  verifyLinuxPackage(process.cwd()).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
