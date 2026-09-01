import { afterEach, describe, expect, it } from "vitest";

import {
  getDesktopReaderResumePath,
  getReaderStateStorageKey,
  getSettingsReturnPath,
  parseReaderResumeState,
  readDesktopReaderResumePath,
  saveReaderResumeState,
} from "@/lib/reader-session";

describe("reader session recovery", () => {
  afterEach(() => window.localStorage.clear());

  it("restores and bounds the exact mode-specific page and zoom", () => {
    const restored = parseReaderResumeState(JSON.stringify({
      mode: "book",
      continuousPage: 999,
      bookPage: 42,
      continuousZoom: 8,
      bookZoom: 1.3,
    }), 100);

    expect(restored).toEqual({
      mode: "book",
      continuousPage: 100,
      bookPage: 42,
      continuousZoom: 3,
      bookZoom: 1.3,
    });
  });

  it("persists the last reader route independently from delayed database writes", () => {
    saveReaderResumeState("robotics sha", {
      mode: "continuous",
      continuousPage: 87,
      bookPage: 40,
      continuousZoom: 1.2,
      bookZoom: 1,
    });

    expect(readDesktopReaderResumePath()).toBe("/reader/robotics%20sha");
    expect(parseReaderResumeState(
      window.localStorage.getItem(getReaderStateStorageKey("robotics sha")),
      408,
    )?.continuousPage).toBe(87);
  });

  it("accepts only local reader paths for startup and settings return navigation", () => {
    expect(getDesktopReaderResumePath("/reader/document-id")).toBe("/reader/document-id");
    expect(getDesktopReaderResumePath("https://attacker.test/reader/id")).toBeUndefined();
    expect(getSettingsReturnPath("/settings")).toBe("/");
    expect(getSettingsReturnPath("/reader/safe-id")).toBe("/reader/safe-id");
  });
});
