import { useEffect, useState } from "react";

export type Route =
  | { name: "list" }
  | { name: "detail"; id: string }
  | { name: "mcp" }
  | { name: "not-found" };

export function parseRoute(pathname: string): Route {
  if (pathname === "/") return { name: "list" };
  if (pathname === "/mcp") return { name: "mcp" };
  const match = /^\/features\/([^/]+)$/.exec(pathname);
  if (match?.[1] !== undefined) return { name: "detail", id: decodeURIComponent(match[1]) };
  return { name: "not-found" };
}

export function navigate(path: string): void {
  history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** Current route, updated on navigation (back/forward and `navigate()` calls). */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.pathname));

  useEffect(() => {
    const onPopState = () => setRoute(parseRoute(location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  return route;
}

/** A same-origin link that navigates via the router instead of a full page load. */
export function Link({
  to,
  className,
  children,
}: {
  to: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={to}
      className={className}
      onClick={(event) => {
        event.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
