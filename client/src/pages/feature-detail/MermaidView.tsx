import mermaid from "mermaid";
import { useEffect, useRef, useState } from "react";

const DARK_QUERY = "(prefers-color-scheme: dark)";

export function MermaidView({ source }: { source: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [dark, setDark] = useState(() => window.matchMedia(DARK_QUERY).matches);

  // Mermaid bakes its theme into the rendered SVG at render time, unlike
  // the rest of this app's CSS-token-driven theming, which reacts to
  // prefers-color-scheme on its own — so a live OS theme change needs an
  // explicit listener to trigger a re-render, not just a CSS variable.
  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY);
    const onChange = () => setDark(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (el === null || source === "") return;
    let cancelled = false;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: dark ? "dark" : "default",
    });
    const id = `mermaid-${Math.random().toString(36).slice(2)}`;
    mermaid
      .render(id, source)
      .then(({ svg }) => {
        if (!cancelled) el.innerHTML = svg;
      })
      .catch(() => {
        if (!cancelled) el.innerHTML = "";
      });
    return () => {
      cancelled = true;
    };
  }, [source, dark]);

  return <div ref={ref} data-mermaid-view className="h-full overflow-auto" />;
}
