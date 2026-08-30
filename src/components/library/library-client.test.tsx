import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LibraryClient } from "@/components/library/library-client";
import { clearReaderDatabase, getReaderDatabase } from "@/lib/database";
import type {
  AnnotationRecord,
  DocumentRecord,
  TranslationMark,
  TranslationPayload,
  VocabularyEntry,
} from "@/lib/types";

const createdAt = "2026-08-28T10:00:00.000Z";
const documentRecord: DocumentRecord = {
  id: "doc-delete",
  fingerprint: "doc-delete",
  title: "Vocabulary source",
  fileName: "vocabulary-source.pdf",
  file: new Blob(["%PDF-1.7"]),
  pageCount: 12,
  createdAt,
  lastOpenedAt: createdAt,
  currentPage: 4,
  continuousPage: 4,
  bookPage: 3,
  continuousZoom: 1,
  bookZoom: 1,
  progress: 0.33,
  persisted: true,
};
const translation: TranslationPayload = {
  id: "translation-delete",
  cacheKey: "token::zh-CN",
  originalText: "token",
  translatedText: "词元",
  sourceLanguage: "en",
  targetLanguage: "zh-CN",
  model: "deepseek-v4-flash",
  createdAt,
  updatedAt: createdAt,
};
const anchor = {
  page: 4,
  exact: "token",
  prefix: "a ",
  suffix: " cache",
  rotation: 0,
  rects: [{ x: 0.1, y: 0.2, width: 0.1, height: 0.03 }],
};
const mark: TranslationMark = {
  id: "mark-delete",
  documentId: documentRecord.id,
  translationId: translation.id,
  anchor,
  createdAt,
  updatedAt: createdAt,
};
const annotation: AnnotationRecord = {
  id: "annotation-delete",
  documentId: documentRecord.id,
  kind: "note",
  color: "yellow",
  title: "A note",
  anchor,
  createdAt,
  updatedAt: createdAt,
};
const vocabulary: VocabularyEntry = {
  id: "vocabulary-keep",
  documentId: documentRecord.id,
  translationId: translation.id,
  originalText: "token",
  translatedText: "词元",
  context: "a token cache",
  page: 4,
  mastered: false,
  favorite: true,
  createdAt,
  updatedAt: createdAt,
};

describe("LibraryClient document management", () => {
  beforeEach(async () => {
    const database = getReaderDatabase();
    await clearReaderDatabase(database);
    await database.documents.put(documentRecord);
    await database.translations.put(translation);
    await database.translationMarks.put(mark);
    await database.annotations.put(annotation);
    await database.vocabulary.put(vocabulary);
  });

  afterEach(async () => {
    await clearReaderDatabase(getReaderDatabase());
  });

  it("removes the document records but retains its vocabulary for later review", async () => {
    const database = getReaderDatabase();
    render(<LibraryClient />);

    await screen.findByText("Vocabulary source");
    await userEvent.click(screen.getByRole("button", { name: "删除文献：Vocabulary source" }));
    await userEvent.click(screen.getByRole("button", { name: "永久删除" }));

    await waitFor(async () => {
      expect(await database.documents.get(documentRecord.id)).toBeUndefined();
    });
    await expect(database.translationMarks.where("documentId").equals(documentRecord.id).count()).resolves.toBe(0);
    await expect(database.annotations.where("documentId").equals(documentRecord.id).count()).resolves.toBe(0);
    await expect(database.vocabulary.get(vocabulary.id)).resolves.toMatchObject({
      originalText: "token",
      translatedText: "词元",
      sourceTitle: "Vocabulary source",
    });
    await expect(database.translations.get(translation.id)).resolves.toBeDefined();
  });

  it("creates, renames, uses, and deletes a course folder without deleting its document", async () => {
    const database = getReaderDatabase();
    render(<LibraryClient />);

    await screen.findByText("Vocabulary source");
    await userEvent.click(screen.getByRole("button", { name: "新建文件夹" }));
    await userEvent.type(screen.getByLabelText("文件夹名称"), "Robotics");
    await userEvent.click(screen.getByRole("button", { name: "创建" }));

    const roboticsButton = await screen.findByRole("button", { name: "Robotics 0" });
    await userEvent.click(screen.getByRole("button", { name: "移动文献：Vocabulary source" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Robotics" }));

    await waitFor(async () => {
      expect(await database.documents.get(documentRecord.id)).toMatchObject({
        folderId: expect.any(String),
      });
    });
    expect(await screen.findByRole("button", { name: "Robotics 1" })).toBeInTheDocument();
    expect(roboticsButton).toHaveAccessibleName("Robotics 1");

    await userEvent.click(screen.getByRole("button", { name: "管理文件夹：Robotics" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "重命名" }));
    const nameInput = screen.getByLabelText("文件夹名称");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Robotics I");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByRole("button", { name: "Robotics I 1" });

    await userEvent.click(screen.getByRole("button", { name: "管理文件夹：Robotics I" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "删除文件夹" }));
    expect(screen.getByRole("dialog", { name: "删除文件夹" })).toHaveTextContent("1 份文献将移至未分类");
    await userEvent.click(screen.getByRole("button", { name: "确认删除文件夹" }));

    await waitFor(async () => {
      expect(await database.folders.count()).toBe(0);
    });
    await expect(database.documents.get(documentRecord.id)).resolves.toMatchObject({
      id: documentRecord.id,
      title: documentRecord.title,
    });
    expect((await database.documents.get(documentRecord.id))?.folderId).toBeUndefined();
  });
});
