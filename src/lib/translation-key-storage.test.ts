import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearTranslationApiKey,
  loadTranslationApiKey,
  saveTranslationApiKey,
} from "@/lib/translation-key-storage";

describe("persistent translation API keys", () => {
  afterEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    delete window.moduDesktop;
  });

  it("restores a browser key after the session storage is cleared", async () => {
    await saveTranslationApiKey("deepseek", "sk-persistent");
    window.sessionStorage.clear();

    await expect(loadTranslationApiKey("deepseek")).resolves.toBe("sk-persistent");
    expect(window.sessionStorage.getItem("modu-deepseek-key")).toBe("sk-persistent");
  });

  it("uses the desktop secure store without copying the key to persistent browser storage", async () => {
    const save = vi.fn().mockResolvedValue(true);
    const get = vi.fn().mockResolvedValue("sk-encrypted");
    const clear = vi.fn().mockResolvedValue(true);
    window.moduDesktop = {
      isDesktop: true,
      consumeLaunchPdf: vi.fn(),
      onOpenPdfAvailable: () => () => {},
      getPdfDefaultAppStatus: vi.fn(),
      setAsPdfDefaultApp: vi.fn(),
      getTranslationApiKey: get,
      saveTranslationApiKey: save,
      clearTranslationApiKey: clear,
    };

    await saveTranslationApiKey("deepseek", "sk-encrypted");
    expect(save).toHaveBeenCalledWith("deepseek", "sk-encrypted");
    expect(window.localStorage.getItem("modu-persistent-deepseek-key")).toBeNull();

    window.sessionStorage.clear();
    await expect(loadTranslationApiKey("deepseek")).resolves.toBe("sk-encrypted");
    await clearTranslationApiKey("deepseek");
    expect(get).toHaveBeenCalledWith("deepseek");
    expect(clear).toHaveBeenCalledWith("deepseek");
    expect(window.sessionStorage.getItem("modu-deepseek-key")).toBeNull();
  });
});
