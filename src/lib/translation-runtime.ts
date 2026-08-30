import type { TranslationProvider, TranslationService } from "@/lib/types";

interface TranslationKeys {
  deepseek: boolean;
  google: boolean;
}

export function resolveTranslationProvider(
  preference: TranslationProvider,
  text: string,
  keys: TranslationKeys,
): TranslationService {
  if (preference !== "smart") return preference;
  if (keys.google && (!keys.deepseek || Array.from(text.trim()).length <= 40)) return "google";
  return "deepseek";
}

export function createInFlightRequestDeduper() {
  const pending = new Map<string, Promise<unknown>>();

  return {
    run<T>(key: string, request: () => Promise<T>): Promise<T> {
      const existing = pending.get(key) as Promise<T> | undefined;
      if (existing) return existing;
      const next = request();
      pending.set(key, next);
      void next.finally(() => {
        if (pending.get(key) === next) pending.delete(key);
      }).catch(() => undefined);
      return next;
    },
  };
}

export const translationRequestDeduper = createInFlightRequestDeduper();
