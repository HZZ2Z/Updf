import { beforeEach, describe, expect, it, vi } from "vitest";

const pdfjsMock = vi.hoisted(() => {
  const page = {
    getTextContent: vi.fn().mockResolvedValue({ items: [] }),
    getViewport: vi.fn().mockReturnValue({ width: 499, height: 668 }),
  };
  const pdf = {
    numPages: 408,
    getMetadata: vi.fn().mockResolvedValue({ info: { Title: "Introduction to Robotics" } }),
    getPage: vi.fn().mockResolvedValue(page),
  };
  const loadingTask = {
    promise: Promise.resolve(pdf),
    destroy: vi.fn().mockResolvedValue(undefined),
    onPassword: undefined as ((submitPassword: (password: string) => void) => void) | undefined,
  };

  return {
    GlobalWorkerOptions: { workerSrc: "" },
    getDocument: vi.fn().mockReturnValue(loadingTask),
    loadingTask,
  };
});

vi.mock("pdfjs-dist", () => pdfjsMock);

import { inspectPdfFile } from "@/lib/pdf-engine";

describe("PDF.js document loading", () => {
  beforeEach(() => {
    pdfjsMock.getDocument.mockClear();
  });

  it("provides every decoder asset URL needed by image-based PDFs", async () => {
    const file = new File(["%PDF-1.7"], "robotics.pdf", { type: "application/pdf" });

    await inspectPdfFile(file);

    expect(pdfjsMock.getDocument).toHaveBeenCalledWith({
      data: expect.any(Uint8Array),
      wasmUrl: "/pdfjs/wasm/",
      cMapUrl: "/pdfjs/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/pdfjs/standard_fonts/",
      canvasMaxAreaInBytes: 32 * 1024 * 1024,
    });
    expect(pdfjsMock.GlobalWorkerOptions.workerSrc).toBe("/pdf.worker.min.mjs");
  });
});
