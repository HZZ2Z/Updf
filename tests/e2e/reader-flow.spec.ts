import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

const samplePdf = path.resolve("tests/fixtures/reader-e2e-sample.pdf");

async function selectText(page: Page, needle: string) {
  await page.locator("#pdf-page-1 .textLayer span").first().waitFor();
  const selected = await page.evaluate((text) => {
    const spans = Array.from(document.querySelectorAll<HTMLElement>("#pdf-page-1 .textLayer span"));
    const span = spans.find((item) => item.textContent?.includes(text));
    const surface = span?.closest<HTMLElement>(".pdf-page-surface");
    if (!span || !surface) return false;
    const range = document.createRange();
    range.selectNodeContents(span);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    span.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    return true;
  }, needle);
  expect(selected).toBe(true);
  await expect(page.getByRole("toolbar", { name: "选中文本操作" })).toBeVisible();
}

test("imports, reads, translates, restores, exports and reattaches records", async ({ page }) => {
  let translationCalls = 0;
  const translationProviders: string[] = [];
  await page.route("**/api/translate", async (route) => {
    translationCalls += 1;
    const request = route.request().postDataJSON() as { text?: string; provider?: string };
    const headers = route.request().headers();
    expect(headers["x-google-translate-key"]).toBe("google-e2e-only");
    expect(headers["x-deepseek-key"]).toBeUndefined();
    translationProviders.push(request.provider || "missing");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        translation: request.text?.includes("Local-First")
          ? "本地优先阅读流程。"
          : "选中句子的测试译文。",
        detectedLanguage: "en",
      }),
    });
  });

  await page.goto("/settings");
  await page.getByLabel("默认翻译服务").selectOption("google");
  await page.getByLabel("Google Cloud Translation API Key").fill("google-e2e-only");
  await page.getByRole("button", { name: "保存 Google 密钥" }).click();
  await expect(page.getByRole("status")).toContainText("Google Cloud Translation API Key 已保存");

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "文献资料库" })).toBeVisible();
  await page.getByLabel("选择 PDF 文件").setInputFiles(samplePdf);
  await expect(page.getByRole("status")).toContainText("已导入 1 份 PDF");
  await page.getByRole("button", { name: "新建文件夹", exact: true }).click();
  await page.getByLabel("文件夹名称").fill("Robotics");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.getByRole("button", { name: "Robotics 0", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "移动文献：Local-First Reading Workflow" }).click();
  await page.getByRole("menuitem", { name: "Robotics", exact: true }).click();
  await expect(page.getByRole("button", { name: "Robotics 1", exact: true })).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Robotics 1", exact: true }).click();
  await expect(page.getByRole("link", { name: /Local-First Reading Workflow/ })).toBeVisible();
  await page.getByRole("link", { name: /Local-First Reading Workflow/ }).click();

  await expect(page.getByRole("button", { name: "连续阅读" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#pdf-page-1 canvas")).toBeVisible();
  expect(await page.locator(".pdf-page-surface canvas").count()).toBeLessThanOrEqual(4);

  const pageInput = page.getByRole("textbox", { name: "当前页 / 6" });
  const scrollArea = page.locator(".reader-canvas-area");
  await page.waitForTimeout(250);
  await scrollArea.evaluate((element) => {
    element.scrollTop = element.scrollHeight - element.clientHeight;
    element.dispatchEvent(new Event("scroll"));
    element.dispatchEvent(new Event("scrollend"));
  });
  await expect(page.locator("#pdf-page-6 canvas")).toBeInViewport();
  await expect(pageInput).toHaveValue("6");

  await pageInput.fill("5");
  await pageInput.press("Enter");
  await expect(pageInput).toHaveValue("5");
  await page.getByRole("button", { name: "放大" }).click();
  await expect(page.getByText("110%", { exact: true })).toBeVisible();
  await expect(pageInput).toHaveValue("5");

  await page.getByRole("button", { name: "图书阅读" }).click();
  await expect(pageInput).toHaveValue("1");
  await expect(page.getByText("100%", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "向后翻页" }).click();
  await expect(pageInput).toHaveValue("2");
  await expect(page.locator(".book-page-item.--left")).toHaveCount(1);

  await page.getByRole("button", { name: "连续阅读" }).click();
  await expect(pageInput).toHaveValue("5");
  await expect(page.getByText("110%", { exact: true })).toBeVisible();
  await pageInput.fill("1");
  await pageInput.press("Enter");
  await expect(page.locator("#pdf-page-1 canvas")).toBeVisible();

  await page.evaluate(() => window.sessionStorage.removeItem("modu-google-translate-key"));
  await selectText(page, "Select this sentence");
  await page.getByRole("button", { name: "翻译选中内容" }).click();
  const googleKeyDialog = page.getByRole("dialog", { name: "连接 Google Cloud Translation" });
  await expect(googleKeyDialog).toBeVisible();
  await googleKeyDialog.getByLabel("Google Cloud Translation API Key").fill("google-e2e-only");
  await googleKeyDialog.getByRole("button", { name: "保存并翻译" }).click();
  await expect(page.getByText("选中句子的测试译文。")).toBeVisible();
  await expect(page.locator(".translation-mark").first()).toBeVisible();
  expect(translationCalls).toBe(1);
  expect(translationProviders).toEqual(["google"]);
  await page.getByRole("button", { name: "更多翻译操作" }).click();
  await page.getByRole("menuitem", { name: "加入词汇本" }).click();

  await selectText(page, "Select this sentence");
  await page.getByRole("button", { name: "翻译选中内容" }).click();
  await expect(page.getByRole("status")).toContainText("已复用本地翻译缓存");
  expect(translationCalls).toBe(1);

  await selectText(page, "A Local-First Reading Workflow");
  await page.getByRole("button", { name: "翻译选中内容" }).click();
  await expect(page.getByText("本地优先阅读流程。")).toBeVisible();
  expect(translationCalls).toBe(2);
  await expect(page.getByRole("button", { name: "翻译记录 2" })).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".translation-card")).toHaveCount(1);

  await selectText(page, "Select this sentence");
  await page.getByRole("button", { name: "添加注释" }).click();
  await page.getByLabel("注释标题").fill("E2E 核心注释");
  await page.getByLabel("完整注释").fill("刷新和导出后都应该恢复这段内容。");
  await page.getByRole("button", { name: "保存注释" }).click();
  await expect(page.getByText("刷新和导出后都应该恢复这段内容。")).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出阅读记录" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.updf-notes\.json$/);
  const notesPath = await download.path();
  expect(notesPath).toBeTruthy();

  await page.reload();
  await expect(page.locator(".translation-card")).toHaveCount(1);
  await page.getByRole("tab", { name: "注释" }).click();
  await page.getByRole("button", { name: /查看翻译：Select this sentence/ }).first().click();
  await expect(page.getByRole("tab", { name: "翻译" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("选中句子的测试译文。")).toBeVisible();
  await expect(page.locator(".translation-card")).toHaveCount(1);
  await expect(page.locator(".translation-card")).not.toContainText("第 1 页");
  await expect(page.locator(".translation-card")).not.toContainText("en → zh-CN");
  await page.getByRole("tab", { name: "注释" }).click();
  await page.getByRole("button", { name: /查看翻译：Select this sentence/ }).first().click();
  await expect(page.getByRole("tab", { name: "翻译" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("选中句子的测试译文。")).toBeVisible();
  await page.getByRole("tab", { name: "注释" }).click();
  await page.getByRole("button", { name: "E2E 核心注释", exact: true }).click();
  await expect(page.getByText("刷新和导出后都应该恢复这段内容。")).toBeVisible();
  await page.screenshot({ path: "/tmp/modu-reader-implementation.png", fullPage: false });

  await page.goto("/");
  await page.getByRole("button", { name: "Robotics 1", exact: true }).click();
  await page.getByRole("button", { name: "管理文件夹：Robotics" }).click();
  await page.getByRole("menuitem", { name: "删除文件夹" }).click();
  await expect(page.getByRole("dialog", { name: "删除文件夹" })).toContainText("1 份文献将移至未分类");
  await page.getByRole("button", { name: "确认删除文件夹" }).click();
  await expect(page.getByRole("link", { name: /Local-First Reading Workflow/ })).toBeVisible();
  await page.getByRole("link", { name: /Local-First Reading Workflow/ }).click();
  await expect(page.getByRole("button", { name: "连续阅读" })).toBeVisible();

  await page.goto("/settings");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "清空本地资料库" }).click();
  await expect(page.getByRole("status")).toContainText("本地资料库已清空");
  await page.getByLabel("选择阅读记录文件").setInputFiles(notesPath!);
  await expect(page.getByRole("status")).toContainText("等待匹配 PDF");

  await page.goto("/");
  await expect(page.getByText("等待原 PDF")).toBeVisible();
  await page.getByLabel("选择 PDF 文件").setInputFiles(samplePdf);
  await expect(page.getByRole("link", { name: /Local-First Reading Workflow/ })).toBeVisible();
  await expect(page.getByText("2 次翻译")).toBeVisible();
  await expect(page.getByText("1 条笔记")).toBeVisible();
});
