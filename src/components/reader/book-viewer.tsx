"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";
import { ChevronLeft, ChevronRight, Keyboard } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PdfPage } from "@/components/reader/pdf-page";
import type {
  AnnotationRecord,
  PdfPageSize,
  PdfPageSizeMap,
  TextSelectionSnapshot,
  TranslationMark,
} from "@/lib/types";

interface BookViewerProps {
  pdf: PDFDocumentProxy;
  pageCount: number;
  currentPage: number;
  zoom: number;
  translationMarks: TranslationMark[];
  annotations: AnnotationRecord[];
  pageSizes?: PdfPageSizeMap;
  onPageSize?: (page: number, size: PdfPageSize) => void;
  onPageChange: (page: number) => void;
  onSelection: (selection: TextSelectionSnapshot) => void;
  onTranslationClick: (markId: string) => void;
  onAnnotationClick: (annotationId: string) => void;
}

const EMPTY_TRANSLATION_MARKS: TranslationMark[] = [];
const EMPTY_ANNOTATIONS: AnnotationRecord[] = [];

function indexByPage<T extends { anchor: { page: number } }>(records: T[]) {
  const index = new Map<number, T[]>();
  for (const record of records) {
    const pageRecords = index.get(record.anchor.page);
    if (pageRecords) pageRecords.push(record);
    else index.set(record.anchor.page, [record]);
  }
  return index;
}

export const BookViewer = memo(function BookViewer({
  pdf,
  pageCount,
  currentPage,
  zoom,
  translationMarks,
  annotations,
  pageSizes,
  onPageSize,
  onPageChange,
  onSelection,
  onTranslationClick,
  onAnnotationClick,
}: BookViewerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const flipRef = useRef<import("page-flip").PageFlip | undefined>(undefined);
  const fallbackTimerRef = useRef<number | undefined>(undefined);
  const [turnDirection, setTurnDirection] = useState<"next" | "previous">();
  const [bookBounds, setBookBounds] = useState({ width: 580, height: 780 });
  const pages = useMemo(
    () => Array.from({ length: pageCount }, (_, index) => index + 1),
    [pageCount],
  );
  const marksByPage = useMemo(() => indexByPage(translationMarks), [translationMarks]);
  const annotationsByPage = useMemo(() => indexByPage(annotations), [annotations]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const updateBounds = (width: number, height: number) => {
      if (width <= 0 || height <= 0) return;
      const isSinglePage = width < 680;
      const next = {
        width: Number(Math.min(580, isSinglePage ? width : width / 2).toFixed(1)),
        height: Number(Math.min(780, height).toFixed(1)),
      };
      setBookBounds((current) => current.width === next.width && current.height === next.height ? current : next);
    };
    const initial = root.getBoundingClientRect();
    updateBounds(initial.width, initial.height);
    const observer = new ResizeObserver(([entry]) => updateBounds(entry.contentRect.width, entry.contentRect.height));
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let disposed = false;
    void import("page-flip").then(({ PageFlip }) => {
      if (disposed) return;
      const pageFlip = new PageFlip(root, {
        width: 580,
        height: 780,
        size: "stretch",
        minWidth: 300,
        maxWidth: 580,
        minHeight: 404,
        maxHeight: 780,
        maxShadowOpacity: 0.32,
        showCover: true,
        usePortrait: true,
        mobileScrollSupport: true,
        clickEventForward: true,
        disableFlipByClick: true,
        flippingTime: 720,
        startPage: Math.max(0, currentPage - 1),
      });
      pageFlip.loadFromHTML(root.querySelectorAll<HTMLElement>(".book-page-item"));
      pageFlip.on("flip", (event) => {
        if (fallbackTimerRef.current !== undefined) window.clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = undefined;
        setTurnDirection(undefined);
        onPageChange(event.data + 1);
      });
      flipRef.current = pageFlip;
    });
    return () => {
      disposed = true;
      if (fallbackTimerRef.current !== undefined) window.clearTimeout(fallbackTimerRef.current);
      flipRef.current?.destroy();
      flipRef.current = undefined;
    };
  }, [pageCount]);

  useEffect(() => {
    flipRef.current?.turnToPage(currentPage - 1);
  }, [currentPage]);

  const animatePageTurn = useCallback((direction: "next" | "previous") => {
    const pageFlip = flipRef.current;
    if (!pageFlip) return;
    const currentIndex = pageFlip.getCurrentPageIndex();
    if (direction === "next" && currentIndex >= pageFlip.getPageCount() - 1) return;
    if (direction === "previous" && currentIndex <= 0) return;
    setTurnDirection(direction);
    const settings = pageFlip.getSettings();
    const disableFlipByClick = settings.disableFlipByClick;
    settings.disableFlipByClick = false;
    if (direction === "next") pageFlip.flipNext("top");
    else pageFlip.flipPrev("top");
    settings.disableFlipByClick = disableFlipByClick;
    if (fallbackTimerRef.current !== undefined) window.clearTimeout(fallbackTimerRef.current);
    fallbackTimerRef.current = window.setTimeout(() => {
      if (pageFlip.getCurrentPageIndex() === currentIndex) {
        const targetIndex = direction === "next"
          ? Math.min(pageFlip.getPageCount() - 1, currentIndex === 0 ? 1 : currentIndex + 2)
          : Math.max(0, currentIndex <= 2 ? 0 : currentIndex - 2);
        pageFlip.turnToPage(targetIndex);
      }
      setTurnDirection(undefined);
      fallbackTimerRef.current = undefined;
    }, 780);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === "ArrowRight") animatePageTurn("next");
      if (event.key === "ArrowLeft") animatePageTurn("previous");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [animatePageTurn]);

  return (
    <div className={`book-viewer${turnDirection ? ` is-turning-${turnDirection}` : ""}`} aria-label="图书阅读区">
      <button className="book-edge book-edge-left" type="button" aria-label="向前翻页" disabled={currentPage <= 1} onClick={() => animatePageTurn("previous")}>
        <ChevronLeft />
      </button>
      <div ref={rootRef} className="book-flip-root">
        {pages.map((page) => (
          <div className="book-page-item" key={page} data-density={page === 1 ? "hard" : "soft"}>
            <PdfPage
              pdf={pdf}
              pageNumber={page}
              zoom={zoom}
              mode="book"
              shouldRender={Math.abs(page - currentPage) <= 4}
              shouldRenderText={Math.abs(page - currentPage) <= 1}
              bookBounds={bookBounds}
              renderPriority={Math.abs(page - currentPage) <= 4 ? Math.abs(page - currentPage) : 99}
              pageSize={pageSizes?.[page]}
              onPageSize={onPageSize}
              translationMarks={marksByPage.get(page) ?? EMPTY_TRANSLATION_MARKS}
              annotations={annotationsByPage.get(page) ?? EMPTY_ANNOTATIONS}
              onSelection={onSelection}
              onTranslationClick={onTranslationClick}
              onAnnotationClick={onAnnotationClick}
            />
          </div>
        ))}
      </div>
      <button className="book-edge book-edge-right" type="button" aria-label="向后翻页" disabled={currentPage >= pageCount} onClick={() => animatePageTurn("next")}>
        <ChevronRight />
      </button>
      <div className="book-hint"><Keyboard />点击页面边缘或使用方向键翻页</div>
    </div>
  );
});
