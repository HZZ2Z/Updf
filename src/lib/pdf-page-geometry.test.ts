import type { PDFDocumentProxy } from "pdfjs-dist";
import { describe, expect, it, vi } from "vitest";

import {
  getPageGeometryScanOrder,
  mergePdfPageSizes,
  scanPdfPageSizes,
} from "@/lib/pdf-page-geometry";

describe("PDF page geometry scanning", () => {
  it("keeps the existing map identity when a measured size has not changed", () => {
    const current = { 1: { width: 595, height: 842 } };
    expect(mergePdfPageSizes(current, { 1: { width: 595, height: 842 } })).toBe(current);
    expect(mergePdfPageSizes(current, { 2: { width: 612, height: 792 } })).toEqual({
      1: { width: 595, height: 842 },
      2: { width: 612, height: 792 },
    });
  });

  it("scans outward from the reading page and skips cached geometry", () => {
    expect(getPageGeometryScanOrder(7, 4, {
      3: { width: 595, height: 842 },
      4: { width: 595, height: 842 },
    })).toEqual([5, 2, 6, 1, 7]);
  });

  it("yields before every measured page while publishing state in larger batches", async () => {
    const executionOrder: string[] = [];
    const cleanup = vi.fn();
    const getPage = vi.fn().mockImplementation(async (pageNumber: number) => {
      executionOrder.push(`page-${pageNumber}`);
      return {
        getViewport: () => ({ width: pageNumber * 100, height: pageNumber * 140 }),
        cleanup,
      };
    });
    const onBatch = vi.fn();
    const yieldToBrowser = vi.fn().mockImplementation(async () => { executionOrder.push("yield"); });
    const waitForRenderIdle = vi.fn().mockImplementation(async () => { executionOrder.push("render-idle"); });

    await expect(scanPdfPageSizes({
      pdf: { getPage } as unknown as PDFDocumentProxy,
      pageCount: 4,
      currentPage: 2,
      knownSizes: { 2: { width: 200, height: 280 } },
      batchSize: 2,
      onBatch,
      yieldToBrowser,
      waitForRenderIdle,
    })).resolves.toEqual({
      1: { width: 100, height: 140 },
      2: { width: 200, height: 280 },
      3: { width: 300, height: 420 },
      4: { width: 400, height: 560 },
    });
    expect(getPage.mock.calls.map(([pageNumber]) => pageNumber)).toEqual([3, 1, 4]);
    expect(onBatch).toHaveBeenCalledTimes(2);
    expect(yieldToBrowser).toHaveBeenCalledTimes(3);
    expect(waitForRenderIdle).toHaveBeenCalledTimes(3);
    expect(cleanup).toHaveBeenCalledTimes(3);
    expect(executionOrder.slice(0, 3)).toEqual(["yield", "render-idle", "page-3"]);
  });

  it("cleans up a page when scanning is aborted after it was acquired", async () => {
    const controller = new AbortController();
    const cleanup = vi.fn();
    const getPage = vi.fn().mockImplementation(async () => {
      controller.abort();
      return {
        getViewport: () => ({ width: 595, height: 842 }),
        cleanup,
      };
    });

    await scanPdfPageSizes({
      pdf: { getPage } as unknown as PDFDocumentProxy,
      pageCount: 1,
      currentPage: 1,
      knownSizes: {},
      signal: controller.signal,
      yieldToBrowser: vi.fn().mockResolvedValue(undefined),
    });

    expect(cleanup).toHaveBeenCalledOnce();
  });
});
