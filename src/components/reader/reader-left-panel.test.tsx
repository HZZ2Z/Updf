import type { PDFDocumentProxy } from "pdfjs-dist";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReaderLeftPanel } from "@/components/reader/reader-left-panel";

describe("ReaderLeftPanel", () => {
  afterEach(() => vi.restoreAllMocks());

  it("lazily renders real PDF thumbnails and navigates directly", async () => {
    const onPageChange = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
    const renderPage = vi.fn(() => ({
      promise: Promise.resolve(),
      cancel: vi.fn(),
      onContinue: undefined,
    }));
    const pdf = {
      getPage: vi.fn(async () => ({
        getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
        render: renderPage,
      })),
    } as unknown as PDFDocumentProxy;
    render(
      <ReaderLeftPanel
        pdf={pdf}
        pageCount={20}
        currentPage={8}
        onPageChange={onPageChange}
      />,
    );

    expect(screen.getByText("缩略图")).toBeInTheDocument();
    expect(screen.queryByText("大纲")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("搜索大纲")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "第 1 页" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "第 20 页" })).toBeInTheDocument();
    await waitFor(() => expect(pdf.getPage).toHaveBeenCalledWith(8));
    await waitFor(() => expect(renderPage).toHaveBeenCalled());
    await userEvent.click(screen.getByRole("button", { name: "第 9 页" }));
    expect(onPageChange).toHaveBeenCalledWith(9);
  });
});
