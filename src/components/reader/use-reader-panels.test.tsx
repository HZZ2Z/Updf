import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useReaderPanels } from "@/components/reader/use-reader-panels";

describe("useReaderPanels", () => {
  beforeEach(() => window.localStorage.clear());

  it("starts with navigation open and an empty inspector closed", () => {
    const { result } = renderHook(() => useReaderPanels("paper-a"));

    expect(result.current.leftPanelOpen).toBe(true);
    expect(result.current.inspectorOpen).toBe(false);
  });

  it("remembers each document panel layout", () => {
    const { result, unmount } = renderHook(() => useReaderPanels("paper-a"));

    act(() => {
      result.current.toggleLeftPanel();
      result.current.toggleInspector();
    });
    expect(window.localStorage.getItem("modu-reader-panel:paper-a:left")).toBe("closed");
    expect(window.localStorage.getItem("modu-reader-panel:paper-a:inspector")).toBe("open");

    unmount();
    const restored = renderHook(() => useReaderPanels("paper-a"));
    expect(restored.result.current.leftPanelOpen).toBe(false);
    expect(restored.result.current.inspectorOpen).toBe(true);
  });

  it("restores the previous layout after leaving focus mode with Escape", () => {
    const { result } = renderHook(() => useReaderPanels("paper-a"));

    act(() => result.current.toggleInspector());
    act(() => result.current.toggleFocusMode());
    expect(result.current.focusMode).toBe(true);
    expect(result.current.leftPanelOpen).toBe(false);
    expect(result.current.inspectorOpen).toBe(false);

    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(result.current.focusMode).toBe(false);
    expect(result.current.leftPanelOpen).toBe(true);
    expect(result.current.inspectorOpen).toBe(true);
  });

  it("opens the inspector when a reading record needs attention", () => {
    const { result } = renderHook(() => useReaderPanels("paper-a"));

    act(() => result.current.openInspector());

    expect(result.current.inspectorOpen).toBe(true);
    expect(window.localStorage.getItem("modu-reader-panel:paper-a:inspector")).toBe("open");
  });
});
