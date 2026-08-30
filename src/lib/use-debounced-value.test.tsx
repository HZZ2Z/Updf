import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useDebouncedValue } from "@/lib/use-debounced-value";

function Probe({ value }: { value: number }) {
  const settled = useDebouncedValue(value, 150);
  return <output>{settled}</output>;
}

describe("useDebouncedValue", () => {
  afterEach(() => vi.useRealTimers());

  it("waits for rapid zoom changes to settle before requesting another render", () => {
    vi.useFakeTimers();
    const view = render(<Probe value={1} />);

    view.rerender(<Probe value={1.2} />);
    view.rerender(<Probe value={1.4} />);
    expect(screen.getByRole("status")).toHaveTextContent("1");

    act(() => vi.advanceTimersByTime(149));
    expect(screen.getByRole("status")).toHaveTextContent("1");
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("status")).toHaveTextContent("1.4");
  });
});
