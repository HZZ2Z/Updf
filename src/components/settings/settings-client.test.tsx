import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsClient } from "@/components/settings/settings-client";
import type { DesktopUpdateState } from "@/types/desktop";

describe("SettingsClient desktop integration", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState({}, "", "/settings");
  });

  afterEach(() => {
    delete window.moduDesktop;
  });

  it("queries status on desktop and changes the PDF default only after a click", async () => {
    const getPdfDefaultAppStatus = vi.fn().mockResolvedValue({
      available: true,
      isDefault: false,
      defaultApplication: "org.gnome.Evince.desktop",
    });
    const setAsPdfDefaultApp = vi.fn().mockResolvedValue({
      available: true,
      isDefault: true,
      defaultApplication: "com.hzz2z.modureader.desktop",
    });
    window.moduDesktop = {
      isDesktop: true,
      consumeLaunchPdf: vi.fn(),
      onOpenPdfAvailable: () => () => {},
      getPdfDefaultAppStatus,
      setAsPdfDefaultApp,
    };

    render(<SettingsClient />);

    const button = await screen.findByRole("button", { name: "设为 PDF 默认应用" });
    expect(getPdfDefaultAppStatus).toHaveBeenCalledOnce();
    expect(setAsPdfDefaultApp).not.toHaveBeenCalled();
    await userEvent.click(button);

    expect(setAsPdfDefaultApp).toHaveBeenCalledOnce();
    expect(await screen.findByText("墨读已是 PDF 默认应用")).toBeInTheDocument();
    await waitFor(() => expect(button).toBeDisabled());
  });

  it("subscribes to update state and downloads only after confirmation", async () => {
    let updateListener: ((state: DesktopUpdateState) => void) | undefined;
    const downloadUpdate = vi.fn().mockResolvedValue({
      status: "downloading",
      currentVersion: "1.1.0",
      availableVersion: "1.2.0",
      progress: 0,
    });
    window.moduDesktop = {
      isDesktop: true,
      consumeLaunchPdf: vi.fn(),
      onOpenPdfAvailable: () => () => {},
      getPdfDefaultAppStatus: vi.fn().mockResolvedValue({ available: true, isDefault: true }),
      setAsPdfDefaultApp: vi.fn(),
      getUpdateState: vi.fn().mockResolvedValue({
        status: "available",
        currentVersion: "1.1.0",
        availableVersion: "1.2.0",
      }),
      checkForUpdates: vi.fn(),
      downloadUpdate,
      installUpdate: vi.fn(),
      onUpdateState: (listener) => {
        updateListener = listener;
        return () => {
          updateListener = undefined;
        };
      },
    };

    render(<SettingsClient />);

    await userEvent.click(await screen.findByRole("button", { name: "下载更新" }));
    expect(downloadUpdate).toHaveBeenCalledOnce();
    act(() => {
      updateListener?.({ status: "ready", currentVersion: "1.1.0", availableVersion: "1.2.0" });
    });
    expect(await screen.findByRole("button", { name: "重启并更新" })).toBeInTheDocument();
  });

  it("restores and replaces a DeepSeek key through desktop secure storage", async () => {
    const saveTranslationApiKey = vi.fn().mockResolvedValue(true);
    window.moduDesktop = {
      isDesktop: true,
      consumeLaunchPdf: vi.fn(),
      onOpenPdfAvailable: () => () => {},
      getPdfDefaultAppStatus: vi.fn().mockResolvedValue({ available: true, isDefault: true }),
      setAsPdfDefaultApp: vi.fn(),
      getTranslationApiKey: vi.fn(async (provider) => provider === "deepseek" ? "sk-restored" : ""),
      saveTranslationApiKey,
      clearTranslationApiKey: vi.fn().mockResolvedValue(true),
    };

    render(<SettingsClient />);

    expect(await screen.findByText("本机已保存")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("DeepSeek API Key"), "sk-replacement");
    await userEvent.click(screen.getByRole("button", { name: "保存到本机" }));
    await waitFor(() => expect(saveTranslationApiKey).toHaveBeenCalledWith("deepseek", "sk-replacement"));
    expect(await screen.findByText("DeepSeek API Key 已安全保存到本机。")).toBeInTheDocument();
  });
});
