import { useEffect, useRef, useState } from "react";
import { useLiveReload } from "@/lib/liveReload";

interface ApiErrorBody {
  error?: string;
}

/**
 * Fetches `path` as JSON, with error handling and a stale-response guard.
 *
 * The server can return a non-2xx JSON body (e.g. `{"error": "..."}"`) for a
 * workspace with no `logicspec.config.yaml`, or a 404 for an unknown feature
 * id — see `src/server/create-server.ts`. Without this hook, callers used to
 * treat that error body as real data and crash rendering it (a blank page)
 * instead of showing the message the server already computed.
 *
 * `load` is shared between the mount/path-change effect and `useLiveReload`,
 * so two fetches for different paths can be in flight at once and resolve
 * out of order — a ref holding the current `path` discards any response
 * that resolves after `path` has already moved on.
 */
export function useApi<T>(path: string): { data: T | null; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pathRef = useRef(path);
  pathRef.current = path;

  const load = () => {
    const requestedPath = path;
    fetch(requestedPath)
      .then(async (res) => {
        if (pathRef.current !== requestedPath) return;
        if (res.ok) {
          const body = (await res.json()) as T;
          if (pathRef.current !== requestedPath) return;
          setData(body);
          setError(null);
          return;
        }
        let message = `Request failed (${res.status})`;
        try {
          const body = (await res.json()) as ApiErrorBody;
          if (typeof body.error === "string") message = body.error;
        } catch {
          // Non-JSON error body — fall back to the generic message above.
        }
        if (pathRef.current !== requestedPath) return;
        setError(message);
      })
      .catch(() => {
        if (pathRef.current !== requestedPath) return;
        setError("Network error");
      });
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: load is rebuilt every render; only re-run when path changes (useLiveReload below always calls the current load)
  useEffect(() => {
    setData(null);
    setError(null);
    load();
  }, [path]);
  useLiveReload(load);

  return { data, error };
}
