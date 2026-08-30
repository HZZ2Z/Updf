import type { PDFDocumentLoadingTask } from "pdfjs-dist";

type PdfJsModule = typeof import("pdfjs-dist");

const PDFJS_WORKER_URL = "/pdf.worker.min.mjs";

/**
 * Keep every PDF.js entry point on the same browser-runtime configuration.
 * The trailing slashes are required because PDF.js appends decoder filenames.
 */
export function loadPdfDocument(
  pdfjs: PdfJsModule,
  data: Uint8Array,
): PDFDocumentLoadingTask {
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
  return pdfjs.getDocument({
    data,
    wasmUrl: "/pdfjs/wasm/",
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    canvasMaxAreaInBytes: 32 * 1024 * 1024,
  });
}
