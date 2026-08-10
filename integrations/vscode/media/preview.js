// Webview side of the LogicSpec feature preview.
// Receives { type: "render", source } messages with Mermaid text and
// { type: "stale", stale } messages toggling the invalid-spec banner.
(function () {
  const vscode = acquireVsCodeApi();
  const banner = document.getElementById("banner");
  const container = document.getElementById("diagram");
  const toolbar = document.getElementById("toolbar");
  const viewSelect = document.getElementById("view");
  let counter = 0;

  if (viewSelect) {
    viewSelect.addEventListener("change", () => {
      vscode.postMessage({ type: "setView", view: viewSelect.value });
    });
  }

  mermaid.initialize({
    startOnLoad: false,
    theme: "neutral",
    securityLevel: "strict",
    // Pure-SVG labels: foreignObject HTML labels serialize as HTML (e.g.
    // unclosed <br>), which is invalid strict XML and also renders blank
    // under some webview CSPs.
    flowchart: { htmlLabels: false },
  });

  function showError(message) {
    container.replaceChildren();
    const pre = document.createElement("pre");
    pre.className = "error";
    pre.textContent = message;
    container.appendChild(pre);
  }

  async function render(source) {
    try {
      const { svg } = await mermaid.render(`logicspec-${++counter}`, source);
      // Parse instead of innerHTML and only accept an <svg> root. Content is
      // locally generated (our renderer + mermaid strict mode) and the CSP
      // blocks non-nonce scripts, but defense in depth is cheap here.
      // Mermaid output may contain HTML-serialized fragments that strict XML
      // parsing rejects, so parse as HTML and extract the svg element.
      const parsed = new DOMParser().parseFromString(svg, "text/html");
      const root = parsed.body.querySelector("svg");
      if (root === null) {
        showError("Renderer returned unexpected content.");
        return;
      }
      container.replaceChildren(document.importNode(root, true));
      vscode.setState({ source });
    } catch (error) {
      showError(String(error));
    }
  }

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || typeof message !== "object") return;
    if (message.type === "render" && typeof message.source === "string") {
      banner.hidden = true;
      // Feature previews send the active view; the workspace graph does not
      // (its view is fixed), so the switcher only appears when meaningful.
      if (typeof message.view === "string" && toolbar && viewSelect) {
        toolbar.hidden = false;
        viewSelect.value = message.view;
      }
      void render(message.source);
    } else if (message.type === "stale") {
      banner.hidden = !message.stale;
    }
  });

  const state = vscode.getState();
  if (state && typeof state.source === "string") {
    void render(state.source);
  }

  vscode.postMessage({ type: "ready" });
})();
