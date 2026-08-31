export type ReaderMode = "continuous" | "book";
export type HighlightColor = "yellow" | "green" | "pink";
export type TranslationService = "deepseek" | "google";
export type TranslationProvider = TranslationService | "smart";

export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfPageSize {
  width: number;
  height: number;
}

export type PdfPageSizeMap = Record<number, PdfPageSize>;

export interface TextAnchor {
  page: number;
  exact: string;
  prefix: string;
  suffix: string;
  rotation: number;
  rects: NormalizedRect[];
}

export interface TextSelectionSnapshot {
  page: number;
  text: string;
  context: string;
  anchor: TextAnchor;
  viewportX: number;
  viewportY: number;
}

export interface DocumentRecord {
  id: string;
  fingerprint: string;
  title: string;
  fileName: string;
  file: Blob;
  pageCount: number;
  coverDataUrl?: string;
  author?: string;
  createdAt: string;
  lastOpenedAt: string;
  sortOrder?: number;
  pinnedAt?: string;
  folderId?: string;
  currentPage: number;
  continuousPage: number;
  bookPage: number;
  continuousZoom: number;
  bookZoom: number;
  progress: number;
  persisted: boolean;
  hasTextLayer?: boolean;
  pageSizes?: PdfPageSizeMap;
}

export interface LibraryFolder {
  id: string;
  name: string;
  normalizedName: string;
  createdAt: string;
  updatedAt: string;
  sortOrder?: number;
}

export interface TranslationPayload {
  id: string;
  cacheKey: string;
  originalText: string;
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
  model: string;
  createdAt: string;
  updatedAt: string;
}

export interface TranslationMark {
  id: string;
  documentId: string;
  translationId: string;
  anchor: TextAnchor;
  createdAt: string;
  updatedAt: string;
}

export interface AnnotationRecord {
  id: string;
  documentId: string;
  kind: "highlight" | "note";
  color: HighlightColor;
  title?: string;
  body?: string;
  url?: string;
  anchor: TextAnchor;
  createdAt: string;
  updatedAt: string;
}

export interface VocabularyEntry {
  id: string;
  documentId: string;
  translationId: string;
  originalText: string;
  translatedText: string;
  context: string;
  sourceTitle?: string;
  page: number;
  mastered: boolean;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PortableDocument {
  fingerprint: string;
  title: string;
  fileName: string;
  pageCount: number;
}

export interface ExportBundleV1 {
  schemaVersion: 1;
  appVersion: string;
  exportedAt: string;
  document: PortableDocument;
  translations: TranslationPayload[];
  translationMarks: TranslationMark[];
  annotations: AnnotationRecord[];
  vocabulary: VocabularyEntry[];
}

export interface ExportLibraryArchiveV1 {
  schemaVersion: 1;
  type: "modu-library";
  appVersion: string;
  exportedAt: string;
  bundles: ExportBundleV1[];
}

export interface PendingBundleRecord {
  id: string;
  fingerprint: string;
  title: string;
  importedAt: string;
  bundle: ExportBundleV1;
}

export interface ReaderSettings {
  targetLanguage: string;
  translationProvider: TranslationProvider;
  readerMode: ReaderMode;
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
}
