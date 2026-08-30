import { describe, expect, it, vi } from "vitest";

import {
  createInFlightRequestDeduper,
  resolveTranslationProvider,
} from "@/lib/translation-runtime";

describe("translation request runtime", () => {
  it("routes short selections to Google and paragraphs to DeepSeek in smart mode", () => {
    const keys = { deepseek: true, google: true };

    expect(resolveTranslationProvider("smart", "inverse kinematics", keys)).toBe("google");
    expect(resolveTranslationProvider("smart", "A".repeat(120), keys)).toBe("deepseek");
  });

  it("falls back to the provider that has a session key", () => {
    expect(resolveTranslationProvider("smart", "short term", { deepseek: true, google: false })).toBe("deepseek");
    expect(resolveTranslationProvider("smart", "A".repeat(120), { deepseek: false, google: true })).toBe("google");
  });

  it("coalesces simultaneous identical API requests and allows later retries", async () => {
    const deduper = createInFlightRequestDeduper();
    const request = vi.fn().mockResolvedValue({ translation: "模型" });

    const [first, second] = await Promise.all([
      deduper.run("deepseek:cache-key", request),
      deduper.run("deepseek:cache-key", request),
    ]);
    expect(first).toEqual({ translation: "模型" });
    expect(second).toEqual({ translation: "模型" });
    expect(request).toHaveBeenCalledOnce();

    await deduper.run("deepseek:cache-key", request);
    expect(request).toHaveBeenCalledTimes(2);
  });
});
