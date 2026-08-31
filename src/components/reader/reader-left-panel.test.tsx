import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ReaderLeftPanel } from "@/components/reader/reader-left-panel";

describe("ReaderLeftPanel", () => {
  it("shows only nearby page thumbnails and navigates directly", async () => {
    const onPageChange = vi.fn();
    render(
      <ReaderLeftPanel
        pageCount={20}
        currentPage={8}
        onPageChange={onPageChange}
      />,
    );

    expect(screen.getByText("缩略图")).toBeInTheDocument();
    expect(screen.queryByText("大纲")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("搜索大纲")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "第 9 页" }));
    expect(onPageChange).toHaveBeenCalledWith(9);
  });
});
