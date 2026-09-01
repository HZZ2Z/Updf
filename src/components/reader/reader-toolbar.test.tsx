import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ReaderToolbar } from "@/components/reader/reader-toolbar";

describe("ReaderToolbar", () => {
  it("switches between continuous and book reading modes", async () => {
    const onModeChange = vi.fn();
    render(
      <ReaderToolbar
        title="Interpretable Systems"
        page={12}
        pageCount={28}
        mode="continuous"
        zoom={1.1}
        leftPanelOpen
        inspectorOpen={false}
        focusMode={false}
        onModeChange={onModeChange}
        onPageChange={vi.fn()}
        onZoomChange={vi.fn()}
        onFit={vi.fn()}
        onExport={vi.fn()}
        onToggleLeftPanel={vi.fn()}
        onToggleInspector={vi.fn()}
        onToggleFocusMode={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "连续阅读" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "图书阅读" }));

    expect(onModeChange).toHaveBeenCalledWith("book");
  });

  it("clamps zoom controls to 50% through 300%", async () => {
    const onZoomChange = vi.fn();
    const { rerender } = render(
      <ReaderToolbar
        title="Paper"
        page={1}
        pageCount={10}
        mode="continuous"
        zoom={0.5}
        leftPanelOpen
        inspectorOpen={false}
        focusMode={false}
        onModeChange={vi.fn()}
        onPageChange={vi.fn()}
        onZoomChange={onZoomChange}
        onFit={vi.fn()}
        onExport={vi.fn()}
        onToggleLeftPanel={vi.fn()}
        onToggleInspector={vi.fn()}
        onToggleFocusMode={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "缩小" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "放大" }));
    expect(onZoomChange).toHaveBeenCalledWith(0.6);

    rerender(
      <ReaderToolbar
        title="Paper"
        page={1}
        pageCount={10}
        mode="book"
        zoom={3}
        leftPanelOpen
        inspectorOpen={false}
        focusMode={false}
        onModeChange={vi.fn()}
        onPageChange={vi.fn()}
        onZoomChange={onZoomChange}
        onFit={vi.fn()}
        onExport={vi.fn()}
        onToggleLeftPanel={vi.fn()}
        onToggleInspector={vi.fn()}
        onToggleFocusMode={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "放大" })).toBeDisabled();
    expect(screen.getByText("300%")).toBeInTheDocument();
  });

  it("controls the navigation, reading records, and focus layout", async () => {
    const onToggleLeftPanel = vi.fn();
    const onToggleInspector = vi.fn();
    const onToggleFocusMode = vi.fn();
    render(
      <ReaderToolbar
        title="Paper"
        page={1}
        pageCount={10}
        mode="continuous"
        zoom={1}
        leftPanelOpen
        inspectorOpen={false}
        focusMode={false}
        settingsHref="/settings?returnTo=%2Freader%2Fpaper"
        onModeChange={vi.fn()}
        onPageChange={vi.fn()}
        onZoomChange={vi.fn()}
        onFit={vi.fn()}
        onExport={vi.fn()}
        onToggleLeftPanel={onToggleLeftPanel}
        onToggleInspector={onToggleInspector}
        onToggleFocusMode={onToggleFocusMode}
      />,
    );

    const navigation = screen.getByRole("button", { name: "文档导航" });
    const records = screen.getByRole("button", { name: "阅读记录" });
    const focus = screen.getByRole("button", { name: "专注阅读" });
    expect(navigation).toHaveAttribute("aria-pressed", "true");
    expect(records).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("link", { name: "设置" })).toHaveAttribute(
      "href",
      "/settings?returnTo=%2Freader%2Fpaper",
    );

    await userEvent.click(navigation);
    await userEvent.click(records);
    await userEvent.click(focus);
    expect(onToggleLeftPanel).toHaveBeenCalledOnce();
    expect(onToggleInspector).toHaveBeenCalledOnce();
    expect(onToggleFocusMode).toHaveBeenCalledOnce();
  });
});
