"use client";

import { useCallback, useEffect, useState } from "react";

import {
  LibraryScreen,
  type LibraryDocumentView,
  type LibraryFolderView,
  type PendingBundleView,
} from "@/components/library/library-screen";
import {
  applyBundleToDatabase,
  createLibraryFolder,
  deleteLibraryFolder,
  deleteDocumentFromDatabase,
  getReaderDatabase,
  moveDocumentToFolder,
  renameLibraryFolder,
} from "@/lib/database";
import {
  forgetEphemeralDocument,
  getEphemeralDocument,
  listEphemeralDocuments,
  updateEphemeralDocument,
} from "@/lib/pdf-engine";
import { importPdfIntoLibrary } from "@/lib/pdf-library-import";
import { createExportBundle, parsePortableArchive } from "@/lib/portable-data";
import type { DocumentRecord, TranslationPayload } from "@/lib/types";

const DESKTOP_DEFAULT_PROMPT_KEY = "modu-desktop-default-prompt-dismissed-v1";

function safeFileName(title: string) {
  return title.replace(/[\\/:*?"<>|]/g, "-").slice(0, 80) || "modu-notes";
}

function triggerDownload(fileName: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function toLibraryViews(
  documents: DocumentRecord[],
): Promise<LibraryDocumentView[]> {
  const database = getReaderDatabase();
  return Promise.all(
    documents.map(async (document) => {
      const [translationCount, annotationCount, vocabularyCount] = await Promise.all([
        database.translationMarks.where("documentId").equals(document.id).count(),
        database.annotations.where("documentId").equals(document.id).count(),
        database.vocabulary.where("documentId").equals(document.id).count(),
      ]);
      return {
        id: document.id,
        title: document.title,
        author: document.author,
        pageCount: document.pageCount,
        currentPage: document.currentPage,
        progress: document.progress,
        translationCount,
        annotationCount,
        vocabularyCount,
        lastOpenedAt: document.lastOpenedAt,
        pinnedAt: document.pinnedAt,
        folderId: document.folderId,
        coverDataUrl: document.coverDataUrl,
      };
    }),
  );
}

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    if (error.name === "PasswordException") return "PDF 密码不正确或已取消输入";
    if (error.name === "InvalidPDFException") return "PDF 已损坏，无法读取";
    return error.message;
  }
  return "导入失败，请确认文件可正常打开";
}

export function LibraryClient() {
  const [documents, setDocuments] = useState<LibraryDocumentView[]>([]);
  const [folders, setFolders] = useState<LibraryFolderView[]>([]);
  const [pendingBundles, setPendingBundles] = useState<PendingBundleView[]>([]);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState("");
  const [showDesktopWelcome, setShowDesktopWelcome] = useState(false);
  const [settingPdfDefault, setSettingPdfDefault] = useState(false);

  const refresh = useCallback(async () => {
    const database = getReaderDatabase();
    const [storedDocuments, storedFolders, pending] = await Promise.all([
      database.documents.orderBy("lastOpenedAt").reverse().toArray(),
      database.folders.toArray(),
      database.pendingBundles.orderBy("importedAt").reverse().toArray(),
    ]);
    const allDocuments = [...storedDocuments, ...listEphemeralDocuments()];
    setDocuments(await toLibraryViews(allDocuments));
    setFolders(storedFolders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      documentCount: allDocuments.filter((document) => document.folderId === folder.id).length,
    })));
    setPendingBundles(
      pending.map((item) => ({
        id: item.id,
        title: item.title,
        importedAt: item.importedAt,
        translationCount: item.bundle.translationMarks.length,
        annotationCount: item.bundle.annotations.length,
      })),
    );
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const desktop = window.moduDesktop;
    if (!desktop) return;

    let active = true;
    void desktop.getPdfDefaultAppStatus()
      .then((status) => {
        if (!active || !status.available || status.isDefault) return;
        if (window.localStorage.getItem(DESKTOP_DEFAULT_PROMPT_KEY) === "true") return;
        setShowDesktopWelcome(true);
      })
      .catch(() => {
        // The desktop settings page remains available if the host cannot query xdg-mime.
      });

    return () => {
      active = false;
    };
  }, []);

  const handleDismissDesktopWelcome = useCallback(() => {
    window.localStorage.setItem(DESKTOP_DEFAULT_PROMPT_KEY, "true");
    setShowDesktopWelcome(false);
  }, []);

  const handleSetPdfDefault = useCallback(async () => {
    const desktop = window.moduDesktop;
    if (!desktop) return;

    setSettingPdfDefault(true);
    try {
      const status = await desktop.setAsPdfDefaultApp();
      if (!status.isDefault) {
        setMessage(status.error ?? "暂时无法设为默认 PDF 应用，请稍后在设置中重试。");
        return;
      }
      window.localStorage.setItem(DESKTOP_DEFAULT_PROMPT_KEY, "true");
      setShowDesktopWelcome(false);
      setMessage("墨读已设为 PDF 默认应用。以后双击 PDF 即可直接阅读。");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setSettingPdfDefault(false);
    }
  }, []);

  const handlePdfImport = useCallback(async (files: File[]) => {
    setImporting(true);
    setMessage("");
    let imported = 0;
    let importMessage = "";

    try {
      for (const file of files) {
        const result = await importPdfIntoLibrary(file, {
          requestPersistence: async () => {
            if (!navigator.storage?.persist) return false;
            return navigator.storage.persist();
          },
        });
        if (result.outcome === "existing") {
          importMessage = `“${result.title}”已在资料库中，已保留原有阅读记录。`;
        } else if (result.storage === "session") {
          importMessage = "本地空间不足，文件仅在当前会话中可用；笔记仍会尝试保存。";
        } else {
          imported += 1;
        }
      }
      setMessage(importMessage || (imported > 0 ? `已导入 ${imported} 份 PDF。` : ""));
      await refresh();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setImporting(false);
    }
  }, [refresh]);

  const handleBundleImport = useCallback(async (file: File) => {
    try {
      const bundles = parsePortableArchive(await file.text());
      const results = await Promise.all(
        bundles.map((bundle) => applyBundleToDatabase(getReaderDatabase(), bundle)),
      );
      const attached = results.filter((result) => result === "attached").length;
      setMessage(
        attached === bundles.length
          ? `已合并 ${attached} 份文档的翻译与注释。`
          : `已导入 ${bundles.length} 份笔记记录，其中 ${bundles.length - attached} 份正在等待相同 PDF。`,
      );
      await refresh();
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }, [refresh]);

  const handleTogglePin = useCallback(async (documentId: string, pinned: boolean) => {
    try {
      const pinnedAt = pinned ? new Date().toISOString() : undefined;
      const updated = await getReaderDatabase().documents.update(documentId, { pinnedAt });
      if (!updated && !updateEphemeralDocument(documentId, { pinnedAt })) {
        throw new Error("找不到这份文献");
      }
      setMessage(pinned ? "已将文献置顶。" : "已取消置顶。");
      await refresh();
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }, [refresh]);

  const handleCreateFolder = useCallback(async (name: string) => {
    try {
      await createLibraryFolder(getReaderDatabase(), name);
      setMessage(`已创建文件夹“${name.trim()}”。`);
      await refresh();
    } catch (error) {
      setMessage(errorMessage(error));
      throw error;
    }
  }, [refresh]);

  const handleRenameFolder = useCallback(async (folderId: string, name: string) => {
    try {
      await renameLibraryFolder(getReaderDatabase(), folderId, name);
      setMessage(`文件夹已重命名为“${name.trim()}”。`);
      await refresh();
    } catch (error) {
      setMessage(errorMessage(error));
      throw error;
    }
  }, [refresh]);

  const handleMoveDocument = useCallback(async (documentId: string, folderId?: string) => {
    try {
      const movedStoredDocument = await moveDocumentToFolder(getReaderDatabase(), documentId, folderId);
      if (!movedStoredDocument && !updateEphemeralDocument(documentId, { folderId })) {
        throw new Error("找不到这份文献");
      }
      setMessage(folderId ? "文献已移入文件夹。" : "文献已移至未分类。");
      await refresh();
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }, [refresh]);

  const handleDeleteFolder = useCallback(async (folderId: string) => {
    try {
      const result = await deleteLibraryFolder(getReaderDatabase(), folderId);
      let ephemeralDocumentsUnfiled = 0;
      for (const document of listEphemeralDocuments()) {
        if (document.folderId !== folderId) continue;
        if (updateEphemeralDocument(document.id, { folderId: undefined })) ephemeralDocumentsUnfiled += 1;
      }
      const documentsUnfiled = result.documentsUnfiled + ephemeralDocumentsUnfiled;
      setMessage(
        documentsUnfiled > 0
          ? `文件夹已删除，${documentsUnfiled} 份文献已移至未分类。`
          : "文件夹已删除。",
      );
      await refresh();
    } catch (error) {
      setMessage(errorMessage(error));
      throw error;
    }
  }, [refresh]);

  const handleExportBeforeDelete = useCallback(async (documentId: string) => {
    try {
      const database = getReaderDatabase();
      const documentRecord = await database.documents.get(documentId) ?? getEphemeralDocument(documentId);
      if (!documentRecord) throw new Error("找不到这份文献");
      const [translationMarks, annotations, vocabulary] = await Promise.all([
        database.translationMarks.where("documentId").equals(documentId).toArray(),
        database.annotations.where("documentId").equals(documentId).toArray(),
        database.vocabulary.where("documentId").equals(documentId).toArray(),
      ]);
      const translationIds = new Set([
        ...translationMarks.map((mark) => mark.translationId),
        ...vocabulary.map((entry) => entry.translationId),
      ]);
      const translations = (await database.translations.bulkGet([...translationIds]))
        .filter((item): item is TranslationPayload => item !== undefined);
      const bundle = createExportBundle({
        document: documentRecord,
        translations,
        translationMarks,
        annotations,
        vocabulary,
      });
      triggerDownload(
        `${safeFileName(documentRecord.title)}.updf-notes.json`,
        JSON.stringify(bundle, null, 2),
      );
      setMessage("批注与翻译已导出，不包含 PDF 和 API Key。");
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }, []);

  const handleDelete = useCallback(async (documentId: string) => {
    try {
      const database = getReaderDatabase();
      const documentRecord = await database.documents.get(documentId) ?? getEphemeralDocument(documentId);
      if (!documentRecord) throw new Error("找不到这份文献");
      const result = await deleteDocumentFromDatabase(database, documentId, documentRecord);
      forgetEphemeralDocument(documentId);
      setMessage(
        result.vocabularyRetained > 0
          ? `文献已删除，词汇本中的 ${result.vocabularyRetained} 条词汇已保留。`
          : "文献已删除。",
      );
      await refresh();
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }, [refresh]);

  return (
    <>
      <LibraryScreen
        documents={documents}
        folders={folders}
        pendingBundles={pendingBundles}
        importing={importing}
        message={message}
        onImport={handlePdfImport}
        onImportBundle={handleBundleImport}
        onTogglePin={handleTogglePin}
        onCreateFolder={handleCreateFolder}
        onRenameFolder={handleRenameFolder}
        onDeleteFolder={handleDeleteFolder}
        onMoveDocument={handleMoveDocument}
        onExportBeforeDelete={handleExportBeforeDelete}
        onDelete={handleDelete}
      />

      {showDesktopWelcome ? (
        <div className="dialog-backdrop">
          <section
            className="delete-document-dialog desktop-welcome-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="desktop-welcome-title"
          >
            <div className="desktop-welcome-icon" aria-hidden="true">PDF</div>
            <h2 id="desktop-welcome-title">墨读已准备好</h2>
            <p>
              客户端已包含完整运行环境，无需另外安装 Node.js 或 npm，下载后即可使用。
            </p>
            <div className="desktop-welcome-summary">
              <span>PDF 与阅读记录默认保存在本机</span>
              <span>设为默认应用后，双击 PDF 可直接用墨读打开</span>
            </div>
            <footer>
              <button
                className="secondary-button"
                type="button"
                disabled={settingPdfDefault}
                onClick={handleDismissDesktopWelcome}
              >
                以后再说
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={settingPdfDefault}
                onClick={() => void handleSetPdfDefault()}
              >
                {settingPdfDefault ? "正在设置…" : "设为默认 PDF 应用"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}
