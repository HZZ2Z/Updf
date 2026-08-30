import { afterEach, describe, expect, it, vi } from "vitest";

import { ReaderDatabase } from "@/lib/database";
import { forgetEphemeralDocument, getEphemeralDocument } from "@/lib/pdf-engine";
import { fingerprintFile } from "@/lib/pdf-import";

describe("importPdfIntoLibrary", () => {
  const databases: ReaderDatabase[] = [];

  afterEach(async () => {
    await Promise.all(databases.splice(0).map((database) => database.delete()));
  });

  it("returns the new document id after persisting an inspected PDF", async () => {
    const { importPdfIntoLibrary } = await import("./pdf-library-import");
    const database = new ReaderDatabase(`import-${crypto.randomUUID()}`);
    databases.push(database);
    const file = new File(["%PDF-1.7\nbody"], "paper.pdf", {
      type: "application/pdf",
    });
    const inspect = vi.fn().mockResolvedValue({
      title: "Paper",
      pageCount: 3,
      hasTextLayer: true,
    });

    const result = await importPdfIntoLibrary(file, {
      database,
      inspect,
      requestPersistence: vi.fn().mockResolvedValue(true),
    });

    expect(result).toMatchObject({
      title: "Paper",
      outcome: "created",
      storage: "persistent",
      attachedPendingBundle: false,
    });
    await expect(database.documents.get(result.documentId)).resolves.toMatchObject({
      title: "Paper",
      persisted: true,
    });
  });

  it("opens an existing fingerprint without replacing reading state", async () => {
    const { importPdfIntoLibrary } = await import("./pdf-library-import");
    const database = new ReaderDatabase(`duplicate-${crypto.randomUUID()}`);
    databases.push(database);
    const file = new File(["%PDF-1.7\nsame"], "paper.pdf", {
      type: "application/pdf",
    });
    const first = await importPdfIntoLibrary(file, {
      database,
      inspect: async () => ({ pageCount: 3, hasTextLayer: true }),
    });
    await database.documents.update(first.documentId, {
      currentPage: 3,
      continuousPage: 3,
      progress: 0.8,
    });
    const inspect = vi.fn();

    const second = await importPdfIntoLibrary(file, { database, inspect });

    expect(second).toMatchObject({
      documentId: first.documentId,
      outcome: "existing",
      storage: "persistent",
    });
    expect(inspect).not.toHaveBeenCalled();
    await expect(database.documents.get(first.documentId)).resolves.toMatchObject({
      currentPage: 3,
      continuousPage: 3,
      progress: 0.8,
    });
  });

  it("attaches a waiting notes bundle after the matching PDF is persisted", async () => {
    const { importPdfIntoLibrary } = await import("./pdf-library-import");
    const database = new ReaderDatabase(`pending-${crypto.randomUUID()}`);
    databases.push(database);
    const file = new File(["%PDF-1.7\nwaiting"], "waiting.pdf", {
      type: "application/pdf",
    });
    const fingerprint = await fingerprintFile(file);
    await database.pendingBundles.put({
      id: fingerprint,
      fingerprint,
      title: "Waiting",
      importedAt: "2026-08-30T00:00:00.000Z",
      bundle: {
        schemaVersion: 1,
        appVersion: "1.0.0",
        exportedAt: "2026-08-30T00:00:00.000Z",
        document: {
          fingerprint,
          title: "Waiting",
          fileName: "waiting.pdf",
          pageCount: 1,
        },
        translations: [],
        translationMarks: [],
        annotations: [],
        vocabulary: [],
      },
    });

    const result = await importPdfIntoLibrary(file, {
      database,
      inspect: async () => ({ pageCount: 1, hasTextLayer: true }),
    });

    expect(result.attachedPendingBundle).toBe(true);
    await expect(database.pendingBundles.get(fingerprint)).resolves.toBeUndefined();
  });

  it("falls back to a session document when IndexedDB quota is exhausted", async () => {
    const { importPdfIntoLibrary } = await import("./pdf-library-import");
    const database = new ReaderDatabase(`quota-${crypto.randomUUID()}`);
    databases.push(database);
    const file = new File(["%PDF-1.7\nlarge"], "large.pdf", {
      type: "application/pdf",
    });
    const fingerprint = await fingerprintFile(file);
    vi.spyOn(database.documents, "put").mockRejectedValueOnce(
      new DOMException("quota full", "QuotaExceededError"),
    );

    try {
      const result = await importPdfIntoLibrary(file, {
        database,
        inspect: async () => ({ pageCount: 200, hasTextLayer: true }),
      });

      expect(result).toMatchObject({
        documentId: fingerprint,
        outcome: "created",
        storage: "session",
      });
      expect(getEphemeralDocument(fingerprint)).toMatchObject({
        fileName: "large.pdf",
        persisted: false,
      });
    } finally {
      forgetEphemeralDocument(fingerprint);
    }
  });

  it("reuses a session-only document without inspecting it again", async () => {
    const { importPdfIntoLibrary } = await import("./pdf-library-import");
    const database = new ReaderDatabase(`session-duplicate-${crypto.randomUUID()}`);
    databases.push(database);
    const file = new File(["%PDF-1.7\nsession"], "session.pdf", {
      type: "application/pdf",
    });
    const fingerprint = await fingerprintFile(file);
    vi.spyOn(database.documents, "put").mockRejectedValueOnce(
      new DOMException("quota full", "QuotaExceededError"),
    );
    await importPdfIntoLibrary(file, {
      database,
      inspect: async () => ({ pageCount: 10, hasTextLayer: true }),
    });
    const inspectAgain = vi.fn();

    try {
      const duplicate = await importPdfIntoLibrary(file, {
        database,
        inspect: inspectAgain,
      });

      expect(duplicate).toMatchObject({
        documentId: fingerprint,
        outcome: "existing",
        storage: "session",
      });
      expect(inspectAgain).not.toHaveBeenCalled();
    } finally {
      forgetEphemeralDocument(fingerprint);
    }
  });
});
