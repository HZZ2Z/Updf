"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";
import { memo, useEffect, useMemo, useRef, useState } from "react";

import { PdfPage } from "@/components/reader/pdf-page";
import {
  buildContinuousRenderPlan,
  type ContinuousRenderPlan,
  type ContinuousScrollDirection,
} from "@/lib/reader-core";
import type {
  AnnotationRecord,
  PdfPageSize,
  PdfPageSizeMap,
  TextSelectionSnapshot,
  TranslationMark,
} from "@/lib/types";

const EMPTY_TRANSLATION_MARKS: TranslationMark[] = [];
const EMPTY_ANNOTATIONS: AnnotationRecord[] = [];

function sameRenderPlan(left: ContinuousRenderPlan, right: ContinuousRenderPlan) {
  return left.currentPage === right.currentPage
    && left.pages.length === right.pages.length
    && left.pages.every((page, index) => {
      const candidate = right.pages[index];
      return candidate?.page === page.page && candidate.priority === page.priority;
    });
}

function indexByPage<T extends { anchor: { page: number } }>(records: T[]) {
  const index = new Map<number, T[]>();
  for (const record of records) {
    const pageRecords = index.get(record.anchor.page);
    if (pageRecords) pageRecords.push(record);
    else index.set(record.anchor.page, [record]);
  }
  return index;
}

function visiblePageRects(
  elements: HTMLElement[],
  viewport: { top: number; left: number; width: number; height: number },
) {
  if (elements.length === 0 || viewport.width <= 0 || viewport.height <= 0) return [];
  const viewportBottom = viewport.top + viewport.height;
  const rectCache = new Map<number, DOMRect>();
  const rectAt = (index: number) => {
    let rect = rectCache.get(index);
    if (!rect) {
      rect = elements[index]!.getBoundingClientRect();
      rectCache.set(index, rect);
    }
    return rect;
  };

  let low = 0;
  let high = elements.length - 1;
  let firstVisible = elements.length;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (rectAt(middle).bottom > viewport.top) {
      firstVisible = middle;
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }

  const pages = [];
  for (let index = firstVisible; index < elements.length; index += 1) {
    const element = elements[index]!;
    const rect = rectAt(index);
    if (rect.top >= viewportBottom) break;
    const page = Number(element.dataset.page);
    if (!Number.isFinite(page)) continue;
    pages.push({
      page,
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    });
  }
  return pages;
}

interface ContinuousViewerProps {
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

export const ContinuousViewer = memo(function ContinuousViewer({
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
}: ContinuousViewerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const onPageChangeRef = useRef(onPageChange);
  const currentPageRef = useRef(currentPage);
  const lastReportedPageRef = useRef<number | undefined>(undefined);
  const previousCurrentPageRef = useRef(currentPage);
  const [bounds, setBounds] = useState({ width: 804, compact: false });
  const pages = useMemo(
    () => Array.from({ length: pageCount }, (_, index) => index + 1),
    [pageCount],
  );
  const marksByPage = useMemo(() => indexByPage(translationMarks), [translationMarks]);
  const annotationsByPage = useMemo(() => indexByPage(annotations), [annotations]);
  const [renderPlan, setRenderPlan] = useState(() => buildContinuousRenderPlan({
    pageCount,
    fallbackPage: currentPage,
    direction: "none",
    viewport: { top: 0, left: 0, width: 0, height: 0 },
    pages: [],
  }));
  const renderPriorities = useMemo(
    () => new Map(renderPlan.pages.map(({ page, priority }) => [page, priority])),
    [renderPlan],
  );

  onPageChangeRef.current = onPageChange;
  currentPageRef.current = currentPage;

  useEffect(() => {
    if (previousCurrentPageRef.current === currentPage) return;
    previousCurrentPageRef.current = currentPage;
    if (renderPriorities.has(currentPage)) return;
    const nextPlan = buildContinuousRenderPlan({
      pageCount,
      fallbackPage: currentPage,
      direction: "none",
      viewport: { top: 0, left: 0, width: 0, height: 0 },
      pages: [],
    });
    setRenderPlan((existing) => sameRenderPlan(existing, nextPlan) ? existing : nextPlan);
  }, [currentPage, pageCount, renderPriorities]);

  useEffect(() => {
    const root = rootRef.current;
    const scrollRoot = root?.closest<HTMLElement>(".reader-canvas-area");
    if (!root || !scrollRoot || typeof ResizeObserver === "undefined") return;
    const updateBounds = (width: number) => {
      if (width <= 0) return;
      const next = {
        width: Number(width.toFixed(1)),
        compact: window.matchMedia("(max-width: 760px)").matches,
      };
      setBounds((current) => current.width === next.width && current.compact === next.compact ? current : next);
    };
    updateBounds(scrollRoot.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => updateBounds(entry.contentRect.width));
    observer.observe(scrollRoot);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    const scrollRoot = root?.closest<HTMLElement>(".reader-canvas-area");
    if (!root) return;
    const pageElements = Array.from(root.querySelectorAll<HTMLElement>(".pdf-page-shell"));
    let frame: number | undefined;
    let lastScrollTop = scrollRoot?.scrollTop ?? 0;
    let lastObservedScrollTop = lastScrollTop;
    let direction: ContinuousScrollDirection = "none";
    const reportViewport = () => {
      frame = undefined;
      const rootRect = scrollRoot?.getBoundingClientRect() ?? {
        top: 0,
        left: 0,
        width: window.innerWidth,
        height: window.innerHeight,
      };
      const scrollTop = scrollRoot?.scrollTop ?? window.scrollY;
      const scrollDelta = scrollTop - lastScrollTop;
      if (scrollDelta > 1) direction = "down";
      else if (scrollDelta < -1) direction = "up";
      lastScrollTop = scrollTop;
      lastObservedScrollTop = scrollTop;
      const viewport = {
        top: rootRect.top,
        left: rootRect.left,
        width: rootRect.width,
        height: rootRect.height,
      };
      const pageRects = visiblePageRects(pageElements, viewport);
      const nextPlan = buildContinuousRenderPlan({
        pageCount,
        fallbackPage: currentPageRef.current,
        direction,
        viewport,
        pages: pageRects,
      });
      setRenderPlan((existing) => sameRenderPlan(existing, nextPlan) ? existing : nextPlan);
      if (pageRects.length > 0 && nextPlan.currentPage !== lastReportedPageRef.current) {
        lastReportedPageRef.current = nextPlan.currentPage;
        onPageChangeRef.current(nextPlan.currentPage);
      }
    };
    const scheduleReport = () => {
      if (frame === undefined) frame = window.requestAnimationFrame(reportViewport);
    };
    const reportSettledViewport = () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      frame = undefined;
      reportViewport();
    };
    scrollRoot?.addEventListener("scroll", scheduleReport, { passive: true });
    scrollRoot?.addEventListener("scrollend", reportSettledViewport, { passive: true });
    const scrollWatchdog = window.setInterval(() => {
      const scrollTop = scrollRoot?.scrollTop ?? window.scrollY;
      if (Math.abs(scrollTop - lastObservedScrollTop) <= 1) return;
      lastObservedScrollTop = scrollTop;
      scheduleReport();
    }, 120);
    scheduleReport();
    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      window.clearInterval(scrollWatchdog);
      scrollRoot?.removeEventListener("scroll", scheduleReport);
      scrollRoot?.removeEventListener("scrollend", reportSettledViewport);
    };
  }, [bounds.compact, bounds.width, pageCount, zoom]);

  return (
    <div ref={rootRef} className="continuous-viewer" aria-label="连续阅读区">
      {pages.map((page) => (
        <PdfPage
          key={page}
          pdf={pdf}
          pageNumber={page}
          zoom={zoom}
          mode="continuous"
          shouldRender={renderPriorities.has(page)}
          shouldRenderText={renderPriorities.get(page) === 0}
          continuousBounds={bounds}
          renderPriority={renderPriorities.get(page) ?? 99}
          pageSize={pageSizes?.[page]}
          onPageSize={onPageSize}
          translationMarks={marksByPage.get(page) ?? EMPTY_TRANSLATION_MARKS}
          annotations={annotationsByPage.get(page) ?? EMPTY_ANNOTATIONS}
          onSelection={onSelection}
          onTranslationClick={onTranslationClick}
          onAnnotationClick={onAnnotationClick}
        />
      ))}
    </div>
  );
});
