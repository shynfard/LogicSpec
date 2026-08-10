// Webview side of the LogicSpec previews (feature preview + workspace graph).
// Receives { type: "render", source, view? } messages with Mermaid text and
// { type: "stale", stale } messages toggling the banner. Sends
// { type: "ready" | "setView" | "nodeClick" } back to the extension.
(function () {
  const vscode = acquireVsCodeApi();
  const banner = document.getElementById("banner");
  const container = document.getElementById("diagram");
  const viewLabel = document.getElementById("view-label");
  const viewSelect = document.getElementById("view");
  const zoomIn = document.getElementById("zoom-in");
  const zoomOut = document.getElementById("zoom-out");
  const zoomFit = document.getElementById("zoom-fit");
  const zoomLevel = document.getElementById("zoom-level");
  let counter = 0;

  // ── Zoom & pan ─────────────────────────────────────────────────────────────
  // The SVG's layout width is set directly (natural size × scale), so the
  // container's native scrollbars do the panning and node clicks stay plain
  // DOM clicks. scale === null means "fit to panel width".
  const MIN_SCALE = 0.2;
  const MAX_SCALE = 5;
  let scale = null;
  let suppressClick = false;

  function currentSvg() {
    return container.querySelector("svg");
  }

  function naturalWidth(svg) {
    const viewBox = svg.viewBox && svg.viewBox.baseVal;
    if (viewBox && viewBox.width > 0) return viewBox.width;
    try {
      return svg.getBBox().width || 800;
    } catch {
      return 800;
    }
  }

  function effectiveScale(svg) {
    if (scale !== null) return scale;
    const available = container.clientWidth - 16;
    const natural = naturalWidth(svg);
    return natural > 0 ? Math.min(1, available / natural) : 1;
  }

  function applyZoom() {
    const svg = currentSvg();
    if (!svg) return;
    const factor = effectiveScale(svg);
    svg.style.maxWidth = "none";
    svg.style.height = "auto";
    svg.style.width = `${naturalWidth(svg) * factor}px`;
    if (zoomLevel) zoomLevel.textContent = `${Math.round(factor * 100)}%`;
  }

  function setScale(next, pivot) {
    const svg = currentSvg();
    if (!svg) return;
    const previous = effectiveScale(svg);
    const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
    // Keep the pivot point (viewport coordinates) visually stable.
    const rect = container.getBoundingClientRect();
    const px = (pivot ? pivot.x : rect.left + rect.width / 2) - rect.left;
    const py = (pivot ? pivot.y : rect.top + rect.height / 2) - rect.top;
    const contentX = container.scrollLeft + px;
    const contentY = container.scrollTop + py;
    scale = clamped;
    applyZoom();
    const ratio = clamped / previous;
    container.scrollLeft = contentX * ratio - px;
    container.scrollTop = contentY * ratio - py;
  }

  if (zoomIn) zoomIn.addEventListener("click", () => setScale(effectiveScaleSafe() * 1.25));
  if (zoomOut) zoomOut.addEventListener("click", () => setScale(effectiveScaleSafe() / 1.25));
  if (zoomLevel) zoomLevel.addEventListener("click", () => setScale(1));
  if (zoomFit) {
    zoomFit.addEventListener("click", () => {
      scale = null;
      applyZoom();
    });
  }

  function effectiveScaleSafe() {
    const svg = currentSvg();
    return svg ? effectiveScale(svg) : 1;
  }

  container.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return; // plain wheel = scroll
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
      setScale(effectiveScaleSafe() * factor, { x: event.clientX, y: event.clientY });
    },
    { passive: false },
  );

  // Drag to pan (scrolls the container). A small threshold keeps node clicks
  // working; after a real drag the next click is suppressed.
  let pan = null;
  container.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    pan = { x: event.clientX, y: event.clientY, moved: false, id: event.pointerId };
  });
  container.addEventListener("pointermove", (event) => {
    if (!pan || event.pointerId !== pan.id) return;
    const dx = event.clientX - pan.x;
    const dy = event.clientY - pan.y;
    if (!pan.moved && Math.hypot(dx, dy) < 4) return;
    if (!pan.moved) {
      pan.moved = true;
      container.classList.add("panning");
      container.setPointerCapture(pan.id);
    }
    container.scrollLeft -= dx;
    container.scrollTop -= dy;
    pan.x = event.clientX;
    pan.y = event.clientY;
  });
  function endPan(event) {
    if (!pan || (event.pointerId !== undefined && event.pointerId !== pan.id)) return;
    if (pan.moved) {
      suppressClick = true;
      container.classList.remove("panning");
      try {
        container.releasePointerCapture(pan.id);
      } catch {
        // capture may already be gone
      }
    }
    pan = null;
  }
  container.addEventListener("pointerup", endPan);
  container.addEventListener("pointercancel", endPan);

  // ── View switcher ──────────────────────────────────────────────────────────
  if (viewSelect) {
    viewSelect.addEventListener("change", () => {
      vscode.postMessage({ type: "setView", view: viewSelect.value });
    });
  }

  // ── Node clicks → extension navigation ─────────────────────────────────────
  container.addEventListener("click", (event) => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    const nodeEl = event.target instanceof Element ? event.target.closest("g.node[id]") : null;
    if (!nodeEl) return;
    const match = /^flowchart-(.+)-\d+$/.exec(nodeEl.id);
    if (match) {
      vscode.postMessage({ type: "nodeClick", node: match[1] });
    }
  });

  // ── Rendering ──────────────────────────────────────────────────────────────
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
      applyZoom();
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
      if (typeof message.view === "string" && viewLabel && viewSelect) {
        viewLabel.hidden = false;
        viewSelect.value = message.view;
      }
      void render(message.source);
    } else if (message.type === "stale") {
      banner.hidden = !message.stale;
    }
  });

  window.addEventListener("resize", () => {
    if (scale === null) applyZoom();
  });

  const state = vscode.getState();
  if (state && typeof state.source === "string") {
    void render(state.source);
  }

  vscode.postMessage({ type: "ready" });
})();
