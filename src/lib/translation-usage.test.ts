import { beforeEach, describe, expect, it } from "vitest";

import {
  readTranslationUsage,
  recordLocalTranslationCacheHit,
  recordRemoteTranslationUsage,
} from "@/lib/translation-usage";

describe("monthly translation usage", () => {
  beforeEach(() => window.localStorage.clear());

  it("aggregates DeepSeek tokens, provider calls and local cache hits for the month", () => {
    const now = new Date("2026-08-29T08:00:00.000Z");
    recordRemoteTranslationUsage("deepseek", {
      promptTokens: 48,
      completionTokens: 12,
      totalTokens: 60,
      promptCacheHitTokens: 32,
      promptCacheMissTokens: 16,
    }, now);
    recordRemoteTranslationUsage("deepseek", {
      promptTokens: 20,
      completionTokens: 8,
      totalTokens: 28,
      promptCacheHitTokens: 0,
      promptCacheMissTokens: 20,
    }, now);
    recordRemoteTranslationUsage("google", undefined, now);
    recordLocalTranslationCacheHit(now);

    expect(readTranslationUsage(now)).toEqual({
      month: "2026-08",
      deepSeekRequests: 2,
      googleRequests: 1,
      localCacheHits: 1,
      promptTokens: 68,
      completionTokens: 20,
      totalTokens: 88,
      promptCacheHitTokens: 32,
      promptCacheMissTokens: 36,
    });
  });

  it("starts a separate total for a new month and tolerates corrupt local data", () => {
    recordRemoteTranslationUsage("google", undefined, new Date("2026-08-31T08:00:00.000Z"));
    expect(readTranslationUsage(new Date("2026-09-01T08:00:00.000Z")).googleRequests).toBe(0);

    window.localStorage.setItem("modu-translation-usage-v1", "not-json");
    expect(readTranslationUsage(new Date("2026-09-01T08:00:00.000Z")).totalTokens).toBe(0);
  });
});
