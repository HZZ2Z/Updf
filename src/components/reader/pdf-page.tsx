"use client";

import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import { MessageSquareText } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";

import {
  anchorRectToStyle,
  fitPageIntoBounds,
  getContinuousPageScale,
} from "@/lib/reader-core";
import {
  getAdaptiveCanvasScale,
  getCachedPdfTextContent,
  pdfRenderQueue,
  pdfTextQueue,
  type QueuedTask,
} from "@/lib/pdf-performance";
import type {
  AnnotationRecord,
  PdfPageSize,
  ReaderMode,
  TextSelectionSnapshot,
  TranslationMark,
} from "@/lib/types";

interface PdfPageProps {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  zoom: number;
  mode: ReaderMode;
  translationMarks: TranslationMark[];
  annotations: AnnotationRecord[];
  shouldRender?: boolean;
  shouldRenderText?: boolean;
  continuousBounds?: { width: number; compact: boolean };
  bookBounds?: { width: number; height: number };
  renderPriority?: number;
  pageSize?: PdfPageSize;
  onPageSize?: (page: number, size: PdfPageSize) => void;
  onSelection: (selection: TextSelectionSnapshot) => void;
  onTranslationClick: (markId: string) => void;
  onAnnotationClick: (annotationId: string) => void;
  onVisible?: (page: number) => void;
}

function selectionRects(range: Range, surface: HTMLElement) {
  const surfaceRect = surface.getBoundingClientRect();
  return Array.from(range.getClientRects())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map((rect) => ({
      x: Math.max(0, (rect.left - surfaceRect.left) / surfaceRect.width),
      y: Math.max(0, (rect.top - surfaceRect.top) / surfaceRect.height),
      width: Math.min(1, rect.width / surfaceRect.width),
      height: Math.min(1, rect.height / surfaceRect.height),
    }));
}

function getInitialPageDisplaySize({
  pageSize,
  mode,
  continuousBounds,
  bookBounds,
  zoom,
}: Pick<PdfPageProps, "pageSize" | "mode" | "continuousBounds" | "bookBounds" | "zoom">) {
  const resolvedPageSize = pageSize || { width: 595, height: 842 };
  if (mode === "book") {
    return fitPageIntoBounds(
      resolvedPageSize,
      bookBounds || { width: 540, height: 740 },
      zoom,
    );
  }
  const scale = getContinuousPageScale(
    resolvedPageSize.width,
    continuousBounds?.width ?? 804,
    zoom,
    continuousBounds?.compact ?? false,
  );
  return {
    width: Number((resolvedPageSize.width * scale).toFixed(1)),
    height: Number((resolvedPageSize.height * scale).toFixed(1)),
  };
}

export const PdfPage = memo(function PdfPage({
  pdf,
  pageNumber,
  zoom,
  mode,
  translationMarks,
  annotations,
  shouldRender,
  shouldRenderText = true,
  continuousBounds,
  bookBounds,
  renderPriority = 0,
  pageSize,
  onPageSize,
  onSelection,
  onTranslationClick,
  onAnnotationClick,
  onVisible,
}: PdfPageProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastDisplayedCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const renderKeyRef = useRef<object>({});
  const queuedTaskRef = useRef<QueuedTask<void> | undefined>(undefined);
  const renderPriorityRef = useRef(renderPriority);
  const isNearViewportRef = useRef(false);
  const pageProxyRef = useRef<PDFPageProxy | undefined>(undefined);
  const committedViewportRef = useRef<ReturnType<PDFPageProxy["getViewport"]> | undefined>(undefined);
  const textViewportRef = useRef<ReturnType<PDFPageProxy["getViewport"]> | undefined>(undefined);
  const pageSizeRef = useRef(pageSize);
  const onPageSizeRef = useRef(onPageSize);
  renderPriorityRef.current = renderPriority;
  pageSizeRef.current = pageSize;
  onPageSizeRef.current = onPageSize;
  const [isObservedNearViewport, setIsObservedNearViewport] = useState(false);
  const isNearViewport = shouldRender ?? isObservedNearViewport;
  isNearViewportRef.current = isNearViewport;
  const [size, setSize] = useState(() => getInitialPageDisplaySize({
    pageSize,
    mode,
    continuousBounds,
    bookBounds,
    zoom,
  }));
  const [measuredPageSize, setMeasuredPageSize] = useState<PdfPageSize>();
  const [canvasRevision, setCanvasRevision] = useState(0);
  const [pageText, setPageText] = useState("");

  useEffect(() => {
    const next = getInitialPageDisplaySize({
      pageSize: pageSize || measuredPageSize,
      mode,
      continuousBounds,
      bookBounds,
      zoom,
    });
    setSize((current) =>
      current.width === next.width && current.height === next.height ? current : next,
    );
  }, [bookBounds, continuousBounds, measuredPageSize, mode, pageSize, zoom]);

  useEffect(() => {
    if (shouldRender !== undefined) return;
    const element = shellRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setIsObservedNearViewport(true);
      return;
    }
    const scrollRoot = element.closest(".reader-canvas-area");
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsObservedNearViewport(entry.isIntersecting);
      },
      { root: scrollRoot, rootMargin: "900px 0px", threshold: 0 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [shouldRender]);

  useEffect(() => {
    const element = shellRef.current;
    if (!element || !onVisible || typeof IntersectionObserver === "undefined") return;
    const scrollRoot = element.closest(".reader-canvas-area");
    const observer = new IntersectionObserver(
      ([entry]) => {
        const rootBounds = entry.rootBounds;
        if (!rootBounds || !entry.isIntersecting) return;
        const readingLine = rootBounds.top + rootBounds.height * 0.42;
        if (entry.boundingClientRect.top <= readingLine && entry.boundingClientRect.bottom >= readingLine) {
          onVisible(pageNumber);
        }
      },
      {
        root: scrollRoot,
        rootMargin: "0px",
        threshold: Array.from({ length: 11 }, (_, index) => index / 10),
      },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [onVisible, pageNumber]);

  useEffect(() => {
    const displayedCanvas = canvasRef.current;
    if (displayedCanvas) {
      displayedCanvas.style.width = `${size.width}px`;
      displayedCanvas.style.height = `${size.height}px`;
    }
    const textContainer = textLayerRef.current;
    const textViewport = textViewportRef.current;
    if (!textContainer || !textViewport) return;
    const scaleX = size.width / textViewport.width;
    const scaleY = size.height / textViewport.height;
    textContainer.style.width = `${textViewport.width}px`;
    textContainer.style.height = `${textViewport.height}px`;
    textContainer.style.transform = Math.abs(scaleX - 1) < 0.0001 && Math.abs(scaleY - 1) < 0.0001
      ? ""
      : Math.abs(scaleX - scaleY) < 0.0001
        ? `scale(${Number(scaleX.toFixed(5))})`
        : `scale(${Number(scaleX.toFixed(5))}, ${Number(scaleY.toFixed(5))})`;
  }, [canvasRevision, isNearViewport, size]);

  useEffect(() => {
    queuedTaskRef.current?.updatePriority(renderPriority);
  }, [renderPriority]);

  useEffect(() => {
    if (!isNearViewport) {
      const displayedCanvas = lastDisplayedCanvasRef.current;
      if (displayedCanvas) {
        displayedCanvas.width = 0;
        displayedCanvas.height = 0;
        lastDisplayedCanvasRef.current = null;
      }
      pageProxyRef.current?.cleanup?.();
      return;
    }
    let renderTask: RenderTask | undefined;
    let renderCanvas: HTMLCanvasElement | undefined;
    let cancelled = false;

    const queuedTask = pdfRenderQueue.enqueue(renderPriorityRef.current, async () => {
      const page = await pdf.getPage(pageNumber);
      pageProxyRef.current = page;
      if (cancelled) return;
      const baseViewport = page.getViewport({ scale: 1 });
      const measuredSize = { width: baseViewport.width, height: baseViewport.height };
      setMeasuredPageSize((current) => {
        return current?.width === measuredSize.width && current.height === measuredSize.height
          ? current
          : measuredSize;
      });
      const knownPageSize = pageSizeRef.current;
      if (!knownPageSize || knownPageSize.width !== measuredSize.width || knownPageSize.height !== measuredSize.height) {
        onPageSizeRef.current?.(pageNumber, measuredSize);
      }
      const pageScale = mode === "book"
        ? fitPageIntoBounds(
            { width: baseViewport.width, height: baseViewport.height },
            bookBounds || { width: 540, height: 740 },
            zoom,
          ).width / baseViewport.width
        : getContinuousPageScale(
            baseViewport.width,
            continuousBounds?.width ?? 804,
            zoom,
            continuousBounds?.compact ?? false,
          );
      const viewport = page.getViewport({ scale: pageScale });
      setSize({ width: viewport.width, height: viewport.height });
      const displayedCanvas = canvasRef.current;
      if (!displayedCanvas) return;
      displayedCanvas.style.width = `${viewport.width}px`;
      displayedCanvas.style.height = `${viewport.height}px`;

      const outputScale = getAdaptiveCanvasScale(
        viewport.width,
        viewport.height,
        window.devicePixelRatio || 1,
      );
      renderCanvas = document.createElement("canvas");
      renderCanvas.width = Math.floor(viewport.width * outputScale);
      renderCanvas.height = Math.floor(viewport.height * outputScale);
      const context = renderCanvas.getContext("2d");
      if (!context) return;

      renderTask = page.render({
        canvas: renderCanvas,
        canvasContext: context,
        viewport,
        transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
      });
      renderTask.onContinue = (continueRendering: () => void) => {
        if (cancelled) return;
        if (typeof window.requestAnimationFrame === "function") {
          window.requestAnimationFrame(() => {
            if (!cancelled) continueRendering();
          });
          return;
        }
        queueMicrotask(() => {
          if (!cancelled) continueRendering();
        });
      };
      let painted = false;
      try {
        await renderTask.promise;
        painted = true;
      } catch (error) {
        if (!cancelled && !(error instanceof Error && ["AbortException", "RenderingCancelledException"].includes(error.name))) {
          throw error;
        }
      }
      if (!painted || cancelled || !renderCanvas) {
        if (renderCanvas) {
          renderCanvas.width = 0;
          renderCanvas.height = 0;
        }
        return;
      }
      const currentCanvas = canvasRef.current;
      const currentContext = currentCanvas?.getContext("2d");
      if (!currentCanvas || !currentContext) return;
      currentCanvas.width = renderCanvas.width;
      currentCanvas.height = renderCanvas.height;
      currentCanvas.style.width = `${viewport.width}px`;
      currentCanvas.style.height = `${viewport.height}px`;
      currentContext.drawImage(renderCanvas, 0, 0);
      lastDisplayedCanvasRef.current = currentCanvas;
      committedViewportRef.current = viewport;
      setCanvasRevision((revision) => revision + 1);
      renderCanvas.width = 0;
      renderCanvas.height = 0;
    }, renderKeyRef.current);
    queuedTaskRef.current = queuedTask;
    const releaseIfInactive = () => {
      if (!isNearViewportRef.current) pageProxyRef.current?.cleanup?.();
    };
    void queuedTask.promise.then(releaseIfInactive, (error: unknown) => {
      if (!cancelled && !(error instanceof Error && error.name === "RenderingCancelledException")) {
        console.error(`Failed to render PDF page ${pageNumber}`, error);
      }
      releaseIfInactive();
    });

    return () => {
      cancelled = true;
      if (queuedTaskRef.current === queuedTask) queuedTaskRef.current = undefined;
      queuedTask.cancel();
      renderTask?.cancel();
    };
  }, [bookBounds, continuousBounds, isNearViewport, mode, pageNumber, pdf, zoom]);

  useEffect(() => {
    const textContainer = textLayerRef.current;
    if (!isNearViewport || !shouldRenderText) {
      setPageText("");
      textContainer?.replaceChildren();
      if (textContainer) textContainer.style.transform = "";
      textViewportRef.current = undefined;
      return;
    }
    const viewport = committedViewportRef.current;
    if (!textContainer || !viewport || canvasRevision === 0) return;
    let cancelled = false;
    let textLayer: { cancel: () => void } | undefined;
    const renderTextLayer = async () => {
      let page = pageProxyRef.current;
      try {
        page ??= await pdf.getPage(pageNumber);
        pageProxyRef.current = page;
        const resolvedPage = page;
        const textContent = await getCachedPdfTextContent(
          pdf,
          pageNumber,
          () => resolvedPage.getTextContent(),
        );
        if (cancelled) return;
        setPageText(
          textContent.items
            .map((item) => ("str" in item ? item.str : ""))
            .join(" ")
            .replace(/\s+/g, " "),
        );
        const nextTextContainer = document.createElement("div");
        if (textContent.items.length > 0) {
          const pdfjs = await import("pdfjs-dist");
          if (cancelled) return;
          const layer = new pdfjs.TextLayer({
            textContentSource: textContent,
            container: nextTextContainer,
            viewport,
          });
          textLayer = layer;
          await layer.render();
        }
        if (cancelled) return;
        const currentTextContainer = textLayerRef.current;
        if (!currentTextContainer) return;
        currentTextContainer.style.setProperty("--total-scale-factor", String(viewport.scale));
        currentTextContainer.style.width = `${viewport.width}px`;
        currentTextContainer.style.height = `${viewport.height}px`;
        currentTextContainer.style.transform = "";
        currentTextContainer.replaceChildren(...Array.from(nextTextContainer.childNodes));
        textViewportRef.current = viewport;
      } catch (error) {
        if (!cancelled && !(error instanceof Error && ["AbortException", "RenderingCancelledException"].includes(error.name))) {
          console.warn(`Failed to render PDF text layer ${pageNumber}`, error);
        }
      } finally {
        if (!isNearViewportRef.current) page?.cleanup?.();
      }
    };
    const queuedTextTask = pdfTextQueue.enqueue(0, renderTextLayer);
    void queuedTextTask.promise.catch((error: unknown) => {
      if (!cancelled) console.warn(`Failed to schedule PDF text layer ${pageNumber}`, error);
    });
    return () => {
      cancelled = true;
      queuedTextTask.cancel();
      textLayer?.cancel();
    };
  }, [canvasRevision, isNearViewport, pageNumber, pdf, shouldRenderText]);

  useEffect(() => () => {
    const displayedCanvas = lastDisplayedCanvasRef.current;
    if (displayedCanvas) {
      displayedCanvas.width = 0;
      displayedCanvas.height = 0;
      lastDisplayedCanvasRef.current = null;
    }
  }, []);

  const handleMouseUp = () => {
    const selection = window.getSelection();
    const surface = surfaceRef.current;
    if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !surface) return;
    const range = selection.getRangeAt(0);
    if (!surface.contains(range.commonAncestorContainer)) return;
    const text = selection.toString().trim();
    const rects = selectionRects(range, surface);
    if (!text || rects.length === 0) return;
    const index = pageText.toLocaleLowerCase().indexOf(text.toLocaleLowerCase());
    const prefix = index >= 0 ? pageText.slice(Math.max(0, index - 60), index) : "";
    const suffix = index >= 0 ? pageText.slice(index + text.length, index + text.length + 60) : "";
    const lastRect = range.getBoundingClientRect();
    onSelection({
      page: pageNumber,
      text,
      context: `${prefix}${text}${suffix}`.trim(),
      anchor: { page: pageNumber, exact: text, prefix, suffix, rotation: 0, rects },
      viewportX: Math.min(window.innerWidth - 260, Math.max(12, lastRect.left + lastRect.width / 2)),
      viewportY: Math.max(64, lastRect.top - 10),
    });
  };

  return (
    <div
      ref={shellRef}
      className={`pdf-page-shell ${mode === "book" ? "is-book-page" : ""}`}
      id={`pdf-page-${pageNumber}`}
      data-page={pageNumber}
      style={{ width: size.width, minHeight: size.height }}
    >
      {isNearViewport ? (
        <div
          ref={surfaceRef}
          className="pdf-page-surface"
          style={{ width: size.width, height: size.height }}
          onMouseUp={handleMouseUp}
        >
          <canvas ref={canvasRef} />
          <div ref={textLayerRef} className="textLayer" />
          <div className="reader-mark-layer" aria-label={`第 ${pageNumber} 页阅读标记`}>
            {translationMarks.flatMap((mark) =>
              mark.anchor.rects.map((rect, index) => (
                <button
                  className="reader-mark translation-mark"
                  type="button"
                  aria-label={`查看翻译：${mark.anchor.exact}`}
                  key={`${mark.id}-${index}`}
                  style={anchorRectToStyle(rect)}
                  onClick={(event) => {
                    event.stopPropagation();
                    onTranslationClick(mark.id);
                  }}
                />
              )),
            )}
            {annotations.flatMap((annotation) =>
              annotation.anchor.rects.length > 0
                ? annotation.anchor.rects.map((rect, index) => (
                    <button
                      className={`reader-mark annotation-mark is-${annotation.color}`}
                      type="button"
                      aria-label={annotation.title ? `查看注释：${annotation.title}` : "查看高亮"}
                      key={`${annotation.id}-${index}`}
                      style={anchorRectToStyle(rect)}
                      onClick={(event) => {
                        event.stopPropagation();
                        onAnnotationClick(annotation.id);
                      }}
                    />
                  ))
                : [
                    <button
                      className="page-note-pin"
                      type="button"
                      aria-label={`查看注释：${annotation.title || `第 ${pageNumber} 页注释`}`}
                      key={annotation.id}
                      onClick={() => onAnnotationClick(annotation.id)}
                    ><MessageSquareText /></button>,
                  ],
            )}
          </div>
          <span className="pdf-page-number">{pageNumber}</span>
        </div>
      ) : (
        <div className="pdf-page-placeholder"><span>第 {pageNumber} 页</span></div>
      )}
    </div>
  );
});
