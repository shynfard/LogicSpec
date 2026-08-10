// Webview side of the LogicSpec previews (feature preview + workspace graph).
// Mermaid views render here; the "interactive" view is handled by canvas.js
// (React Flow) — this script coordinates visibility and shared UI (banner,
// view switcher, details drawer).
(function () {
  const vscode = acquireVsCodeApi();
  // canvas.js must reuse the same API object (acquireVsCodeApi is once-only).
  window.__logicspecVsCode = vscode;

  const banner = document.getElementById("banner");
  const container = document.getElementById("diagram");
  const canvasHost = document.getElementById("canvas");
  const viewLabel = document.getElementById("view-label");
  const viewSelect = document.getElementById("view");
  const zoomControls = document.getElementById("zoom");
  const zoomIn = document.getElementById("zoom-in");
  const zoomOut = document.getElementById("zoom-out");
  const zoomFit = document.getElementById("zoom-fit");
  const zoomLevel = document.getElementById("zoom-level");
  let counter = 0;

  // ── Zoom & pan (Mermaid views only; the interactive view has its own) ─────
  const MIN_SCALE = 0.2;
  const MAX_SCALE = 5;
  let scale = null; // null = fit to panel width
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

  function effectiveScaleSafe() {
    const svg = currentSvg();
    return svg ? effectiveScale(svg) : 1;
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

  container.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
      setScale(effectiveScaleSafe() * factor, { x: event.clientX, y: event.clientY });
    },
    { passive: false },
  );

  // Background drag pans via native scrolling; 4px threshold keeps clicks.
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

  // ── Node clicks (Mermaid views): single → details, double → jump ──────────
  function nodeIdFromEvent(event) {
    const nodeEl = event.target instanceof Element ? event.target.closest("g.node[id]") : null;
    if (!nodeEl) return null;
    const match = /^flowchart-(.+)-\d+$/.exec(nodeEl.id);
    return match ? match[1] : null;
  }
  let clickTimer = null;
  container.addEventListener("click", (event) => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    const node = nodeIdFromEvent(event);
    if (node === null) return;
    if (clickTimer !== null) clearTimeout(clickTimer);
    clickTimer = setTimeout(() => {
      clickTimer = null;
      vscode.postMessage({ type: "nodeDetails", node });
    }, 220);
  });
  container.addEventListener("dblclick", (event) => {
    const node = nodeIdFromEvent(event);
    if (node === null) return;
    if (clickTimer !== null) {
      clearTimeout(clickTimer);
      clickTimer = null;
    }
    vscode.postMessage({ type: "nodeClick", node });
  });

  // ── Details drawer (shared by Mermaid and interactive views) ───────────────
  const drawer = document.createElement("aside");
  drawer.id = "details";
  drawer.hidden = true;
  document.body.appendChild(drawer);

  function hideDetails() {
    drawer.hidden = true;
  }
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideDetails();
  });

  function addRow(parent, key, value) {
    const dt = document.createElement("dt");
    dt.textContent = key;
    const dd = document.createElement("dd");
    dd.textContent = value;
    parent.append(dt, dd);
  }

  function showDetails(details) {
    drawer.replaceChildren();

    const header = document.createElement("header");
    const title = document.createElement("strong");
    title.textContent = details.label;
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = details.type.toUpperCase();
    const close = document.createElement("button");
    close.textContent = "×";
    close.title = "Close (Esc)";
    close.addEventListener("click", hideDetails);
    header.append(title, badge, close);
    drawer.appendChild(header);

    const idLine = document.createElement("div");
    idLine.className = "step-id";
    idLine.textContent = details.id;
    drawer.appendChild(idLine);

    if (details.fields.length > 0) {
      const dl = document.createElement("dl");
      for (const field of details.fields) addRow(dl, field.key, field.value);
      drawer.appendChild(dl);
    }

    if (details.transitions.length > 0) {
      const heading = document.createElement("h4");
      heading.textContent = "Transitions";
      drawer.appendChild(heading);
      const list = document.createElement("ul");
      for (const transition of details.transitions) {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.className = "link";
        button.textContent = `${transition.label} → ${transition.to}`;
        button.title = `Go to step "${transition.to}"`;
        button.addEventListener("click", () => {
          vscode.postMessage({
            type: "openLink",
            link: { kind: "step", label: transition.to, step: transition.to },
          });
        });
        item.appendChild(button);
        list.appendChild(item);
      }
      drawer.appendChild(list);
    }

    if (details.links.length > 0) {
      const heading = document.createElement("h4");
      heading.textContent = "Open";
      drawer.appendChild(heading);
      const list = document.createElement("ul");
      for (const link of details.links) {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.className = "link";
        button.textContent = link.label;
        button.addEventListener("click", () => {
          vscode.postMessage({ type: "openLink", link });
        });
        item.appendChild(button);
        list.appendChild(item);
      }
      drawer.appendChild(list);
    }

    drawer.hidden = false;
  }

  // ── Mermaid rendering ──────────────────────────────────────────────────────
  mermaid.initialize({
    startOnLoad: false,
    theme: "neutral",
    securityLevel: "strict",
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

  function syncView(view) {
    if (typeof view === "string" && viewLabel && viewSelect) {
      viewLabel.hidden = false;
      viewSelect.value = view;
    }
  }

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || typeof message !== "object") return;
    if (message.type === "render" && typeof message.source === "string") {
      banner.hidden = true;
      syncView(message.view);
      if (zoomControls) zoomControls.hidden = false;
      if (canvasHost) canvasHost.setAttribute("hidden", "true");
      container.removeAttribute("hidden");
      void render(message.source);
    } else if (message.type === "canvas") {
      banner.hidden = true;
      syncView("interactive");
      // React Flow brings its own controls; the SVG zoom bar is meaningless.
      if (zoomControls) zoomControls.hidden = true;
    } else if (message.type === "stale") {
      banner.hidden = !message.stale;
    } else if (
      message.type === "details" &&
      message.details &&
      typeof message.details === "object"
    ) {
      showDetails(message.details);
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
