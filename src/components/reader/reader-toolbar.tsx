"use client";

import {
  ArrowLeft,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Download,
  Maximize2,
  Minus,
  Minimize2,
  PanelLeft,
  PanelRight,
  PanelTop,
  Plus,
  Settings,
} from "lucide-react";
import { useEffect, useState } from "react";

import type { ReaderMode } from "@/lib/types";

interface ReaderToolbarProps {
  title: string;
  page: number;
  pageCount: number;
  mode: ReaderMode;
  zoom: number;
  leftPanelOpen: boolean;
  inspectorOpen: boolean;
  focusMode: boolean;
  settingsHref?: string;
  onModeChange: (mode: ReaderMode) => void;
  onPageChange: (page: number) => void;
  onZoomChange: (zoom: number) => void;
  onFit: (kind: "width" | "page") => void;
  onExport: () => void;
  onToggleLeftPanel: () => void;
  onToggleInspector: () => void;
  onToggleFocusMode: () => void;
}

function clampPage(page: number, pageCount: number) {
  return Math.min(Math.max(Math.round(page) || 1, 1), pageCount);
}

export function ReaderToolbar({
  title,
  page,
  pageCount,
  mode,
  zoom,
  leftPanelOpen,
  inspectorOpen,
  focusMode,
  settingsHref = "/settings",
  onModeChange,
  onPageChange,
  onZoomChange,
  onFit,
  onExport,
  onToggleLeftPanel,
  onToggleInspector,
  onToggleFocusMode,
}: ReaderToolbarProps) {
  const [pageInput, setPageInput] = useState(String(page));

  useEffect(() => setPageInput(String(page)), [page]);

  const commitPage = () => {
    const nextPage = clampPage(Number(pageInput), pageCount);
    setPageInput(String(nextPage));
    onPageChange(nextPage);
  };

  const changeZoom = (delta: number) => {
    onZoomChange(Math.min(3, Math.max(0.5, Math.round((zoom + delta) * 10) / 10)));
  };

  return (
    <header className="reader-toolbar">
      <div className="toolbar-document">
        <a className="toolbar-icon-button" href="/" aria-label="返回资料库"><ArrowLeft /></a>
        <a className="toolbar-brand" href="/" aria-label="墨读首页">墨读</a>
        <button
          className="toolbar-icon-button toolbar-left-panel-toggle"
          type="button"
          aria-label="文档导航"
          aria-pressed={leftPanelOpen}
          title={leftPanelOpen ? "收起文档导航" : "展开文档导航"}
          onClick={onToggleLeftPanel}
        >
          <PanelLeft />
        </button>
        <span className="toolbar-title" title={title}>{title}</span>
      </div>

      <div className="toolbar-center">
        <div className="page-navigation">
          <button type="button" aria-label="上一页" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
            <ChevronLeft />
          </button>
          <label>
            <span className="visually-hidden">当前页</span>
            <input
              inputMode="numeric"
              value={pageInput}
              onChange={(event) => setPageInput(event.target.value.replace(/\D/g, ""))}
              onBlur={commitPage}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
            <i>/</i><span>{pageCount}</span>
          </label>
          <button type="button" aria-label="下一页" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
            <ChevronRight />
          </button>
        </div>

        <div className="segmented-control" aria-label="阅读模式">
          <button
            type="button"
            aria-label="连续阅读"
            aria-pressed={mode === "continuous"}
            onClick={() => onModeChange("continuous")}
          >
            <PanelTop />连续
          </button>
          <button
            type="button"
            aria-label="图书阅读"
            aria-pressed={mode === "book"}
            onClick={() => onModeChange("book")}
          >
            <BookOpen />图书
          </button>
        </div>

        <div className="zoom-control">
          <button type="button" aria-label="缩小" disabled={zoom <= 0.5} onClick={() => changeZoom(-0.1)}><Minus /></button>
          <button
            className="fit-button"
            type="button"
            onClick={() => onFit(mode === "continuous" ? "width" : "page")}
          >
            {mode === "continuous" ? "适合宽度" : "适合页面"}
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" aria-label="放大" disabled={zoom >= 3} onClick={() => changeZoom(0.1)}><Plus /></button>
        </div>
      </div>

      <div className="toolbar-actions">
        <button
          className="toolbar-icon-button"
          type="button"
          aria-label="阅读记录"
          aria-pressed={inspectorOpen}
          title={inspectorOpen ? "收起阅读记录" : "展开阅读记录"}
          onClick={onToggleInspector}
        >
          <PanelRight />
        </button>
        <button
          className="toolbar-icon-button toolbar-focus-button"
          type="button"
          aria-label={focusMode ? "退出专注阅读" : "专注阅读"}
          aria-pressed={focusMode}
          title={focusMode ? "退出专注阅读（Esc）" : "专注阅读"}
          onClick={onToggleFocusMode}
        >
          {focusMode ? <Minimize2 /> : <Maximize2 />}
        </button>
        <button className="toolbar-icon-button toolbar-export-button" type="button" aria-label="导出阅读记录" onClick={onExport}><Download /></button>
        <a className="toolbar-icon-button" href={settingsHref} aria-label="设置"><Settings /></a>
      </div>
    </header>
  );
}
