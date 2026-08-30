import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { VocabularyScreen } from "@/components/vocabulary/vocabulary-screen";
import type { VocabularyEntry } from "@/lib/types";

const entries: VocabularyEntry[] = [
  {
    id: "word-1",
    documentId: "doc-1",
    translationId: "translation-1",
    originalText: "interpretability",
    translatedText: "可解释性",
    context: "model interpretability matters",
    page: 4,
    mastered: false,
    favorite: true,
    createdAt: "2026-08-27T10:00:00.000Z",
    updatedAt: "2026-08-27T10:00:00.000Z",
  },
  {
    id: "word-2",
    documentId: "doc-2",
    translationId: "translation-2",
    originalText: "fidelity",
    translatedText: "保真度",
    context: "prediction fidelity",
    page: 8,
    mastered: true,
    favorite: false,
    createdAt: "2026-08-27T10:00:00.000Z",
    updatedAt: "2026-08-27T10:00:00.000Z",
  },
];

describe("VocabularyScreen", () => {
  it("searches vocabulary across original text and translation", async () => {
    render(
      <VocabularyScreen
        entries={entries}
        documentTitles={{ "doc-1": "Paper A", "doc-2": "Paper B" }}
        onUpdate={vi.fn()}
        onExport={vi.fn()}
      />,
    );

    await userEvent.type(screen.getByLabelText("搜索词汇"), "保真");
    expect(screen.getByText("fidelity")).toBeInTheDocument();
    expect(screen.queryByText("interpretability")).not.toBeInTheDocument();
  });

  it("reveals the answer before marking a review card mastered", async () => {
    const onUpdate = vi.fn();
    render(
      <VocabularyScreen
        entries={[entries[0]]}
        documentTitles={{ "doc-1": "Paper A" }}
        onUpdate={onUpdate}
        onExport={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "卡片复习" }));
    expect(screen.queryByText("可解释性")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "显示答案" }));
    expect(screen.getByText("可解释性")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "已掌握" }));
    expect(onUpdate).toHaveBeenCalledWith("word-1", { mastered: true });
  });
});
