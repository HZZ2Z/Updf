import { describe, expect, it, vi } from "vitest";

import {
  anchorRectToStyle,
  buildTranslationCacheKey,
  buildContinuousRenderPlan,
  fitPageIntoBounds,
  captureContinuousZoomAnchor,
  getContinuousPageScale,
  getContinuousZoomScrollTop,
  getBookSpread,
  mergeByUpdatedAt,
  normalizeTranslationText,
  scheduleContinuousPagePosition,
  sameTextAnchorLocation,
  shouldAcceptViewerPageChange,
  updateModePage,
} from "@/lib/reader-core";

describe("translation cache", () => {
  it("reuses a translation when whitespace and casing differ", async () => {
    expect(normalizeTranslationText("  Explainable\n  AI  ")).toBe(
      "explainable ai",
    );
    await expect(
      buildTranslationCacheKey(" Explainable   AI ", "zh-CN"),
    ).resolves.toBe(
      await buildTranslationCacheKey("explainable ai", "zh-CN"),
    );
  });

  it("does not reuse cache across target languages", async () => {
    const chinese = await buildTranslationCacheKey("interpretability", "zh-CN");
    const japanese = await buildTranslationCacheKey("interpretability", "ja");

    expect(chinese).not.toBe(japanese);
  });

  it("does not reuse cache across translation providers", async () => {
    const deepSeek = await buildTranslationCacheKey("interpretability", "zh-CN", "deepseek");
    const google = await buildTranslationCacheKey("interpretability", "zh-CN", "google");

    expect(deepSeek).not.toBe(google);
  });

  it("keeps existing DeepSeek cache entries reusable after the provider upgrade", async () => {
    await expect(
      buildTranslationCacheKey("interpretability", "zh-CN", "deepseek"),
    ).resolves.toBe("0e640de9062d9399a54708b1b89be0425f4c650f37e971faff68d72cb352b764");
  });
});

describe("book spread pairing", () => {
  it("keeps the cover alone and pairs following pages", () => {
    expect(getBookSpread(1, 8)).toEqual([1]);
    expect(getBookSpread(2, 8)).toEqual([2, 3]);
    expect(getBookSpread(3, 8)).toEqual([2, 3]);
    expect(getBookSpread(8, 8)).toEqual([8]);
  });

  it("fits an A4 page inside the actual page-flip slot without clipping", () => {
    expect(
      fitPageIntoBounds(
        { width: 595, height: 842 },
        { width: 458, height: 616 },
        1,
      ),
    ).toEqual({ width: 435.3, height: 616 });
  });
});

describe("mode-specific reading progress", () => {
  it("updates one reading mode without moving the other", () => {
    expect(updateModePage({ continuous: 5, book: 20 }, "continuous", 7)).toEqual({
      continuous: 7,
      book: 20,
    });
    expect(updateModePage({ continuous: 7, book: 20 }, "book", 24)).toEqual({
      continuous: 7,
      book: 24,
    });
  });

  it("rejects late page events from the viewer that is being unmounted", () => {
    expect(shouldAcceptViewerPageChange("book", "continuous", undefined, undefined, 4)).toBe(false);
    expect(shouldAcceptViewerPageChange("continuous", "continuous", "continuous", undefined, 4)).toBe(false);
    expect(shouldAcceptViewerPageChange("continuous", "continuous", undefined, undefined, 4)).toBe(true);
  });

  it("ignores intermediate observer pages during programmatic navigation", () => {
    expect(shouldAcceptViewerPageChange("continuous", "continuous", undefined, 5, 3)).toBe(false);
    expect(shouldAcceptViewerPageChange("continuous", "continuous", undefined, 5, 5)).toBe(true);
  });

  it("repositions a restored continuous page after both paint and delayed layout settle", () => {
    const frames = new Map<number, FrameRequestCallback>();
    const delays = new Map<number, () => void>();
    const cancelledFrames: number[] = [];
    const clearedDelays: number[] = [];
    let nextId = 1;
    const position = vi.fn();
    const cleanup = scheduleContinuousPagePosition(position, {
      requestFrame: (callback: FrameRequestCallback) => {
        const id = nextId++;
        frames.set(id, callback);
        return id;
      },
      cancelFrame: (id: number) => cancelledFrames.push(id),
      setDelay: (callback: () => void) => {
        const id = nextId++;
        delays.set(id, callback);
        return id;
      },
      clearDelay: (id: number) => clearedDelays.push(id),
    });

    frames.get(1)?.(0);
    frames.get(2)?.(16);
    delays.get(3)?.();

    expect(position).toHaveBeenCalledTimes(3);
    cleanup();
    expect(cancelledFrames).toEqual([1, 2]);
    expect(clearedDelays).toEqual([3]);
  });
});

describe("normalized text anchors", () => {
  it("converts normalized coordinates to a stable overlay style", () => {
    expect(
      anchorRectToStyle({ x: 0.125, y: 0.25, width: 0.5, height: 0.04 }),
    ).toEqual({ left: "12.5%", top: "25%", width: "50%", height: "4%" });
  });

  it("distinguishes identical text selected at different positions on one page", () => {
    const first = {
      page: 1,
      exact: "state",
      prefix: "first ",
      suffix: " result",
      rotation: 0,
      rects: [{ x: 0.1, y: 0.2, width: 0.08, height: 0.03 }],
    };
    const second = {
      ...first,
      prefix: "second ",
      rects: [{ x: 0.1, y: 0.6, width: 0.08, height: 0.03 }],
    };

    expect(sameTextAnchorLocation(first, second)).toBe(false);
    expect(sameTextAnchorLocation(first, {
      ...first,
      rects: [{ x: 0.1004, y: 0.1997, width: 0.0803, height: 0.03 }],
    })).toBe(true);
  });
});

describe("continuous page sizing", () => {
  it("fits every PDF page width to the available reading area", () => {
    expect(getContinuousPageScale(595, 390, 1, true)).toBeCloseTo(0.595, 3);
    expect(getContinuousPageScale(595, 704, 1, false)).toBeCloseTo(0.982, 3);
    expect(getContinuousPageScale(595, 864, 1, false)).toBeCloseTo(1.25, 3);
    expect(getContinuousPageScale(595, 390, 1.5, true)).toBeCloseTo(0.892, 3);
  });

  it("enlarges physically small PDF pages instead of leaving a large blank margin", () => {
    expect(getContinuousPageScale(168, 689, 1, false)).toBeCloseTo(3.387, 3);
  });

  it("keeps the same point on the current page under the reading line while zooming", () => {
    const viewport = { top: 60, height: 800 };
    const anchor = captureContinuousZoomAnchor(
      { top: 140, height: 1_000 },
      viewport,
    );

    expect(anchor).toBeCloseTo(0.256, 3);
    expect(getContinuousZoomScrollTop({
      scrollTop: 4_000,
      page: { top: 20, height: 2_000 },
      viewport,
      anchor,
    })).toBeCloseTo(4_136, 3);
  });
});

describe("continuous viewport scheduling", () => {
  it("uses the greatest visible page proportion and prefetches in the scroll direction", () => {
    expect(buildContinuousRenderPlan({
      pageCount: 20,
      fallbackPage: 4,
      direction: "down",
      viewport: { top: 0, left: 0, width: 800, height: 1_000 },
      pages: [
        { page: 10, top: -700, left: 0, width: 800, height: 1_000 },
        { page: 11, top: 300, left: 0, width: 800, height: 1_000 },
      ],
    })).toEqual({
      currentPage: 11,
      pages: [
        { page: 10, priority: 0 },
        { page: 11, priority: 0 },
        { page: 12, priority: 1 },
        { page: 13, priority: 2 },
        { page: 9, priority: 3 },
      ],
    });
  });

  it("falls back to a bounded window before observer geometry is available", () => {
    expect(buildContinuousRenderPlan({
      pageCount: 4,
      fallbackPage: 1,
      direction: "none",
      viewport: { top: 0, left: 0, width: 0, height: 0 },
      pages: [],
    })).toEqual({
      currentPage: 1,
      pages: [
        { page: 1, priority: 0 },
        { page: 2, priority: 1 },
        { page: 3, priority: 2 },
      ],
    });
  });
});

describe("import conflict resolution", () => {
  it("keeps the newest record for the same stable id", () => {
    const local = [{ id: "note-1", updatedAt: "2026-08-25T10:00:00.000Z", body: "old" }];
    const incoming = [
      { id: "note-1", updatedAt: "2026-08-26T10:00:00.000Z", body: "new" },
      { id: "note-2", updatedAt: "2026-08-24T10:00:00.000Z", body: "another" },
    ];

    expect(mergeByUpdatedAt(local, incoming)).toEqual([
      incoming[0],
      incoming[1],
    ]);
  });
});
