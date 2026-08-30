import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ASSET_DIRECTORIES = ["wasm", "cmaps", "standard_fonts"];

export async function syncPdfJsAssets(rootDir) {
  const pdfjsRoot = join(rootDir, "node_modules", "pdfjs-dist");
  const publicRoot = join(rootDir, "public");
  const pdfjsPublicRoot = join(publicRoot, "pdfjs");

  await mkdir(pdfjsPublicRoot, { recursive: true });
  await cp(
    join(pdfjsRoot, "build", "pdf.worker.min.mjs"),
    join(publicRoot, "pdf.worker.min.mjs"),
    { force: true },
  );

  await Promise.all(ASSET_DIRECTORIES.map(async (directory) => {
    const destination = join(pdfjsPublicRoot, directory);
    await rm(destination, { recursive: true, force: true });
    await cp(join(pdfjsRoot, directory), destination, { recursive: true });
  }));
}

const scriptPath = fileURLToPath(import.meta.url);
const launchedDirectly = process.argv[1] && resolve(process.argv[1]) === scriptPath;

if (launchedDirectly) {
  const rootDir = resolve(dirname(scriptPath), "..");
  syncPdfJsAssets(rootDir).catch((error) => {
    console.error(`PDF.js 资源同步失败：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
