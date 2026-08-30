import { loadPdfDocument } from "@/lib/pdf-runtime";
import type { DocumentRecord } from "@/lib/types";

export interface PdfInspection {
  title?: string;
  author?: string;
  pageCount: number;
  coverDataUrl?: string;
  hasTextLayer: boolean;
}

function metadataString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export async function inspectPdfFile(file: File): Promise<PdfInspection> {
  const pdfjs = await import("pdfjs-dist");
  const loadingTask = loadPdfDocument(
    pdfjs,
    new Uint8Array(await file.arrayBuffer()),
  );

  loadingTask.onPassword = (submitPassword: (password: string) => void) => {
    const password = window.prompt("这份 PDF 已加密，请输入密码");
    if (password !== null) submitPassword(password);
  };

  const document = await loadingTask.promise;
  try {
    const [metadata, firstPage] = await Promise.all([
      document.getMetadata().catch(() => ({ info: {} })),
      document.getPage(1),
    ]);
    const [textContent, coverDataUrl] = await Promise.all([
      firstPage.getTextContent().catch(() => ({ items: [] })),
      renderCover(firstPage).catch(() => undefined),
    ]);
    const info = metadata.info as Record<string, unknown>;

    return {
      title: metadataString(info.Title),
      author: metadataString(info.Author),
      pageCount: document.numPages,
      coverDataUrl,
      hasTextLayer: textContent.items.some(
        (item) => "str" in item && Boolean(item.str.trim()),
      ),
    };
  } finally {
    await loadingTask.destroy();
  }
}

async function renderCover(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof import("pdfjs-dist")["getDocument"]>["promise"]>["getPage"]>>,
): Promise<string> {
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(0.42, 180 / baseViewport.width);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const outputScale = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("浏览器无法生成 PDF 封面");
  await page.render({
    canvasContext: context,
    canvas,
    viewport,
    transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
  }).promise;
  return canvas.toDataURL("image/jpeg", 0.82);
}

const ephemeralDocuments = new Map<string, DocumentRecord>();

export function rememberEphemeralDocument(documentRecord: DocumentRecord) {
  ephemeralDocuments.set(documentRecord.id, documentRecord);
}

export function updateEphemeralDocument(
  id: string,
  changes: Partial<DocumentRecord>,
) {
  const documentRecord = ephemeralDocuments.get(id);
  if (!documentRecord) return false;
  ephemeralDocuments.set(id, { ...documentRecord, ...changes });
  return true;
}

export function forgetEphemeralDocument(id: string) {
  return ephemeralDocuments.delete(id);
}

export function getEphemeralDocument(id: string) {
  return ephemeralDocuments.get(id);
}

export function listEphemeralDocuments() {
  return Array.from(ephemeralDocuments.values());
}
