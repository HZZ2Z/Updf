// @vitest-environment node

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { prepareDesktopRuntime } from "../../scripts/prepare-desktop-runtime.mjs";

describe("Linux desktop packaging", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("stages standalone server, static assets and public PDF.js files", async () => {
    const root = await mkdtemp(join(tmpdir(), "modu-stage-"));
    roots.push(root);
    await Promise.all([
      mkdir(join(root, ".next", "standalone"), { recursive: true }),
      mkdir(join(root, ".next", "static"), { recursive: true }),
      mkdir(join(root, "public", "pdfjs"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(root, ".next", "standalone", "server.js"), "server"),
      writeFile(join(root, ".next", "static", "chunk.js"), "chunk"),
      writeFile(join(root, "public", "pdf.worker.min.mjs"), "worker"),
      writeFile(join(root, "public", "pdfjs", "cmaps.bin"), "cmap"),
    ]);

    await prepareDesktopRuntime(root);

    await expect(readFile(
      join(root, ".desktop-runtime", "server", "server.js"),
      "utf8",
    )).resolves.toBe("server");
    await expect(readFile(
      join(root, ".desktop-runtime", "server", ".next", "static", "chunk.js"),
      "utf8",
    )).resolves.toBe("chunk");
    await expect(readFile(
      join(root, ".desktop-runtime", "server", "public", "pdf.worker.min.mjs"),
      "utf8",
    )).resolves.toBe("worker");
    await expect(readFile(
      join(root, ".desktop-runtime", "server", "public", "pdfjs", "cmaps.bin"),
      "utf8",
    )).resolves.toBe("cmap");
  });

  it("keeps Linux package identity and build scripts at version 1.1.1", async () => {
    const packageJson = JSON.parse(await readFile(
      join(process.cwd(), "package.json"),
      "utf8",
    ));

    expect(packageJson).toMatchObject({
      version: "1.1.1",
      main: "desktop/main.mjs",
      desktopName: "com.hzz2z.modureader",
      homepage: "https://github.com/HZZ2Z/Updf",
    });
    expect(packageJson.scripts).toHaveProperty("desktop:run");
    expect(packageJson.scripts).toHaveProperty("build:linux");
  });
});
