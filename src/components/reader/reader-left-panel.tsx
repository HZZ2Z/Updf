"use client";

import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { FileText } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";

import { pdfRenderQueue, pdfThumbnailQueue } from "@/lib/pdf-performance";

interface ReaderLeftPanelProps {
  pdf: PDFDocumentProxy;
  pageCount: number;
  currentPage: number;
  onPageChange: (page: number) => void;
}

const THUMBNAIL_WIDTH = 112;
const MAX_RENDERED_THUMBNAILS = 40;

function addRenderedPages(current: Set<number>, additions: number[], keepPage: number) {
  if (additions.every((page) => current.has(page))) return current;
  const next = new Set(current);
  additions.forEach((page) => next.add(page));
  while (next.size > MAX_RENDERED_THUMBNAILS) {
    const removable = Array.from(next).find(
      (page) => page !== keepPage && !additions.includes(page),
    );
    if (removable === undefined) break;
    next.delete(removable);
  }
  return next;
}

const PdfThumbnail = memo(function PdfThumbnail({
  pdf,
  pageNumber,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let renderTask: RenderTask | undefined;

    setStatus("loading");
    const queuedTask = pdfThumbnailQueue.enqueue(0, async () => {
      // Let visible reading pages finish first. Thumbnail work has its own
      // single-slot queue and therefore cannot displace the document canvas.
      await pdfRenderQueue.whenIdle();
      if (cancelled) return;
      const page = await pdf.getPage(pageNumber);
      if (cancelled) return;
      const baseViewport = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: THUMBNAIL_WIDTH / baseViewport.width });
      const outputScale = Math.min(1.5, Math.max(1, window.devicePixelRatio || 1));
      const context = canvas.getContext("2d");
      if (!context) {
        setStatus("error");
        return;
      }
      canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
      canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
      canvas.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
      renderTask = page.render({
        canvas,
        canvasContext: context,
        viewport,
        transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
      });
      renderTask.onContinue = (continueRendering: () => void) => {
        window.requestAnimationFrame(() => {
          if (!cancelled) continueRendering();
        });
      };
      await renderTask.promise;
      if (!cancelled) setStatus("ready");
    });

    void queuedTask.promise.catch((error: unknown) => {
      if (cancelled || (error instanceof Error && ["AbortException", "RenderingCancelledException"].includes(error.name))) return;
      setStatus("error");
      console.warn(`Failed to render PDF thumbnail ${pageNumber}`, error);
    });

    return () => {
      cancelled = true;
      queuedTask.cancel();
      renderTask?.cancel();
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [pageNumber, pdf]);

  return (
    <span className={`thumbnail-surface is-${status}`}>
      <canvas ref={canvasRef} aria-hidden="true" />
      {status === "ready" ? null : <FileText aria-hidden="true" />}
    </span>
  );
});

export function ReaderLeftPanel({
  pdf,
  pageCount,
  currentPage,
  onPageChange,
}: ReaderLeftPanelProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const currentPageRef = useRef(currentPage);
  currentPageRef.current = currentPage;
  const pages = useMemo(
    () => Array.from({ length: pageCount }, (_, index) => index + 1),
    [pageCount],
  );
  const [renderedPages, setRenderedPages] = useState<Set<number>>(() => new Set([currentPage]));

  useEffect(() => {
    setRenderedPages((current) => addRenderedPages(current, [currentPage], currentPage));
    const active = gridRef.current?.querySelector<HTMLElement>(`[data-thumbnail-page="${currentPage}"]`);
    active?.scrollIntoView?.({ block: "nearest" });
  }, [currentPage]);

  useEffect(() => {
    const root = gridRef.current;
    if (!root) return;
    const buttons = Array.from(root.querySelectorAll<HTMLElement>("[data-thumbnail-page]"));
    if (typeof IntersectionObserver === "undefined") {
      const initialPages = pages.slice(0, Math.min(pageCount, 6));
      setRenderedPages((current) => addRenderedPages(current, initialPages, currentPageRef.current));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      const visiblePages = entries.flatMap((entry) => {
        if (!entry.isIntersecting) return [];
        const page = Number((entry.target as HTMLElement).dataset.thumbnailPage);
        return Number.isFinite(page) ? [page] : [];
      });
      if (visiblePages.length === 0) return;
      setRenderedPages((current) => addRenderedPages(
        current,
        visiblePages,
        currentPageRef.current,
      ));
    }, { root, rootMargin: "360px 0px", threshold: 0 });
    buttons.forEach((button) => observer.observe(button));
    return () => observer.disconnect();
  }, [pageCount, pages]);

  return (
    <aside className="reader-left-panel" aria-label="文档导航">
      <div className="left-panel-heading">
        <FileText aria-hidden="true" />
        <strong>缩略图</strong>
      </div>
      <div ref={gridRef} className="thumbnail-grid">
        {pages.map((page) => (
          <button
            className={page === currentPage ? "is-active" : ""}
            type="button"
            key={page}
            aria-label={`第 ${page} 页`}
            data-thumbnail-page={page}
            onClick={() => onPageChange(page)}
          >
            {renderedPages.has(page) ? <PdfThumbnail pdf={pdf} pageNumber={page} /> : <span className="thumbnail-surface is-loading"><FileText aria-hidden="true" /></span>}
            <i>{page}</i>
          </button>
        ))}
      </div>
    </aside>
  );
}
