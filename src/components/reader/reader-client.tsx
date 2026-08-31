"use client";

import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import { AlertCircle, KeyRound, LoaderCircle, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BookViewer } from "@/components/reader/book-viewer";
import { ContinuousViewer } from "@/components/reader/continuous-viewer";
import { InspectorPanel, type TranslationView } from "@/components/reader/inspector-panel";
import { NoteDialog } from "@/components/reader/note-dialog";
import { ReaderLeftPanel } from "@/components/reader/reader-left-panel";
import { ReaderToolbar } from "@/components/reader/reader-toolbar";
import { SelectionToolbar } from "@/components/reader/selection-toolbar";
import { useReaderPanels } from "@/components/reader/use-reader-panels";
import { getReaderDatabase } from "@/lib/database";
import { getEphemeralDocument, updateEphemeralDocument } from "@/lib/pdf-engine";
import { mergePdfPageSizes, scanPdfPageSizes } from "@/lib/pdf-page-geometry";
import { pdfRenderQueue } from "@/lib/pdf-performance";
import { loadPdfDocument } from "@/lib/pdf-runtime";
import { createExportBundle, exportBundleToMarkdown } from "@/lib/portable-data";
import {
  buildTranslationCacheKey,
  captureContinuousZoomAnchor,
  getContinuousZoomScrollTop,
  scheduleContinuousPagePosition,
  sameTextAnchorLocation,
  shouldAcceptViewerPageChange,
  updateModePage,
} from "@/lib/reader-core";
import {
  resolveTranslationProvider,
  translationRequestDeduper,
} from "@/lib/translation-runtime";
import {
  recordLocalTranslationCacheHit,
  recordRemoteTranslationUsage,
  type TranslationApiUsage,
} from "@/lib/translation-usage";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import type {
  AnnotationRecord,
  DocumentRecord,
  ExportBundleV1,
  HighlightColor,
  PdfPageSize,
  PdfPageSizeMap,
  ReaderMode,
  TextAnchor,
  TextSelectionSnapshot,
  TranslationMark,
  TranslationPayload,
  TranslationProvider,
  TranslationService,
  VocabularyEntry,
} from "@/lib/types";

interface ReaderClientProps {
  documentId: string;
}

interface NoteDialogState {
  anchor: TextAnchor;
  editing?: AnnotationRecord;
}

interface TranslationApiResult {
  translation?: string;
  detectedLanguage?: string;
  usage?: TranslationApiUsage;
  error?: string;
}

function clampZoom(value: number) {
  return Math.min(3, Math.max(0.5, Math.round(value * 10) / 10));
}

function triggerDownload(fileName: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function safeFileName(title: string) {
  return title.replace(/[\\/:*?"<>|]/g, "-").slice(0, 80) || "modu-notes";
}

export function ReaderClient({ documentId }: ReaderClientProps) {
  const {
    leftPanelOpen,
    inspectorOpen,
    focusMode,
    toggleLeftPanel,
    toggleInspector,
    openInspector,
    toggleFocusMode,
  } = useReaderPanels(documentId);
  const [documentRecord, setDocumentRecord] = useState<DocumentRecord>();
  const [pdf, setPdf] = useState<PDFDocumentProxy>();
  const [pageSizes, setPageSizes] = useState<PdfPageSizeMap>({});
  const pageSizesRef = useRef<PdfPageSizeMap>({});
  const [outline, setOutline] = useState<string[]>([]);
  const [mode, setMode] = useState<ReaderMode>("continuous");
  const [modePages, setModePages] = useState<Record<ReaderMode, number>>({ continuous: 1, book: 1 });
  const page = modePages[mode];
  const readingPageRef = useRef(page);
  readingPageRef.current = page;
  const mergeMeasuredPageSizes = useCallback((incoming: PdfPageSizeMap) => {
    const merged = mergePdfPageSizes(pageSizesRef.current, incoming);
    if (merged === pageSizesRef.current) return;
    pageSizesRef.current = merged;
    setPageSizes(merged);
  }, []);
  const handlePageSize = useCallback((pageNumber: number, size: PdfPageSize) => {
    mergeMeasuredPageSizes({ [pageNumber]: size });
  }, [mergeMeasuredPageSizes]);
  const setPage = useCallback((nextPage: number) => {
    setModePages((current) => updateModePage(current, mode, nextPage));
  }, [mode]);
  const [continuousZoom, setContinuousZoom] = useState(1);
  const [bookZoom, setBookZoom] = useState(1);
  const continuousRenderZoom = useDebouncedValue(continuousZoom, 150);
  const bookRenderZoom = useDebouncedValue(bookZoom, 150);
  const [translations, setTranslations] = useState<TranslationPayload[]>([]);
  const [translationMarks, setTranslationMarks] = useState<TranslationMark[]>([]);
  const [annotations, setAnnotations] = useState<AnnotationRecord[]>([]);
  const [vocabulary, setVocabulary] = useState<VocabularyEntry[]>([]);
  const [selection, setSelection] = useState<TextSelectionSnapshot>();
  const [noteDialog, setNoteDialog] = useState<NoteDialogState>();
  const [translationFocus, setTranslationFocus] = useState<{ markId: string; request: number }>();
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string>();
  const [translating, setTranslating] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [apiKeyProvider, setApiKeyProvider] = useState<TranslationService>("deepseek");
  const [targetLanguage, setTargetLanguage] = useState("zh-CN");
  const [translationProvider, setTranslationProvider] = useState<TranslationProvider>("deepseek");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const canvasAreaRef = useRef<HTMLDivElement>(null);
  const activeModeRef = useRef<ReaderMode>("continuous");
  const programmaticPageRef = useRef<Partial<Record<ReaderMode, number>>>({});
  const continuousPositionCleanupRef = useRef<(() => void) | undefined>(undefined);
  const continuousZoomAnchorRef = useRef<{ page: number; anchor: number } | undefined>(undefined);
  const zoomRestoringRef = useRef(false);
  const pendingTranslationRef = useRef<{
    selection: TextSelectionSnapshot;
    bypassCache: boolean;
    provider: TranslationService;
  } | undefined>(undefined);
  const focusTranslation = useCallback((markId: string) => {
    openInspector();
    setTranslationFocus((current) => ({
      markId,
      request: (current?.request ?? 0) + 1,
    }));
  }, [openInspector]);
  const focusAnnotation = useCallback((annotationId: string) => {
    openInspector();
    setSelectedAnnotationId(annotationId);
  }, [openInspector]);

  const refreshRecords = useCallback(async () => {
    const database = getReaderDatabase();
    const [allTranslations, marks, notes, words] = await Promise.all([
      database.translations.toArray(),
      database.translationMarks.where("documentId").equals(documentId).toArray(),
      database.annotations.where("documentId").equals(documentId).toArray(),
      database.vocabulary.where("documentId").equals(documentId).toArray(),
    ]);
    const translationIds = new Set(marks.map((mark) => mark.translationId));
    setTranslations(allTranslations.filter((translation) => translationIds.has(translation.id)));
    setTranslationMarks(marks);
    setAnnotations(notes);
    setVocabulary(words);
  }, [documentId]);

  useEffect(() => {
    let loadingTask: PDFDocumentLoadingTask | undefined;
    let cancelled = false;
    void (async () => {
      const database = getReaderDatabase();
      const storedDocument = await database.documents.get(documentId);
      const record = storedDocument || getEphemeralDocument(documentId);
      if (!record) {
        setError("找不到这份 PDF，它可能已从本地资料库中移除。");
        return;
      }
      setDocumentRecord(record);
      pageSizesRef.current = record.pageSizes ?? {};
      setPageSizes(pageSizesRef.current);
      setModePages({
        continuous: record.continuousPage ?? record.currentPage,
        book: record.bookPage ?? record.currentPage,
      });
      setContinuousZoom(record.continuousZoom);
      setBookZoom(record.bookZoom);
      const savedMode = window.localStorage.getItem("modu-reader-mode");
      if (savedMode === "book" || savedMode === "continuous") {
        activeModeRef.current = savedMode;
        setMode(savedMode);
      }
      setTargetLanguage(window.localStorage.getItem("modu-target-language") || "zh-CN");
      const savedProvider = window.localStorage.getItem("modu-translation-provider");
      setTranslationProvider(savedProvider === "google" || savedProvider === "smart" ? savedProvider : "deepseek");
      await refreshRecords();

      const pdfjs = await import("pdfjs-dist");
      loadingTask = loadPdfDocument(
        pdfjs,
        new Uint8Array(await record.file.arrayBuffer()),
      );
      loadingTask.onPassword = (submitPassword: (password: string) => void) => {
        const password = window.prompt("这份 PDF 已加密，请输入密码");
        if (password !== null) submitPassword(password);
      };
      const loadedPdf = await loadingTask.promise;
      if (cancelled) return;
      setPdf(loadedPdf);
      const loadedOutline = await loadedPdf.getOutline().catch(() => null);
      if (loadedOutline) setOutline(loadedOutline.map((item) => item.title));
    })().catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : "PDF 加载失败");
    });
    return () => {
      cancelled = true;
      void loadingTask?.destroy();
    };
  }, [documentId, refreshRecords]);

  useEffect(() => {
    if (!pdf || !documentRecord) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void scanPdfPageSizes({
        pdf,
        pageCount: documentRecord.pageCount,
        currentPage: readingPageRef.current,
        knownSizes: pageSizesRef.current,
        signal: controller.signal,
        onBatch: mergeMeasuredPageSizes,
        waitForRenderIdle: () => pdfRenderQueue.whenIdle(),
      }).catch((caught: unknown) => {
        if (!controller.signal.aborted) {
          console.warn("Failed to scan PDF page geometry", caught);
        }
      });
    }, 450);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [documentRecord, mergeMeasuredPageSizes, pdf]);

  useEffect(() => {
    if (!documentRecord || Object.keys(pageSizes).length === 0) return;
    const timer = window.setTimeout(() => {
      if (documentRecord.persisted) {
        void getReaderDatabase().documents.update(documentId, { pageSizes });
      } else {
        updateEphemeralDocument(documentId, { pageSizes });
      }
    }, 650);
    return () => window.clearTimeout(timer);
  }, [documentId, documentRecord, pageSizes]);

  useEffect(() => {
    if (!documentRecord?.persisted) return;
    const timer = window.setTimeout(() => {
      void getReaderDatabase().documents.update(documentId, {
        currentPage: page,
        continuousPage: modePages.continuous,
        bookPage: modePages.book,
        progress: page / documentRecord.pageCount,
        continuousZoom,
        bookZoom,
        lastOpenedAt: new Date().toISOString(),
      });
    }, 280);
    return () => window.clearTimeout(timer);
  }, [bookZoom, continuousZoom, documentId, documentRecord, modePages.book, modePages.continuous, page]);

  useEffect(() => {
    if (!pdf) return;
    const targetPage = modePages[mode];
    if (mode === "continuous") programmaticPageRef.current.continuous = targetPage;
    else delete programmaticPageRef.current.book;
    setModePages((current) => updateModePage(current, mode, targetPage));
    if (mode !== "continuous") return;
    const cleanup = scheduleContinuousPagePosition(() => {
      document.getElementById(`pdf-page-${targetPage}`)?.scrollIntoView({ behavior: "auto", block: "start" });
    });
    continuousPositionCleanupRef.current = cleanup;
    return () => {
      cleanup();
      if (continuousPositionCleanupRef.current === cleanup) {
        continuousPositionCleanupRef.current = undefined;
      }
    };
    // The saved target is intentionally captured only when the active mode changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, pdf]);

  const handleViewerPageChange = useCallback((viewerMode: ReaderMode, nextPage: number) => {
    if (viewerMode === "continuous" && zoomRestoringRef.current) return;
    const programmaticTarget = programmaticPageRef.current[viewerMode];
    if (!shouldAcceptViewerPageChange(
      activeModeRef.current,
      viewerMode,
      undefined,
      programmaticTarget,
      nextPage,
    )) return;
    if (programmaticTarget === nextPage) delete programmaticPageRef.current[viewerMode];
    setModePages((current) => updateModePage(current, viewerMode, nextPage));
  }, []);
  const handleContinuousPageChange = useCallback(
    (nextPage: number) => handleViewerPageChange("continuous", nextPage),
    [handleViewerPageChange],
  );
  const handleBookPageChange = useCallback(
    (nextPage: number) => handleViewerPageChange("book", nextPage),
    [handleViewerPageChange],
  );

  const zoom = mode === "continuous" ? continuousZoom : bookZoom;
  const setZoom = useCallback((nextZoom: number) => {
    const clamped = clampZoom(nextZoom);
    if (mode === "continuous") {
      if (clamped === continuousZoom) return;
      const area = canvasAreaRef.current;
      const pageNumber = readingPageRef.current;
      const pageElement = document.getElementById(`pdf-page-${pageNumber}`);
      if (area && pageElement) {
        const areaRect = area.getBoundingClientRect();
        const pageRect = pageElement.getBoundingClientRect();
        continuousZoomAnchorRef.current = {
          page: pageNumber,
          anchor: captureContinuousZoomAnchor(
            { top: pageRect.top, height: pageRect.height },
            { top: areaRect.top, height: areaRect.height },
          ),
        };
        zoomRestoringRef.current = true;
        programmaticPageRef.current.continuous = pageNumber;
      }
      setContinuousZoom(clamped);
      return;
    }
    if (clamped === bookZoom) return;
    setBookZoom(clamped);
  }, [bookZoom, continuousZoom, mode]);

  useEffect(() => {
    if (mode !== "continuous") return;
    const zoomAnchor = continuousZoomAnchorRef.current;
    const area = canvasAreaRef.current;
    if (!zoomAnchor || !area) return;
    let firstFrame: number | undefined;
    let secondFrame: number | undefined;
    let cancelled = false;
    const restore = () => {
      const pageElement = document.getElementById(`pdf-page-${zoomAnchor.page}`);
      if (!pageElement) return;
      const areaRect = area.getBoundingClientRect();
      const pageRect = pageElement.getBoundingClientRect();
      area.scrollTop = getContinuousZoomScrollTop({
        scrollTop: area.scrollTop,
        page: { top: pageRect.top, height: pageRect.height },
        viewport: { top: areaRect.top, height: areaRect.height },
        anchor: zoomAnchor.anchor,
      });
    };
    firstFrame = window.requestAnimationFrame(() => {
      restore();
      secondFrame = window.requestAnimationFrame(() => {
        if (cancelled) return;
        restore();
        if (continuousZoomAnchorRef.current === zoomAnchor) {
          continuousZoomAnchorRef.current = undefined;
          zoomRestoringRef.current = false;
          if (programmaticPageRef.current.continuous === zoomAnchor.page) {
            delete programmaticPageRef.current.continuous;
          }
        }
      });
    });
    return () => {
      cancelled = true;
      if (firstFrame !== undefined) window.cancelAnimationFrame(firstFrame);
      if (secondFrame !== undefined) window.cancelAnimationFrame(secondFrame);
    };
  }, [continuousRenderZoom, mode]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      if (!["+", "=", "-", "0"].includes(event.key)) return;
      event.preventDefault();
      if (event.key === "0") setZoom(1);
      else if (event.key === "-") setZoom(zoom - 0.1);
      else setZoom(zoom + 0.1);
    };
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom(zoom + (event.deltaY < 0 ? 0.1 : -0.1));
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("wheel", onWheel);
    };
  }, [setZoom, zoom]);

  const translationViews = useMemo<TranslationView[]>(() => {
    const payloads = new Map(translations.map((translation) => [translation.id, translation]));
    return translationMarks.flatMap((mark) => {
      const payload = payloads.get(mark.translationId);
      return payload ? [{ payload, mark }] : [];
    });
  }, [translationMarks, translations]);

  const navigateToPage = useCallback((nextPage: number) => {
    if (!documentRecord) return;
    const safePage = Math.min(documentRecord.pageCount, Math.max(1, Math.round(nextPage)));
    programmaticPageRef.current[mode] = safePage;
    setPage(safePage);
    if (mode === "continuous") {
      continuousPositionCleanupRef.current?.();
      continuousPositionCleanupRef.current = undefined;
      document.getElementById(`pdf-page-${safePage}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [documentRecord, mode]);

  const saveHighlight = useCallback(async (color: HighlightColor) => {
    if (!selection) return;
    const now = new Date().toISOString();
    const annotation: AnnotationRecord = {
      id: crypto.randomUUID(),
      documentId,
      kind: "highlight",
      color,
      anchor: selection.anchor,
      createdAt: now,
      updatedAt: now,
    };
    await getReaderDatabase().annotations.put(annotation);
    setAnnotations((current) => [...current, annotation]);
    setSelection(undefined);
    window.getSelection()?.removeAllRanges();
    setStatus("高亮已保存在本机");
  }, [documentId, selection]);

  const createTranslationMark = useCallback(async (
    payload: TranslationPayload,
    selected: TextSelectionSnapshot,
  ) => {
    const existing = translationMarks.find(
      (mark) => mark.translationId === payload.id && sameTextAnchorLocation(mark.anchor, selected.anchor),
    );
    if (existing) {
      focusTranslation(existing.id);
      return existing;
    }
    const now = new Date().toISOString();
    const mark: TranslationMark = {
      id: crypto.randomUUID(),
      documentId,
      translationId: payload.id,
      anchor: selected.anchor,
      createdAt: now,
      updatedAt: now,
    };
    await getReaderDatabase().translationMarks.put(mark);
    setTranslationMarks((current) => [...current, mark]);
    focusTranslation(mark.id);
    return mark;
  }, [documentId, focusTranslation, translationMarks]);

  const translateSelection = useCallback(async (
    selected: TextSelectionSnapshot,
    providedApiKey?: string,
    bypassCache = false,
    forcedProvider?: TranslationService,
  ) => {
    const deepSeekSessionKey = window.sessionStorage.getItem("modu-deepseek-key") || "";
    const googleSessionKey = window.sessionStorage.getItem("modu-google-translate-key") || "";
    const provider = forcedProvider ?? resolveTranslationProvider(
      translationProvider,
      selected.text,
      {
        deepseek: Boolean(deepSeekSessionKey),
        google: Boolean(googleSessionKey),
      },
    );
    const sessionKey = provider === "google"
      ? "modu-google-translate-key"
      : "modu-deepseek-key";
    const apiKey = providedApiKey || window.sessionStorage.getItem(sessionKey) || "";
    if (!apiKey) {
      pendingTranslationRef.current = { selection: selected, bypassCache, provider };
      setApiKeyProvider(provider);
      setApiKeyDraft("");
      setShowApiKey(true);
      return;
    }
    setTranslating(true);
    setStatus("");
    try {
      const cacheKey = await buildTranslationCacheKey(
        selected.text,
        targetLanguage,
        provider,
      );
      const database = getReaderDatabase();
      const cached = await database.translations.where("cacheKey").equals(cacheKey).first();
      if (!bypassCache) {
        if (cached) {
          recordLocalTranslationCacheHit();
          if (!translations.some((item) => item.id === cached.id)) setTranslations((current) => [...current, cached]);
          await createTranslationMark(cached, selected);
          setStatus("已复用本地翻译缓存，未调用翻译 API");
          setSelection(undefined);
          window.getSelection()?.removeAllRanges();
          return;
        }
      }

      const result = await translationRequestDeduper.run(`${provider}:${cacheKey}`, async () => {
        const response = await fetch("/api/translate", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [provider === "google" ? "x-google-translate-key" : "x-deepseek-key"]: apiKey,
          },
          body: JSON.stringify({
            text: selected.text,
            targetLanguage,
            provider,
          }),
        });
        const apiResult = await response.json() as TranslationApiResult;
        if (!response.ok || !apiResult.translation) throw new Error(apiResult.error || "翻译失败");
        recordRemoteTranslationUsage(provider, apiResult.usage);
        return { ...apiResult, translation: apiResult.translation };
      });
      const now = new Date().toISOString();
      const payload: TranslationPayload = {
        id: cached?.id || crypto.randomUUID(),
        cacheKey,
        originalText: selected.text,
        translatedText: result.translation,
        sourceLanguage: result.detectedLanguage || "auto",
        targetLanguage,
        model: provider === "google" ? "google-nmt" : "deepseek-v4-flash",
        createdAt: cached?.createdAt || now,
        updatedAt: now,
      };
      await database.translations.put(payload);
      setTranslations((current) => [...current.filter((item) => item.id !== payload.id), payload]);
      await createTranslationMark(payload, selected);
      setSelection(undefined);
      window.getSelection()?.removeAllRanges();
      setStatus("翻译已保存并以蓝色标记");
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "翻译失败");
    } finally {
      setTranslating(false);
    }
  }, [createTranslationMark, targetLanguage, translationProvider, translations]);

  const saveNote = useCallback(async (values: { title: string; body: string; url: string }) => {
    if (!noteDialog) return;
    const now = new Date().toISOString();
    const annotation: AnnotationRecord = noteDialog.editing
      ? { ...noteDialog.editing, ...values, updatedAt: now }
      : {
          id: crypto.randomUUID(),
          documentId,
          kind: "note",
          color: "yellow",
          title: values.title,
          body: values.body,
          url: values.url,
          anchor: noteDialog.anchor,
          createdAt: now,
          updatedAt: now,
        };
    await getReaderDatabase().annotations.put(annotation);
    setAnnotations((current) => {
      const without = current.filter((item) => item.id !== annotation.id);
      return [...without, annotation];
    });
    setNoteDialog(undefined);
    setSelection(undefined);
    focusAnnotation(annotation.id);
    window.getSelection()?.removeAllRanges();
  }, [documentId, focusAnnotation, noteDialog]);

  const deleteAnnotation = useCallback(async (annotationId: string) => {
    if (!window.confirm("删除这条注释或高亮？此操作无法撤销。")) return;
    await getReaderDatabase().annotations.delete(annotationId);
    setAnnotations((current) => current.filter((item) => item.id !== annotationId));
    if (selectedAnnotationId === annotationId) setSelectedAnnotationId(undefined);
  }, [selectedAnnotationId]);

  const addVocabulary = useCallback(async (translationId: string, markId: string) => {
    if (vocabulary.some((item) => item.translationId === translationId)) return;
    const payload = translations.find((item) => item.id === translationId);
    const mark = translationMarks.find((item) => item.id === markId);
    if (!payload || !mark) return;
    const now = new Date().toISOString();
    const entry: VocabularyEntry = {
      id: crypto.randomUUID(),
      documentId,
      translationId,
      originalText: payload.originalText,
      translatedText: payload.translatedText,
      context: `${mark.anchor.prefix}${mark.anchor.exact}${mark.anchor.suffix}`.trim(),
      sourceTitle: documentRecord?.title,
      page: mark.anchor.page,
      mastered: false,
      favorite: false,
      createdAt: now,
      updatedAt: now,
    };
    await getReaderDatabase().vocabulary.put(entry);
    setVocabulary((current) => [...current, entry]);
    setStatus("已加入词汇本");
  }, [documentId, documentRecord?.title, translationMarks, translations, vocabulary]);

  const exportRecords = useCallback(() => {
    if (!documentRecord) return;
    const bundle: ExportBundleV1 = createExportBundle({
      document: documentRecord,
      translations,
      translationMarks,
      annotations,
      vocabulary,
    });
    triggerDownload(
      `${safeFileName(documentRecord.title)}.updf-notes.json`,
      JSON.stringify(bundle, null, 2),
      "application/json;charset=utf-8",
    );
    setStatus("阅读记录已导出，文件不包含原 PDF 和 API Key");
  }, [annotations, documentRecord, translationMarks, translations, vocabulary]);

  const exportMarkdown = useCallback(() => {
    if (!documentRecord) return;
    const bundle = createExportBundle({
      document: documentRecord,
      translations,
      translationMarks,
      annotations,
      vocabulary,
    });
    triggerDownload(
      `${safeFileName(documentRecord.title)}-阅读笔记.md`,
      exportBundleToMarkdown(bundle),
      "text/markdown;charset=utf-8",
    );
    setStatus("Markdown 笔记已导出");
  }, [annotations, documentRecord, translationMarks, translations, vocabulary]);

  if (error) {
    return <main className="reader-error"><AlertCircle /><h1>无法打开文档</h1><p>{error}</p><a className="primary-button" href="/">返回资料库</a></main>;
  }

  if (!documentRecord || !pdf) {
    return <main className="reader-loading"><LoaderCircle /><strong>正在打开本地 PDF…</strong><span>文件不会上传</span></main>;
  }

  return (
    <div className={`reader-shell ${inspectorOpen ? "" : "is-inspector-closed"}`}>
      <ReaderToolbar
        title={documentRecord.title}
        page={page}
        pageCount={documentRecord.pageCount}
        mode={mode}
        zoom={zoom}
        leftPanelOpen={leftPanelOpen}
        inspectorOpen={inspectorOpen}
        focusMode={focusMode}
        onModeChange={(nextMode) => {
          activeModeRef.current = nextMode;
          setMode(nextMode);
          window.localStorage.setItem("modu-reader-mode", nextMode);
        }}
        onPageChange={navigateToPage}
        onZoomChange={setZoom}
        onFit={(kind) => {
          const area = canvasAreaRef.current?.getBoundingClientRect();
          if (!area) return setZoom(1);
          const widthScale = (area.width - 100) / 684;
          const pageScale = Math.min(widthScale, (area.height - 70) / 884);
          setZoom(kind === "width" ? widthScale : pageScale);
        }}
        onExport={exportRecords}
        onToggleLeftPanel={toggleLeftPanel}
        onToggleInspector={toggleInspector}
        onToggleFocusMode={toggleFocusMode}
      />

      {!documentRecord.hasTextLayer ? (
        <div className="ocr-banner"><AlertCircle />这份 PDF 可能是扫描件：首版暂不支持 OCR，仍可阅读、缩放和添加页面注释。</div>
      ) : null}
      {status ? <div className="reader-status" role="status"><span>{status}</span><button type="button" aria-label="关闭消息" onClick={() => setStatus("")}><X /></button></div> : null}

      <div className={`reader-workspace ${leftPanelOpen ? "" : "is-left-panel-closed"} ${inspectorOpen ? "" : "is-inspector-closed"}`}>
        {leftPanelOpen ? (
          <ReaderLeftPanel
            title={documentRecord.title}
            pageCount={documentRecord.pageCount}
            currentPage={page}
            outline={outline}
            onPageChange={navigateToPage}
          />
        ) : null}
        <main ref={canvasAreaRef} className={`reader-canvas-area mode-${mode}`}>
          {mode === "continuous" ? (
            <ContinuousViewer
              pdf={pdf}
              pageCount={documentRecord.pageCount}
              currentPage={page}
              zoom={continuousRenderZoom}
              translationMarks={translationMarks}
              annotations={annotations}
              pageSizes={pageSizes}
              onPageSize={handlePageSize}
              onPageChange={handleContinuousPageChange}
              onSelection={setSelection}
              onTranslationClick={focusTranslation}
              onAnnotationClick={focusAnnotation}
            />
          ) : (
            <BookViewer
              pdf={pdf}
              pageCount={documentRecord.pageCount}
              currentPage={page}
              zoom={bookRenderZoom}
              translationMarks={translationMarks}
              annotations={annotations}
              pageSizes={pageSizes}
              onPageSize={handlePageSize}
              onPageChange={handleBookPageChange}
              onSelection={setSelection}
              onTranslationClick={focusTranslation}
              onAnnotationClick={focusAnnotation}
            />
          )}
        </main>
        {inspectorOpen ? <InspectorPanel
          translations={translationViews}
          annotations={annotations}
          vocabularyTranslationIds={new Set(vocabulary.map((item) => item.translationId))}
          selectedTranslationMarkId={translationFocus?.markId}
          translationFocusRequest={translationFocus?.request}
          selectedAnnotationId={selectedAnnotationId}
          onAddVocabulary={addVocabulary}
          onRetranslate={(payload, mark) => {
            const selected: TextSelectionSnapshot = {
              page: mark.anchor.page,
              text: payload.originalText,
              context: `${mark.anchor.prefix}${mark.anchor.exact}${mark.anchor.suffix}`.trim(),
              anchor: mark.anchor,
              viewportX: Math.max(12, window.innerWidth - 380),
              viewportY: 92,
            };
            void translateSelection(selected, undefined, true);
          }}
          onDeleteAnnotation={deleteAnnotation}
          onEditAnnotation={(annotation) => setNoteDialog({ anchor: annotation.anchor, editing: annotation })}
          onAddPageNote={() => setNoteDialog({
            anchor: { page, exact: "", prefix: "", suffix: "", rotation: 0, rects: [] },
          })}
          onExportMarkdown={exportMarkdown}
        /> : null}
      </div>

      {selection ? (
        <SelectionToolbar
          x={selection.viewportX}
          y={selection.viewportY}
          translating={translating}
          onTranslate={() => void translateSelection(selection)}
          onHighlight={(color) => void saveHighlight(color)}
          onNote={() => setNoteDialog({ anchor: selection.anchor })}
          onCopy={() => {
            void navigator.clipboard.writeText(selection.text);
            setStatus("已复制选中内容");
          }}
          onClose={() => setSelection(undefined)}
        />
      ) : null}

      {noteDialog ? (
        <NoteDialog
          page={noteDialog.anchor.page}
          selectedText={noteDialog.anchor.exact}
          initialValues={noteDialog.editing ? {
            title: noteDialog.editing.title || "",
            body: noteDialog.editing.body || "",
            url: noteDialog.editing.url || "",
          } : undefined}
          onSave={(values) => void saveNote(values)}
          onCancel={() => setNoteDialog(undefined)}
        />
      ) : null}

      {showApiKey ? (
        <div className="dialog-backdrop" role="presentation">
          <section className="api-key-dialog" role="dialog" aria-modal="true" aria-labelledby="api-key-title">
            <KeyRound />
            <h2 id="api-key-title">连接 {apiKeyProvider === "google" ? "Google Cloud Translation" : "DeepSeek"}</h2>
            <p>密钥只保存在当前浏览器会话中，不写入阅读记录或导出文件。</p>
            <label><span>{apiKeyProvider === "google" ? "Google Cloud Translation API Key" : "DeepSeek API Key"}</span><input autoFocus type="password" value={apiKeyDraft} placeholder={apiKeyProvider === "google" ? "AIza…" : "sk-…"} onChange={(event) => setApiKeyDraft(event.target.value)} /></label>
            <div>
              <button className="secondary-button" type="button" onClick={() => setShowApiKey(false)}>取消</button>
              <button className="primary-button" type="button" disabled={!apiKeyDraft.trim()} onClick={() => {
                const key = apiKeyDraft.trim();
                window.sessionStorage.setItem(
                  apiKeyProvider === "google"
                    ? "modu-google-translate-key"
                    : "modu-deepseek-key",
                  key,
                );
                setShowApiKey(false);
                const pending = pendingTranslationRef.current;
                pendingTranslationRef.current = undefined;
                if (pending) void translateSelection(pending.selection, key, pending.bypassCache, pending.provider);
              }}>保存并翻译</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
