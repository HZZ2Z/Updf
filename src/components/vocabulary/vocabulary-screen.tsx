"use client";

import {
  ArrowLeft,
  BookOpen,
  Check,
  Download,
  Eye,
  List,
  Search,
  Star,
  X,
} from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";

import type { VocabularyEntry } from "@/lib/types";

interface VocabularyScreenProps {
  entries: VocabularyEntry[];
  documentTitles: Record<string, string>;
  onUpdate: (id: string, changes: Partial<Pick<VocabularyEntry, "mastered" | "favorite">>) => void;
  onExport: () => void;
}

export function VocabularyScreen({
  entries,
  documentTitles,
  onUpdate,
  onExport,
}: VocabularyScreenProps) {
  const [mode, setMode] = useState<"list" | "review">("list");
  const [query, setQuery] = useState("");
  const [documentFilter, setDocumentFilter] = useState("all");
  const [masteryFilter, setMasteryFilter] = useState<"all" | "learning" | "mastered">("all");
  const [reviewIndex, setReviewIndex] = useState(0);
  const [answerVisible, setAnswerVisible] = useState(false);
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());

  const filteredEntries = useMemo(() => entries.filter((entry) => {
    if (documentFilter !== "all" && entry.documentId !== documentFilter) return false;
    if (masteryFilter === "learning" && entry.mastered) return false;
    if (masteryFilter === "mastered" && !entry.mastered) return false;
    if (!deferredQuery) return true;
    return `${entry.originalText} ${entry.translatedText} ${entry.context}`
      .toLocaleLowerCase()
      .includes(deferredQuery);
  }), [deferredQuery, documentFilter, entries, masteryFilter]);

  const reviewEntries = filteredEntries.length > 0 ? filteredEntries : entries;
  const reviewEntry = reviewEntries[reviewIndex % Math.max(reviewEntries.length, 1)];
  const goNext = () => {
    setReviewIndex((index) => (index + 1) % Math.max(reviewEntries.length, 1));
    setAnswerVisible(false);
  };

  return (
    <div className="vocabulary-shell">
      <header className="subpage-topbar">
        <a className="toolbar-icon-button" href="/" aria-label="返回资料库"><ArrowLeft /></a>
        <a className="brand" href="/"><span className="brand-mark">墨</span><span>墨读</span></a>
        <div className="subpage-actions">
          <button className="secondary-button" type="button" onClick={onExport}><Download />导出 CSV</button>
        </div>
      </header>

      <main className="vocabulary-main">
        <div className="vocabulary-heading">
          <div><h1>词汇本</h1><p>把阅读中遇见的词语，变成可以反复回看的知识。</p></div>
          <div className="segmented-control" aria-label="词汇本模式">
            <button type="button" aria-pressed={mode === "list"} onClick={() => setMode("list")}><List />词汇列表</button>
            <button type="button" aria-label="卡片复习" aria-pressed={mode === "review"} onClick={() => {
              setMode("review");
              setAnswerVisible(false);
            }}><BookOpen />卡片复习</button>
          </div>
        </div>

        {mode === "list" ? (
          <>
            <div className="vocabulary-filters">
              <label className="vocabulary-search"><Search /><span className="visually-hidden">搜索词汇</span><input value={query} placeholder="搜索原词、译文或上下文" onChange={(event) => setQuery(event.target.value)} /></label>
              <select aria-label="按文档筛选" value={documentFilter} onChange={(event) => setDocumentFilter(event.target.value)}>
                <option value="all">全部文档</option>
                {Object.entries(documentTitles).map(([id, title]) => <option value={id} key={id}>{title}</option>)}
              </select>
              <select aria-label="按掌握状态筛选" value={masteryFilter} onChange={(event) => setMasteryFilter(event.target.value as typeof masteryFilter)}>
                <option value="all">全部状态</option>
                <option value="learning">正在学习</option>
                <option value="mastered">已掌握</option>
              </select>
            </div>

            <div className="vocabulary-summary"><strong>{filteredEntries.length}</strong><span>条词汇</span><i>{entries.filter((entry) => entry.mastered).length} 条已掌握</i></div>

            {filteredEntries.length > 0 ? (
              <div className="vocabulary-table">
                <div className="vocabulary-table-head"><span>词汇与译文</span><span>上下文</span><span>来源</span><span>状态</span></div>
                {filteredEntries.map((entry) => (
                  <article className="vocabulary-row" key={entry.id}>
                    <div className="vocabulary-term"><strong>{entry.originalText}</strong><span>{entry.translatedText}</span></div>
                    <p>{entry.context || "暂无上下文"}</p>
                    <div className="vocabulary-source"><span>{documentTitles[entry.documentId] || entry.sourceTitle || "本地文档"}</span><i>第 {entry.page} 页</i></div>
                    <div className="vocabulary-row-actions">
                      <button className={entry.favorite ? "is-active" : ""} type="button" aria-label={entry.favorite ? "取消收藏" : "收藏"} onClick={() => onUpdate(entry.id, { favorite: !entry.favorite })}><Star /></button>
                      <button className={entry.mastered ? "is-mastered" : ""} type="button" onClick={() => onUpdate(entry.id, { mastered: !entry.mastered })}>{entry.mastered ? <Check /> : <X />}{entry.mastered ? "已掌握" : "学习中"}</button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="vocabulary-empty"><Search /><strong>没有匹配的词汇</strong><p>尝试其他关键词或筛选条件。</p></div>
            )}
          </>
        ) : (
          <section className="review-stage">
            {reviewEntry ? (
              <>
                <div className="review-progress"><span>第 {(reviewIndex % reviewEntries.length) + 1} / {reviewEntries.length} 张</span><i>{documentTitles[reviewEntry.documentId] || reviewEntry.sourceTitle || "本地文档"} · 第 {reviewEntry.page} 页</i></div>
                <article className={`review-card ${answerVisible ? "is-revealed" : ""}`}>
                  <small>原词</small>
                  <h2>{reviewEntry.originalText}</h2>
                  {answerVisible ? (
                    <div className="review-answer"><span>{reviewEntry.translatedText}</span><p>{reviewEntry.context}</p></div>
                  ) : (
                    <button type="button" aria-label="显示答案" onClick={() => setAnswerVisible(true)}><Eye />显示答案</button>
                  )}
                </article>
                {answerVisible ? (
                  <div className="review-actions">
                    <button type="button" onClick={() => {
                      onUpdate(reviewEntry.id, { mastered: false });
                      goNext();
                    }}><X />还不熟悉</button>
                    <button className="is-mastered" type="button" aria-label="已掌握" onClick={() => {
                      onUpdate(reviewEntry.id, { mastered: true });
                      goNext();
                    }}><Check />已掌握</button>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="vocabulary-empty"><BookOpen /><strong>词汇本还是空的</strong><p>翻译单个词后会自动出现在这里，也可从翻译记录手动加入短语。</p></div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
