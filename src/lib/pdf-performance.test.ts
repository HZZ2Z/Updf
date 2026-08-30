import { describe, expect, it, vi } from "vitest";

import {
  MAX_CACHED_TEXT_PAGES,
  createPriorityTaskQueue,
  getAdaptiveCanvasScale,
  getCachedPdfTextContent,
} from "@/lib/pdf-performance";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("PDF rendering performance", () => {
  it("caps high-DPI canvases to the configured pixel budget", () => {
    const scale = getAdaptiveCanvasScale(3000, 4200, 2, 8_000_000);

    expect(scale).toBeCloseTo(0.7968, 3);
    expect(3000 * 4200 * scale * scale).toBeLessThanOrEqual(8_000_001);
  });

  it("keeps native device resolution when it fits the pixel budget", () => {
    expect(getAdaptiveCanvasScale(1000, 1400, 2, 5_600_000)).toBe(2);
    expect(getAdaptiveCanvasScale(1000, 1400, 1, 8_000_000)).toBe(1);
  });

  it("reuses extracted page text across zoom renders", async () => {
    const pdf = {};
    const load = vi.fn().mockResolvedValue({ items: [{ str: "robot" }] });

    const first = await getCachedPdfTextContent(pdf, 4, load);
    const second = await getCachedPdfTextContent(pdf, 4, load);

    expect(first).toBe(second);
    expect(load).toHaveBeenCalledOnce();
  });

  it("retries text extraction after a failed cached request", async () => {
    const pdf = {};
    const load = vi.fn()
      .mockRejectedValueOnce(new Error("temporary parse failure"))
      .mockResolvedValueOnce({ items: [] });

    await expect(getCachedPdfTextContent(pdf, 2, load)).rejects.toThrow("temporary parse failure");
    await expect(getCachedPdfTextContent(pdf, 2, load)).resolves.toEqual({ items: [] });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("bounds cached text content with a per-document LRU", async () => {
    const pdf = {};
    const loads = new Map<number, number>();
    const loadPage = (pageNumber: number) => getCachedPdfTextContent(
      pdf,
      pageNumber,
      async () => {
        loads.set(pageNumber, (loads.get(pageNumber) ?? 0) + 1);
        return { items: [{ str: `page-${pageNumber}` }] };
      },
    );

    for (let page = 1; page <= MAX_CACHED_TEXT_PAGES + 1; page += 1) {
      await loadPage(page);
    }
    await loadPage(1);

    expect(loads.get(1)).toBe(2);
    expect(loads.get(2)).toBe(1);
  });

  it("limits concurrent page work and prioritizes the nearest queued page", async () => {
    const queue = createPriorityTaskQueue(1);
    const blocker = deferred();
    const order: string[] = [];
    const first = queue.enqueue(0, async () => {
      order.push("current");
      await blocker.promise;
    });
    const far = queue.enqueue(3, async () => { order.push("far"); });
    const near = queue.enqueue(1, async () => { order.push("near"); });

    await Promise.resolve();
    expect(order).toEqual(["current"]);
    blocker.resolve();
    await Promise.all([first.promise, far.promise, near.promise]);

    expect(order).toEqual(["current", "near", "far"]);
  });

  it("promotes queued work when a prefetched page becomes visible", async () => {
    const queue = createPriorityTaskQueue(1);
    const blocker = deferred();
    const order: string[] = [];
    const current = queue.enqueue(0, async () => {
      order.push("current");
      await blocker.promise;
    });
    const promoted = queue.enqueue(3, async () => { order.push("promoted-visible"); });
    const other = queue.enqueue(2, async () => { order.push("other-prefetch"); });

    promoted.updatePriority(0);
    blocker.resolve();
    await Promise.all([current.promise, promoted.promise, other.promise]);

    expect(order).toEqual(["current", "promoted-visible", "other-prefetch"]);
  });

  it("reports idle only after all active and queued work settles", async () => {
    const queue = createPriorityTaskQueue(1);
    const blocker = deferred();
    const first = queue.enqueue(0, async () => blocker.promise);
    const second = queue.enqueue(1, async () => undefined);
    let idle = false;
    const idlePromise = queue.whenIdle().then(() => { idle = true; });

    await Promise.resolve();
    expect(idle).toBe(false);
    blocker.resolve();
    await Promise.all([first.promise, second.promise, idlePromise]);
    expect(idle).toBe(true);
  });

  it("never runs more tasks than the configured concurrency", async () => {
    const queue = createPriorityTaskQueue(2);
    const blocker = deferred();
    let active = 0;
    let maximumActive = 0;
    const run = async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await blocker.promise;
      active -= 1;
    };

    const tasks = [queue.enqueue(0, run), queue.enqueue(1, run), queue.enqueue(2, run)];
    await Promise.resolve();
    expect(maximumActive).toBe(2);
    blocker.resolve();
    await Promise.all(tasks.map((task) => task.promise));
    expect(maximumActive).toBe(2);
  });

  it("does not reuse a render slot until cancelled running work settles", async () => {
    const queue = createPriorityTaskQueue(1);
    const stalled = deferred();
    const order: string[] = [];
    const first = queue.enqueue(0, async () => {
      order.push("stalled");
      await stalled.promise;
    });

    await Promise.resolve();
    first.cancel();
    const next = queue.enqueue(0, async () => {
      order.push("next-page");
    });

    try {
      await Promise.resolve();
      expect(order).toEqual(["stalled"]);
    } finally {
      stalled.resolve();
      await Promise.all([first.promise, next.promise]);
    }
    expect(order).toEqual(["stalled", "next-page"]);
  });

  it("serializes work for the same canvas while other canvases stay concurrent", async () => {
    const queue = createPriorityTaskQueue(2);
    const firstCanvas = {};
    const secondCanvas = {};
    const firstBlocker = deferred();
    const secondBlocker = deferred();
    const order: string[] = [];
    const enqueueWithCanvas = queue.enqueue as unknown as <T>(
      priority: number,
      run: () => Promise<T>,
      canvas: object,
    ) => ReturnType<typeof queue.enqueue<T>>;
    const first = enqueueWithCanvas(0, async () => {
      order.push("first-canvas-old");
      await firstBlocker.promise;
    }, firstCanvas);
    const second = enqueueWithCanvas(0, async () => {
      order.push("second-canvas");
      await secondBlocker.promise;
    }, secondCanvas);
    const replacement = enqueueWithCanvas(0, async () => {
      order.push("first-canvas-new");
    }, firstCanvas);

    await Promise.resolve();
    expect(order).toEqual(["first-canvas-old", "second-canvas"]);
    secondBlocker.resolve();
    await second.promise;

    try {
      await Promise.resolve();
      expect(order).toEqual(["first-canvas-old", "second-canvas"]);
    } finally {
      firstBlocker.resolve();
      await Promise.all([first.promise, replacement.promise]);
    }
    expect(order).toEqual(["first-canvas-old", "second-canvas", "first-canvas-new"]);
  });
});
