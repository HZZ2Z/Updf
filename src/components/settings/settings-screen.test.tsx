import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SettingsScreen } from "@/components/settings/settings-screen";

describe("SettingsScreen", () => {
  it("offers smart routing and shows this month's local token totals", async () => {
    const onTranslationProviderChange = vi.fn();
    render(
      <SettingsScreen
        hasApiKey
        hasGoogleApiKey
        translationProvider="deepseek"
        targetLanguage="zh-CN"
        translationUsage={{
          month: "2026-08",
          deepSeekRequests: 2,
          googleRequests: 1,
          localCacheHits: 4,
          promptTokens: 120,
          completionTokens: 36,
          totalTokens: 156,
          promptCacheHitTokens: 80,
          promptCacheMissTokens: 40,
        }}
        documentCount={0}
        recordCount={0}
        onSaveApiKey={vi.fn()}
        onClearApiKey={vi.fn()}
        onSaveGoogleApiKey={vi.fn()}
        onClearGoogleApiKey={vi.fn()}
        onTranslationProviderChange={onTranslationProviderChange}
        onTargetLanguageChange={vi.fn()}
        onExportAll={vi.fn()}
        onImportArchive={vi.fn()}
        onClearLibrary={vi.fn()}
      />,
    );

    await userEvent.selectOptions(screen.getByLabelText("默认翻译服务"), "smart");
    expect(onTranslationProviderChange).toHaveBeenCalledWith("smart");
    expect(screen.getByText("DeepSeek 2 次")).toBeInTheDocument();
    expect(screen.getByText("输入 120 Tokens")).toBeInTheDocument();
    expect(screen.getByText("本地缓存复用 4 次")).toBeInTheDocument();
  });

  it("changes the default translation provider only from settings", async () => {
    const onTranslationProviderChange = vi.fn();
    render(
      <SettingsScreen
        hasApiKey={false}
        hasGoogleApiKey={false}
        translationProvider="deepseek"
        targetLanguage="zh-CN"
        documentCount={0}
        recordCount={0}
        onSaveApiKey={vi.fn()}
        onClearApiKey={vi.fn()}
        onSaveGoogleApiKey={vi.fn()}
        onClearGoogleApiKey={vi.fn()}
        onTranslationProviderChange={onTranslationProviderChange}
        onTargetLanguageChange={vi.fn()}
        onExportAll={vi.fn()}
        onImportArchive={vi.fn()}
        onClearLibrary={vi.fn()}
      />,
    );

    await userEvent.selectOptions(screen.getByLabelText("默认翻译服务"), "google");
    expect(onTranslationProviderChange).toHaveBeenCalledWith("google");
  });

  it("saves a Google API key only through the session callback", async () => {
    const onSaveGoogleApiKey = vi.fn();
    render(
      <SettingsScreen
        hasApiKey={false}
        hasGoogleApiKey={false}
        translationProvider="google"
        targetLanguage="zh-CN"
        documentCount={0}
        recordCount={0}
        onSaveApiKey={vi.fn()}
        onClearApiKey={vi.fn()}
        onSaveGoogleApiKey={onSaveGoogleApiKey}
        onClearGoogleApiKey={vi.fn()}
        onTranslationProviderChange={vi.fn()}
        onTargetLanguageChange={vi.fn()}
        onExportAll={vi.fn()}
        onImportArchive={vi.fn()}
        onClearLibrary={vi.fn()}
      />,
    );

    const input = screen.getByLabelText("Google Cloud Translation API Key");
    expect(input).toHaveAttribute("type", "password");
    await userEvent.type(input, "google-user-key");
    await userEvent.click(screen.getByRole("button", { name: "保存 Google 密钥" }));
    expect(onSaveGoogleApiKey).toHaveBeenCalledWith("google-user-key");
  });

  it("saves a user-owned key only through the session callback", async () => {
    const onSaveApiKey = vi.fn();
    render(
      <SettingsScreen
        hasApiKey={false}
        hasGoogleApiKey={false}
        translationProvider="deepseek"
        targetLanguage="zh-CN"
        documentCount={2}
        recordCount={12}
        onSaveApiKey={onSaveApiKey}
        onClearApiKey={vi.fn()}
        onSaveGoogleApiKey={vi.fn()}
        onClearGoogleApiKey={vi.fn()}
        onTranslationProviderChange={vi.fn()}
        onTargetLanguageChange={vi.fn()}
        onExportAll={vi.fn()}
        onImportArchive={vi.fn()}
        onClearLibrary={vi.fn()}
      />,
    );

    const input = screen.getByLabelText("DeepSeek API Key");
    expect(input).toHaveAttribute("type", "password");
    await userEvent.type(input, "sk-user-owned");
    await userEvent.click(screen.getByRole("button", { name: "保存到当前会话" }));
    expect(onSaveApiKey).toHaveBeenCalledWith("sk-user-owned");
  });

  it("changes the default translation target", async () => {
    const onTargetLanguageChange = vi.fn();
    render(
      <SettingsScreen
        hasApiKey
        hasGoogleApiKey={false}
        translationProvider="deepseek"
        targetLanguage="zh-CN"
        documentCount={0}
        recordCount={0}
        onSaveApiKey={vi.fn()}
        onClearApiKey={vi.fn()}
        onSaveGoogleApiKey={vi.fn()}
        onClearGoogleApiKey={vi.fn()}
        onTranslationProviderChange={vi.fn()}
        onTargetLanguageChange={onTargetLanguageChange}
        onExportAll={vi.fn()}
        onImportArchive={vi.fn()}
        onClearLibrary={vi.fn()}
      />,
    );

    await userEvent.selectOptions(screen.getByLabelText("默认目标语言"), "en");
    expect(onTargetLanguageChange).toHaveBeenCalledWith("en");
  });

  it("offers an explicit local library cleanup action", async () => {
    const onClearLibrary = vi.fn();
    render(
      <SettingsScreen
        hasApiKey={false}
        hasGoogleApiKey={false}
        translationProvider="deepseek"
        targetLanguage="zh-CN"
        documentCount={2}
        recordCount={12}
        onSaveApiKey={vi.fn()}
        onClearApiKey={vi.fn()}
        onSaveGoogleApiKey={vi.fn()}
        onClearGoogleApiKey={vi.fn()}
        onTranslationProviderChange={vi.fn()}
        onTargetLanguageChange={vi.fn()}
        onExportAll={vi.fn()}
        onImportArchive={vi.fn()}
        onClearLibrary={onClearLibrary}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "清空本地资料库" }));
    expect(onClearLibrary).toHaveBeenCalledOnce();
  });
});
