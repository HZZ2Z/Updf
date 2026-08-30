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
  await cp(
    join(rootDir, ".next", "static"),
    join(target, ".next", "static"),
    { recursive: true },
  );
  await cp(
    join(rootDir, "public"),
    join(target, "public"),
    { recursive: true },
  );
}

const launchedDirectly = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (launchedDirectly) {
  prepareDesktopRuntime(resolve(dirname(fileURLToPath(import.meta.url)), ".."))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
