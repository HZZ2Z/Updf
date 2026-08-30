import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DesktopPdfOpenCoordinator } from "@/components/desktop/desktop-pdf-open-coordinator";
import { importPdfIntoLibrary } from "@/lib/pdf-library-import";

const push = vi.fn();
const router = { push };

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

vi.mock("@/lib/pdf-library-import", () => ({
  importPdfIntoLibrary: vi.fn(),
}));

const importPdfMock = vi.mocked(importPdfIntoLibrary);

describe("DesktopPdfOpenCoordinator", () => {
  beforeEach(() => {
    push.mockReset();
    importPdfMock.mockReset();
  });

  afterEach(() => {
    delete window.moduDesktop;
  });

  it("consumes a launch PDF and routes to its existing reader record", async () => {
    const consumeLaunchPdf = vi
      .fn()
      .mockResolvedValueOnce({
        name: "robotics.pdf",
        bytes: new TextEncoder().encode("%PDF-1.7"),
      })
      .mockResolvedValueOnce(null);
    window.moduDesktop = {
      isDesktop: true,
      consumeLaunchPdf,
      onOpenPdfAvailable: () => () => {},
      getPdfDefaultAppStatus: vi.fn(),
      setAsPdfDefaultApp: vi.fn(),
    };
    importPdfMock.mockResolvedValue({
      documentId: "sha",
      title: "Robotics",
      outcome: "existing",
      storage: "persistent",
      attachedPendingBundle: false,
    });

    render(<DesktopPdfOpenCoordinator />);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/reader/sha"));
    expect(await screen.findByRole("status")).toHaveTextContent("正在打开 Robotics");
    expect(consumeLaunchPdf).toHaveBeenCalledTimes(2);
  });

  it("does nothing in a normal browser", () => {
    render(<DesktopPdfOpenCoordinator />);

    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("opens a PDF announced after startup and unsubscribes on unmount", async () => {
    let announcePdf: (() => void) | undefined;
    const unsubscribe = vi.fn();
    const consumeLaunchPdf = vi.fn().mockResolvedValue(null);
    window.moduDesktop = {
      isDesktop: true,
      consumeLaunchPdf,
      onOpenPdfAvailable: (listener) => {
        announcePdf = listener;
        return unsubscribe;
      },
      getPdfDefaultAppStatus: vi.fn(),
      setAsPdfDefaultApp: vi.fn(),
    };
    importPdfMock.mockResolvedValue({
      documentId: "later-sha",
      title: "Later paper",
      outcome: "created",
      storage: "persistent",
      attachedPendingBundle: false,
    });
    const view = render(<DesktopPdfOpenCoordinator />);
    await waitFor(() => expect(consumeLaunchPdf).toHaveBeenCalledOnce());
    consumeLaunchPdf
      .mockResolvedValueOnce({
        name: "later.pdf",
        bytes: new TextEncoder().encode("%PDF-1.7"),
      })
      .mockResolvedValueOnce(null);

    act(() => announcePdf?.());

    await waitFor(() => expect(push).toHaveBeenCalledWith("/reader/later-sha"));
    view.unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("drains a PDF announced while an earlier queue read is still pending", async () => {
    let announcePdf: (() => void) | undefined;
    let resolveInitialRead: ((value: null) => void) | undefined;
    const initialRead = new Promise<null>((resolve) => {
      resolveInitialRead = resolve;
    });
    const consumeLaunchPdf = vi
      .fn()
      .mockReturnValueOnce(initialRead)
      .mockResolvedValueOnce({
        name: "racing.pdf",
        bytes: new TextEncoder().encode("%PDF-1.7"),
      })
      .mockResolvedValueOnce(null);
    window.moduDesktop = {
      isDesktop: true,
      consumeLaunchPdf,
      onOpenPdfAvailable: (listener) => {
        announcePdf = listener;
        return () => {};
      },
      getPdfDefaultAppStatus: vi.fn(),
      setAsPdfDefaultApp: vi.fn(),
    };
    importPdfMock.mockResolvedValue({
      documentId: "racing-sha",
      title: "Racing paper",
      outcome: "created",
      storage: "persistent",
      attachedPendingBundle: false,
    });

    render(<DesktopPdfOpenCoordinator />);
    await waitFor(() => expect(consumeLaunchPdf).toHaveBeenCalledOnce());
    act(() => announcePdf?.());
    await act(async () => resolveInitialRead?.(null));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/reader/racing-sha"));
    expect(consumeLaunchPdf).toHaveBeenCalledTimes(3);
  });

  it("continues to the next queued PDF after one import fails", async () => {
    const consumeLaunchPdf = vi
      .fn()
      .mockResolvedValueOnce({
        name: "broken.pdf",
        bytes: new TextEncoder().encode("%PDF-1.7 broken"),
      })
      .mockResolvedValueOnce({
        name: "valid.pdf",
        bytes: new TextEncoder().encode("%PDF-1.7 valid"),
      })
      .mockResolvedValueOnce(null);
    window.moduDesktop = {
      isDesktop: true,
      consumeLaunchPdf,
      onOpenPdfAvailable: () => () => {},
      getPdfDefaultAppStatus: vi.fn(),
      setAsPdfDefaultApp: vi.fn(),
    };
    importPdfMock
      .mockRejectedValueOnce(new Error("文件已损坏"))
      .mockResolvedValueOnce({
        documentId: "valid-sha",
        title: "Valid paper",
        outcome: "created",
        storage: "persistent",
        attachedPendingBundle: false,
      });

    render(<DesktopPdfOpenCoordinator />);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/reader/valid-sha"));
    expect(consumeLaunchPdf).toHaveBeenCalledTimes(3);
  });
});
