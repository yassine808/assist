import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

/**
 * Regression test for the unbounded render -> IPC -> render loop.
 *
 * Original bug: `useIPC` returned a fresh `call`/`onEvent` closure on every
 * render. Both secondary views list `call` in a `useEffect` dependency array
 * and set state from the response, so the effect re-ran forever, each pass
 * pushing another request down the single shared Python stdin pipe.
 *
 * The fix wraps both in `useCallback` with `[]`. This test fails if either
 * identity ever changes across re-renders.
 */
describe("useIPC referential stability", () => {
  let unsubscribe: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    unsubscribe = vi.fn();
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      onEvent: vi.fn(() => unsubscribe),
      call: vi.fn(async () => ({ ok: true })),
    };
  });

  it("keeps `call` referentially stable across re-renders", async () => {
    const { useIPC } = await import("./useIPC");
    const { result, rerender } = renderHook(() => useIPC());

    const first = result.current.call;
    rerender();
    rerender();
    expect(result.current.call).toBe(first);
  });

  it("keeps `onEvent` referentially stable across re-renders", async () => {
    const { useIPC } = await import("./useIPC");
    const { result, rerender } = renderHook(() => useIPC());

    const first = result.current.onEvent;
    rerender();
    rerender();
    expect(result.current.onEvent).toBe(first);
  });

  it("does not re-subscribe to the backend event stream on re-render", async () => {
    const { useIPC } = await import("./useIPC");
    const onEventSpy = (window as unknown as { electronAPI: { onEvent: ReturnType<typeof vi.fn> } })
      .electronAPI.onEvent;

    const { rerender } = renderHook(() => useIPC());
    rerender();
    rerender();
    rerender();

    // A per-render subscription would also leak the unsubscribe never running.
    expect(onEventSpy).toHaveBeenCalledTimes(1);
  });

  it("returns an unsubscribe function that deletes the handler", async () => {
    const { useIPC } = await import("./useIPC");
    const handler = vi.fn();
    const { result } = renderHook(() => useIPC());

    let off: (() => void) | undefined;
    act(() => {
      off = result.current.onEvent("ping", handler);
    });

    // `Set.delete` returns a boolean, which React rejects as a cleanup value;
    // the hook must return a real void function.
    expect(typeof off).toBe("function");
    expect(off!()).toBeUndefined();
  });
});
