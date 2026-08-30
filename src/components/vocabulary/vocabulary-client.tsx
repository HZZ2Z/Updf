"use client";

import { useCallback, useEffect, useState } from "react";

import { VocabularyScreen } from "@/components/vocabulary/vocabulary-screen";
import { getReaderDatabase } from "@/lib/database";
import { exportVocabularyToCsv } from "@/lib/portable-data";
import type { VocabularyEntry } from "@/lib/types";

export function VocabularyClient() {
  const [entries, setEntries] = useState<VocabularyEntry[]>([]);
  const [documentTitles, setDocumentTitles] = useState<Record<string, string>>({});

  useEffect(() => {
    void (async () => {
      const database = getReaderDatabase();
      const [words, documents] = await Promise.all([
        database.vocabulary.orderBy("updatedAt").reverse().toArray(),
        database.documents.toArray(),
      ]);
      setEntries(words);
      setDocumentTitles(Object.fromEntries(documents.map((document) => [document.id, document.title])));
    })();
  }, []);

  const updateEntry = useCallback(async (
    id: string,
    changes: Partial<Pick<VocabularyEntry, "mastered" | "favorite">>,
  ) => {
    const updatedAt = new Date().toISOString();
    await getReaderDatabase().vocabulary.update(id, { ...changes, updatedAt });
    setEntries((current) => current.map((entry) =>
      entry.id === id ? { ...entry, ...changes, updatedAt } : entry,
    ));
  }, []);

  const exportCsv = useCallback(() => {
    const blob = new Blob(["\ufeff", exportVocabularyToCsv(entries)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "墨读-词汇本.csv";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [entries]);

  return (
    <VocabularyScreen
      entries={entries}
      documentTitles={documentTitles}
      onUpdate={(id, changes) => void updateEntry(id, changes)}
      onExport={exportCsv}
    />
  );
}
