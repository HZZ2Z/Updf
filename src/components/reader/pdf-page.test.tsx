import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ContinuousViewer } from "@/components/reader/continuous-viewer";
import { PdfPage } from "@/components/reader/pdf-page";

vi.mock("pdfjs-dist", () => ({
  TextLayer: class {
    constructor({ container }: { container: HTMLDivElement }) {
      container.append(document.createElement("span"));
    }

    render() {
      return Promise.resolve();
    }

    cancel() {}
  },
}));

type ObserverCallback = (entries: IntersectionObserverEntry[]) => void;

describe("PdfPage viewport rendering", () => {
  const callbacks: ObserverCallback[] = [];
  const resizeCallbacks: ResizeObserverCallback[] = [];
  const intersectionObserved: Element[][] = [];
  const resizeObserved: Element[][] = [];

  beforeEach(() => {
    callbacks.length = 0;
    resizeCallbacks.length = 0;
    intersectionObserved.length = 0;
    resizeObserved.length = 0;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
      matches: false,
      media: "(max-width: 760px)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: ObserverCallback) {
        callbacks.push(callback);
        intersectionObserved.push([]);
      }

      observe(element: Element) { intersectionObserved.at(-1)?.push(element); }
      disconnect() {}
      unobserve() {}
      takeRecords() { return []; }
      root = null;
      rootMargin = "0px";
      thresholds = [];
    });
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallbacks.push(callback);
        resizeObserved.push([]);
      }

      observe(element: Element) { resizeObserved.at(-1)?.push(element); }
      disconnect() {}
      unobserve() {}
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses known PDF geometry in the first rendered placeholder layout", () => {
    const html = renderToString(
      <PdfPage
        pdf={{} as PDFDocumentProxy}
        pageNumber={132}
        zoom={1}
        mode="continuous"
        continuousBounds={{ width: 804, compact: false }}
        shouldRender={false}
        pageSize={{ width: 595, height: 1_000 }}
        translationMarks={[]}
        annotations={[]}
        onSelection={vi.fn()}
        onTranslationClick={vi.fn()}
        onAnnotationClick={vi.fn()}
      />,
    );

    expect(html).toContain("min-height:1149.6px");
  });

  it("removes the canvas after a page leaves the preload window", async () => {
    const page = {
      getViewport: ({ scale }: { scale: number }) => ({ width: 595 * scale, height: 842 * scale, scale }),
      getTextContent: vi.fn().mockResolvedValue({ items: [] }),
      render: vi.fn().mockReturnValue({ promise: Promise.resolve(), cancel: vi.fn() }),
    };
    const pdf = { getPage: vi.fn().mockResolvedValue(page) } as unknown as PDFDocumentProxy;

    render(
      <PdfPage
        pdf={pdf}
        pageNumber={1}
        zoom={1}
        mode="continuous"
        translationMarks={[]}
        annotations={[]}
        onSelection={vi.fn()}
        onTranslationClick={vi.fn()}
        onAnnotationClick={vi.fn()}
      />,
    );

    expect(screen.getByText("第 1 页")).toBeInTheDocument();
    act(() => callbacks[0]([{ isIntersecting: true } as IntersectionObserverEntry]));
    await waitFor(() => expect(document.querySelector("canvas")).toBeInTheDocument());

    act(() => callbacks[0]([{ isIntersecting: false } as IntersectionObserverEntry]));
    await waitFor(() => expect(document.querySelector("canvas")).not.toBeInTheDocument());
  });

  it("keeps the measured page size after its canvas is unmounted", async () => {
    const page = {
      getViewport: ({ scale }: { scale: number }) => ({ width: 168 * scale, height: 240.48 * scale, scale }),
      getTextContent: vi.fn().mockResolvedValue({ items: [] }),
      render: vi.fn().mockReturnValue({ promise: Promise.resolve(), cancel: vi.fn() }),
    };
    const pdf = { getPage: vi.fn().mockResolvedValue(page) } as unknown as PDFDocumentProxy;
    const view = render(
      <div className="reader-canvas-area">
        <PdfPage
          pdf={pdf}
          pageNumber={1}
          zoom={1}
          mode="continuous"
          continuousBounds={{ width: 689, compact: false }}
          shouldRender
          translationMarks={[]}
          annotations={[]}
          onSelection={vi.fn()}
          onTranslationClick={vi.fn()}
          onAnnotationClick={vi.fn()}
        />
      </div>,
    );

    await waitFor(() => expect(
      Number.parseFloat((document.querySelector(".pdf-page-shell") as HTMLElement).style.minHeight),
    ).toBeCloseTo(814.5, 1));

    view.rerender(
      <div className="reader-canvas-area">
        <PdfPage
          pdf={pdf}
          pageNumber={1}
          zoom={1}
          mode="continuous"
          continuousBounds={{ width: 689, compact: false }}
          shouldRender={false}
          translationMarks={[]}
          annotations={[]}
          onSelection={vi.fn()}
          onTranslationClick={vi.fn()}
          onAnnotationClick={vi.fn()}
        />
      </div>,
    );

    await waitFor(() => expect(document.querySelector("canvas")).not.toBeInTheDocument());
    expect(Number.parseFloat(
      (document.querySelector(".pdf-page-shell") as HTMLElement).style.minHeight,
    )).toBeCloseTo(814.5, 1);
  });

  it("renders the canvas even when extracting the text layer fails", async () => {
    const renderPage = vi.fn().mockReturnValue({ promise: Promise.resolve(), cancel: vi.fn() });
    const page = {
      getViewport: ({ scale }: { scale: number }) => ({ width: 595 * scale, height: 842 * scale, scale }),
      getTextContent: vi.fn().mockRejectedValue(new Error("broken text layer")),
      render: renderPage,
    };
    const pdf = { getPage: vi.fn().mockResolvedValue(page) } as unknown as PDFDocumentProxy;
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <PdfPage
        pdf={pdf}
        pageNumber={1}
        zoom={1}
        mode="continuous"
        shouldRender
        translationMarks={[]}
        annotations={[]}
        onSelection={vi.fn()}
        onTranslationClick={vi.fn()}
        onAnnotationClick={vi.fn()}
      />,
    );

    await waitFor(() => expect(renderPage).toHaveBeenCalledTimes(1));
  });

  it("keeps a high-zoom canvas within the page pixel budget", async () => {
    vi.spyOn(window, "devicePixelRatio", "get").mockReturnValue(2);
    const page = {
      getViewport: ({ scale }: { scale: number }) => ({ width: 1000 * scale, height: 1400 * scale, scale }),
      getTextContent: vi.fn().mockResolvedValue({ items: [] }),
      render: vi.fn().mockReturnValue({ promise: Promise.resolve(), cancel: vi.fn() }),
    };
    const pdf = { getPage: vi.fn().mockResolvedValue(page) } as unknown as PDFDocumentProxy;

    render(
      <PdfPage
        pdf={pdf}
        pageNumber={1}
        zoom={1}
        mode="continuous"
        continuousBounds={{ width: 3120, compact: false }}
        shouldRender
        translationMarks={[]}
        annotations={[]}
        onSelection={vi.fn()}
        onTranslationClick={vi.fn()}
        onAnnotationClick={vi.fn()}
      />,
    );

    await waitFor(() => expect(page.render).toHaveBeenCalledOnce());
    const canvas = document.querySelector("canvas") as HTMLCanvasElement;
    expect(canvas.width * canvas.height).toBeLessThanOrEqual(8_000_001);
  });

  it("does not extract the same page text again after zooming", async () => {
    const page = {
      getViewport: ({ scale }: { scale: number }) => ({ width: 595 * scale, height: 842 * scale, scale }),
      getTextContent: vi.fn().mockResolvedValue({ items: [] }),
      render: vi.fn().mockReturnValue({ promise: Promise.resolve(), cancel: vi.fn() }),
    };
    const pdf = { getPage: vi.fn().mockResolvedValue(page) } as unknown as PDFDocumentProxy;
    const view = render(
      <PdfPage
        pdf={pdf}
        pageNumber={1}
        zoom={1}
        mode="continuous"
        continuousBounds={{ width: 804, compact: false }}
        shouldRender
        translationMarks={[]}
        annotations={[]}
        onSelection={vi.fn()}
        onTranslationClick={vi.fn()}
        onAnnotationClick={vi.fn()}
      />,
    );
    await waitFor(() => expect(page.getTextContent).toHaveBeenCalledOnce());

    view.rerender(
      <PdfPage
        pdf={pdf}
        pageNumber={1}
        zoom={1.5}
        mode="continuous"
        continuousBounds={{ width: 804, compact: false }}
        shouldRender
        translationMarks={[]}
        annotations={[]}
        onSelection={vi.fn()}
        onTranslationClick={vi.fn()}
        onAnnotationClick={vi.fn()}
      />,
    );

    await waitFor(() => expect(page.render).toHaveBeenCalledTimes(2));
    expect(page.getTextContent).toHaveBeenCalledOnce();
  });

  it("extracts text only after a prefetched page becomes truly visible", async () => {
    const page = {
      getViewport: ({ scale }: { scale: number }) => ({ width: 595 * scale, height: 842 * scale, scale }),
      getTextContent: vi.fn().mockResolvedValue({ items: [{ str: "robot" }] }),
      render: vi.fn().mockReturnValue({ promise: Promise.resolve(), cancel: vi.fn() }),
      cleanup: vi.fn(),
    };
    const pdf = { getPage: vi.fn().mockResolvedValue(page) } as unknown as PDFDocumentProxy;
    const props = {
      pdf,
      pageNumber: 1,
      zoom: 1,
      mode: "continuous" as const,
      shouldRender: true,
      translationMarks: [],
      annotations: [],
      onSelection: vi.fn(),
      onTranslationClick: vi.fn(),
      onAnnotationClick: vi.fn(),
    };
    const view = render(<PdfPage {...props} shouldRenderText={false} />);

    await waitFor(() => expect(page.render).toHaveBeenCalledOnce());
    expect(page.getTextContent).not.toHaveBeenCalled();

    view.rerender(<PdfPage {...props} shouldRenderText />);
    await waitFor(() => expect(page.getTextContent).toHaveBeenCalledOnce());
    expect(page.render).toHaveBeenCalledOnce();
  });

  it("clears text state and releases PDF page resources outside the render window", async () => {
    const page = {
      getViewport: ({ scale }: { scale: number }) => ({ width: 595 * scale, height: 842 * scale, scale }),
      getTextContent: vi.fn().mockResolvedValue({ items: [{ str: "robot" }] }),
      render: vi.fn().mockReturnValue({ promise: Promise.resolve(), cancel: vi.fn() }),
      cleanup: vi.fn().mockReturnValue(true),
    };
    const pdf = { getPage: vi.fn().mockResolvedValue(page) } as unknown as PDFDocumentProxy;
    const props = {
      pdf,
      pageNumber: 1,
      zoom: 1,
      mode: "continuous" as const,
      shouldRender: true,
      shouldRenderText: true,
      translationMarks: [],
      annotations: [],
      onSelection: vi.fn(),
      onTranslationClick: vi.fn(),
      onAnnotationClick: vi.fn(),
    };
    const view = render(<PdfPage {...props} />);
    await waitFor(() => expect(page.getTextContent).toHaveBeenCalledOnce());

    view.rerender(<PdfPage {...props} shouldRender={false} shouldRenderText={false} />);

    await waitFor(() => expect(page.cleanup).toHaveBeenCalled());
    expect(document.querySelector(".textLayer")).not.toBeInTheDocument();
  });

  it("releases the backing bitmap when a rendered page is removed", async () => {
    const page = {
      getViewport: ({ scale }: { scale: number }) => ({ width: 595 * scale, height: 842 * scale, scale }),
      getTextContent: vi.fn().mockResolvedValue({ items: [] }),
      render: vi.fn().mockReturnValue({ promise: Promise.resolve(), cancel: vi.fn() }),
    };
    const pdf = { getPage: vi.fn().mockResolvedValue(page) } as unknown as PDFDocumentProxy;
    const view = render(
      <PdfPage
        pdf={pdf}
        pageNumber={1}
        zoom={1}
        mode="continuous"
        continuousBounds={{ width: 804, compact: false }}
        shouldRender
        translationMarks={[]}
        annotations={[]}
        onSelection={vi.fn()}
        onTranslationClick={vi.fn()}
        onAnnotationClick={vi.fn()}
      />,
    );
    await waitFor(() => expect(page.render).toHaveBeenCalledOnce());
    const canvas = document.querySelector("canvas") as HTMLCanvasElement;
    expect(canvas.width).toBeGreaterThan(0);

    view.unmount();
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });

  it("does not let stalled text extraction block another page canvas", async () => {
    let releaseText!: (value: { items: [] }) => void;
    const stalledText = new Promise<{ items: [] }>((resolve) => {
      releaseText = resolve;
    });
    const renderedPages: number[] = [];
    const pdf = {
      getPage: vi.fn().mockImplementation(async (pageNumber: number) => ({
        getViewport: ({ scale }: { scale: number }) => ({ width: 595 * scale, height: 842 * scale, scale }),
        getTextContent: vi.fn().mockReturnValue(stalledText),
        render: vi.fn().mockImplementation(() => {
          renderedPages.push(pageNumber);
          return { promise: Promise.resolve(), cancel: vi.fn() };
        }),
      })),
    } as unknown as PDFDocumentProxy;
    const pageProps = {
      pdf,
      zoom: 1,
      mode: "continuous" as const,
      shouldRender: true,
      translationMarks: [],
      annotations: [],
      onSelection: vi.fn(),
      onTranslationClick: vi.fn(),
      onAnnotationClick: vi.fn(),
    };
    const view = render(
      <div className="reader-canvas-area">
        <PdfPage {...pageProps} pageNumber={1} />
        <PdfPage {...pageProps} pageNumber={2} />
      </div>,
    );

    await waitFor(() => expect(renderedPages).toEqual([1, 2]));
    view.rerender(
      <div className="reader-canvas-area">
        <PdfPage {...pageProps} pageNumber={1} />
        <PdfPage {...pageProps} pageNumber={2} />
        <PdfPage {...pageProps} pageNumber={3} />
      </div>,
    );

    try {
      await waitFor(() => expect(renderedPages).toContain(3), { timeout: 400 });
    } finally {
      releaseText({ items: [] });
    }
  });

  it("bounds text extraction concurrency and cancels text work that never became active", async () => {
    let releaseText!: (value: { items: [] }) => void;
    const stalledText = new Promise<{ items: [] }>((resolve) => { releaseText = resolve; });
    const textLoads = new Map<number, ReturnType<typeof vi.fn>>();
    const pdf = {
      getPage: vi.fn().mockImplementation(async (pageNumber: number) => {
        const getTextContent = vi.fn().mockReturnValue(stalledText);
        textLoads.set(pageNumber, getTextContent);
        return {
          getViewport: ({ scale }: { scale: number }) => ({ width: 595 * scale, height: 842 * scale, scale }),
          getTextContent,
          render: vi.fn().mockReturnValue({ promise: Promise.resolve(), cancel: vi.fn() }),
          cleanup: vi.fn(),
        };
      }),
    } as unknown as PDFDocumentProxy;
    const props = {
      pdf,
      zoom: 1,
      mode: "continuous" as const,
      shouldRender: true,
      shouldRenderText: true,
      translationMarks: [],
      annotations: [],
      onSelection: vi.fn(),
      onTranslationClick: vi.fn(),
      onAnnotationClick: vi.fn(),
    };
    const view = render(
      <div className="reader-canvas-area">
        <PdfPage {...props} pageNumber={1} />
        <PdfPage {...props} pageNumber={2} />
        <PdfPage {...props} pageNumber={3} />
      </div>,
    );

    await waitFor(() => expect(
      Array.from(textLoads.values()).reduce((count, load) => count + load.mock.calls.length, 0),
    ).toBe(2));
    view.rerender(
      <div className="reader-canvas-area">
        <PdfPage {...props} pageNumber={1} />
        <PdfPage {...props} pageNumber={2} />
      </div>,
    );
    releaseText({ items: [] });
    await waitFor(() => expect(textLoads.get(1)).toHaveBeenCalledOnce());
    expect(textLoads.get(2)).toHaveBeenCalledOnce();
    expect(textLoads.get(3)).not.toHaveBeenCalled();
  });

  it("waits for the same canvas render to settle before restarting it", async () => {
    const deferredRender = () => {
      let resolve!: () => void;
      const promise = new Promise<void>((done) => { resolve = done; });
      return { promise, resolve };
    };
    const firstRenders = new Map([
      [1, deferredRender()],
      [2, deferredRender()],
    ]);
    const renderCounts = new Map<number, number>();
    const activeCanvases = new Set<HTMLCanvasElement>();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const pdf = {
      getPage: vi.fn().mockImplementation(async (pageNumber: number) => ({
        getViewport: ({ scale }: { scale: number }) => ({ width: 595 * scale, height: 842 * scale, scale }),
        getTextContent: vi.fn().mockResolvedValue({ items: [] }),
        render: vi.fn().mockImplementation(({ canvas }: { canvas: HTMLCanvasElement }) => {
          const count = (renderCounts.get(pageNumber) ?? 0) + 1;
          renderCounts.set(pageNumber, count);
          if (activeCanvases.has(canvas)) {
            throw new Error("same canvas rendered concurrently");
          }
          activeCanvases.add(canvas);
          const promise = count === 1
            ? firstRenders.get(pageNumber)!.promise
            : Promise.resolve();
          void promise.finally(() => activeCanvases.delete(canvas));
          return { promise, cancel: vi.fn() };
        }),
      })),
    } as unknown as PDFDocumentProxy;
    const callbacks = {
      onSelection: vi.fn(),
      onTranslationClick: vi.fn(),
      onAnnotationClick: vi.fn(),
    };
    const pages = (width: number) => (
      <div className="reader-canvas-area">
        <PdfPage pdf={pdf} pageNumber={1} zoom={1} mode="continuous" continuousBounds={{ width, compact: false }} shouldRender translationMarks={[]} annotations={[]} {...callbacks} />
        <PdfPage pdf={pdf} pageNumber={2} zoom={1} mode="continuous" continuousBounds={{ width, compact: false }} shouldRender translationMarks={[]} annotations={[]} {...callbacks} />
      </div>
    );
    const view = render(pages(804));
    await waitFor(() => expect(renderCounts).toEqual(new Map([[1, 1], [2, 1]])));

    view.rerender(pages(760));
    firstRenders.get(2)!.resolve();

    try {
      await waitFor(() => expect(renderCounts.get(2)).toBe(2));
      expect(renderCounts.get(1)).toBe(1);
    } finally {
      firstRenders.get(1)!.resolve();
    }
  });

  it("keeps the last successful bitmap visible until a replacement render settles", async () => {
    const deferredRender = () => {
      let resolve!: () => void;
      const promise = new Promise<void>((done) => { resolve = done; });
      return { promise, resolve, cancel: vi.fn(), onContinue: undefined as undefined | ((resume: () => void) => void) };
    };
    const renders = [deferredRender(), deferredRender()];
    const renderedCanvases: HTMLCanvasElement[] = [];
    const page = {
      getViewport: ({ scale }: { scale: number }) => ({ width: 595 * scale, height: 842 * scale, scale }),
      getTextContent: vi.fn().mockResolvedValue({ items: [{ str: "robot" }] }),
      render: vi.fn().mockImplementation(({ canvas }: { canvas: HTMLCanvasElement }) => {
        renderedCanvases.push(canvas);
        return renders[renderedCanvases.length - 1];
      }),
    };
    const pdf = { getPage: vi.fn().mockResolvedValue(page) } as unknown as PDFDocumentProxy;
    const props = {
      pdf,
      pageNumber: 1,
      mode: "continuous" as const,
      continuousBounds: { width: 804, compact: false },
      shouldRender: true,
      translationMarks: [],
      annotations: [],
      onSelection: vi.fn(),
      onTranslationClick: vi.fn(),
      onAnnotationClick: vi.fn(),
    };
    const view = render(<PdfPage {...props} zoom={1} />);

    await waitFor(() => expect(page.render).toHaveBeenCalledOnce());
    expect(renders[0].onContinue).toEqual(expect.any(Function));
    expect(document.body.contains(renderedCanvases[0])).toBe(false);
    renders[0].resolve();
    await waitFor(() => expect((document.querySelector("canvas") as HTMLCanvasElement).width).toBe(684));
    await waitFor(() => expect(document.querySelector(".textLayer span")).toBeInTheDocument());

    const continueRendering = vi.fn();
    act(() => renders[0].onContinue?.(continueRendering));
    await waitFor(() => expect(continueRendering).toHaveBeenCalledOnce());

    view.rerender(<PdfPage {...props} zoom={2} />);
    await waitFor(() => expect(page.render).toHaveBeenCalledTimes(2));
    const displayedCanvas = document.querySelector("canvas") as HTMLCanvasElement;
    expect(displayedCanvas.width).toBe(684);
    expect(displayedCanvas.style.width).toBe("1368px");
    expect((document.querySelector(".textLayer") as HTMLElement).style.transform).toBe("scale(2)");
    expect(document.body.contains(renderedCanvases[1])).toBe(false);

    renders[1].resolve();
    await waitFor(() => expect(displayedCanvas.width).toBe(1368));
  });

  it("reports measured page geometry for persistent placeholders", async () => {
    const page = {
      getViewport: ({ scale }: { scale: number }) => ({ width: 612 * scale, height: 792 * scale, scale }),
      getTextContent: vi.fn().mockResolvedValue({ items: [] }),
      render: vi.fn().mockReturnValue({ promise: Promise.resolve(), cancel: vi.fn() }),
    };
    const pdf = { getPage: vi.fn().mockResolvedValue(page) } as unknown as PDFDocumentProxy;
    const onPageSize = vi.fn();

    render(
      <PdfPage
        pdf={pdf}
        pageNumber={3}
        zoom={1}
        mode="continuous"
        shouldRender
        translationMarks={[]}
        annotations={[]}
        onPageSize={onPageSize}
        onSelection={vi.fn()}
        onTranslationClick={vi.fn()}
        onAnnotationClick={vi.fn()}
      />,
    );

    await waitFor(() => expect(onPageSize).toHaveBeenCalledWith(3, { width: 612, height: 792 }));
  });

  it("keeps canvas rendering bounded to pages around the current page", async () => {
    const page = {
      getViewport: ({ scale }: { scale: number }) => ({ width: 595 * scale, height: 842 * scale, scale }),
      getTextContent: vi.fn().mockResolvedValue({ items: [] }),
      render: vi.fn().mockReturnValue({ promise: Promise.resolve(), cancel: vi.fn() }),
    };
    const getPage = vi.fn().mockResolvedValue(page);
    const pdf = { getPage } as unknown as PDFDocumentProxy;

    render(
      <ContinuousViewer
        pdf={pdf}
        pageCount={20}
        currentPage={10}
        zoom={1}
        translationMarks={[]}
        annotations={[]}
        onPageChange={vi.fn()}
        onSelection={vi.fn()}
        onTranslationClick={vi.fn()}
        onAnnotationClick={vi.fn()}
      />,
    );

    await waitFor(() => expect(getPage).toHaveBeenCalledTimes(5));
    expect(getPage.mock.calls.map(([pageNumber]) => pageNumber).sort((a, b) => a - b)).toEqual([
      8, 9, 10, 11, 12,
    ]);
  });

  it("uses one layout observer without per-page visibility observers", async () => {
    const page = {
      getViewport: ({ scale }: { scale: number }) => ({ width: 595 * scale, height: 842 * scale, scale }),
      getTextContent: vi.fn().mockResolvedValue({ items: [] }),
      render: vi.fn().mockReturnValue({ promise: Promise.resolve(), cancel: vi.fn() }),
    };
    const pdf = { getPage: vi.fn().mockResolvedValue(page) } as unknown as PDFDocumentProxy;

    render(
      <div className="reader-canvas-area">
        <ContinuousViewer
          pdf={pdf}
          pageCount={20}
          currentPage={10}
          zoom={1}
          translationMarks={[]}
          annotations={[]}
          onPageChange={vi.fn()}
          onSelection={vi.fn()}
          onTranslationClick={vi.fn()}
          onAnnotationClick={vi.fn()}
        />
      </div>,
    );

    await waitFor(() => expect(document.querySelectorAll(".pdf-page-shell")).toHaveLength(20));
    expect(resizeCallbacks).toHaveLength(1);
    expect(resizeObserved[0]).toHaveLength(1);
    expect(callbacks).toHaveLength(0);
    expect(intersectionObserved).toHaveLength(0);
  });

  it("reports the restored page when its initial programmatic position is reached", async () => {
    const page = {
      getViewport: ({ scale }: { scale: number }) => ({ width: 595 * scale, height: 842 * scale, scale }),
      getTextContent: vi.fn().mockResolvedValue({ items: [] }),
      render: vi.fn().mockReturnValue({ promise: Promise.resolve(), cancel: vi.fn() }),
    };
    const pdf = { getPage: vi.fn().mockResolvedValue(page) } as unknown as PDFDocumentProxy;
    const onPageChange = vi.fn();
    const view = render(
      <div className="reader-canvas-area">
        <ContinuousViewer
          pdf={pdf}
          pageCount={20}
          currentPage={10}
          zoom={1}
          translationMarks={[]}
          annotations={[]}
          onPageChange={onPageChange}
          onSelection={vi.fn()}
          onTranslationClick={vi.fn()}
          onAnnotationClick={vi.fn()}
        />
      </div>,
    );
    const scrollRoot = view.container.querySelector(".reader-canvas-area") as HTMLElement;
    const shells = Array.from(view.container.querySelectorAll<HTMLElement>(".pdf-page-shell"));
    vi.spyOn(scrollRoot, "getBoundingClientRect").mockReturnValue({
      top: 0, left: 0, right: 800, bottom: 1_000, width: 800, height: 1_000,
      x: 0, y: 0, toJSON: () => ({}),
    });
    shells.forEach((shell, index) => {
      const top = (index - 9) * 1_500;
      vi.spyOn(shell, "getBoundingClientRect").mockReturnValue({
        top, left: 0, right: 800, bottom: top + 1_500, width: 800, height: 1_500,
        x: 0, y: top, toJSON: () => ({}),
      });
    });

    await waitFor(() => expect(onPageChange).toHaveBeenCalledWith(10));
  });

  it("renders the actually visible pages and prefetches ahead of the scroll direction", async () => {
    const page = {
      getViewport: ({ scale }: { scale: number }) => ({ width: 595 * scale, height: 842 * scale, scale }),
      getTextContent: vi.fn().mockResolvedValue({ items: [] }),
      render: vi.fn().mockReturnValue({ promise: Promise.resolve(), cancel: vi.fn() }),
    };
    const getPage = vi.fn().mockResolvedValue(page);
    const pdf = { getPage } as unknown as PDFDocumentProxy;
    const onPageChange = vi.fn();
    const view = render(
      <div className="reader-canvas-area">
        <ContinuousViewer
          pdf={pdf}
          pageCount={20}
          currentPage={10}
          zoom={1}
          translationMarks={[]}
          annotations={[]}
          onPageChange={onPageChange}
          onSelection={vi.fn()}
          onTranslationClick={vi.fn()}
          onAnnotationClick={vi.fn()}
        />
      </div>,
    );
    const scrollRoot = view.container.querySelector(".reader-canvas-area") as HTMLElement;
    const shells = Array.from(view.container.querySelectorAll<HTMLElement>(".pdf-page-shell"));
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 40));
    });
    getPage.mockClear();
    vi.spyOn(scrollRoot, "getBoundingClientRect").mockReturnValue({
      top: 0, left: 0, right: 800, bottom: 1_000, width: 800, height: 1_000,
      x: 0, y: 0, toJSON: () => ({}),
    });
    shells.forEach((shell, index) => {
      const top = index < 14
        ? -1_000 - (14 - index) * 1_500
        : index === 14
          ? -1_000
          : index === 15
            ? 500
            : 1_000 + (index - 16) * 1_500;
      const height = index === 15 ? 500 : 1_500;
      vi.spyOn(shell, "getBoundingClientRect").mockReturnValue({
        top, left: 0, right: 800, bottom: top + height, width: 800, height,
        x: 0, y: top, toJSON: () => ({}),
      });
    });
    Object.defineProperty(scrollRoot, "scrollTop", { configurable: true, value: 240, writable: true });

    act(() => scrollRoot.dispatchEvent(new Event("scroll")));

    await waitFor(() => expect(onPageChange).toHaveBeenCalledWith(16));
    await waitFor(() => {
      const requested = new Set(getPage.mock.calls.map(([pageNumber]) => pageNumber));
      expect([14, 15, 16, 17, 18].every((pageNumber) => requested.has(pageNumber))).toBe(true);
    });
  });

  it("recovers the render window when a fast scroll changes position without a callback", async () => {
    const page = {
      getViewport: ({ scale }: { scale: number }) => ({ width: 595 * scale, height: 842 * scale, scale }),
      getTextContent: vi.fn().mockResolvedValue({ items: [] }),
      render: vi.fn().mockReturnValue({ promise: Promise.resolve(), cancel: vi.fn() }),
    };
    const getPage = vi.fn().mockResolvedValue(page);
    const pdf = { getPage } as unknown as PDFDocumentProxy;
    const view = render(
      <div className="reader-canvas-area">
        <ContinuousViewer
          pdf={pdf}
          pageCount={20}
          currentPage={10}
          zoom={1}
          translationMarks={[]}
          annotations={[]}
          onPageChange={vi.fn()}
          onSelection={vi.fn()}
          onTranslationClick={vi.fn()}
          onAnnotationClick={vi.fn()}
        />
      </div>,
    );
    const scrollRoot = view.container.querySelector(".reader-canvas-area") as HTMLElement;
    const shells = Array.from(view.container.querySelectorAll<HTMLElement>(".pdf-page-shell"));
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 40));
    });
    getPage.mockClear();
    vi.spyOn(scrollRoot, "getBoundingClientRect").mockReturnValue({
      top: 0, left: 0, right: 800, bottom: 1_000, width: 800, height: 1_000,
      x: 0, y: 0, toJSON: () => ({}),
    });
    shells.forEach((shell, index) => {
      const top = (index - 14) * 1_500 - 1_000;
      vi.spyOn(shell, "getBoundingClientRect").mockReturnValue({
        top,
        left: 0,
        right: 800,
        bottom: top + 1_500,
        width: 800,
        height: 1_500,
        x: 0,
        y: top,
        toJSON: () => ({}),
      });
    });
    Object.defineProperty(scrollRoot, "scrollTop", { configurable: true, value: 24_000, writable: true });

    await waitFor(() => {
      const requested = new Set(getPage.mock.calls.map(([pageNumber]) => pageNumber));
      expect([14, 15, 16, 17, 18].every((pageNumber) => requested.has(pageNumber))).toBe(true);
    }, { timeout: 1_500 });
  });

  it("renders the final scrollbar position when animation frames were blocked during dragging", async () => {
    const page = {
      getViewport: ({ scale }: { scale: number }) => ({ width: 595 * scale, height: 842 * scale, scale }),
      getTextContent: vi.fn().mockResolvedValue({ items: [] }),
      render: vi.fn().mockReturnValue({ promise: Promise.resolve(), cancel: vi.fn() }),
    };
    const getPage = vi.fn().mockResolvedValue(page);
    const pdf = { getPage } as unknown as PDFDocumentProxy;
    const view = render(
      <div className="reader-canvas-area">
        <ContinuousViewer
          pdf={pdf}
          pageCount={20}
          currentPage={2}
          zoom={1}
          translationMarks={[]}
          annotations={[]}
          onPageChange={vi.fn()}
          onSelection={vi.fn()}
          onTranslationClick={vi.fn()}
          onAnnotationClick={vi.fn()}
        />
      </div>,
    );
    const scrollRoot = view.container.querySelector(".reader-canvas-area") as HTMLElement;
    const shells = Array.from(view.container.querySelectorAll<HTMLElement>(".pdf-page-shell"));
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 40));
    });
    getPage.mockClear();
    vi.spyOn(scrollRoot, "getBoundingClientRect").mockReturnValue({
      top: 0, left: 0, right: 800, bottom: 1_000, width: 800, height: 1_000,
      x: 0, y: 0, toJSON: () => ({}),
    });
    shells.forEach((shell, index) => {
      const top = (index - 14) * 1_500 - 1_000;
      vi.spyOn(shell, "getBoundingClientRect").mockReturnValue({
        top, left: 0, right: 800, bottom: top + 1_500, width: 800, height: 1_500,
        x: 0, y: top, toJSON: () => ({}),
      });
    });
    Object.defineProperty(scrollRoot, "scrollTop", { configurable: true, value: 24_000, writable: true });
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(99);

    act(() => {
      scrollRoot.dispatchEvent(new Event("scroll"));
      scrollRoot.dispatchEvent(new Event("scrollend"));
    });

    await waitFor(() => {
      const requested = new Set(getPage.mock.calls.map(([pageNumber]) => pageNumber));
      expect([14, 15, 16, 17, 18].every((pageNumber) => requested.has(pageNumber))).toBe(true);
    });
  });

  it("reports the exact translation mark when its blue highlight is clicked", async () => {
    const page = {
      getViewport: ({ scale }: { scale: number }) => ({ width: 595 * scale, height: 842 * scale, scale }),
      getTextContent: vi.fn().mockResolvedValue({ items: [] }),
      render: vi.fn().mockReturnValue({ promise: Promise.resolve(), cancel: vi.fn() }),
    };
    const pdf = { getPage: vi.fn().mockResolvedValue(page) } as unknown as PDFDocumentProxy;
    const onTranslationClick = vi.fn();

    render(
      <PdfPage
        pdf={pdf}
        pageNumber={2}
        zoom={1}
        mode="continuous"
        shouldRender
        translationMarks={[{
          id: "mark-exact",
          documentId: "doc-1",
          translationId: "shared-translation",
          anchor: {
            page: 2,
            exact: "shared term",
            prefix: "",
            suffix: "",
            rotation: 0,
            rects: [{ x: 0.1, y: 0.2, width: 0.2, height: 0.04 }],
          },
          createdAt: "2026-08-28T10:00:00.000Z",
          updatedAt: "2026-08-28T10:00:00.000Z",
        }]}
        annotations={[]}
        onSelection={vi.fn()}
        onTranslationClick={onTranslationClick}
        onAnnotationClick={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "查看翻译：shared term" }));
    expect(onTranslationClick).toHaveBeenCalledWith("mark-exact");
  });
});
