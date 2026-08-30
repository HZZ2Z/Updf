import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export function createLaunchPlan({
  serverRunning,
  dependenciesInstalled,
  buildRequired,
}) {
  if (serverRunning) return ["open"];

  const plan = [];
  if (!dependenciesInstalled) plan.push("install");
  if (buildRequired || !dependenciesInstalled) plan.push("build");
  plan.push("start", "open");
  return plan;
}

async function newestModification(path) {
  try {
    const details = await stat(path);
    if (!details.isDirectory()) return details.mtimeMs;
    const children = await readdir(path);
    const times = await Promise.all(children.map((child) => newestModification(join(path, child))));
    return Math.max(details.mtimeMs, ...times);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return 0;
    throw error;
  }
}

export async function needsProductionBuild(rootDir) {
  const buildIdPath = join(rootDir, ".next", "BUILD_ID");
  let buildTime;
  try {
    buildTime = (await stat(buildIdPath)).mtimeMs;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return true;
    throw error;
  }

  const trackedPaths = [
    "src",
    "public",
    "package.json",
    "package-lock.json",
    "next.config.mjs",
    "tsconfig.json",
  ];
  const modificationTimes = await Promise.all(
    trackedPaths.map((path) => newestModification(join(rootDir, path))),
  );
  return Math.max(...modificationTimes) > buildTime;
}
