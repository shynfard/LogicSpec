import { useEffect, useRef } from "react";

/** Pure parsing helper, tested without a real EventSource. */
export function parseSseData(frame: string): string | undefined {
  const match = /^data: (.*)$/m.exec(frame);
  return match?.[1];
}

/** Subscribes to the dashboard's SSE endpoint once; calls `onReload` on every message. */
export function useLiveReload(onReload: () => void): void {
  const callback = useRef(onReload);
  callback.current = onReload;

  useEffect(() => {
    const source = new EventSource("/events");
    source.onmessage = () => callback.current();
    return () => source.close();
  }, []);
}
