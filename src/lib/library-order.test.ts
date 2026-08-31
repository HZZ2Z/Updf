import { describe, expect, it } from "vitest";

import { compareManualOrder, mergeVisibleOrder, moveOrderedItem } from "@/lib/library-order";

describe("manual library order", () => {
  it("ignores recent-reading timestamps once manual positions exist", () => {
    const items = [
      { title: "Recently opened", lastOpenedAt: "2026-08-31", sortOrder: 2_000 },
      { title: "Older", lastOpenedAt: "2026-01-01", sortOrder: 1_000 },
    ];

    expect(items.sort(compareManualOrder).map((item) => item.title)).toEqual(["Older", "Recently opened"]);
  });

  it("moves a dragged item and preserves hidden items when a folder is filtered", () => {
    const visible = moveOrderedItem(["a", "c"], "c", "a");
    expect(visible).toEqual(["c", "a"]);
    expect(mergeVisibleOrder(["a", "b", "c"], visible)).toEqual(["c", "b", "a"]);
  });
});
