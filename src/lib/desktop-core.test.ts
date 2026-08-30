// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const desktopCoreUrl = new URL("../../desktop/desktop-core.mjs", import.meta.url).href;

describe("desktop security boundary", () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("keeps only unique PDF launch arguments and resolves relative paths", async () => {
    const { extractPdfPaths } = await import(/* @vite-ignore */ desktopCoreUrl);

    expect(
      extractPdfPaths(
        ["electron", ".", "--no-sandbox", "notes.pdf", "notes.pdf", "readme.txt"],
        "/course",
      ),
    ).toEqual(["/course/notes.pdf"]);
  });

  it("reads a regular file only when its extension and signature are PDF", async () => {
    const { readValidatedPdf } = await import(/* @vite-ignore */ desktopCoreUrl);
    const root = await mkdtemp(join(tmpdir(), "modu-pdf-"));
    temporaryRoots.push(root);
    const valid = join(root, "paper.pdf");
    const invalid = join(root, "fake.pdf");
    await writeFile(valid, "%PDF-1.7\nbody");
    await writeFile(invalid, "plain text");

    await expect(readValidatedPdf(valid)).resolves.toMatchObject({
      name: "paper.pdf",
      sourcePath: valid,
      bytes: expect.any(Uint8Array),
    });
    await expect(readValidatedPdf(invalid)).rejects.toThrow("不是有效的 PDF 文件");
  });

  it("rejects a directory even when its name ends in PDF", async () => {
    const { readValidatedPdf } = await import(/* @vite-ignore */ desktopCoreUrl);
    const root = await mkdtemp(join(tmpdir(), "modu-directory-"));
    temporaryRoots.push(root);
    const directory = join(root, "folder.pdf");
    await mkdir(directory);

    await expect(readValidatedPdf(directory)).rejects.toThrow("该路径不是普通文件");
  });

  it("accepts only the fixed local application origin", async () => {
    const { isTrustedRendererUrl } = await import(/* @vite-ignore */ desktopCoreUrl);

    expect(
      isTrustedRendererUrl(
        "http://127.0.0.1:32147/settings",
        "http://127.0.0.1:32147",
      ),
    ).toBe(true);
    expect(
      isTrustedRendererUrl(
        "http://127.0.0.1:32147.evil.test/",
        "http://127.0.0.1:32147",
      ),
    ).toBe(false);
  });

  it("quotes a desktop Exec argument without allowing interpolation", async () => {
    const { quoteDesktopExecArg, renderDesktopEntry } = await import(
      /* @vite-ignore */ desktopCoreUrl
    );
    const executable = "/home/A $book/Modu.AppImage";

    expect(quoteDesktopExecArg(executable)).toBe('"/home/A \\$book/Modu.AppImage"');
    expect(
      renderDesktopEntry({ executablePath: executable, iconPath: "/home/A/icon.svg" }),
    ).toContain('Exec="/home/A \\$book/Modu.AppImage" %F');
  });

  it("rejects line breaks in a desktop Exec argument", async () => {
    const { quoteDesktopExecArg } = await import(/* @vite-ignore */ desktopCoreUrl);

    expect(() => quoteDesktopExecArg("/apps/modu\nHidden=true")).toThrow(
      "桌面应用路径不合法",
    );
  });

  it("rejects line breaks in a desktop icon field", async () => {
    const { renderDesktopEntry } = await import(/* @vite-ignore */ desktopCoreUrl);

    expect(() =>
      renderDesktopEntry({
        executablePath: "/apps/modu",
        iconPath: "/icons/modu.svg\nHidden=true",
      }),
    ).toThrow("桌面应用图标路径不合法");
  });

  it("recognizes the exact registered desktop id", async () => {
    const { parsePdfDefaultStatus } = await import(/* @vite-ignore */ desktopCoreUrl);

    expect(
      parsePdfDefaultStatus(
        "com.hzz2z.modureader.desktop\n",
        "com.hzz2z.modureader.desktop",
      ),
    ).toBe(true);
    expect(
      parsePdfDefaultStatus(
        "org.gnome.Evince.desktop\n",
        "com.hzz2z.modureader.desktop",
      ),
    ).toBe(false);
  });
});
