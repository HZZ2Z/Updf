import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { InspectorPanel } from "@/components/reader/inspector-panel";

const translation = {
  id: "translation-1",
  cacheKey: "cache",
  originalText: "state of the art",
  translatedText: "最先进的",
  sourceLanguage: "en",
  targetLanguage: "zh-CN",
  model: "deepseek-v4-flash",
  createdAt: "2026-08-27T10:00:00.000Z",
  updatedAt: "2026-08-27T10:00:00.000Z",
};

const mark = {
  id: "mark-1",
  documentId: "doc-1",
  translationId: "translation-1",
  anchor: { page: 12, exact: "state of the art", prefix: "", suffix: "", rotation: 0, rects: [] },
  createdAt: "2026-08-27T10:00:00.000Z",
  updatedAt: "2026-08-27T10:00:00.000Z",
};

const secondTranslation = {
  ...translation,
  id: "translation-2",
  cacheKey: "cache-2",
  originalText: "kinematic chain",
  translatedText: "运动链",
};

const secondMark = {
  ...mark,
  id: "mark-2",
  translationId: "translation-2",
  anchor: { ...mark.anchor, page: 18, exact: "kinematic chain" },
  updatedAt: "2026-08-28T10:00:00.000Z",
};

const annotation = {
  id: "note-1",
  documentId: "doc-1",
  kind: "note" as const,
  color: "yellow" as const,
  title: "研究注释：核心结论",
  body: "这是完整的注释正文。",
  anchor: { page: 12, exact: "result", prefix: "", suffix: "", rotation: 0, rects: [] },
  createdAt: "2026-08-27T10:00:00.000Z",
  updatedAt: "2026-08-27T10:00:00.000Z",
};

describe("InspectorPanel", () => {
  it("shows a saved translation and adds it to vocabulary", async () => {
    const onAddVocabulary = vi.fn();
    const onRetranslate = vi.fn();
    render(
      <InspectorPanel
        translations={[{ payload: translation, mark }]}
        annotations={[annotation]}
        vocabularyTranslationIds={new Set()}
        onAddVocabulary={onAddVocabulary}
        onRetranslate={onRetranslate}
        onDeleteAnnotation={vi.fn()}
        onEditAnnotation={vi.fn()}
        onAddPageNote={vi.fn()}
        onExportMarkdown={vi.fn()}
      />,
    );

    expect(screen.getByText("state of the art")).toBeInTheDocument();
    expect(screen.getByText("最先进的")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "更多翻译操作" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "加入词汇本" }));
    expect(onAddVocabulary).toHaveBeenCalledWith("translation-1", "mark-1");
    await userEvent.click(screen.getByRole("button", { name: "更多翻译操作" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "重新翻译" }));
    expect(onRetranslate).toHaveBeenCalledWith(translation, mark);
  });

  it("closes translation more actions when clicking elsewhere", async () => {
    render(
      <InspectorPanel
        translations={[{ payload: translation, mark }]}
        annotations={[]}
        vocabularyTranslationIds={new Set()}
        onAddVocabulary={vi.fn()}
        onRetranslate={vi.fn()}
        onDeleteAnnotation={vi.fn()}
        onEditAnnotation={vi.fn()}
        onAddPageNote={vi.fn()}
        onExportMarkdown={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "更多翻译操作" }));
    expect(screen.getByRole("menuitem", { name: "重新翻译" })).toBeInTheDocument();
    await userEvent.click(screen.getByText("state of the art"));
    expect(screen.queryByRole("menuitem", { name: "重新翻译" })).not.toBeInTheDocument();
  });

  it("shows one focused translation and keeps a long history collapsed", async () => {
    const props = {
      translations: [
        { payload: translation, mark },
        { payload: secondTranslation, mark: secondMark },
      ],
      annotations: [annotation],
      vocabularyTranslationIds: new Set<string>(),
      selectedTranslationMarkId: "mark-1",
      translationFocusRequest: 1,
      onAddVocabulary: vi.fn(),
      onRetranslate: vi.fn(),
      onDeleteAnnotation: vi.fn(),
      onEditAnnotation: vi.fn(),
      onAddPageNote: vi.fn(),
      onExportMarkdown: vi.fn(),
    };
    const view = render(<InspectorPanel {...props} />);

    expect(screen.getByText("state of the art")).toBeInTheDocument();
    expect(screen.getByText("最先进的")).toBeInTheDocument();
    expect(screen.queryByText("kinematic chain")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "翻译记录 2" })).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(screen.getByRole("tab", { name: "注释" }));
    expect(screen.getByRole("tab", { name: "注释" })).toHaveAttribute("aria-selected", "true");
    view.rerender(<InspectorPanel {...props} translationFocusRequest={2} />);
    expect(screen.getByRole("tab", { name: "翻译" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("state of the art")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "翻译记录 2" }));
    await userEvent.click(screen.getByRole("button", { name: /kinematic chain/ }));
    expect(screen.getByText("运动链")).toBeInTheDocument();
    expect(screen.queryByText("state of the art")).not.toBeInTheDocument();
  });

  it("does not substitute an unrelated translation when a focused record is missing", () => {
    render(
      <InspectorPanel
        translations={[{ payload: translation, mark }]}
        annotations={[]}
        vocabularyTranslationIds={new Set()}
        selectedTranslationMarkId="missing-mark"
        translationFocusRequest={1}
        onAddVocabulary={vi.fn()}
        onRetranslate={vi.fn()}
        onDeleteAnnotation={vi.fn()}
        onEditAnnotation={vi.fn()}
        onAddPageNote={vi.fn()}
        onExportMarkdown={vi.fn()}
      />,
    );

    expect(screen.getByText("该翻译记录不存在")).toBeInTheDocument();
    expect(screen.queryByText("最先进的")).not.toBeInTheDocument();
  });

  it("keeps notes collapsed as linked titles until clicked", async () => {
    render(
      <InspectorPanel
        translations={[{ payload: translation, mark }]}
        annotations={[annotation]}
        vocabularyTranslationIds={new Set()}
        onAddVocabulary={vi.fn()}
        onRetranslate={vi.fn()}
        onDeleteAnnotation={vi.fn()}
        onEditAnnotation={vi.fn()}
        onAddPageNote={vi.fn()}
        onExportMarkdown={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("tab", { name: "注释" }));
    expect(screen.queryByText("这是完整的注释正文。")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "研究注释：核心结论" }));
    expect(screen.getByText("这是完整的注释正文。")).toBeInTheDocument();
  });

  it("exports a human-readable Markdown copy from history", async () => {
    const onExportMarkdown = vi.fn();
    render(
      <InspectorPanel
        translations={[{ payload: translation, mark }]}
        annotations={[annotation]}
        vocabularyTranslationIds={new Set()}
        onAddVocabulary={vi.fn()}
        onRetranslate={vi.fn()}
        onDeleteAnnotation={vi.fn()}
        onEditAnnotation={vi.fn()}
        onAddPageNote={vi.fn()}
        onExportMarkdown={onExportMarkdown}
      />,
    );

    await userEvent.click(screen.getByRole("tab", { name: "记录" }));
    await userEvent.click(screen.getByRole("button", { name: "导出 Markdown" }));
    expect(onExportMarkdown).toHaveBeenCalledOnce();
  });
});
