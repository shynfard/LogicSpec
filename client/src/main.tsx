// client/src/main.tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Link, useRoute } from "@/lib/router";
import { FeatureDetail } from "@/pages/FeatureDetail";
import { FeatureList } from "@/pages/FeatureList";
import { McpInfo } from "@/pages/McpInfo";
import "./index.css";

function App() {
  const route = useRoute();
  // The feature-detail page is its own full-screen app shell (top bar +
  // tab content fill the whole viewport) with its own "← Dashboard" link,
  // so the global header would just be a second, redundant nav strip
  // stealing vertical space from the canvas.
  if (route.name === "detail") {
    return <FeatureDetail id={route.id} />;
  }
  return (
    <div>
      <header className="flex items-center gap-4 border-b p-3">
        <Link to="/" className="font-semibold hover:underline">
          LogicSpec Dashboard
        </Link>
        <Link to="/mcp" className="text-sm text-muted-foreground hover:underline">
          MCP
        </Link>
      </header>
      <main>
        {route.name === "list" ? <FeatureList /> : null}
        {route.name === "mcp" ? <McpInfo /> : null}
        {route.name === "not-found" ? <p className="p-6">Not found.</p> : null}
      </main>
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("missing #root element");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
