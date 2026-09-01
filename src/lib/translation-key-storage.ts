import type { TranslationService } from "@/lib/types";

const SESSION_KEYS: Record<TranslationService, string> = {
  deepseek: "modu-deepseek-key",
  google: "modu-google-translate-key",
};

const BROWSER_PERSISTENT_KEYS: Record<TranslationService, string> = {
  deepseek: "modu-persistent-deepseek-key",
  google: "modu-persistent-google-translate-key",
};

export async function loadTranslationApiKey(
  provider: TranslationService,
): Promise<string> {
  const sessionKey = SESSION_KEYS[provider];
  const sessionValue = window.sessionStorage.getItem(sessionKey);
  if (sessionValue) return sessionValue;

  const value = window.moduDesktop?.getTranslationApiKey
    ? await window.moduDesktop.getTranslationApiKey(provider)
    : window.localStorage.getItem(BROWSER_PERSISTENT_KEYS[provider]) || "";

  if (value) window.sessionStorage.setItem(sessionKey, value);
  return value;
}

export async function saveTranslationApiKey(
  provider: TranslationService,
  value: string,
): Promise<void> {
  const normalized = value.trim();
  if (!normalized) throw new Error("API Key 不能为空");

  if (window.moduDesktop?.saveTranslationApiKey) {
    await window.moduDesktop.saveTranslationApiKey(provider, normalized);
  } else {
    window.localStorage.setItem(BROWSER_PERSISTENT_KEYS[provider], normalized);
  }
  window.sessionStorage.setItem(SESSION_KEYS[provider], normalized);
}

export async function clearTranslationApiKey(
  provider: TranslationService,
): Promise<void> {
  if (window.moduDesktop?.clearTranslationApiKey) {
    await window.moduDesktop.clearTranslationApiKey(provider);
  } else {
    window.localStorage.removeItem(BROWSER_PERSISTENT_KEYS[provider]);
  }
  window.sessionStorage.removeItem(SESSION_KEYS[provider]);
}
