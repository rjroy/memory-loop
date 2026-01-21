import { describe, test, expect, mock } from "bun:test";
import { renderHook, act } from "@testing-library/react";
import { useLongPress, DEFAULT_LONG_PRESS_DURATION } from "./useLongPress";

describe("useLongPress", () => {

  /**
   * Helper to create a mock touch event
   */
  function createTouchEvent(type: "start" | "move" | "end"): React.TouchEvent {
    const prevented = { current: false };
    return {
      type: `touch${type}`,
      preventDefault: () => {
        prevented.current = true;
      },
      touches: [{ clientX: 100, clientY: 200 }],
      changedTouches: [{ clientX: 100, clientY: 200 }],
      // Expose for test assertions
      _prevented: prevented,
    } as unknown as React.TouchEvent & { _prevented: { current: boolean } };
  }

  describe("default duration", () => {
    test("exports DEFAULT_LONG_PRESS_DURATION as 500ms", () => {
      expect(DEFAULT_LONG_PRESS_DURATION).toBe(500);
    });

    test("uses 500ms duration by default", async () => {
      const callback = mock(() => {});
      const { result } = renderHook(() => useLongPress(callback));

      const event = createTouchEvent("start");
      act(() => {
        result.current.onTouchStart(event);
      });

      // Not called immediately
      expect(callback).not.toHaveBeenCalled();

      // Wait less than 500ms
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(callback).not.toHaveBeenCalled();

      // Wait past 500ms
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe("custom duration", () => {
    test("respects custom duration option", async () => {
      const callback = mock(() => {});
      const { result } = renderHook(() => useLongPress(callback, { duration: 200 }));

      const event = createTouchEvent("start");
      act(() => {
        result.current.onTouchStart(event);
      });

      // Not called at 150ms
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(callback).not.toHaveBeenCalled();

      // Called after 200ms
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe("callback invocation", () => {
    test("calls callback with the touch event", async () => {
      const callback = mock(() => {});
      const { result } = renderHook(() => useLongPress(callback, { duration: 50 }));

      const event = createTouchEvent("start");
      act(() => {
        result.current.onTouchStart(event);
      });

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(callback).toHaveBeenCalledTimes(1);
      // The callback receives the event
      expect(callback).toHaveBeenCalledWith(event);
    });

    test("does not call callback if undefined", async () => {
      const { result } = renderHook(() => useLongPress(undefined, { duration: 50 }));

      const event = createTouchEvent("start");
      act(() => {
        result.current.onTouchStart(event);
      });

      await new Promise((resolve) => setTimeout(resolve, 100));
      // No error thrown, just no callback
    });
  });

  describe("preventDefault", () => {
    test("calls preventDefault on touchstart to suppress system context menu", () => {
      const callback = mock(() => {});
      const { result } = renderHook(() => useLongPress(callback));

      const event = createTouchEvent("start") as React.TouchEvent & {
        _prevented: { current: boolean };
      };
      act(() => {
        result.current.onTouchStart(event);
      });

      expect(event._prevented.current).toBe(true);
    });
  });

  describe("cancellation on move", () => {
    test("cancels timer when touch moves", async () => {
      const callback = mock(() => {});
      const { result } = renderHook(() => useLongPress(callback, { duration: 100 }));

      act(() => {
        result.current.onTouchStart(createTouchEvent("start"));
      });

      // Move before timer fires
      await new Promise((resolve) => setTimeout(resolve, 50));
      act(() => {
        result.current.onTouchMove(createTouchEvent("move"));
      });

      // Wait past original timer
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe("cancellation on end", () => {
    test("cancels timer when touch ends", async () => {
      const callback = mock(() => {});
      const { result } = renderHook(() => useLongPress(callback, { duration: 100 }));

      act(() => {
        result.current.onTouchStart(createTouchEvent("start"));
      });

      // End before timer fires
      await new Promise((resolve) => setTimeout(resolve, 50));
      act(() => {
        result.current.onTouchEnd(createTouchEvent("end"));
      });

      // Wait past original timer
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe("cleanup", () => {
    test("cleans up timer on unmount", async () => {
      const callback = mock(() => {});
      const { result, unmount } = renderHook(() => useLongPress(callback, { duration: 100 }));

      act(() => {
        result.current.onTouchStart(createTouchEvent("start"));
      });

      // Unmount before timer fires
      await new Promise((resolve) => setTimeout(resolve, 50));
      unmount();

      // Wait past original timer
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe("multiple interactions", () => {
    test("can trigger multiple long presses sequentially", async () => {
      const callback = mock(() => {});
      const { result } = renderHook(() => useLongPress(callback, { duration: 50 }));

      // First long press
      act(() => {
        result.current.onTouchStart(createTouchEvent("start"));
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(callback).toHaveBeenCalledTimes(1);

      // End first touch
      act(() => {
        result.current.onTouchEnd(createTouchEvent("end"));
      });

      // Second long press
      act(() => {
        result.current.onTouchStart(createTouchEvent("start"));
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(callback).toHaveBeenCalledTimes(2);
    });

    test("restarting touch before timer fires resets the timer", async () => {
      const callback = mock(() => {});
      const { result } = renderHook(() => useLongPress(callback, { duration: 100 }));

      // Start first touch
      act(() => {
        result.current.onTouchStart(createTouchEvent("start"));
      });

      // Wait 60ms, then end
      await new Promise((resolve) => setTimeout(resolve, 60));
      act(() => {
        result.current.onTouchEnd(createTouchEvent("end"));
      });

      // Start new touch immediately
      act(() => {
        result.current.onTouchStart(createTouchEvent("start"));
      });

      // Wait another 60ms (total 120ms from first start, but only 60ms from second)
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(callback).not.toHaveBeenCalled();

      // Wait for second timer to complete
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe("return value stability", () => {
    test("returns consistent handler references when dependencies unchanged", () => {
      const callback = mock(() => {});
      const { result, rerender } = renderHook(() => useLongPress(callback, { duration: 500 }));

      const firstHandlers = result.current;
      rerender();
      const secondHandlers = result.current;

      expect(secondHandlers.onTouchStart).toBe(firstHandlers.onTouchStart);
      expect(secondHandlers.onTouchMove).toBe(firstHandlers.onTouchMove);
      expect(secondHandlers.onTouchEnd).toBe(firstHandlers.onTouchEnd);
    });

    test("updates handlers when callback changes", () => {
      const callback1 = mock(() => {});
      const callback2 = mock(() => {});
      const { result, rerender } = renderHook(
        ({ cb }) => useLongPress(cb, { duration: 500 }),
        { initialProps: { cb: callback1 } }
      );

      const firstStart = result.current.onTouchStart;
      rerender({ cb: callback2 });
      const secondStart = result.current.onTouchStart;

      // onTouchStart should be different because callback changed
      expect(secondStart).not.toBe(firstStart);
    });

    test("updates handlers when duration changes", () => {
      const callback = mock(() => {});
      const { result, rerender } = renderHook(
        ({ dur }) => useLongPress(callback, { duration: dur }),
        { initialProps: { dur: 500 } }
      );

      const firstStart = result.current.onTouchStart;
      rerender({ dur: 1000 });
      const secondStart = result.current.onTouchStart;

      expect(secondStart).not.toBe(firstStart);
    });
  });
});
