import type { NormalizedRect, ReaderMode, TextAnchor, TranslationService } from "@/lib/types";

export type { NormalizedRect } from "@/lib/types";

export type ContinuousScrollDirection = "up" | "down" | "none";

export interface ContinuousPageRect {
  page: number;
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface ContinuousViewportRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface ContinuousRenderPlan {
  currentPage: number;
  pages: Array<{ page: number; priority: number }>;
}

interface ContinuousPagePositionScheduler {
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (id: number) => void;
  setDelay: (callback: () => void) => number;
  clearDelay: (id: number) => void;
}

export function scheduleContinuousPagePosition(
  position: () => void,
  scheduler: ContinuousPagePositionScheduler = {
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (id) => window.cancelAnimationFrame(id),
    setDelay: (callback) => window.setTimeout(callback, 180),
    clearDelay: (id) => window.clearTimeout(id),
  },
) {
  let cancelled = false;
  let secondFrame: number | undefined;
  let delayedPosition: number | undefined;
  const firstFrame = scheduler.requestFrame(() => {
    if (cancelled) return;
    position();
    secondFrame = scheduler.requestFrame(() => {
      if (!cancelled) position();
    });
    delayedPosition = scheduler.setDelay(() => {
      if (!cancelled) position();
    });
  });

  return () => {
    cancelled = true;
    scheduler.cancelFrame(firstFrame);
    if (secondFrame !== undefined) scheduler.cancelFrame(secondFrame);
    if (delayedPosition !== undefined) scheduler.clearDelay(delayedPosition);
  };
}

function intersectionArea(
  page: ContinuousPageRect,
  viewport: ContinuousViewportRect,
) {
  const right = Math.min(page.left + page.width, viewport.left + viewport.width);
  const bottom = Math.min(page.top + page.height, viewport.top + viewport.height);
  const width = Math.max(0, right - Math.max(page.left, viewport.left));
  const height = Math.max(0, bottom - Math.max(page.top, viewport.top));
  return width * height;
}

function boundedPage(page: number, pageCount: number) {
  return Math.min(Math.max(Math.round(page), 1), Math.max(1, pageCount));
}

export function buildContinuousRenderPlan({
  pageCount,
  fallbackPage,
  direction,
  viewport,
  pages,
}: {
  pageCount: number;
  fallbackPage: number;
  direction: ContinuousScrollDirection;
  viewport: ContinuousViewportRect;
  pages: ContinuousPageRect[];
}): ContinuousRenderPlan {
  const safePageCount = Math.max(1, Math.round(pageCount));
  const safeFallback = boundedPage(fallbackPage, safePageCount);
  const visible = pages
    .map((page) => {
      const area = Math.max(1, page.width * page.height);
      return { page: boundedPage(page.page, safePageCount), ratio: intersectionArea(page, viewport) / area };
    })
    .filter((page) => page.ratio > 0);

  if (visible.length === 0) {
    const priorities = new Map<number, number>();
    for (let distance = 0; distance <= 2; distance += 1) {
      const candidates = distance === 0
        ? [safeFallback]
        : [safeFallback - distance, safeFallback + distance];
      for (const candidate of candidates) {
        if (candidate >= 1 && candidate <= safePageCount) priorities.set(candidate, distance);
      }
    }
    return {
      currentPage: safeFallback,
      pages: Array.from(priorities, ([page, priority]) => ({ page, priority })),
    };
  }

  const currentPage = visible.reduce((best, candidate) =>
    candidate.ratio > best.ratio ? candidate : best,
  ).page;
  const visibleNumbers = Array.from(new Set(visible.map((page) => page.page)))
    .sort((left, right) => left - right);
  const priorities = new Map<number, number>(visibleNumbers.map((page) => [page, 0]));
  const firstVisible = visibleNumbers[0]!;
  const lastVisible = visibleNumbers.at(-1)!;
  const add = (page: number, priority: number) => {
    if (page >= 1 && page <= safePageCount && !priorities.has(page)) priorities.set(page, priority);
  };

  if (direction === "down") {
    add(lastVisible + 1, 1);
    add(lastVisible + 2, 2);
    add(firstVisible - 1, 3);
  } else if (direction === "up") {
    add(firstVisible - 1, 1);
    add(firstVisible - 2, 2);
    add(lastVisible + 1, 3);
  } else {
    add(firstVisible - 1, 1);
    add(lastVisible + 1, 1);
  }

  return {
    currentPage,
    pages: Array.from(priorities, ([page, priority]) => ({ page, priority })),
  };
}


export function normalizeTranslationText(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function isVocabularyCandidate(text: string): boolean {
  const normalized = text.normalize("NFKC").trim();
  if (!normalized || Array.from(normalized).length > 80 || /\s/u.test(normalized)) {
    return false;
  }
  return /^[\p{L}\p{M}\p{N}]+(?:[.'’_+\-][\p{L}\p{M}\p{N}]+)*$/u.test(normalized);
}

export async function buildTranslationCacheKey(
  text: string,
  targetLanguage: string,
  provider: TranslationService = "deepseek",
): Promise<string> {
  const normalized = `${normalizeTranslationText(text)}\u0000${targetLanguage}`;
  const value = provider === "deepseek" ? normalized : `${provider}\u0000${normalized}`;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function getBookSpread(page: number, pageCount: number): number[] {
  const safePage = Math.min(Math.max(Math.round(page), 1), pageCount);
  if (safePage === 1) return [1];

  const leftPage = safePage % 2 === 0 ? safePage : safePage - 1;
  return leftPage + 1 <= pageCount ? [leftPage, leftPage + 1] : [leftPage];
}

export function updateModePage(
  pages: Record<ReaderMode, number>,
  mode: ReaderMode,
  page: number,
): Record<ReaderMode, number> {
  return { ...pages, [mode]: page };
}

export function shouldAcceptViewerPageChange(
  activeMode: ReaderMode,
  viewerMode: ReaderMode,
  restoringMode: ReaderMode | undefined,
  programmaticTarget: number | undefined,
  candidatePage: number,
): boolean {
  if (activeMode !== viewerMode || restoringMode === viewerMode) return false;
  return programmaticTarget === undefined || programmaticTarget === candidatePage;
}

export function fitPageIntoBounds(
  page: { width: number; height: number },
  bounds: { width: number; height: number },
  zoom: number,
) {
  const baseScale = Math.min(bounds.width / page.width, bounds.height / page.height);
  const scale = baseScale * zoom;
  return {
    width: Number((page.width * scale).toFixed(1)),
    height: Number((page.height * scale).toFixed(1)),
  };
}

export function getContinuousPageScale(
  pageWidth: number,
  containerWidth: number,
  zoom: number,
  compact: boolean,
): number {
  const horizontalGutter = compact ? 36 : 120;
  const fitScale = Math.max(0.1, (containerWidth - horizontalGutter) / pageWidth);
  return fitScale * zoom;
}

const CONTINUOUS_READING_LINE_RATIO = 0.42;

export function captureContinuousZoomAnchor(
  page: { top: number; height: number },
  viewport: { top: number; height: number },
) {
  if (page.height <= 0) return 0;
  const readingLine = viewport.top + viewport.height * CONTINUOUS_READING_LINE_RATIO;
  return Math.min(1, Math.max(0, (readingLine - page.top) / page.height));
}

export function getContinuousZoomScrollTop({
  scrollTop,
  page,
  viewport,
  anchor,
}: {
  scrollTop: number;
  page: { top: number; height: number };
  viewport: { top: number; height: number };
  anchor: number;
}) {
  const readingLine = viewport.top + viewport.height * CONTINUOUS_READING_LINE_RATIO;
  const anchoredPoint = page.top + page.height * Math.min(1, Math.max(0, anchor));
  return Math.max(0, scrollTop + anchoredPoint - readingLine);
}

function percentage(value: number): string {
  return `${Number((value * 100).toFixed(4))}%`;
}

export function anchorRectToStyle(rect: NormalizedRect) {
  return {
    left: percentage(rect.x),
    top: percentage(rect.y),
    width: percentage(rect.width),
    height: percentage(rect.height),
  };
}

const ANCHOR_POSITION_TOLERANCE = 0.001;

export function sameTextAnchorLocation(left: TextAnchor, right: TextAnchor): boolean {
  if (
    left.page !== right.page
    || left.rotation !== right.rotation
    || left.exact !== right.exact
    || left.rects.length !== right.rects.length
  ) return false;

  return left.rects.every((rect, index) => {
    const candidate = right.rects[index];
    return candidate !== undefined && (
      Math.abs(rect.x - candidate.x) <= ANCHOR_POSITION_TOLERANCE
      && Math.abs(rect.y - candidate.y) <= ANCHOR_POSITION_TOLERANCE
      && Math.abs(rect.width - candidate.width) <= ANCHOR_POSITION_TOLERANCE
      && Math.abs(rect.height - candidate.height) <= ANCHOR_POSITION_TOLERANCE
    );
  });
}

export function mergeByUpdatedAt<T extends { id: string; updatedAt: string }>(
  local: T[],
  incoming: T[],
): T[] {
  const records = new Map(local.map((record) => [record.id, record]));

  for (const candidate of incoming) {
    const existing = records.get(candidate.id);
    if (!existing || candidate.updatedAt > existing.updatedAt) {
      records.set(candidate.id, candidate);
    }
  }

  return Array.from(records.values());
}
