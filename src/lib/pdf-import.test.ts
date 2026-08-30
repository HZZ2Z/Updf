import { describe, expect, it } from "vitest";

import {
  createDocumentRecord,
  fingerprintFile,
  validatePdfFile,
} from "@/lib/pdf-import";

function pdfFile(contents = "%PDF-1.7\nbody") {
  return new File([contents], "research-paper.pdf", { type: "application/pdf" });
}

describe("PDF import", () => {
  it("uses SHA-256 as the stable document identity", async () => {
    const file = new File(["abc"], "sample.pdf");

    await expect(fingerprintFile(file)).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("checks the file signature instead of trusting only the MIME type", async () => {
    await expect(validatePdfFile(pdfFile())).resolves.toBeUndefined();
    await expect(
      validatePdfFile(new File(["not a pdf"], "fake.pdf", { type: "application/pdf" })),
    ).rejects.toThrow("不是有效的 PDF 文件");
  });

  it("creates a resumable document record from inspected metadata", async () => {
    const file = pdfFile();
    const record = await createDocumentRecord(file, {
      title: "Interpretable Systems",
      author: "Lin et al.",
      pageCount: 28,
      coverDataUrl: "data:image/png;base64,cover",
      persisted: true,
    });

    expect(record).toMatchObject({
      id: record.fingerprint,
      title: "Interpretable Systems",
      author: "Lin et al.",
      currentPage: 1,
      continuousPage: 1,
      bookPage: 1,
      continuousZoom: 1,
      bookZoom: 1,
      progress: 0,
    });
  });

  it("reuses a caller-supplied verified fingerprint", async () => {
    const file = pdfFile();

    const record = await createDocumentRecord(
      file,
      { pageCount: 1, persisted: true },
      "verified-sha",
    );

    expect(record.id).toBe("verified-sha");
    expect(record.fingerprint).toBe("verified-sha");
  });
});
