import type { TranslationService } from "@/lib/types";

const STORAGE_KEY = "modu-translation-usage-v1";

export interface TranslationApiUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  promptCacheHitTokens: number;
  promptCacheMissTokens: number;
}

export interface TranslationUsageSummary extends TranslationApiUsage {
  month: string;
  deepSeekRequests: number;
  googleRequests: number;
  localCacheHits: number;
}

interface StoredUsage {
  months: Record<string, TranslationUsageSummary>;
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function emptyUsage(date: Date): TranslationUsageSummary {
  return {
    month: monthKey(date),
    deepSeekRequests: 0,
    googleRequests: 0,
    localCacheHits: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    promptCacheHitTokens: 0,
    promptCacheMissTokens: 0,
  };
}

function browserStorage(storage?: Storage) {
  if (storage) return storage;
  return typeof window === "undefined" ? undefined : window.localStorage;
}

function readStore(storage?: Storage): StoredUsage {
  const target = browserStorage(storage);
  if (!target) return { months: {} };
  try {
    const parsed = JSON.parse(target.getItem(STORAGE_KEY) || "") as Partial<StoredUsage>;
    return parsed && typeof parsed.months === "object" && parsed.months ? { months: parsed.months } : { months: {} };
  } catch {
    return { months: {} };
  }
}

function updateUsage(
  date: Date,
  update: (current: TranslationUsageSummary) => TranslationUsageSummary,
  storage?: Storage,
) {
  const target = browserStorage(storage);
  if (!target) return;
  const store = readStore(target);
  const key = monthKey(date);
  store.months[key] = update(store.months[key] ?? emptyUsage(date));
  target.setItem(STORAGE_KEY, JSON.stringify(store));
}

export function readTranslationUsage(date = new Date(), storage?: Storage) {
  const store = readStore(storage);
  return store.months[monthKey(date)] ?? emptyUsage(date);
}

export function recordRemoteTranslationUsage(
  provider: TranslationService,
  usage?: TranslationApiUsage,
  date = new Date(),
  storage?: Storage,
) {
  updateUsage(date, (current) => ({
    ...current,
    deepSeekRequests: current.deepSeekRequests + (provider === "deepseek" ? 1 : 0),
    googleRequests: current.googleRequests + (provider === "google" ? 1 : 0),
    promptTokens: current.promptTokens + (usage?.promptTokens ?? 0),
    completionTokens: current.completionTokens + (usage?.completionTokens ?? 0),
    totalTokens: current.totalTokens + (usage?.totalTokens ?? 0),
    promptCacheHitTokens: current.promptCacheHitTokens + (usage?.promptCacheHitTokens ?? 0),
    promptCacheMissTokens: current.promptCacheMissTokens + (usage?.promptCacheMissTokens ?? 0),
  }), storage);
}

export function recordLocalTranslationCacheHit(date = new Date(), storage?: Storage) {
  updateUsage(date, (current) => ({
    ...current,
    localCacheHits: current.localCacheHits + 1,
  }), storage);
}
