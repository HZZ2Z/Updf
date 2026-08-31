"use client";

import { useCallback, useEffect, useState } from "react";

interface PanelLayout {
  leftPanelOpen: boolean;
  inspectorOpen: boolean;
}

function storageKey(documentId: string, panel: "left" | "inspector") {
  return `modu-reader-panel:${documentId}:${panel}`;
}

function readPanelState(documentId: string): PanelLayout {
  if (typeof window === "undefined") return { leftPanelOpen: true, inspectorOpen: false };
  return {
    leftPanelOpen: window.localStorage.getItem(storageKey(documentId, "left")) !== "closed",
    inspectorOpen: window.localStorage.getItem(storageKey(documentId, "inspector")) === "open",
  };
}

function persistPanel(documentId: string, panel: "left" | "inspector", open: boolean) {
  window.localStorage.setItem(storageKey(documentId, panel), open ? "open" : "closed");
}

export function useReaderPanels(documentId: string) {
  const initialLayout = readPanelState(documentId);
  const [leftPanelOpen, setLeftPanelOpen] = useState(initialLayout.leftPanelOpen);
  const [inspectorOpen, setInspectorOpen] = useState(initialLayout.inspectorOpen);
  const [focusMode, setFocusMode] = useState(false);

  useEffect(() => {
    const saved = readPanelState(documentId);
    setLeftPanelOpen(saved.leftPanelOpen);
    setInspectorOpen(saved.inspectorOpen);
    setFocusMode(false);
  }, [documentId]);

  const leaveFocusMode = useCallback(() => {
    setFocusMode(false);
  }, []);

  const toggleLeftPanel = useCallback(() => {
    if (focusMode) leaveFocusMode();
    const next = !leftPanelOpen;
    setLeftPanelOpen(next);
    persistPanel(documentId, "left", next);
  }, [documentId, focusMode, leftPanelOpen, leaveFocusMode]);

  const toggleInspector = useCallback(() => {
    if (focusMode) leaveFocusMode();
    const next = !inspectorOpen;
    setInspectorOpen(next);
    persistPanel(documentId, "inspector", next);
  }, [documentId, focusMode, inspectorOpen, leaveFocusMode]);

  const openInspector = useCallback(() => {
    if (focusMode) {
      setFocusMode(false);
    }
    setInspectorOpen(true);
    persistPanel(documentId, "inspector", true);
  }, [documentId, focusMode]);

  const toggleFocusMode = useCallback(() => {
    if (focusMode) {
      leaveFocusMode();
      return;
    }
    setFocusMode(true);
  }, [focusMode, leaveFocusMode]);

  useEffect(() => {
    if (!focusMode) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") leaveFocusMode();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [focusMode, leaveFocusMode]);

  return {
    leftPanelOpen: focusMode ? false : leftPanelOpen,
    inspectorOpen: focusMode ? false : inspectorOpen,
    focusMode,
    toggleLeftPanel,
    toggleInspector,
    openInspector,
    toggleFocusMode,
  };
}
