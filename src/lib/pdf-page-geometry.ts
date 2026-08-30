import type { PDFDocumentProxy } from "pdfjs-dist";

import type { PdfPageSize, PdfPageSizeMap } from "@/lib/types";

export function mergePdfPageSizes(current: PdfPageSizeMap, incoming: PdfPageSizeMap) {
  let changed = false;
  for (const [pageNumber, size] of Object.entries(incoming)) {
    const existing = current[Number(pageNumber)];
    if (!existing || existing.width !== size.width || existing.height !== size.height) {
      changed = true;
      break;
    }
  }
  return changed ? { ...current, ...incoming } : current;
}

export function getPageGeometryScanOrder(
  pageCount: number,
  currentPage: number,
  knownSizes: PdfPageSizeMap,
) {
  const count = Math.max(0, Math.round(pageCount));
  if (count === 0) return [];
  const center = Math.min(Math.max(Math.round(currentPage), 1), count);
  const pages: number[] = [];
  if (!knownSizes[center]) pages.push(center);
  const forward = Array.from(
    { length: count - center },
    (_, index) => center + index + 1,
  ).filter((page) => !knownSizes[page]);
  const backward = Array.from(
    { length: center - 1 },
    (_, index) => center - index - 1,
  ).filter((page) => !knownSizes[page]);
  const remaining = Math.max(forward.length, backward.length);
  for (let index = 0; index < remaining; index += 1) {
    if (forward[index] !== undefined) pages.push(forward[index]);
    if (backward[index] !== undefined) pages.push(backward[index]);
  }
  return pages;
}

function yieldDuringIdle() {
  return new Promise<void>((resolve) => {
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      const waitForBudget = () => window.requestIdleCallback((deadline) => {
        if (deadline.didTimeout || deadline.timeRemaining() >= 4) {
          resolve();
          return;
        }
        waitForBudget();
      }, { timeout: 120 });
      waitForBudget();
      return;
    }
    setTimeout(resolve, 16);
  });
}

export async function scanPdfPageSizes({
  pdf,
  pageCount,
  currentPage,
  knownSizes,
  batchSize = 8,
  signal,
  onBatch,
  yieldToBrowser = yieldDuringIdle,
  waitForRenderIdle,
}: {
  pdf: PDFDocumentProxy;
  pageCount: number;
  currentPage: number;
  knownSizes: PdfPageSizeMap;
  batchSize?: number;
  signal?: AbortSignal;
  onBatch?: (sizes: PdfPageSizeMap) => void;
  yieldToBrowser?: () => Promise<void>;
  waitForRenderIdle?: () => Promise<void>;
}): Promise<PdfPageSizeMap> {
  const sizes: PdfPageSizeMap = { ...knownSizes };
  const order = getPageGeometryScanOrder(pageCount, currentPage, knownSizes);
  const safeBatchSize = Math.max(1, Math.round(batchSize));

  let batch: PdfPageSizeMap = {};
  for (const pageNumber of order) {
    if (signal?.aborted) break;
    await yieldToBrowser();
    if (signal?.aborted) break;
    await waitForRenderIdle?.();
    if (signal?.aborted) break;
    const page = await pdf.getPage(pageNumber);
    try {
      if (signal?.aborted) break;
      const viewport = page.getViewport({ scale: 1 });
      const size: PdfPageSize = { width: viewport.width, height: viewport.height };
      sizes[pageNumber] = size;
      batch[pageNumber] = size;
    } finally {
      page.cleanup();
    }
    if (Object.keys(batch).length >= safeBatchSize) {
      onBatch?.(batch);
      batch = {};
    }
  }
  if (Object.keys(batch).length > 0) onBatch?.(batch);

  return sizes;
}
