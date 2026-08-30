import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createLaunchPlan,
  needsProductionBuild,
} from "../../scripts/launcher-core.mjs";
import { isServerRunning } from "../../scripts/start-modu.mjs";

describe("one-click launcher", () => {
  const temporaryRoots: string[] = [];
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("opens the existing local reader without starting a duplicate server", () => {
    expect(createLaunchPlan({
      serverRunning: true,
      dependenciesInstalled: false,
      buildRequired: true,
    })).toEqual(["open"]);
  });

  it("installs, builds, starts and opens on the first run", () => {
    expect(createLaunchPlan({
      serverRunning: false,
      dependenciesInstalled: false,
      buildRequired: true,
    })).toEqual(["install", "build", "start", "open"]);
  });

  it("starts immediately when dependencies and the production build are ready", () => {
    expect(createLaunchPlan({
      serverRunning: false,
      dependenciesInstalled: true,
      buildRequired: false,
    })).toEqual(["start", "open"]);
  });

  it("rebuilds when application source is newer than the last production build", async () => {
    const root = await mkdtemp(join(tmpdir(), "modu-launcher-"));
    temporaryRoots.push(root);
    await mkdir(join(root, ".next"), { recursive: true });
    await mkdir(join(root, "src"), { recursive: true });
    const buildId = join(root, ".next", "BUILD_ID");
    const source = join(root, "src", "app.tsx");
    await writeFile(buildId, "build");
    await writeFile(source, "source");
    await utimes(buildId, new Date("2026-01-01"), new Date("2026-01-01"));
    await utimes(source, new Date("2026-01-02"), new Date("2026-01-02"));

    await expect(needsProductionBuild(root)).resolves.toBe(true);
  });

  it("recognizes an already-running local reader", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("墨读");
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not expose a TCP port");

    await expect(isServerRunning(`http://127.0.0.1:${address.port}`)).resolves.toBe(true);
    await expect(isServerRunning("http://127.0.0.1:1")).resolves.toBe(false);
  });

  it("finds a supported Node.js runtime in the user directory when the desktop PATH omits it", async () => {
    const home = await mkdtemp(join(tmpdir(), "modu-launcher-home-"));
    temporaryRoots.push(home);
    const runtimeBin = join(home, "node-v24.99.0-linux-x64", "bin");
    await mkdir(runtimeBin, { recursive: true });
    const nodePath = join(runtimeBin, "node");
    const npmPath = join(runtimeBin, "npm");
    await writeFile(nodePath, "#!/usr/bin/env bash\necho v24.99.0\n");
    await writeFile(npmPath, "#!/usr/bin/env bash\necho 11.99.0\n");
    await chmod(nodePath, 0o755);
    await chmod(npmPath, 0o755);

    const result = spawnSync("/bin/bash", [join(process.cwd(), "启动墨读.sh"), "--diagnose"], {
      cwd: process.cwd(),
      encoding: "utf8",
      input: "\n",
      env: {
        HOME: home,
        NODE_ENV: "test",
        PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Node.js: ${nodePath}`);
    expect(result.stdout).toContain(`npm: ${npmPath}`);
  });
});
