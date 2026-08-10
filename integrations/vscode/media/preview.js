// Webview side of the LogicSpec feature preview.
// Receives { type: "render", source } messages with Mermaid text and
// { type: "stale", stale } messages toggling the invalid-spec banner.
(function () {
  const vscode = acquireVsCodeApi();
  const banner = document.getElementById("banner");
  const container = document.getElementById("diagram");
  let counter = 0;

  mermaid.initialize({
    startOnLoad: false,
    theme: "neutral",
    securityLevel: "strict",
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
      const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
      const root = parsed.documentElement;
      if (root.nodeName.toLowerCase() !== "svg") {
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
