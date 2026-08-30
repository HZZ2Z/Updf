import { describe, expect, it } from "vitest";

import {
  createLibraryArchive,
  createExportBundle,
  exportBundleToMarkdown,
  exportVocabularyToCsv,
  parseExportBundle,
  parsePortableArchive,
} from "@/lib/portable-data";
import type {
  AnnotationRecord,
  DocumentRecord,
  TranslationMark,
  TranslationPayload,
  VocabularyEntry,
} from "@/lib/types";

const documentRecord: DocumentRecord = {
  id: "doc-sha",
  fingerprint: "doc-sha",
  title: "Interpretable Systems",
  fileName: "paper.pdf",
  file: new Blob(["%PDF"]),
  pageCount: 28,
  createdAt: "2026-08-25T10:00:00.000Z",
  lastOpenedAt: "2026-08-26T10:00:00.000Z",
  currentPage: 12,
  continuousPage: 12,
  bookPage: 12,
  continuousZoom: 1.1,
  bookZoom: 1,
  progress: 0.43,
  persisted: true,
};

const translation: TranslationPayload = {
  id: "translation-1",
  cacheKey: "cache-1",
  originalText: "state of the art",
  translatedText: "最先进的",
  sourceLanguage: "en",
  targetLanguage: "zh-CN",
  model: "deepseek-v4-flash",
  createdAt: "2026-08-26T10:00:00.000Z",
  updatedAt: "2026-08-26T10:00:00.000Z",
};

const anchor = {
  page: 12,
  exact: "state of the art",
  prefix: "achieves ",
  suffix: " fidelity",
  rotation: 0,
  rects: [{ x: 0.2, y: 0.3, width: 0.25, height: 0.025 }],
};

const mark: TranslationMark = {
  id: "mark-1",
  documentId: "doc-sha",
  translationId: "translation-1",
  anchor,
  createdAt: "2026-08-26T10:00:00.000Z",
  updatedAt: "2026-08-26T10:00:00.000Z",
};

const annotation: AnnotationRecord = {
  id: "note-1",
  documentId: "doc-sha",
  kind: "note",
  color: "yellow",
  title: "核心结论",
  body: "方法优于基线。",
  anchor,
  createdAt: "2026-08-26T10:00:00.000Z",
  updatedAt: "2026-08-26T10:00:00.000Z",
};

const vocabulary: VocabularyEntry = {
  id: "vocab-1",
  documentId: "doc-sha",
  translationId: "translation-1",
  originalText: "state of the art",
  translatedText: "最先进的",
  context: "achieves state of the art fidelity",
  page: 12,
  mastered: false,
  favorite: true,
  createdAt: "2026-08-26T10:00:00.000Z",
  updatedAt: "2026-08-26T10:00:00.000Z",
};

describe("portable note bundles", () => {
  it("exports portable reading data without the PDF blob", () => {
    const bundle = createExportBundle({
      document: documentRecord,
      translations: [translation],
      translationMarks: [mark],
      annotations: [annotation],
      vocabulary: [vocabulary],
    });

    expect(bundle.schemaVersion).toBe(1);
    expect(bundle.document).toEqual({
      fingerprint: "doc-sha",
      title: "Interpretable Systems",
      fileName: "paper.pdf",
      pageCount: 28,
    });
    expect(JSON.stringify(bundle)).not.toContain("%PDF");
  });

  it("rejects unsupported bundle versions", () => {
    expect(() =>
      parseExportBundle(JSON.stringify({ schemaVersion: 2 })),
    ).toThrow("不支持的笔记包版本");
  });

  it("packs and restores a full library as multiple portable bundles", () => {
    const bundle = createExportBundle({
      document: documentRecord,
      translations: [translation],
      translationMarks: [mark],
      annotations: [annotation],
      vocabulary: [vocabulary],
    });
    const archive = createLibraryArchive([bundle]);

    expect(archive.type).toBe("modu-library");
    expect(parsePortableArchive(JSON.stringify(archive))).toEqual([bundle]);
    expect(parsePortableArchive(JSON.stringify(bundle))).toEqual([bundle]);
  });

  it("creates readable Markdown and escaped CSV exports", () => {
    const bundle = createExportBundle({
      document: documentRecord,
      translations: [translation],
      translationMarks: [mark],
      annotations: [annotation],
      vocabulary: [{ ...vocabulary, context: 'A "quoted", context' }],
    });

    expect(exportBundleToMarkdown(bundle)).toContain("## 第 12 页 · 核心结论");
    expect(exportBundleToMarkdown(bundle)).toContain("state of the art → 最先进的");
    expect(exportVocabularyToCsv(bundle.vocabulary)).toContain(
      '"A ""quoted"", context"',
    );
  });
});
