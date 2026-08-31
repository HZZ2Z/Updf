"use client";

import { FileText } from "lucide-react";
import { useMemo } from "react";

interface ReaderLeftPanelProps {
  pageCount: number;
  currentPage: number;
  onPageChange: (page: number) => void;
}

export function ReaderLeftPanel({
  pageCount,
  currentPage,
  onPageChange,
}: ReaderLeftPanelProps) {
  const nearbyPages = useMemo(() => {
    const start = Math.max(1, currentPage - 5);
    const end = Math.min(pageCount, start + 11);
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }, [currentPage, pageCount]);

  return (
    <aside className="reader-left-panel" aria-label="文档导航">
      <div className="left-panel-heading">
        <FileText aria-hidden="true" />
        <strong>缩略图</strong>
      </div>
      <div className="thumbnail-grid">
        {nearbyPages.map((page) => (
          <button
            className={page === currentPage ? "is-active" : ""}
            type="button"
            key={page}
            aria-label={`第 ${page} 页`}
            onClick={() => onPageChange(page)}
          >
            <span><FileText aria-hidden="true" /></span><i>{page}</i>
          </button>
        ))}
      </div>
    </aside>
  );
}
