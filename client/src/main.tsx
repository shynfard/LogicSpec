// client/src/main.tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Link, useRoute } from "@/lib/router";
import { FeatureList } from "@/pages/FeatureList";
import "./index.css";

function App() {
  const route = useRoute();
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
        {route.name === "detail" ? <p className="p-6">Feature detail — coming in Task 7.</p> : null}
        {route.name === "mcp" ? <p className="p-6">MCP page — coming in Task 10.</p> : null}
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
