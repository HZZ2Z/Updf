const MAX_DEVICE_PIXEL_RATIO = 2;

export const DEFAULT_CANVAS_PIXEL_BUDGET = 8_000_000;

export function getAdaptiveCanvasScale(
  width: number,
  height: number,
  devicePixelRatio: number,
  pixelBudget = DEFAULT_CANVAS_PIXEL_BUDGET,
) {
  const desiredScale = Math.min(MAX_DEVICE_PIXEL_RATIO, Math.max(1, devicePixelRatio || 1));
  const cssPixels = Math.max(1, width * height);
  const budgetScale = Math.sqrt(Math.max(1, pixelBudget) / cssPixels);
  return Math.min(desiredScale, budgetScale);
}

const textContentCache = new WeakMap<object, Map<number, Promise<unknown>>>();
export const MAX_CACHED_TEXT_PAGES = 12;

export function getCachedPdfTextContent<T>(
  pdf: object,
  pageNumber: number,
  load: () => Promise<T>,
): Promise<T> {
  let pages = textContentCache.get(pdf);
  if (!pages) {
    pages = new Map();
    textContentCache.set(pdf, pages);
  }
  const cached = pages.get(pageNumber) as Promise<T> | undefined;
  if (cached) {
    pages.delete(pageNumber);
    pages.set(pageNumber, cached);
    return cached;
  }

  const pending = load();
  pages.set(pageNumber, pending);
  while (pages.size > MAX_CACHED_TEXT_PAGES) {
    const oldestPage = pages.keys().next().value as number | undefined;
    if (oldestPage === undefined) break;
    pages.delete(oldestPage);
  }
  void pending.catch(() => {
    if (pages?.get(pageNumber) === pending) pages.delete(pageNumber);
  });
  return pending;
}

interface QueueItem<T> {
  priority: number;
  order: number;
  run: () => Promise<T>;
  resolve: (value: T | undefined) => void;
  reject: (reason: unknown) => void;
  cancelled: boolean;
  started: boolean;
  key?: object;
}

export interface QueuedTask<T> {
  promise: Promise<T | undefined>;
  cancel: () => void;
  updatePriority: (priority: number) => void;
}

export function createPriorityTaskQueue(concurrency: number) {
  const limit = Math.max(1, Math.round(concurrency));
  const pending: QueueItem<unknown>[] = [];
  const activeKeys = new Set<object>();
  let running = 0;
  let order = 0;
  const idleResolvers = new Set<() => void>();

  const notifyIdle = () => {
    if (running !== 0 || pending.length !== 0) return;
    for (const resolve of idleResolvers) resolve();
    idleResolvers.clear();
  };

  const pump = () => {
    pending.sort((left, right) => left.priority - right.priority || left.order - right.order);
    while (running < limit && pending.length > 0) {
      const runnableIndex = pending.findIndex(
        (candidate) => candidate.cancelled || !candidate.key || !activeKeys.has(candidate.key),
      );
      if (runnableIndex < 0) break;
      const [item] = pending.splice(runnableIndex, 1);
      if (!item) break;
      if (item.cancelled) {
        item.resolve(undefined);
        continue;
      }
      item.started = true;
      if (item.key) activeKeys.add(item.key);
      running += 1;
      void item.run().then(item.resolve, item.reject).finally(() => {
        if (item.key) activeKeys.delete(item.key);
        running -= 1;
        pump();
      });
    }
    notifyIdle();
  };

  return {
    enqueue<T>(priority: number, run: () => Promise<T>, key?: object): QueuedTask<T> {
      let item!: QueueItem<T>;
      const promise = new Promise<T | undefined>((resolve, reject) => {
        item = {
          priority,
          order: order++,
          run,
          resolve,
          reject,
          cancelled: false,
          started: false,
          key,
        };
      });
      pending.push(item as QueueItem<unknown>);
      pump();
      return {
        promise,
        cancel: () => {
          item.cancelled = true;
          if (!item.started) pump();
        },
        updatePriority: (nextPriority: number) => {
          if (item.started || item.cancelled || item.priority === nextPriority) return;
          item.priority = nextPriority;
          pump();
        },
      };
    },
    whenIdle(): Promise<void> {
      if (running === 0 && pending.length === 0) return Promise.resolve();
      return new Promise((resolve) => idleResolvers.add(resolve));
    },
  };
}

export const pdfRenderQueue = createPriorityTaskQueue(2);
export const pdfTextQueue = createPriorityTaskQueue(2);
// Thumbnails are intentionally isolated and serialized so they never occupy
// the two slots reserved for the reading surface.
export const pdfThumbnailQueue = createPriorityTaskQueue(1);
