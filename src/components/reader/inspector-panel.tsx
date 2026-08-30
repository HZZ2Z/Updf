"use client";

import {
  BookPlus,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Languages,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type {
  AnnotationRecord,
  TranslationMark,
  TranslationPayload,
} from "@/lib/types";

export interface TranslationView {
  payload: TranslationPayload;
  mark: TranslationMark;
}

interface InspectorPanelProps {
  translations: TranslationView[];
  annotations: AnnotationRecord[];
  vocabularyTranslationIds: Set<string>;
  selectedTranslationMarkId?: string;
  translationFocusRequest?: number;
  selectedAnnotationId?: string;
  onAddVocabulary: (translationId: string, markId: string) => void;
  onRetranslate: (payload: TranslationPayload, mark: TranslationMark) => void;
  onDeleteAnnotation: (annotationId: string) => void;
  onEditAnnotation: (annotation: AnnotationRecord) => void;
  onAddPageNote: () => void;
  onExportMarkdown: () => void;
}

type InspectorTab = "translation" | "notes" | "history";

export function InspectorPanel({
  translations,
  annotations,
  vocabularyTranslationIds,
  selectedTranslationMarkId,
  translationFocusRequest,
  selectedAnnotationId,
  onAddVocabulary,
  onRetranslate,
  onDeleteAnnotation,
  onEditAnnotation,
  onAddPageNote,
  onExportMarkdown,
}: InspectorPanelProps) {
  const [tab, setTab] = useState<InspectorTab>("translation");
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());
  const [activeTranslationMarkId, setActiveTranslationMarkId] = useState(selectedTranslationMarkId);
  const [translationHistoryExpanded, setTranslationHistoryExpanded] = useState(false);
  const [translationActionsMarkId, setTranslationActionsMarkId] = useState<string>();

  useEffect(() => {
    if (!selectedTranslationMarkId) return;
    setActiveTranslationMarkId(selectedTranslationMarkId);
    setTranslationHistoryExpanded(false);
    setTranslationActionsMarkId(undefined);
    setTab("translation");
  }, [selectedTranslationMarkId, translationFocusRequest]);

  useEffect(() => {
    if (!selectedAnnotationId) return;
    setTab("notes");
    setExpandedNotes((current) => new Set(current).add(selectedAnnotationId));
  }, [selectedAnnotationId]);

  const sortedTranslations = useMemo(
    () => [...translations].sort((a, b) => b.mark.updatedAt.localeCompare(a.mark.updatedAt)),
    [translations],
  );
  const sortedAnnotations = useMemo(
    () => [...annotations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [annotations],
  );
  const activeTranslation = activeTranslationMarkId
    ? sortedTranslations.find((item) => item.mark.id === activeTranslationMarkId)
    : sortedTranslations[0];

  return (
    <aside className="inspector-panel" aria-label="阅读记录面板">
      <div className="inspector-tabs" role="tablist" aria-label="阅读记录类型">
        <button role="tab" aria-selected={tab === "translation"} onClick={() => setTab("translation")}>翻译</button>
        <button role="tab" aria-selected={tab === "notes"} onClick={() => setTab("notes")}>注释</button>
        <button role="tab" aria-selected={tab === "history"} onClick={() => setTab("history")}>记录</button>
      </div>

      <div className="inspector-scroll">
        {tab === "translation" ? (
          activeTranslation ? (
            <div className="translation-stack">
              {(() => {
                const { payload, mark } = activeTranslation;
                const isSaved = vocabularyTranslationIds.has(payload.id);
                return (
                  <article className="translation-card" key={mark.id}>
                    <div className="inspector-label"><Languages />原文</div>
                    <p className="source-text">{payload.originalText}</p>
                    <div className="inspector-label">译文</div>
                    <p className="translated-text">{payload.translatedText}</p>
                    <div className="translation-more">
                      <button
                        type="button"
                        aria-label="更多翻译操作"
                        aria-expanded={translationActionsMarkId === mark.id}
                        onClick={() => setTranslationActionsMarkId((current) => current === mark.id ? undefined : mark.id)}
                      >
                        <MoreHorizontal aria-hidden="true" />更多
                      </button>
                      {translationActionsMarkId === mark.id ? (
                        <div className="translation-action-menu" role="menu">
                          <button
                            type="button"
                            role="menuitem"
                            disabled={isSaved}
                            onClick={() => {
                              setTranslationActionsMarkId(undefined);
                              onAddVocabulary(payload.id, mark.id);
                            }}
                          >
                            <BookPlus />{isSaved ? "已加入词汇本" : "加入词汇本"}
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setTranslationActionsMarkId(undefined);
                              onRetranslate(payload, mark);
                            }}
                          >
                            <RefreshCw />重新翻译
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </article>
                );
              })()}
              {sortedTranslations.length > 1 ? (
                <div className="translation-history-list">
                  <button
                    className="translation-history-toggle"
                    type="button"
                    aria-expanded={translationHistoryExpanded}
                    onClick={() => setTranslationHistoryExpanded((expanded) => !expanded)}
                  >
                    <span>翻译记录 {sortedTranslations.length}</span>
                    {translationHistoryExpanded ? <ChevronDown /> : <ChevronRight />}
                  </button>
                  {translationHistoryExpanded ? (
                    <div className="translation-history-items">
                      {sortedTranslations.map((item) => (
                        <button
                          className={item.mark.id === activeTranslation.mark.id ? "is-active" : ""}
                          type="button"
                          key={item.mark.id}
                          onClick={() => {
                            setActiveTranslationMarkId(item.mark.id);
                            setTranslationHistoryExpanded(false);
                          }}
                        >
                          <span>{item.payload.originalText}</span>
                          <i>第 {item.mark.anchor.page} 页</i>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : activeTranslationMarkId ? (
            <InspectorEmpty icon={<Languages />} title="该翻译记录不存在" body="这条高亮引用的译文可能已损坏或未完整导入。" />
          ) : (
            <InspectorEmpty icon={<Languages />} title="还没有翻译" body="选择单词、句子或段落后点击翻译。" />
          )
        ) : null}

        {tab === "notes" ? (
          <div className="annotation-stack">
            <button className="add-page-note" type="button" onClick={onAddPageNote}><Plus />添加页面注释</button>
            {sortedAnnotations.length > 0 ? sortedAnnotations.map((annotation) => {
              const expanded = expandedNotes.has(annotation.id);
              return (
                <article className={`annotation-card is-${annotation.color}`} key={annotation.id}>
                  <button
                    className="annotation-title"
                    type="button"
                    aria-expanded={expanded}
                    aria-label={annotation.title || `第 ${annotation.anchor.page} 页高亮`}
                    onClick={() => setExpandedNotes((current) => {
                      const next = new Set(current);
                      if (next.has(annotation.id)) next.delete(annotation.id);
                      else next.add(annotation.id);
                      return next;
                    })}
                  >
                    {expanded ? <ChevronDown /> : <ChevronRight />}
                    <span>{annotation.title || annotation.anchor.exact || "页面高亮"}</span>
                    <i>第 {annotation.anchor.page} 页</i>
                  </button>
                  {expanded ? (
                    <div className="annotation-body">
                      {annotation.body ? <p>{annotation.body}</p> : <p className="muted-copy">仅高亮，无文字注释。</p>}
                      {annotation.url ? (
                        <a href={annotation.url} target="_blank" rel="noreferrer"><ExternalLink />打开相关链接</a>
                      ) : null}
                      <div className="annotation-actions">
                        <button type="button" onClick={() => onEditAnnotation(annotation)}><Pencil />编辑</button>
                        <button className="danger-action" type="button" onClick={() => onDeleteAnnotation(annotation.id)}><Trash2 />删除</button>
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            }) : (
              <InspectorEmpty icon={<FileText />} title="还没有注释" body="高亮文字或添加一个折叠注释。" />
            )}
          </div>
        ) : null}

        {tab === "history" ? (
          <div className="history-summary">
            <div><Languages /><strong>{translations.length}</strong><span>翻译记录</span></div>
            <div><FileText /><strong>{annotations.length}</strong><span>注释与高亮</span></div>
            <p>所有记录已自动保存在本机，JSON 可供他人导入，Markdown 便于阅读分享。</p>
            <button className="history-export-button" type="button" onClick={onExportMarkdown}><Download />导出 Markdown</button>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function InspectorEmpty({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="inspector-empty">
      {icon}
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}
