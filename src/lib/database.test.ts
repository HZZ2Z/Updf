import { afterEach, describe, expect, it } from "vitest";
import Dexie from "dexie";

import {
  applyBundleToDatabase,
  clearReaderDatabase,
  createLibraryFolder,
  deleteLibraryFolder,
  moveDocumentToFolder,
  ReaderDatabase,
  reorderLibraryDocuments,
  reorderLibraryFolders,
  renameLibraryFolder,
} from "@/lib/database";
import { createExportBundle } from "@/lib/portable-data";
import type {
  AnnotationRecord,
  DocumentRecord,
  TranslationMark,
  TranslationPayload,
  VocabularyEntry,
} from "@/lib/types";

const databases: ReaderDatabase[] = [];

function createDatabase() {
  const database = new ReaderDatabase(`modu-test-${crypto.randomUUID()}`);
  databases.push(database);
  return database;
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

const documentRecord: DocumentRecord = {
  id: "doc-sha",
  fingerprint: "doc-sha",
  title: "Paper",
  fileName: "paper.pdf",
  file: new Blob(["%PDF"]),
  pageCount: 10,
  createdAt: "2026-08-25T10:00:00.000Z",
  lastOpenedAt: "2026-08-25T10:00:00.000Z",
  currentPage: 1,
  continuousPage: 1,
  bookPage: 1,
  continuousZoom: 1,
  bookZoom: 1,
  progress: 0,
  persisted: true,
};

const translation: TranslationPayload = {
  id: "translation-1",
  cacheKey: "cache-key",
  originalText: "model",
  translatedText: "模型",
  sourceLanguage: "en",
  targetLanguage: "zh-CN",
  model: "deepseek-v4-flash",
  createdAt: "2026-08-25T10:00:00.000Z",
  updatedAt: "2026-08-25T10:00:00.000Z",
};

describe("reader database", () => {
  it("clears every local reader table as one library cleanup", async () => {
    const database = createDatabase();
    await database.documents.put(documentRecord);
    await database.translations.put(translation);

    await clearReaderDatabase(database);

    await expect(database.documents.count()).resolves.toBe(0);
    await expect(database.translations.count()).resolves.toBe(0);
    await expect(database.annotations.count()).resolves.toBe(0);
    await expect(database.pendingBundles.count()).resolves.toBe(0);
  });

  it("migrates legacy shared progress into separate mode pages", async () => {
    const name = `modu-migration-${crypto.randomUUID()}`;
    const legacy = new Dexie(name);
    legacy.version(1).stores({
      documents: "&id,&fingerprint,lastOpenedAt,title",
      translations: "&id,&cacheKey,updatedAt",
      translationMarks: "&id,documentId,translationId,updatedAt",
      annotations: "&id,documentId,kind,updatedAt",
      vocabulary: "&id,documentId,translationId,mastered,favorite,updatedAt",
      pendingBundles: "&id,&fingerprint,importedAt",
    });
    const {
      continuousPage: _continuousPage,
      bookPage: _bookPage,
      ...legacyDocument
    } = documentRecord;
    await legacy.table("documents").put({ ...legacyDocument, currentPage: 7 });
    legacy.close();

    const database = new ReaderDatabase(name);
    databases.push(database);
    await expect(database.documents.get("doc-sha")).resolves.toMatchObject({
      currentPage: 7,
      continuousPage: 7,
      bookPage: 7,
    });
  });

  it("opens version 2 documents as unfiled without rewriting their PDF", async () => {
    const name = `modu-folder-migration-${crypto.randomUUID()}`;
    const legacy = new Dexie(name);
    legacy.version(2).stores({
      documents: "&id,&fingerprint,lastOpenedAt,title",
      translations: "&id,&cacheKey,updatedAt",
      translationMarks: "&id,documentId,translationId,updatedAt",
      annotations: "&id,documentId,kind,updatedAt",
      vocabulary: "&id,documentId,translationId,mastered,favorite,updatedAt",
      pendingBundles: "&id,&fingerprint,importedAt",
    });
    const pdfBytes = new Uint8Array([37, 80, 68, 70]);
    await legacy.table("documents").put({ ...documentRecord, file: pdfBytes });
    legacy.close();

    const database = new ReaderDatabase(name);
    databases.push(database);
    const migrated = await database.documents.get(documentRecord.id);

    expect(migrated?.folderId).toBeUndefined();
    expect(Array.from(migrated?.file as unknown as Uint8Array)).toEqual([37, 80, 68, 70]);
    await expect(database.folders.count()).resolves.toBe(0);
  });

  it("persists explicit document and folder positions", async () => {
    const database = createDatabase();
    await database.documents.bulkPut([
      { ...documentRecord, id: "one", fingerprint: "one" },
      { ...documentRecord, id: "two", fingerprint: "two" },
      { ...documentRecord, id: "three", fingerprint: "three" },
    ]);
    const firstFolder = await createLibraryFolder(database, "First");
    const secondFolder = await createLibraryFolder(database, "Second");

    await reorderLibraryDocuments(database, ["three", "one", "two"]);
    await reorderLibraryFolders(database, [secondFolder.id, firstFolder.id]);

    await expect(database.documents.get("three")).resolves.toMatchObject({ sortOrder: 1_000 });
    await expect(database.documents.get("one")).resolves.toMatchObject({ sortOrder: 2_000 });
    await expect(database.folders.get(secondFolder.id)).resolves.toMatchObject({ sortOrder: 1_000 });
  });

  it("normalizes folder names and rejects invalid or duplicate variants", async () => {
    const database = createDatabase();

    const folder = await createLibraryFolder(database, "  Robot   Control  ");

    expect(folder).toMatchObject({
      name: "Robot Control",
      normalizedName: "robot control",
    });
    await expect(createLibraryFolder(database, "robot control"))
      .rejects.toThrow("文件夹已存在");
    await expect(createLibraryFolder(database, "   "))
      .rejects.toThrow("文件夹名不能为空");
    await expect(createLibraryFolder(database, "a".repeat(61)))
      .rejects.toThrow("文件夹名最多 60 个字符");
  });

  it("renames folders through the same uniqueness rules", async () => {
    const database = createDatabase();
    const robotics = await createLibraryFolder(database, "Robotics");
    await createLibraryFolder(database, "Linear Algebra");

    await expect(renameLibraryFolder(database, robotics.id, "  Robot   Systems "))
      .resolves.toMatchObject({ name: "Robot Systems", normalizedName: "robot systems" });
    await expect(renameLibraryFolder(database, robotics.id, "linear algebra"))
      .rejects.toThrow("文件夹已存在");
  });

  it("moves a document only to an existing folder or unfiled", async () => {
    const database = createDatabase();
    const folder = await createLibraryFolder(database, "Robotics");
    await database.documents.put(documentRecord);

    await expect(moveDocumentToFolder(database, documentRecord.id, folder.id)).resolves.toBe(true);
    await expect(database.documents.get(documentRecord.id)).resolves.toMatchObject({ folderId: folder.id });
    await expect(moveDocumentToFolder(database, documentRecord.id, "missing-folder"))
      .rejects.toThrow("文件夹不存在");
    await expect(database.documents.get(documentRecord.id)).resolves.toMatchObject({ folderId: folder.id });
    await expect(moveDocumentToFolder(database, documentRecord.id)).resolves.toBe(true);
    expect((await database.documents.get(documentRecord.id))?.folderId).toBeUndefined();
    await expect(moveDocumentToFolder(database, "missing-document", folder.id)).resolves.toBe(false);
  });

  it("deletes a folder without deleting its documents or study records", async () => {
    const database = createDatabase();
    const folder = await createLibraryFolder(database, "Robotics");
    const now = "2026-08-28T10:00:00.000Z";
    const mark: TranslationMark = {
      id: "folder-mark",
      documentId: documentRecord.id,
      translationId: translation.id,
      anchor: { page: 1, exact: "model", prefix: "", suffix: "", rotation: 0, rects: [] },
      createdAt: now,
      updatedAt: now,
    };
    const note: AnnotationRecord = {
      id: "folder-note",
      documentId: documentRecord.id,
      kind: "note",
      color: "yellow",
      title: "Keep me",
      anchor: mark.anchor,
      createdAt: now,
      updatedAt: now,
    };
    const word: VocabularyEntry = {
      id: "folder-word",
      documentId: documentRecord.id,
      translationId: translation.id,
      originalText: "model",
      translatedText: "模型",
      context: "model",
      page: 1,
      mastered: false,
      favorite: false,
      createdAt: now,
      updatedAt: now,
    };
    await database.documents.put({ ...documentRecord, folderId: folder.id });
    await database.translations.put(translation);
    await database.translationMarks.put(mark);
    await database.annotations.put(note);
    await database.vocabulary.put(word);

    await expect(deleteLibraryFolder(database, folder.id)).resolves.toEqual({ documentsUnfiled: 1 });

    expect((await database.documents.get(documentRecord.id))?.folderId).toBeUndefined();
    await expect(database.translations.get(translation.id)).resolves.toEqual(translation);
    await expect(database.translationMarks.get(mark.id)).resolves.toEqual(mark);
    await expect(database.annotations.get(note.id)).resolves.toEqual(note);
    await expect(database.vocabulary.get(word.id)).resolves.toEqual(word);
  });

  it("persists documents and finds cached translations by cache key", async () => {
    const database = createDatabase();
    await database.documents.put(documentRecord);
    await database.translations.put(translation);

    await expect(database.documents.get("doc-sha")).resolves.toMatchObject({
      title: "Paper",
      pageCount: 10,
    });
    await expect(
      database.translations.where("cacheKey").equals("cache-key").first(),
    ).resolves.toMatchObject({ translatedText: "模型" });
  });

  it("keeps an unmatched import pending until its PDF exists", async () => {
    const database = createDatabase();
    const bundle = createExportBundle({
      document: documentRecord,
      translations: [translation],
      translationMarks: [],
      annotations: [],
      vocabulary: [],
    });

    await expect(applyBundleToDatabase(database, bundle)).resolves.toBe("pending");
    await expect(database.pendingBundles.get("doc-sha")).resolves.toMatchObject({
      fingerprint: "doc-sha",
      title: "Paper",
    });
  });

  it("merges matching annotations and keeps the newest edit", async () => {
    const database = createDatabase();
    await database.documents.put(documentRecord);
    const localNote: AnnotationRecord = {
      id: "note-1",
      documentId: "doc-sha",
      kind: "note",
      color: "yellow",
      title: "local",
      body: "newer local edit",
      anchor: { page: 2, exact: "text", prefix: "", suffix: "", rotation: 0, rects: [] },
      createdAt: "2026-08-25T10:00:00.000Z",
      updatedAt: "2026-08-27T10:00:00.000Z",
    };
    await database.annotations.put(localNote);
    const bundle = createExportBundle({
      document: documentRecord,
      translations: [],
      translationMarks: [],
      annotations: [{ ...localNote, title: "incoming", updatedAt: "2026-08-26T10:00:00.000Z" }],
      vocabulary: [],
    });

    await expect(applyBundleToDatabase(database, bundle)).resolves.toBe("attached");
    await expect(database.annotations.get("note-1")).resolves.toMatchObject({
      title: "local",
      body: "newer local edit",
    });
  });
});
