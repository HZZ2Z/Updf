// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  expectedLinuxArtifacts,
  validateStandaloneServerFiles,
  validateDesktopEntryContent,
} from "../../scripts/verify-linux-package.mjs";

describe("Linux package verifier", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("requires both 1.0.0 x86_64 deliverables", () => {
    expect(expectedLinuxArtifacts("1.0.0")).toEqual([
      "Modu-1.0.0-x86_64.AppImage",
      "Modu-1.0.0-x86_64.deb",
    ]);
  });

  it("requires PDF MIME, a file placeholder and the stable desktop identity", () => {
    expect(() => validateDesktopEntryContent([
      "[Desktop Entry]",
      "Name=墨读",
      'Exec="/opt/墨读/modu-reader" %F',
      "MimeType=application/pdf;",
      "StartupWMClass=com.hzz2z.modureader",
      "",
    ].join("\n"))).not.toThrow();

    expect(() => validateDesktopEntryContent([
      "[Desktop Entry]",
      "Exec=modu-reader",
      "StartupWMClass=com.hzz2z.modureader",
      "",
    ].join("\n"))).toThrow("缺少 application/pdf");
  });

  it("rejects a packaged standalone server when its traced Next runtime is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "modu-server-check-"));
    roots.push(root);
    await writeFile(join(root, "server.js"), "server");

    await expect(validateStandaloneServerFiles(root)).rejects.toThrow(
      "缺少 Next standalone 运行时",
    );

    await mkdir(join(root, "node_modules", "next"), { recursive: true });
    await writeFile(
      join(root, "node_modules", "next", "package.json"),
      JSON.stringify({ name: "next", version: "16.3.3" }),
    );
    await expect(validateStandaloneServerFiles(root)).resolves.toBeUndefined();
  });
});
