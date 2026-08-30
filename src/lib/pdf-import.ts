import type { DocumentRecord } from "@/lib/types";

export async function fingerprintFile(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function validatePdfFile(file: File): Promise<void> {
  const signature = new TextDecoder().decode(await file.slice(0, 5).arrayBuffer());
  if (signature !== "%PDF-") throw new Error("不是有效的 PDF 文件");
}

interface InspectedPdfMetadata {
  title?: string;
  author?: string;
  pageCount: number;
  coverDataUrl?: string;
  persisted: boolean;
  hasTextLayer?: boolean;
}

export async function createDocumentRecord(
  file: File,
  metadata: InspectedPdfMetadata,
): Promise<DocumentRecord> {
  await validatePdfFile(file);
  const fingerprint = await fingerprintFile(file);
  const now = new Date().toISOString();

  return {
    id: fingerprint,
    fingerprint,
    title: metadata.title?.trim() || file.name.replace(/\.pdf$/i, ""),
    fileName: file.name,
    file,
    pageCount: metadata.pageCount,
    coverDataUrl: metadata.coverDataUrl,
    author: metadata.author,
    createdAt: now,
    lastOpenedAt: now,
    currentPage: 1,
    continuousPage: 1,
    bookPage: 1,
    continuousZoom: 1,
    bookZoom: 1,
    progress: 0,
    persisted: metadata.persisted,
    hasTextLayer: metadata.hasTextLayer,
  };
}
