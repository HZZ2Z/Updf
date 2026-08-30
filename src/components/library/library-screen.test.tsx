import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { LibraryScreen } from "@/components/library/library-screen";

const folderDocuments = [
  {
    id: "kinematics",
    title: "Kinematics",
    pageCount: 40,
    currentPage: 8,
    progress: 0.2,
    translationCount: 2,
    annotationCount: 1,
    lastOpenedAt: "2026-08-28T10:32:00.000Z",
    folderId: "robotics",
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
    folderId: "robotics",
  },
  {
    id: "linear-algebra",
    title: "Linear Algebra",
    pageCount: 120,
    currentPage: 3,
    progress: 0.025,
    translationCount: 1,
    annotationCount: 2,
    lastOpenedAt: "2026-08-26T10:32:00.000Z",
  },
];

const roboticsFolder = { id: "robotics", name: "Robotics", documentCount: 2 };

describe("LibraryScreen", () => {
  it("shows the import-first empty state", () => {
    render(
      <LibraryScreen
        documents={[]}
        pendingBundles={[]}
        onImport={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "文献资料库" })).toBeInTheDocument();
    expect(screen.getByText("把知识留在本地，把阅读变成积累")).toBeInTheDocument();
    expect(screen.getByLabelText("选择 PDF 文件")).toBeInTheDocument();
    expect(screen.getByText("拖放 PDF 到这里")).toBeInTheDocument();
  });

  it("renders document progress and reading records", () => {
    render(
      <LibraryScreen
        documents={[
          {
            id: "doc-1",
            title: "Attention Is All You Need",
            author: "Vaswani et al.",
            pageCount: 63,
            currentPage: 43,
            progress: 0.68,
            translationCount: 12,
            annotationCount: 4,
            lastOpenedAt: "2026-08-27T10:32:00.000Z",
          },
        ]}
        pendingBundles={[]}
        onImport={vi.fn()}
      />,
    );

    expect(screen.getByText("Attention Is All You Need")).toBeInTheDocument();
    expect(screen.getByText("68%")).toBeInTheDocument();
    expect(screen.getByText("43 / 63 页")).toBeInTheDocument();
    expect(screen.getByText("12 次翻译")).toBeInTheDocument();
    expect(screen.getByText("4 条笔记")).toBeInTheDocument();
  });

  it("passes selected PDF files to the import workflow", async () => {
    const onImport = vi.fn();
    render(
      <LibraryScreen
        documents={[]}
        pendingBundles={[]}
        onImport={onImport}
      />,
    );
    const file = new File(["%PDF-1.7"], "paper.pdf", { type: "application/pdf" });

    await userEvent.upload(screen.getByLabelText("选择 PDF 文件"), file);

    expect(onImport).toHaveBeenCalledWith([file]);
  });

  it("labels unmatched note bundles as waiting for their original PDF", () => {
    render(
      <LibraryScreen
        documents={[]}
        pendingBundles={[{
          id: "pending-1",
          title: "Shared research notes",
          translationCount: 3,
          annotationCount: 2,
          importedAt: "2026-08-27T10:32:00.000Z",
        }]}
        onImport={vi.fn()}
      />,
    );

    expect(screen.getByText("等待原 PDF")).toBeInTheDocument();
  });

  it("places pinned documents first and lets the user unpin them", async () => {
    const onTogglePin = vi.fn();
    render(
      <LibraryScreen
        documents={[
          {
            id: "recent-document",
            title: "Recently opened",
            pageCount: 12,
            currentPage: 2,
            progress: 0.1,
            translationCount: 0,
            annotationCount: 0,
            vocabularyCount: 0,
            lastOpenedAt: "2026-08-28T10:32:00.000Z",
          },
          {
            id: "pinned-document",
            title: "Pinned research",
            pageCount: 40,
            currentPage: 20,
            progress: 0.5,
            translationCount: 2,
            annotationCount: 1,
            vocabularyCount: 3,
            lastOpenedAt: "2026-08-20T10:32:00.000Z",
            pinnedAt: "2026-08-27T10:32:00.000Z",
          },
        ]}
        pendingBundles={[]}
        onImport={vi.fn()}
        onTogglePin={onTogglePin}
      />,
    );

    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent))
      .toEqual(["Pinned research", "Recently opened"]);

    await userEvent.click(screen.getByRole("button", { name: "取消置顶：Pinned research" }));
    expect(onTogglePin).toHaveBeenCalledWith("pinned-document", false);
  });

  it("confirms deletion, keeps vocabulary, and offers a backup first", async () => {
    const onDelete = vi.fn();
    const onExportBeforeDelete = vi.fn();
    render(
      <LibraryScreen
        documents={[
          {
            id: "doc-delete",
            title: "Research to remove",
            pageCount: 30,
            currentPage: 8,
            progress: 0.27,
            translationCount: 5,
            annotationCount: 4,
            vocabularyCount: 3,
            lastOpenedAt: "2026-08-28T10:32:00.000Z",
          },
        ]}
        pendingBundles={[]}
        onImport={vi.fn()}
        onDelete={onDelete}
        onExportBeforeDelete={onExportBeforeDelete}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "删除文献：Research to remove" }));

    expect(screen.getByRole("dialog", { name: "删除文献" })).toBeInTheDocument();
    expect(screen.getByText("词汇本中的 3 条词汇会保留，仍可继续复习。")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "导出批注与翻译" }));
    expect(onExportBeforeDelete).toHaveBeenCalledWith("doc-delete");

    await userEvent.click(screen.getByRole("button", { name: "永久删除" }));
    expect(onDelete).toHaveBeenCalledWith("doc-delete");
  });

  it("filters by course folder and moves a document to unfiled", async () => {
    const onMoveDocument = vi.fn();
    render(
      <LibraryScreen
        documents={folderDocuments}
        folders={[roboticsFolder]}
        pendingBundles={[]}
        onImport={vi.fn()}
        onMoveDocument={onMoveDocument}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Robotics 2" }));
    expect(screen.getByText("Kinematics")).toBeInTheDocument();
    expect(screen.queryByText("Linear Algebra")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "移动文献：Kinematics" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "未分类" }));
    expect(onMoveDocument).toHaveBeenCalledWith("kinematics", undefined);
  });

  it("creates and renames a course folder", async () => {
    const onCreateFolder = vi.fn();
    const onRenameFolder = vi.fn();
    render(
      <LibraryScreen
        documents={folderDocuments}
        folders={[roboticsFolder]}
        pendingBundles={[]}
        onImport={vi.fn()}
        onCreateFolder={onCreateFolder}
        onRenameFolder={onRenameFolder}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "新建文件夹" }));
    await userEvent.type(screen.getByLabelText("文件夹名称"), "Robot Control");
    await userEvent.click(screen.getByRole("button", { name: "创建" }));
    expect(onCreateFolder).toHaveBeenCalledWith("Robot Control");

    await userEvent.click(screen.getByRole("button", { name: "管理文件夹：Robotics" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "重命名" }));
    await userEvent.clear(screen.getByLabelText("文件夹名称"));
    await userEvent.type(screen.getByLabelText("文件夹名称"), "Advanced Robotics");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onRenameFolder).toHaveBeenCalledWith("robotics", "Advanced Robotics");
  });

  it("warns that deleting a folder keeps every document and record", async () => {
    const onDeleteFolder = vi.fn();
    render(
      <LibraryScreen
        documents={folderDocuments}
        folders={[roboticsFolder]}
        pendingBundles={[]}
        onImport={vi.fn()}
        onDeleteFolder={onDeleteFolder}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "管理文件夹：Robotics" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "删除文件夹" }));

    const dialog = screen.getByRole("dialog", { name: "删除文件夹" });
    expect(dialog).toHaveTextContent("2 份文献将移至未分类");
    expect(dialog).toHaveTextContent("文献和阅读记录不会删除");

    await userEvent.click(screen.getByRole("button", { name: "确认删除文件夹" }));
    expect(onDeleteFolder).toHaveBeenCalledWith("robotics");
  });

  it("keeps folder management available beside the narrow-screen selector", async () => {
    render(
      <LibraryScreen
        documents={folderDocuments}
        folders={[roboticsFolder]}
        pendingBundles={[]}
        onImport={vi.fn()}
        onCreateFolder={vi.fn()}
        onRenameFolder={vi.fn()}
        onDeleteFolder={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "新建课程文件夹" })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("筛选文件夹"), "robotics");
    await userEvent.click(screen.getByRole("button", { name: "管理当前文件夹" }));
    expect(screen.getByRole("menuitem", { name: "重命名当前文件夹" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "删除当前文件夹" })).toBeInTheDocument();
  });

  it("keeps the folder dialog open and shows a validation failure", async () => {
    const onCreateFolder = vi.fn().mockRejectedValue(new Error("文件夹已存在"));
    render(
      <LibraryScreen
        documents={folderDocuments}
        folders={[roboticsFolder]}
        pendingBundles={[]}
        onImport={vi.fn()}
        onCreateFolder={onCreateFolder}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "新建文件夹" }));
    await userEvent.type(screen.getByLabelText("文件夹名称"), "Robotics");
    await userEvent.click(screen.getByRole("button", { name: "创建" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("文件夹已存在");
    expect(screen.getByRole("dialog", { name: "新建文件夹" })).toBeInTheDocument();
  });
});
