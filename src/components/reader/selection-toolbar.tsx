"use client";

import { Copy, Highlighter, Languages, MessageSquareText, X } from "lucide-react";
import { useState } from "react";

import type { HighlightColor } from "@/lib/types";

interface SelectionToolbarProps {
  x: number;
  y: number;
  translating: boolean;
  onTranslate: () => void;
  onHighlight: (color: HighlightColor) => void;
  onNote: () => void;
  onCopy: () => void;
  onClose: () => void;
}

export function SelectionToolbar({
  x,
  y,
  translating,
  onTranslate,
  onHighlight,
  onNote,
  onCopy,
  onClose,
}: SelectionToolbarProps) {
  const [paletteOpen, setPaletteOpen] = useState(false);

  return (
    <div
      className="selection-toolbar"
      role="toolbar"
      aria-label="选中文本操作"
      style={{ left: x, top: y }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <button type="button" aria-label="翻译选中内容" disabled={translating} onClick={onTranslate}>
        <Languages />{translating ? "翻译中…" : "翻译"}
      </button>
      <div className="highlight-picker">
        <button type="button" aria-label="选择高亮颜色" aria-expanded={paletteOpen} onClick={() => setPaletteOpen((open) => !open)}>
          <Highlighter />高亮
        </button>
        {paletteOpen ? (
          <div className="highlight-palette" aria-label="高亮颜色">
            {(["yellow", "green", "pink"] as HighlightColor[]).map((color) => (
              <button
                key={color}
                className={`color-dot is-${color}`}
                type="button"
                aria-label={`${color === "yellow" ? "黄色" : color === "green" ? "绿色" : "粉色"}高亮`}
                onClick={() => onHighlight(color)}
              />
            ))}
          </div>
        ) : null}
      </div>
      <button type="button" aria-label="添加注释" onClick={onNote}><MessageSquareText />注释</button>
      <button type="button" aria-label="复制选中内容" onClick={onCopy}><Copy />复制</button>
      <button className="selection-close" type="button" aria-label="关闭选区工具栏" onClick={onClose}><X /></button>
    </div>
  );
}
