// client/src/main.tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root element");

createRoot(root).render(
  <StrictMode>
    <p>LogicSpec Dashboard — under construction.</p>
  </StrictMode>,
);
