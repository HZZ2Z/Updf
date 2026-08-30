"use client";

import { FileText, ListTree, Search } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";

interface ReaderLeftPanelProps {
  title: string;
  pageCount: number;
  currentPage: number;
  outline: string[];
  onPageChange: (page: number) => void;
}

export function ReaderLeftPanel({
  title,
  pageCount,
  currentPage,
  outline,
  onPageChange,
}: ReaderLeftPanelProps) {
  const [tab, setTab] = useState<"outline" | "pages">("outline");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const visibleOutline = useMemo(
    () => outline.filter((item) => item.toLocaleLowerCase().includes(deferredQuery)),
    [deferredQuery, outline],
  );
  const nearbyPages = useMemo(() => {
    const start = Math.max(1, currentPage - 5);
    const end = Math.min(pageCount, start + 11);
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }, [currentPage, pageCount]);

  return (
    <aside className="reader-left-panel" aria-label="文档导航">
      <div className="left-panel-tabs" role="tablist" aria-label="文档导航类型">
        <button role="tab" aria-selected={tab === "outline"} onClick={() => setTab("outline")}><ListTree />大纲</button>
        <button role="tab" aria-selected={tab === "pages"} onClick={() => setTab("pages")}><FileText />缩略图</button>
      </div>

      {tab === "outline" ? (
        <>
          <label className="outline-search"><Search /><span className="visually-hidden">搜索大纲</span><input value={query} placeholder="搜索大纲" onChange={(event) => setQuery(event.target.value)} /></label>
          <div className="outline-list">
            <button className="outline-document-title" type="button" onClick={() => onPageChange(1)}>{title}</button>
            {(visibleOutline.length > 0 ? visibleOutline : ["文档正文"]).map((item, index) => {
              const page = Math.min(pageCount, Math.max(1, index + 1));
              return (
                <button className={page === currentPage ? "is-active" : ""} type="button" key={`${item}-${index}`} onClick={() => onPageChange(page)}>
                  <span>{item}</span><i>{page}</i>
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <div className="thumbnail-grid">
          {nearbyPages.map((page) => (
            <button className={page === currentPage ? "is-active" : ""} type="button" key={page} onClick={() => onPageChange(page)}>
              <span><FileText /></span><i>{page}</i>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
