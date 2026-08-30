import { z } from "zod";

import type {
  AnnotationRecord,
  DocumentRecord,
  ExportBundleV1,
  ExportLibraryArchiveV1,
  TranslationMark,
  TranslationPayload,
  VocabularyEntry,
} from "@/lib/types";

const rectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

const anchorSchema = z.object({
  page: z.number().int().positive(),
  exact: z.string(),
  prefix: z.string(),
  suffix: z.string(),
  rotation: z.number(),
  rects: z.array(rectSchema),
});

const datedRecord = {
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
};

const bundleSchema = z.object({
  schemaVersion: z.literal(1),
  appVersion: z.string(),
  exportedAt: z.string(),
  document: z.object({
    fingerprint: z.string(),
    title: z.string(),
    fileName: z.string(),
    pageCount: z.number().int().positive(),
  }),
  translations: z.array(
    z.object({
      ...datedRecord,
      cacheKey: z.string(),
      originalText: z.string(),
      translatedText: z.string(),
      sourceLanguage: z.string(),
      targetLanguage: z.string(),
      model: z.string(),
    }),
  ),
  translationMarks: z.array(
    z.object({
      ...datedRecord,
      documentId: z.string(),
      translationId: z.string(),
      anchor: anchorSchema,
    }),
  ),
  annotations: z.array(
    z.object({
      ...datedRecord,
      documentId: z.string(),
      kind: z.enum(["highlight", "note"]),
      color: z.enum(["yellow", "green", "pink"]),
      title: z.string().optional(),
      body: z.string().optional(),
      url: z.string().optional(),
      anchor: anchorSchema,
    }),
  ),
  vocabulary: z.array(
    z.object({
      ...datedRecord,
      documentId: z.string(),
      translationId: z.string(),
      originalText: z.string(),
      translatedText: z.string(),
      context: z.string(),
      sourceTitle: z.string().optional(),
      page: z.number().int().positive(),
      mastered: z.boolean(),
      favorite: z.boolean(),
    }),
  ),
});

const archiveSchema = z.object({
  schemaVersion: z.literal(1),
  type: z.literal("modu-library"),
  appVersion: z.string(),
  exportedAt: z.string(),
  bundles: z.array(bundleSchema),
});

interface CreateBundleInput {
  document: DocumentRecord;
  translations: TranslationPayload[];
  translationMarks: TranslationMark[];
  annotations: AnnotationRecord[];
  vocabulary: VocabularyEntry[];
}

export function createExportBundle(input: CreateBundleInput): ExportBundleV1 {
  return {
    schemaVersion: 1,
    appVersion: "0.1.0",
    exportedAt: new Date().toISOString(),
    document: {
      fingerprint: input.document.fingerprint,
      title: input.document.title,
      fileName: input.document.fileName,
      pageCount: input.document.pageCount,
    },
    translations: input.translations,
    translationMarks: input.translationMarks,
    annotations: input.annotations,
    vocabulary: input.vocabulary,
  };
}

export function parseExportBundle(serialized: string): ExportBundleV1 {
  let raw: unknown;
  try {
    raw = JSON.parse(serialized);
  } catch {
    throw new Error("笔记包格式损坏");
  }

  if (
    typeof raw === "object" &&
    raw !== null &&
    "schemaVersion" in raw &&
    raw.schemaVersion !== 1
  ) {
    throw new Error("不支持的笔记包版本");
  }

  const result = bundleSchema.safeParse(raw);
  if (!result.success) throw new Error("笔记包格式损坏");
  return result.data;
}

export function createLibraryArchive(
  bundles: ExportBundleV1[],
): ExportLibraryArchiveV1 {
  return {
    schemaVersion: 1,
    type: "modu-library",
    appVersion: "0.1.0",
    exportedAt: new Date().toISOString(),
    bundles,
  };
}

export function parsePortableArchive(serialized: string): ExportBundleV1[] {
  let raw: unknown;
  try {
    raw = JSON.parse(serialized);
  } catch {
    throw new Error("笔记包格式损坏");
  }

  const archive = archiveSchema.safeParse(raw);
  if (archive.success) return archive.data.bundles;
  return [parseExportBundle(serialized)];
}

function findTranslation(
  bundle: ExportBundleV1,
  mark: TranslationMark,
): TranslationPayload | undefined {
  return bundle.translations.find((item) => item.id === mark.translationId);
}

export function exportBundleToMarkdown(bundle: ExportBundleV1): string {
  const sections = [`# ${bundle.document.title}`, ""];

  if (bundle.annotations.length > 0) {
    sections.push("# 注释", "");
    for (const note of bundle.annotations) {
      sections.push(
        `## 第 ${note.anchor.page} 页 · ${note.title || "高亮"}`,
        "",
        note.body || note.anchor.exact,
        "",
      );
    }
  }

  if (bundle.translationMarks.length > 0) {
    sections.push("# 翻译", "");
    for (const mark of bundle.translationMarks) {
      const translation = findTranslation(bundle, mark);
      if (!translation) continue;
      sections.push(
        `- 第 ${mark.anchor.page} 页：${translation.originalText} → ${translation.translatedText}`,
      );
    }
  }

  return sections.join("\n").trimEnd();
}

function csvCell(value: string | number | boolean): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function exportVocabularyToCsv(entries: VocabularyEntry[]): string {
  const rows = [
    ["原文", "译文", "上下文", "页码", "收藏", "已掌握"],
    ...entries.map((entry) => [
      entry.originalText,
      entry.translatedText,
      entry.context,
      entry.page,
      entry.favorite,
      entry.mastered,
    ]),
  ];

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}
