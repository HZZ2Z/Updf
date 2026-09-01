"use client";

import {
  ArrowRight,
  BookOpen,
  ChevronLeft,
  Download,
  FileText,
  FileUp,
  Folder,
  FolderClock,
  FolderInput,
  FolderPlus,
  GripVertical,
  HardDrive,
  MoreHorizontal,
  Pencil,
  Pin,
  RefreshCw,
  Settings,
  Trash2,
  TriangleAlert,
  UploadCloud,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";

import { compareManualOrder, mergeVisibleOrder, moveOrderedItem } from "@/lib/library-order";

export interface LibraryDocumentView {
  id: string;
  title: string;
  author?: string;
  pageCount: number;
  currentPage: number;
  progress: number;
  translationCount: number;
  annotationCount: number;
  vocabularyCount?: number;
  lastOpenedAt: string;
  createdAt?: string;
  sortOrder?: number;
  pinnedAt?: string;
  folderId?: string;
  coverDataUrl?: string;
}

export interface LibraryFolderView {
  id: string;
  name: string;
  documentCount: number;
  createdAt?: string;
  sortOrder?: number;
}

export interface PendingBundleView {
  id: string;
  title: string;
  importedAt: string;
  translationCount: number;
  annotationCount: number;
}

interface LibraryScreenProps {
  documents: LibraryDocumentView[];
  folders?: LibraryFolderView[];
  pendingBundles: PendingBundleView[];
  onImport: (files: File[]) => void | Promise<void>;
  onImportBundle?: (file: File) => void | Promise<void>;
  onTogglePin?: (documentId: string, pinned: boolean) => void | Promise<void>;
  onReorderDocuments?: (orderedIds: string[]) => void | Promise<void>;
  onReorderFolders?: (orderedIds: string[]) => void | Promise<void>;
  onDelete?: (documentId: string) => void | Promise<void>;
  onExportBeforeDelete?: (documentId: string) => void | Promise<void>;
  onCreateFolder?: (name: string) => void | Promise<void>;
  onRenameFolder?: (folderId: string, name: string) => void | Promise<void>;
  onDeleteFolder?: (folderId: string) => void | Promise<void>;
  onMoveDocument?: (documentId: string, folderId?: string) => void | Promise<void>;
  importing?: boolean;
  message?: string;
  updateAvailableVersion?: string;
}

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function LibraryScreen({
  documents,
  folders = [],
  pendingBundles,
  onImport,
  onImportBundle,
  onTogglePin,
  onReorderDocuments,
  onReorderFolders,
  onDelete,
  onExportBeforeDelete,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveDocument,
  importing = false,
  message,
  updateAvailableVersion,
}: LibraryScreenProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const bundleInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<LibraryDocumentView>();
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [activeFolder, setActiveFolder] = useState<string>("all");
  const [managedFolderId, setManagedFolderId] = useState<string>();
  const [documentActionsId, setDocumentActionsId] = useState<string>();
  const [moveDocumentId, setMoveDocumentId] = useState<string>();
  const [folderDialog, setFolderDialog] = useState<{ mode: "create" | "rename"; folder?: LibraryFolderView }>();
  const [folderNameDraft, setFolderNameDraft] = useState("");
  const [folderDialogError, setFolderDialogError] = useState("");
  const [savingFolder, setSavingFolder] = useState(false);
  const [mobileFolderMenuOpen, setMobileFolderMenuOpen] = useState(false);
  const [deleteFolderCandidate, setDeleteFolderCandidate] = useState<LibraryFolderView>();
  const [deleteFolderError, setDeleteFolderError] = useState("");
  const [deletingFolder, setDeletingFolder] = useState(false);
  const [draggedDocumentId, setDraggedDocumentId] = useState<string>();
  const [draggedFolderId, setDraggedFolderId] = useState<string>();
  const [documentDropTargetId, setDocumentDropTargetId] = useState<string>();
  const [folderDropTargetId, setFolderDropTargetId] = useState<string>();
  const sortedDocuments = useMemo(() => [...documents].sort(compareManualOrder), [documents]);
  const sortedFolders = useMemo(
    () => [...folders].sort(compareManualOrder),
    [folders],
  );
  const visibleDocuments = useMemo(() => {
    if (activeFolder === "all") return sortedDocuments;
    return sortedDocuments.filter((document) => document.folderId === activeFolder);
  }, [activeFolder, sortedDocuments]);
  const activeFolderName = activeFolder === "all"
    ? "全部文献"
    : folders.find((folder) => folder.id === activeFolder)?.name || "全部文献";
  const activeFolderView = folders.find((folder) => folder.id === activeFolder);
  const folderFeaturesEnabled = folders.length > 0 || Boolean(
    onCreateFolder || onRenameFolder || onDeleteFolder || onMoveDocument,
  );
  const clearDragState = () => {
    setDraggedDocumentId(undefined);
    setDraggedFolderId(undefined);
    setDocumentDropTargetId(undefined);
    setFolderDropTargetId(undefined);
  };

  useEffect(() => {
    if (!managedFolderId && !documentActionsId && !mobileFolderMenuOpen) return;
    const closeOpenMenus = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-library-menu-control]")) return;
      setManagedFolderId(undefined);
      setDocumentActionsId(undefined);
      setMoveDocumentId(undefined);
      setMobileFolderMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setManagedFolderId(undefined);
      setDocumentActionsId(undefined);
      setMoveDocumentId(undefined);
      setMobileFolderMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOpenMenus);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOpenMenus);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [documentActionsId, managedFolderId, mobileFolderMenuOpen]);

  const reorderVisibleDocuments = (targetId: string) => {
    if (!draggedDocumentId || !onReorderDocuments) return;
    const visibleIds = visibleDocuments.map((document) => document.id);
    const nextVisibleIds = moveOrderedItem(visibleIds, draggedDocumentId, targetId);
    if (nextVisibleIds === visibleIds) return;
    const allIds = sortedDocuments.map((document) => document.id);
    void onReorderDocuments(mergeVisibleOrder(allIds, nextVisibleIds));
  };

  const reorderFolders = (targetId: string) => {
    if (!draggedFolderId || !onReorderFolders) return;
    void onReorderFolders(moveOrderedItem(
      sortedFolders.map((folder) => folder.id),
      draggedFolderId,
      targetId,
    ));
  };

  const importFiles = (files: FileList | File[]) => {
    const pdfFiles = Array.from(files).filter(
      (file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"),
    );
    if (pdfFiles.length > 0) void onImport(pdfFiles);
  };

  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) importFiles(event.target.files);
    event.target.value = "";
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    importFiles(event.dataTransfer.files);
  };

  return (
    <div className="library-shell">
      <header className="library-topbar">
        <a className="brand" href="/" aria-label="墨读首页">
          <span className="brand-mark">墨</span>
          <span>墨读</span>
        </a>
        <nav className="library-nav" aria-label="全局导航">
          <a href="/vocabulary"><BookOpen aria-hidden="true" />词汇本</a>
          <a href="/settings"><Settings aria-hidden="true" />设置</a>
        </nav>
      </header>

      <main className="library-main">
        <section className="library-heading-row">
          <div>
            <h1>文献资料库</h1>
            <p>把知识留在本地，把阅读变成积累</p>
          </div>
          {onImportBundle ? (
            <div className="library-heading-actions">
              <button className="secondary-button" type="button" onClick={() => bundleInputRef.current?.click()}>
                <FileUp aria-hidden="true" />导入笔记包
              </button>
            </div>
          ) : null}
        </section>

        <input
          ref={inputRef}
          id="pdf-file-input"
          className="visually-hidden"
          type="file"
          accept="application/pdf,.pdf"
          multiple
          aria-label="选择 PDF 文件"
          onChange={handleInput}
        />
        {onImportBundle ? (
          <input
            ref={bundleInputRef}
            className="visually-hidden"
            type="file"
            accept="application/json,.json"
            aria-label="选择笔记包"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onImportBundle(file);
              event.target.value = "";
            }}
          />
        ) : null}

        <div
          className={`import-dropzone ${isDragging ? "is-dragging" : ""}`}
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") inputRef.current?.click();
          }}
          onDragEnter={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          <UploadCloud aria-hidden="true" />
          <strong>{importing ? "正在导入 PDF…" : "拖放 PDF 到这里，或点击选择文件"}</strong>
          <span>{importing ? "正在写入本地资料库" : "支持一次选择多份文件 · 文件仅存储在这台设备上"}</span>
        </div>

        {message ? <div className="library-message" role="status">{message}</div> : null}
        {updateAvailableVersion ? (
          <a className="library-update-banner" href="/settings">
            <RefreshCw aria-hidden="true" />
            <span>墨读 {updateAvailableVersion} 已可用</span>
            <strong>前往更新</strong>
          </a>
        ) : null}

        <section className="library-section" aria-labelledby="all-documents-title">
          {folderFeaturesEnabled ? (
            <div className="folder-mobile-control">
              <label>
                <span>文件夹</span>
                <select
                  aria-label="筛选文件夹"
                  value={activeFolder}
                  onChange={(event) => {
                    setActiveFolder(event.target.value);
                    setMobileFolderMenuOpen(false);
                  }}
                >
                  <option value="all">全部文献（{documents.length}）</option>
                  {sortedFolders.map((folder) => (
                    <option key={folder.id} value={folder.id}>{folder.name}（{folder.documentCount}）</option>
                  ))}
                </select>
              </label>
              {onCreateFolder ? (
                <button
                  className="folder-mobile-action"
                  type="button"
                  aria-label="新建课程文件夹"
                  onClick={() => {
                    setFolderDialogError("");
                    setFolderNameDraft("");
                    setFolderDialog({ mode: "create" });
                  }}
                >
                  <FolderPlus aria-hidden="true" />
                </button>
              ) : null}
              {activeFolderView && (onRenameFolder || onDeleteFolder) ? (
                <>
                  <button
                    className="folder-mobile-action"
                    type="button"
                    data-library-menu-control
                    aria-label="管理当前文件夹"
                    aria-expanded={mobileFolderMenuOpen}
                    onClick={() => setMobileFolderMenuOpen((open) => !open)}
                  >
                    <MoreHorizontal aria-hidden="true" />
                  </button>
                  {mobileFolderMenuOpen ? (
                    <div className="folder-mobile-menu" role="menu" data-library-menu-control>
                      {onRenameFolder ? (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setMobileFolderMenuOpen(false);
                            setFolderDialogError("");
                            setFolderNameDraft(activeFolderView.name);
                            setFolderDialog({ mode: "rename", folder: activeFolderView });
                          }}
                        >
                          <Pencil aria-hidden="true" />重命名当前文件夹
                        </button>
                      ) : null}
                      {onDeleteFolder ? (
                        <button
                          className="is-danger"
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setMobileFolderMenuOpen(false);
                            setDeleteFolderError("");
                            setDeleteFolderCandidate(activeFolderView);
                          }}
                        >
                          <Trash2 aria-hidden="true" />删除当前文件夹
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}

          <div className={`library-browser ${folderFeaturesEnabled ? "has-folders" : ""}`}>
            {folderFeaturesEnabled ? (
              <aside className="folder-sidebar" aria-label="课程文件夹">
                <div className="folder-sidebar-heading">
                  <strong>文件夹</strong>
                  {onCreateFolder ? (
                    <button
                      type="button"
                      aria-label="新建文件夹"
                      title="新建文件夹"
                      onClick={() => {
                        setFolderDialogError("");
                        setFolderNameDraft("");
                        setFolderDialog({ mode: "create" });
                      }}
                    >
                      <FolderPlus aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
                <nav className="folder-nav" aria-label="文献分类">
                  <button
                    className={activeFolder === "all" ? "is-active" : ""}
                    type="button"
                    onClick={() => setActiveFolder("all")}
                  >
                    <Folder aria-hidden="true" />
                    <span>全部文献</span>
                    <b>{documents.length}</b>
                  </button>
                  {sortedFolders.map((folder) => (
                    <div
                      className={`folder-nav-row ${folderDropTargetId === folder.id ? "is-drop-target" : ""}`}
                      key={folder.id}
                      onDragOver={(event) => {
                        if ((!draggedDocumentId || !onMoveDocument) && (!draggedFolderId || !onReorderFolders)) return;
                        event.preventDefault();
                        setFolderDropTargetId(folder.id);
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        if (draggedDocumentId) {
                          void onMoveDocument?.(draggedDocumentId, folder.id);
                        } else {
                          reorderFolders(folder.id);
                        }
                        clearDragState();
                      }}
                    >
                      <button
                        className={activeFolder === folder.id ? "is-active" : ""}
                        type="button"
                        aria-label={`${folder.name} ${folder.documentCount}`}
                        onClick={() => setActiveFolder(folder.id)}
                      >
                        <Folder aria-hidden="true" />
                        <span>{folder.name}</span>
                        <b>{folder.documentCount}</b>
                      </button>
                      {onReorderFolders ? (
                        <button
                          className="folder-drag-handle"
                          type="button"
                          draggable
                          aria-label={`拖动排序文件夹：${folder.name}`}
                          title="拖动排序"
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("text/plain", folder.id);
                            setDraggedFolderId(folder.id);
                            setDraggedDocumentId(undefined);
                          }}
                          onDragEnd={clearDragState}
                        >
                          <GripVertical aria-hidden="true" />
                        </button>
                      ) : null}
                      {onRenameFolder || onDeleteFolder ? (
                        <button
                          className="folder-manage-button"
                          type="button"
                          data-library-menu-control
                          aria-label={`管理文件夹：${folder.name}`}
                          title="管理文件夹"
                          onClick={() => setManagedFolderId((current) => current === folder.id ? undefined : folder.id)}
                        >
                          <MoreHorizontal aria-hidden="true" />
                        </button>
                      ) : null}
                      {managedFolderId === folder.id ? (
                        <div className="folder-action-menu" role="menu" data-library-menu-control>
                          {onRenameFolder ? (
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setManagedFolderId(undefined);
                                setFolderDialogError("");
                                setFolderNameDraft(folder.name);
                                setFolderDialog({ mode: "rename", folder });
                              }}
                            >
                              <Pencil aria-hidden="true" />重命名
                            </button>
                          ) : null}
                          {onDeleteFolder ? (
                            <button
                              className="is-danger"
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setManagedFolderId(undefined);
                                setDeleteFolderError("");
                                setDeleteFolderCandidate(folder);
                              }}
                            >
                              <Trash2 aria-hidden="true" />删除文件夹
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </nav>
              </aside>
            ) : null}

            <div className="folder-document-pane">
              <div className="section-title-row">
                <h2 id="all-documents-title">{activeFolderName} <span>{visibleDocuments.length}</span></h2>
              </div>

              {documents.length === 0 ? (
                <div className="library-empty">
                  <FileText aria-hidden="true" />
                  <h3>还没有文献</h3>
                  <p>导入第一份 PDF，翻译、注释和进度都会自动保存在本地。</p>
                </div>
              ) : visibleDocuments.length === 0 ? (
                <div className="library-empty library-folder-empty">
                  <Folder aria-hidden="true" />
                  <h3>这个文件夹还是空的</h3>
                  <p>从文献右侧的文件夹按钮把 PDF 移到这里。</p>
                </div>
              ) : (
                <div className="document-list">
                  {visibleDocuments.map((document) => {
                const progress = Math.round(document.progress * 100);
                const hasActions = Boolean(onTogglePin || onDelete || onMoveDocument);
                return (
                  <article
                    className={`document-row ${document.pinnedAt ? "is-pinned" : ""} ${hasActions ? "has-actions" : ""} ${documentActionsId === document.id ? "has-open-folder-menu" : ""} ${documentDropTargetId === document.id ? "is-drop-target" : ""}`}
                    key={document.id}
                    aria-label={`文献：${document.title}`}
                    onDragOver={(event) => {
                      if (!draggedDocumentId || !onReorderDocuments) return;
                      event.preventDefault();
                      setDocumentDropTargetId(document.id);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      reorderVisibleDocuments(document.id);
                      clearDragState();
                    }}
                  >
                    <a className="document-row-link" href={`/reader/${document.id}`}>
                      <div
                        className={`document-cover${onReorderDocuments ? " is-draggable" : ""}`}
                        draggable={Boolean(onReorderDocuments)}
                        aria-label={onReorderDocuments ? `拖动排序：${document.title}` : undefined}
                        title={onReorderDocuments ? "拖动排序或拖到文件夹分类" : undefined}
                        style={document.coverDataUrl ? { backgroundImage: `url(${document.coverDataUrl})` } : undefined}
                        onDragStart={(event) => {
                          if (!onReorderDocuments) return;
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", document.id);
                          setDraggedDocumentId(document.id);
                          setDraggedFolderId(undefined);
                        }}
                        onDragEnd={clearDragState}
                      >
                        {document.coverDataUrl ? null : <FileText aria-hidden="true" />}
                      </div>
                      <div className="document-identity">
                        <div className="document-title-line">
                          {document.pinnedAt ? <Pin aria-hidden="true" /> : null}
                          <h3>{document.title}</h3>
                        </div>
                        <p>{document.author || "本地 PDF"}</p>
                        <span><BookOpen aria-hidden="true" />继续阅读</span>
                      </div>
                      <div className="document-progress">
                        <strong>{progress}%</strong>
                        <div className="progress-track"><i style={{ width: `${progress}%` }} /></div>
                        <span>{document.currentPage} / {document.pageCount} 页</span>
                      </div>
                      <div className="document-stat"><strong>{document.translationCount} 次翻译</strong><span>翻译记录</span></div>
                      <div className="document-stat"><strong>{document.annotationCount} 条笔记</strong><span>批注记录</span></div>
                      <div className="document-last-read">
                        <span>{dateFormatter.format(new Date(document.lastOpenedAt))}</span>
                        <ArrowRight aria-hidden="true" />
                      </div>
                      {hasActions ? <span className="document-actions-spacer" aria-hidden="true" /> : null}
                    </a>
                    {hasActions ? (
                      <div className="document-row-actions">
                        {onTogglePin ? (
                          <button
                            className={document.pinnedAt ? "is-active" : ""}
                            type="button"
                            aria-label={`${document.pinnedAt ? "取消置顶" : "置顶文献"}：${document.title}`}
                            title={document.pinnedAt ? "取消置顶" : "置顶文献"}
                            onClick={() => void onTogglePin(document.id, !document.pinnedAt)}
                          >
                            <Pin aria-hidden="true" />
                          </button>
                        ) : null}
                        {onMoveDocument || onDelete ? (
                          <button
                            type="button"
                            data-library-menu-control
                            aria-label={`更多操作：${document.title}`}
                            aria-expanded={documentActionsId === document.id}
                            title="更多操作"
                            onClick={() => {
                              setMoveDocumentId(undefined);
                              setDocumentActionsId((current) => current === document.id ? undefined : document.id);
                            }}
                          >
                            <MoreHorizontal aria-hidden="true" />
                          </button>
                        ) : null}
                        {documentActionsId === document.id ? (
                          <div className="document-folder-menu" role="menu" data-library-menu-control>
                            {moveDocumentId === document.id ? (
                              <>
                                <button type="button" role="menuitem" onClick={() => setMoveDocumentId(undefined)}>
                                  <ChevronLeft aria-hidden="true" />返回
                                </button>
                                {document.folderId ? (
                                  <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => {
                                      setMoveDocumentId(undefined);
                                      setDocumentActionsId(undefined);
                                      void onMoveDocument?.(document.id, undefined);
                                    }}
                                  >
                                    <FolderInput aria-hidden="true" />移出当前文件夹
                                  </button>
                                ) : null}
                                {sortedFolders.map((folder) => (
                                  <button
                                    className={document.folderId === folder.id ? "is-current" : ""}
                                    type="button"
                                    role="menuitem"
                                    key={folder.id}
                                    onClick={() => {
                                      setMoveDocumentId(undefined);
                                      setDocumentActionsId(undefined);
                                      void onMoveDocument?.(document.id, folder.id);
                                    }}
                                  >
                                    {folder.name}
                                  </button>
                                ))}
                              </>
                            ) : (
                              <>
                                {onMoveDocument && (sortedFolders.length > 0 || document.folderId) ? (
                                  <button type="button" role="menuitem" onClick={() => setMoveDocumentId(document.id)}>
                                    <FolderInput aria-hidden="true" />移动到文件夹
                                  </button>
                                ) : null}
                                {onDelete ? (
                                  <button
                                    className="is-danger"
                                    type="button"
                                    role="menuitem"
                                    onClick={() => {
                                      setDocumentActionsId(undefined);
                                      setDeleteCandidate(document);
                                    }}
                                  >
                                    <Trash2 aria-hidden="true" />删除文献
                                  </button>
                                ) : null}
                              </>
                            )}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                );
                  })}
                </div>
              )}
            </div>
          </div>
        </section>

        {pendingBundles.length > 0 ? (
          <section className="library-section" aria-labelledby="pending-title">
            <div className="section-title-row">
              <h2 id="pending-title">笔记包（待匹配）</h2>
            </div>
            <div className="pending-list">
              {pendingBundles.map((bundle) => (
                <div className="pending-row" key={bundle.id}>
                  <FolderClock aria-hidden="true" />
                  <div>
                    <strong>{bundle.title}</strong>
                    <span>{bundle.translationCount} 条翻译 · {bundle.annotationCount} 条注释</span>
                  </div>
                  <div className="pending-meta">
                    <span className="pending-badge">等待原 PDF</span>
                    <time>{dateFormatter.format(new Date(bundle.importedAt))}</time>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <footer className="storage-footer">
          <HardDrive aria-hidden="true" />
          <span>本地存储</span>
          <strong>PDF 与阅读记录不会上传</strong>
        </footer>
      </main>

      {folderDialog ? (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !savingFolder) setFolderDialog(undefined);
          }}
        >
          <form
            className="delete-document-dialog folder-name-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="folder-name-dialog-title"
            onSubmit={async (event) => {
              event.preventDefault();
              const name = folderNameDraft.trim();
              if (!name) return;
              setSavingFolder(true);
              try {
                if (folderDialog.mode === "create") {
                  await onCreateFolder?.(name);
                } else if (folderDialog.folder) {
                  await onRenameFolder?.(folderDialog.folder.id, name);
                }
                setFolderDialog(undefined);
                setFolderNameDraft("");
                setFolderDialogError("");
              } catch (error) {
                setFolderDialogError(error instanceof Error ? error.message : "文件夹保存失败，请重试");
              } finally {
                setSavingFolder(false);
              }
            }}
          >
            <button
              className="dialog-close-button"
              type="button"
              aria-label="关闭文件夹提示"
              disabled={savingFolder}
              onClick={() => setFolderDialog(undefined)}
            >
              <X aria-hidden="true" />
            </button>
            <FolderPlus className="folder-dialog-icon" aria-hidden="true" />
            <h2 id="folder-name-dialog-title">{folderDialog.mode === "create" ? "新建文件夹" : "重命名文件夹"}</h2>
            <label className="folder-name-field">
              <span>文件夹名称</span>
              <input
                autoFocus
                maxLength={60}
                value={folderNameDraft}
                onChange={(event) => setFolderNameDraft(event.target.value)}
              />
            </label>
            {folderDialogError ? <div className="folder-dialog-error" role="alert">{folderDialogError}</div> : null}
            <footer>
              <button className="secondary-button" type="button" disabled={savingFolder} onClick={() => setFolderDialog(undefined)}>
                取消
              </button>
              <button className="primary-button" type="submit" disabled={savingFolder || !folderNameDraft.trim()}>
                {savingFolder ? "正在保存…" : folderDialog.mode === "create" ? "创建" : "保存"}
              </button>
            </footer>
          </form>
        </div>
      ) : null}

      {deleteFolderCandidate ? (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !deletingFolder) setDeleteFolderCandidate(undefined);
          }}
        >
          <section
            className="delete-document-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-folder-title"
          >
            <button
              className="dialog-close-button"
              type="button"
              aria-label="关闭删除文件夹提示"
              disabled={deletingFolder}
              onClick={() => setDeleteFolderCandidate(undefined)}
            >
              <X aria-hidden="true" />
            </button>
            <TriangleAlert className="delete-dialog-icon" aria-hidden="true" />
            <h2 id="delete-folder-title">删除文件夹</h2>
            <p>确定删除“{deleteFolderCandidate.name}”吗？</p>
            <div className="delete-dialog-keep">
              {deleteFolderCandidate.documentCount} 份文献仍会保留在资料库，阅读记录不会删除。
            </div>
            {deleteFolderError ? <div className="folder-dialog-error" role="alert">{deleteFolderError}</div> : null}
            <footer>
              <button className="secondary-button" type="button" disabled={deletingFolder} onClick={() => setDeleteFolderCandidate(undefined)}>
                取消
              </button>
              <button
                className="danger-button"
                type="button"
                aria-label="确认删除文件夹"
                disabled={deletingFolder}
                onClick={async () => {
                  if (!onDeleteFolder) return;
                  setDeletingFolder(true);
                  try {
                    await onDeleteFolder(deleteFolderCandidate.id);
                    if (activeFolder === deleteFolderCandidate.id) setActiveFolder("all");
                    setDeleteFolderCandidate(undefined);
                    setDeleteFolderError("");
                  } catch (error) {
                    setDeleteFolderError(error instanceof Error ? error.message : "文件夹删除失败，请重试");
                  } finally {
                    setDeletingFolder(false);
                  }
                }}
              >
                <Trash2 aria-hidden="true" />
                {deletingFolder ? "正在删除…" : "确认删除文件夹"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {deleteCandidate ? (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !deleting) setDeleteCandidate(undefined);
          }}
        >
          <section
            className="delete-document-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-document-title"
          >
            <button
              className="dialog-close-button"
              type="button"
              aria-label="关闭删除提示"
              disabled={deleting}
              onClick={() => setDeleteCandidate(undefined)}
            >
              <X aria-hidden="true" />
            </button>
            <TriangleAlert className="delete-dialog-icon" aria-hidden="true" />
            <h2 id="delete-document-title">删除文献</h2>
            <p>确定删除“{deleteCandidate.title}”吗？</p>
            <div className="delete-dialog-summary">
              <span>PDF 文件与阅读进度</span>
              <span>{deleteCandidate.translationCount} 条页面翻译与 {deleteCandidate.annotationCount} 条批注</span>
            </div>
            <div className="delete-dialog-keep">
              词汇本中的 {deleteCandidate.vocabularyCount ?? 0} 条词汇会保留，仍可继续复习。
            </div>
            <footer>
              {onExportBeforeDelete ? (
                <button
                  className="secondary-button"
                  type="button"
                  disabled={exporting || deleting}
                  onClick={async () => {
                    setExporting(true);
                    try {
                      await onExportBeforeDelete(deleteCandidate.id);
                    } finally {
                      setExporting(false);
                    }
                  }}
                >
                  <Download aria-hidden="true" />
                  {exporting ? "正在导出…" : "导出批注与翻译"}
                </button>
              ) : null}
              <button className="secondary-button" type="button" disabled={deleting} onClick={() => setDeleteCandidate(undefined)}>
                取消
              </button>
              <button
                className="danger-button"
                type="button"
                disabled={deleting}
                onClick={async () => {
                  if (!onDelete) return;
                  setDeleting(true);
                  try {
                    await onDelete(deleteCandidate.id);
                    setDeleteCandidate(undefined);
                  } finally {
                    setDeleting(false);
                  }
                }}
              >
                <Trash2 aria-hidden="true" />
                {deleting ? "正在删除…" : "永久删除"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}
