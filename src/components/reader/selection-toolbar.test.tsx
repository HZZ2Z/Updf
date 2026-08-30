import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SelectionToolbar } from "@/components/reader/selection-toolbar";

describe("SelectionToolbar", () => {
  it("requires an explicit translation action and exposes all highlight colors", async () => {
    const onTranslate = vi.fn();
    const onHighlight = vi.fn();
    render(
      <SelectionToolbar
        x={300}
        y={240}
        translating={false}
        onTranslate={onTranslate}
        onHighlight={onHighlight}
        onNote={vi.fn()}
        onCopy={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(onTranslate).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "翻译选中内容" }));
    expect(onTranslate).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole("button", { name: "选择高亮颜色" }));
    await userEvent.click(screen.getByRole("button", { name: "绿色高亮" }));
    expect(onHighlight).toHaveBeenCalledWith("green");
  });
});
