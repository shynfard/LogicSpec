import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { debounce } from "../src/debounce.js";

describe("debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires once on the trailing edge with the last arguments", () => {
    const calls: string[] = [];
    const run = debounce((value: string) => calls.push(value), 300);
    run("a");
    run("b");
    run("c");
    vi.advanceTimersByTime(299);
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(calls).toEqual(["c"]);
  });

  it("can be cancelled", () => {
    const calls: number[] = [];
    const run = debounce(() => calls.push(1), 100);
    run();
    run.cancel();
    vi.advanceTimersByTime(500);
    expect(calls).toEqual([]);
  });

  it("fires again for bursts after the delay", () => {
    const calls: number[] = [];
    const run = debounce(() => calls.push(calls.length), 100);
    run();
    vi.advanceTimersByTime(100);
    run();
    vi.advanceTimersByTime(100);
    expect(calls).toEqual([0, 1]);
  });
});
