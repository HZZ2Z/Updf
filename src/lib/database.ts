import Dexie, { type EntityTable } from "dexie";

import { mergeByUpdatedAt } from "@/lib/reader-core";
import type {
  AnnotationRecord,
  DocumentRecord,
  ExportBundleV1,
  LibraryFolder,
  PendingBundleRecord,
  TranslationMark,
  TranslationPayload,
  VocabularyEntry,
} from "@/lib/types";

export class ReaderDatabase extends Dexie {
  documents!: EntityTable<DocumentRecord, "id">;
  folders!: EntityTable<LibraryFolder, "id">;
  translations!: EntityTable<TranslationPayload, "id">;
  translationMarks!: EntityTable<TranslationMark, "id">;
  annotations!: EntityTable<AnnotationRecord, "id">;
  vocabulary!: EntityTable<VocabularyEntry, "id">;
  pendingBundles!: EntityTable<PendingBundleRecord, "id">;

  constructor(name = "modu-reader") {
    super(name);
    const stores = {
      documents: "&id,&fingerprint,lastOpenedAt,title",
      translations: "&id,&cacheKey,updatedAt",
      translationMarks: "&id,documentId,translationId,updatedAt",
      annotations: "&id,documentId,kind,updatedAt",
      vocabulary: "&id,documentId,translationId,mastered,favorite,updatedAt",
      pendingBundles: "&id,&fingerprint,importedAt",
    };
    this.version(1).stores(stores);
    this.version(2).stores(stores).upgrade((transaction) =>
      transaction.table<DocumentRecord>("documents").toCollection().modify((document) => {
        document.continuousPage ??= document.currentPage || 1;
        document.bookPage ??= document.currentPage || 1;
      }),
    );
    this.version(3).stores({
      ...stores,
      documents: "&id,&fingerprint,lastOpenedAt,title,folderId",
      folders: "&id,&normalizedName,updatedAt",
    });
  }
}

let singleton: ReaderDatabase | undefined;

export function getReaderDatabase(): ReaderDatabase {
  singleton ??= new ReaderDatabase();
  return singleton;
}

export async function clearReaderDatabase(database: ReaderDatabase): Promise<void> {
  await database.transaction("rw", database.tables, async () => {
    await Promise.all(database.tables.map((table) => table.clear()));
  });
}

function cleanFolderName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

export function normalizeFolderName(value: string) {
  return cleanFolderName(value).toLocaleLowerCase();
}

function validateFolderName(value: string) {
  const name = cleanFolderName(value);
  if (!name) throw new Error("文件夹名不能为空");
  if (Array.from(name).length > 60) throw new Error("文件夹名最多 60 个字符");
  return { name, normalizedName: normalizeFolderName(name) };
}

async function ensureUniqueFolderName(
  database: ReaderDatabase,
  normalizedName: string,
  ignoredFolderId?: string,
) {
  const duplicate = await database.folders
    .where("normalizedName")
    .equals(normalizedName)
    .first();
  if (duplicate && duplicate.id !== ignoredFolderId) throw new Error("文件夹已存在");
}

export async function createLibraryFolder(
  database: ReaderDatabase,
  value: string,
): Promise<LibraryFolder> {
  const { name, normalizedName } = validateFolderName(value);
  await ensureUniqueFolderName(database, normalizedName);
  const now = new Date().toISOString();
  const folder: LibraryFolder = {
    id: crypto.randomUUID(),
    name,
    normalizedName,
    createdAt: now,
    updatedAt: now,
    sortOrder: Date.now(),
  };
  try {
    await database.folders.add(folder);
  } catch (error) {
    if (error instanceof Error && error.name === "ConstraintError") {
      throw new Error("文件夹已存在");
    }
    throw error;
  }
  return folder;
}

export async function reorderLibraryDocuments(
  database: ReaderDatabase,
  orderedIds: string[],
): Promise<void> {
  await database.transaction("rw", database.documents, async () => {
    await Promise.all(orderedIds.map((id, index) =>
      database.documents.update(id, { sortOrder: (index + 1) * 1_000 })));
  });
}

export async function reorderLibraryFolders(
  database: ReaderDatabase,
  orderedIds: string[],
): Promise<void> {
  await database.transaction("rw", database.folders, async () => {
    await Promise.all(orderedIds.map((id, index) =>
      database.folders.update(id, { sortOrder: (index + 1) * 1_000 })));
  });
}

export async function renameLibraryFolder(
  database: ReaderDatabase,
  folderId: string,
  value: string,
): Promise<LibraryFolder> {
  const folder = await database.folders.get(folderId);
  if (!folder) throw new Error("文件夹不存在");
  const { name, normalizedName } = validateFolderName(value);
  await ensureUniqueFolderName(database, normalizedName, folderId);
  const updated: LibraryFolder = {
    ...folder,
    name,
    normalizedName,
    updatedAt: new Date().toISOString(),
  };
  try {
    await database.folders.put(updated);
  } catch (error) {
    if (error instanceof Error && error.name === "ConstraintError") {
      throw new Error("文件夹已存在");
    }
    throw error;
  }
  return updated;
}

export async function moveDocumentToFolder(
  database: ReaderDatabase,
  documentId: string,
  folderId?: string,
): Promise<boolean> {
  return database.transaction("rw", [database.folders, database.documents], async () => {
    if (folderId && !await database.folders.get(folderId)) {
      throw new Error("文件夹不存在");
    }
    const document = await database.documents.get(documentId);
    if (!document) return false;
    if (folderId) {
      await database.documents.update(documentId, { folderId });
    } else {
      await database.documents.where("id").equals(documentId).modify((record) => {
        delete record.folderId;
      });
    }
    return true;
  });
}

export async function deleteLibraryFolder(
  database: ReaderDatabase,
  folderId: string,
): Promise<{ documentsUnfiled: number }> {
  return database.transaction("rw", [database.folders, database.documents], async () => {
    const folder = await database.folders.get(folderId);
    if (!folder) throw new Error("文件夹不存在");
    const documents = database.documents.where("folderId").equals(folderId);
    const documentsUnfiled = await documents.count();
    await documents.modify((document) => {
      delete document.folderId;
    });
    await database.folders.delete(folderId);
    return { documentsUnfiled };
  });
}

export interface DeleteDocumentResult {
  documentFound: boolean;
  vocabularyRetained: number;
}

export async function deleteDocumentFromDatabase(
  database: ReaderDatabase,
  documentId: string,
  fallbackDocument?: Pick<DocumentRecord, "fingerprint" | "title">,
): Promise<DeleteDocumentResult> {
  return database.transaction(
    "rw",
    [
      database.documents,
      database.translations,
      database.translationMarks,
      database.annotations,
      database.vocabulary,
      database.pendingBundles,
    ],
    async () => {
      const storedDocument = await database.documents.get(documentId);
      const document = storedDocument ?? fallbackDocument;
      const [translationMarks, vocabulary] = await Promise.all([
        database.translationMarks.where("documentId").equals(documentId).toArray(),
        database.vocabulary.where("documentId").equals(documentId).toArray(),
      ]);
      const translationIds = new Set(translationMarks.map((mark) => mark.translationId));

      if (document && vocabulary.length > 0) {
        await Promise.all(vocabulary.map((entry) =>
          database.vocabulary.update(entry.id, {
            sourceTitle: entry.sourceTitle || document.title,
          }),
        ));
      }

      await Promise.all([
        database.documents.delete(documentId),
        database.translationMarks.where("documentId").equals(documentId).delete(),
        database.annotations.where("documentId").equals(documentId).delete(),
        document
          ? database.pendingBundles.delete(document.fingerprint)
          : Promise.resolve(),
      ]);

      for (const translationId of translationIds) {
        const [markReferences, vocabularyReferences] = await Promise.all([
          database.translationMarks.where("translationId").equals(translationId).count(),
          database.vocabulary.where("translationId").equals(translationId).count(),
        ]);
        if (markReferences === 0 && vocabularyReferences === 0) {
          await database.translations.delete(translationId);
        }
      }

      return {
        documentFound: Boolean(document),
        vocabularyRetained: vocabulary.length,
      };
    },
  );
}

async function mergeRecords<
  T extends { id: string; updatedAt: string },
>(table: { get: (id: string) => Promise<T | undefined>; bulkPut: (records: T[]) => Promise<unknown> }, incoming: T[]) {
  if (incoming.length === 0) return;
  const results = await Promise.all(incoming.map((record) => table.get(record.id)));
  const existing = results.filter((record) => record !== undefined) as T[];
  await table.bulkPut(mergeByUpdatedAt<T>(existing, incoming));
}

export async function applyBundleToDatabase(
  database: ReaderDatabase,
  bundle: ExportBundleV1,
): Promise<"attached" | "pending"> {
  const document = await database.documents
    .where("fingerprint")
    .equals(bundle.document.fingerprint)
    .first();

  if (!document) {
    await database.pendingBundles.put({
      id: bundle.document.fingerprint,
      fingerprint: bundle.document.fingerprint,
      title: bundle.document.title,
      importedAt: new Date().toISOString(),
      bundle,
    });
    return "pending";
  }

  await database.transaction(
    "rw",
    [
      database.translations,
      database.translationMarks,
      database.annotations,
      database.vocabulary,
      database.pendingBundles,
    ],
    async () => {
      await mergeRecords(
        database.translations as unknown as Parameters<typeof mergeRecords<TranslationPayload>>[0],
        bundle.translations,
      );
      await mergeRecords(
        database.translationMarks as unknown as Parameters<typeof mergeRecords<TranslationMark>>[0],
        bundle.translationMarks,
      );
      await mergeRecords(
        database.annotations as unknown as Parameters<typeof mergeRecords<AnnotationRecord>>[0],
        bundle.annotations,
      );
      await mergeRecords(
        database.vocabulary as unknown as Parameters<typeof mergeRecords<VocabularyEntry>>[0],
        bundle.vocabulary,
      );
      await database.pendingBundles.delete(bundle.document.fingerprint);
    },
  );

  return "attached";
}
