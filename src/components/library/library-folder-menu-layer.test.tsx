import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import "@/app/globals.css";
import { LibraryScreen } from "@/components/library/library-screen";

const documents = [
  {
    id: "kinematics",
    title: "Kinematics",
    pageCount: 40,
    currentPage: 8,
    progress: 0.2,
    translationCount: 2,
    annotationCount: 1,
    lastOpenedAt: "2026-08-28T10:32:00.000Z",
  },
  {
    id: "robot-dynamics",
    title: "Robot Dynamics",
    pageCount: 80,
    currentPage: 10,
    progress: 0.125,
    translationCount: 0,
    annotationCount: 0,
    lastOpenedAt: "2026-08-27T10:32:00.000Z",
  },
];

describe("document folder menu layering", () => {
  it("keeps an open menu above the following document row", async () => {
    render(
      <LibraryScreen
        documents={documents}
        folders={[{ id: "robotics", name: "Robotics", documentCount: 0 }]}
        pendingBundles={[]}
        onImport={vi.fn()}
        onMoveDocument={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "更多操作：Kinematics" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "移动到文件夹" }));

    const openRow = screen.getByRole("button", { name: "更多操作：Kinematics" }).closest("article");
    const followingRow = screen.getByRole("button", { name: "更多操作：Robot Dynamics" }).closest("article");
    const openRowLevel = Number.parseInt(getComputedStyle(openRow!).zIndex, 10) || 0;
    const followingRowLevel = Number.parseInt(getComputedStyle(followingRow!).zIndex, 10) || 0;

    expect(screen.getByRole("menu")).toBeVisible();
    expect(openRowLevel).toBeGreaterThan(followingRowLevel);
  });
});
