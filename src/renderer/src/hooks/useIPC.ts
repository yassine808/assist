import { useCallback, useEffect, useRef } from "react";

/**
 * Custom hook that wraps the Python backend proxy.
 *
 * `call(method, params)` sends a request to the Python backend.
 * `onEvent(event, handler)` subscribes to asynchronous events pushed by Python.
 */
export function useIPC() {
  const listenersRef = useRef<Map<string, Set<(params: unknown) => void>>>(new Map());

  useEffect(() => {
    const unsubscribe = window.electronAPI.onEvent(({ event, params }) => {
      const listeners = listenersRef.current.get(event);
      listeners?.forEach((cb) => cb(params));
    });
    return unsubscribe;
  }, []);

  // These MUST be referentially stable. Views list them as effect deps and set
  // state from the responses; a fresh identity per render makes those effects
  // re-run forever, producing an unbounded render -> IPC -> render loop.
  const call = useCallback(
    async <T,>(method: string, params?: Record<string, unknown>): Promise<T> => {
      return (await window.electronAPI.call(method, params)) as T;
    },
    []
  );

  const onEvent = useCallback(
    (event: string, handler: (params: unknown) => void): (() => void) => {
      if (!listenersRef.current.has(event)) {
        listenersRef.current.set(event, new Set());
      }
      listenersRef.current.get(event)!.add(handler);
      // `Set.delete` returns a boolean, which React rejects as a cleanup value.
      return () => {
        listenersRef.current.get(event)?.delete(handler);
      };
    },
    []
  );

  return { call, onEvent };
}
