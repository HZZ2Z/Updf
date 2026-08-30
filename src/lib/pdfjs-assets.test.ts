import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { syncPdfJsAssets } from "../../scripts/sync-pdfjs-assets.mjs";

describe("PDF.js browser assets", () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("publishes the worker, WASM decoders, character maps and standard fonts", async () => {
    const root = await mkdtemp(join(tmpdir(), "modu-pdfjs-assets-"));
    temporaryRoots.push(root);
    const pdfjsRoot = join(root, "node_modules", "pdfjs-dist");
    await Promise.all([
      mkdir(join(pdfjsRoot, "build"), { recursive: true }),
      mkdir(join(pdfjsRoot, "wasm"), { recursive: true }),
      mkdir(join(pdfjsRoot, "cmaps"), { recursive: true }),
      mkdir(join(pdfjsRoot, "standard_fonts"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(pdfjsRoot, "build", "pdf.worker.min.mjs"), "worker-v6"),
      writeFile(join(pdfjsRoot, "wasm", "jbig2.wasm"), "jbig2-decoder"),
      writeFile(join(pdfjsRoot, "cmaps", "UniJIS-UTF16-H.bcmap"), "unicode-map"),
      writeFile(join(pdfjsRoot, "standard_fonts", "LiberationSans-Regular.ttf"), "font-data"),
    ]);

    await syncPdfJsAssets(root);

    await expect(readFile(join(root, "public", "pdf.worker.min.mjs"), "utf8"))
      .resolves.toBe("worker-v6");
    await expect(readFile(join(root, "public", "pdfjs", "wasm", "jbig2.wasm"), "utf8"))
      .resolves.toBe("jbig2-decoder");
    await expect(readFile(join(root, "public", "pdfjs", "cmaps", "UniJIS-UTF16-H.bcmap"), "utf8"))
      .resolves.toBe("unicode-map");
    await expect(readFile(join(root, "public", "pdfjs", "standard_fonts", "LiberationSans-Regular.ttf"), "utf8"))
      .resolves.toBe("font-data");
  });
});
