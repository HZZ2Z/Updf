import {
  applyBundleToDatabase,
  getReaderDatabase,
  type ReaderDatabase,
} from "@/lib/database";
import {
  getEphemeralDocument,
  inspectPdfFile,
  rememberEphemeralDocument,
  updateEphemeralDocument,
  type PdfInspection,
} from "@/lib/pdf-engine";
import {
  createDocumentRecord,
  fingerprintFile,
  validatePdfFile,
} from "@/lib/pdf-import";

export interface PdfLibraryImportOptions {
  database?: ReaderDatabase;
  inspect?: (file: File) => Promise<PdfInspection>;
  requestPersistence?: () => Promise<boolean>;
}

export interface PdfLibraryImportResult {
  documentId: string;
  title: string;
  outcome: "created" | "existing";
  storage: "persistent" | "session";
  attachedPendingBundle: boolean;
}

export async function importPdfIntoLibrary(
  file: File,
  options: PdfLibraryImportOptions = {},
): Promise<PdfLibraryImportResult> {
  const database = options.database ?? getReaderDatabase();
  await validatePdfFile(file);
  const fingerprint = await fingerprintFile(file);
  const existing = await database.documents.get(fingerprint)
    ?? getEphemeralDocument(fingerprint);
  if (existing) {
    const lastOpenedAt = new Date().toISOString();
    if (existing.persisted) {
      await database.documents.update(existing.id, { lastOpenedAt });
    } else {
      updateEphemeralDocument(existing.id, { lastOpenedAt });
    }
    return {
      documentId: existing.id,
      title: existing.title,
      outcome: "existing",
      storage: existing.persisted ? "persistent" : "session",
      attachedPendingBundle: false,
    };
  }
  const inspection = await (options.inspect ?? inspectPdfFile)(file);
  const record = await createDocumentRecord(
    file,
    { ...inspection, persisted: true },
    fingerprint,
  );

  await options.requestPersistence?.();
  let storage: PdfLibraryImportResult["storage"] = "persistent";
  try {
    await database.documents.put(record);
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== "QuotaExceededError") {
      throw error;
    }
    record.persisted = false;
    rememberEphemeralDocument(record);
    storage = "session";
  }

  const waitingBundle = storage === "persistent"
    ? await database.pendingBundles.get(fingerprint)
    : undefined;
  if (waitingBundle) {
    await applyBundleToDatabase(database, waitingBundle.bundle);
  }

  return {
    documentId: record.id,
    title: record.title,
    outcome: "created",
    storage,
    attachedPendingBundle: Boolean(waitingBundle),
  };
}
