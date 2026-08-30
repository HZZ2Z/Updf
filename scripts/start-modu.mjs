import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { createLaunchPlan, needsProductionBuild } from "./launcher-core.mjs";

const DEFAULT_URL = "http://127.0.0.1:3000";

export async function isServerRunning(url) {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(1200),
      cache: "no-store",
    });
    return response.status > 0;
  } catch {
    return false;
  }
}

function runCommand(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} 执行失败`);
}

function openBrowser(url) {
  const candidates = process.platform === "win32"
    ? [["cmd", ["/c", "start", "", url]]]
    : process.platform === "darwin"
      ? [["open", [url]]]
      : [["xdg-open", [url]], ["gio", ["open", url]]];

  for (const [command, args] of candidates) {
    const result = spawnSync(command, ["--help"], { stdio: "ignore" });
    if (process.platform !== "win32" && result.error) continue;
    const opener = spawn(command, args, { detached: true, stdio: "ignore" });
    opener.unref();
    return;
  }
  console.log(`浏览器未自动打开，请访问：${url}`);
}

async function waitForServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isServerRunning(url)) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 300));
  }
  throw new Error("本地服务启动超时，请查看上方日志");
}

async function main() {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const url = process.env.MODU_READER_URL || DEFAULT_URL;
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (!Number.isFinite(nodeMajor) || nodeMajor < 20) {
    throw new Error(`需要 Node.js 20 或更高版本，当前版本为 ${process.versions.node}`);
  }

  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const serverRunning = await isServerRunning(url);
  const dependenciesInstalled = existsSync(resolve(rootDir, "node_modules", "next", "package.json"));
  const buildRequired = serverRunning ? false : await needsProductionBuild(rootDir);
  const plan = createLaunchPlan({ serverRunning, dependenciesInstalled, buildRequired });

  console.log("\n墨读一键启动器");
  console.log("────────────────────────");

  if (plan.includes("install")) {
    console.log("首次运行：正在安装依赖…");
    runCommand(npmCommand, ["install"], rootDir);
  }
  if (plan.includes("build")) {
    console.log("正在生成最新的本地生产版本…");
    runCommand(npmCommand, ["run", "build"], rootDir);
  }
  if (plan.length === 1 && plan[0] === "open") {
    console.log("墨读已经在运行，正在打开浏览器…");
    openBrowser(url);
    return;
  }

  console.log(`正在启动：${url}`);
  const server = spawn(npmCommand, ["run", "start"], { cwd: rootDir, stdio: "inherit" });
  const serverExit = new Promise((resolveExit, rejectExit) => {
    server.once("error", rejectExit);
    server.once("exit", (code, signal) => resolveExit({ code, signal }));
  });
  await Promise.race([
    waitForServer(url),
    serverExit.then(({ code, signal }) => {
      throw new Error(`本地服务提前退出（${signal || `状态码 ${code}`}）`);
    }),
  ]);
  console.log("墨读已启动，正在打开浏览器。关闭此窗口即可停止服务。\n");
  openBrowser(url);
  const { code, signal } = await serverExit;
  if (code && signal !== "SIGINT") process.exitCode = code;
}

const launchedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (launchedDirectly) {
  main().catch((error) => {
    console.error(`\n启动失败：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
