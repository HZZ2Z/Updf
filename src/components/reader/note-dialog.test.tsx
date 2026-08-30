import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { NoteDialog } from "@/components/reader/note-dialog";

describe("NoteDialog", () => {
  it("saves a collapsible title, full note body and optional link", async () => {
    const onSave = vi.fn();
    render(<NoteDialog page={7} selectedText="important result" onSave={onSave} onCancel={vi.fn()} />);

    await userEvent.type(screen.getByLabelText("注释标题"), "核心结论");
    await userEvent.type(screen.getByLabelText("完整注释"), "这项结果需要复现。");
    await userEvent.type(screen.getByLabelText("相关链接（可选）"), "https://example.com");
    await userEvent.click(screen.getByRole("button", { name: "保存注释" }));

    expect(onSave).toHaveBeenCalledWith({
      title: "核心结论",
      body: "这项结果需要复现。",
      url: "https://example.com",
    });
  });
});
