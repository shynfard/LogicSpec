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

  // ── Movable nodes (view-only, n8n-style) ──────────────────────────────────
  // The rendered SVG is edited in place: node groups get an extra translate
  // offset, connected edge paths become border-clipped straight lines, and
  // edge labels re-center. Nothing is persisted — Reset (or any re-render)
  // restores Mermaid's layout.
  const layout = {
    nodes: new Map(), // mermaid node id → {el, x0, y0, dx, dy, hw, hh}
    edges: [], // {el, from, to, d0, labelEl, labelT0}
  };

  function parseTranslate(el) {
    const match = /translate\(\s*([-\d.]+)[ ,]\s*([-\d.]+)/.exec(
      el.getAttribute("transform") || "",
    );
    return match ? { x: Number(match[1]), y: Number(match[2]) } : { x: 0, y: 0 };
  }

  function buildLayoutRegistry() {
    layout.nodes = new Map();
    layout.edges = [];
    const svg = currentSvg();
    if (!svg) return;
    for (const el of svg.querySelectorAll("g.node[id]")) {
      const match = /^flowchart-(.+)-\d+$/.exec(el.id);
      if (!match) continue;
      const at = parseTranslate(el);
      let hw = 40;
      let hh = 20;
      try {
        const box = el.getBBox();
        hw = box.width / 2 + 6;
        hh = box.height / 2 + 6;
      } catch {
        // detached bbox; keep defaults
      }
      layout.nodes.set(match[1], { el, x0: at.x, y0: at.y, dx: 0, dy: 0, hw, hh });
    }
    const paths = [...svg.querySelectorAll("g.edgePaths path")];
    const labels = [...svg.querySelectorAll("g.edgeLabels > g")];
    paths.forEach((el, index) => {
      let from;
      let to;
      for (const cls of el.classList) {
        if (cls.startsWith("LS-")) from = cls.slice(3);
        else if (cls.startsWith("LE-")) to = cls.slice(3);
      }
      if (from === undefined || to === undefined) return;
      const labelEl = labels.length === paths.length ? labels[index] : undefined;
      layout.edges.push({
        el,
        from,
        to,
        d0: el.getAttribute("d"),
        labelEl,
        labelT0: labelEl ? labelEl.getAttribute("transform") : undefined,
      });
    });
  }

  function nodeCenter(node) {
    return { x: node.x0 + node.dx, y: node.y0 + node.dy };
  }

  // Where the segment from `fromPt` toward `toPt` exits `node`'s bounding
  // rectangle — keeps arrowheads outside the shapes.
  function clipToNode(fromPt, toPt, node) {
    const dx = toPt.x - fromPt.x;
    const dy = toPt.y - fromPt.y;
    const tx = dx !== 0 ? node.hw / Math.abs(dx) : Infinity;
    const ty = dy !== 0 ? node.hh / Math.abs(dy) : Infinity;
    const t = Math.min(tx, ty, 1);
    return { x: toPt.x - dx * t, y: toPt.y - dy * t };
  }

  function updateEdgesFor(nodeId) {
    for (const edge of layout.edges) {
      if (edge.from !== nodeId && edge.to !== nodeId) continue;
      const fromNode = layout.nodes.get(edge.from);
      const toNode = layout.nodes.get(edge.to);
      if (!fromNode || !toNode) continue;
      const a = nodeCenter(fromNode);
      const b = nodeCenter(toNode);
      const start = clipToNode(b, a, fromNode);
      const end = clipToNode(a, b, toNode);
      edge.el.setAttribute("d", `M${start.x},${start.y}L${end.x},${end.y}`);
      if (edge.labelEl) {
        edge.labelEl.setAttribute(
          "transform",
          `translate(${(start.x + end.x) / 2}, ${(start.y + end.y) / 2})`,
        );
      }
    }
  }

  function resetLayout() {
    for (const node of layout.nodes.values()) {
      node.dx = 0;
      node.dy = 0;
      node.el.setAttribute("transform", `translate(${node.x0}, ${node.y0})`);
    }
    for (const edge of layout.edges) {
      if (edge.d0 != null) edge.el.setAttribute("d", edge.d0);
      if (edge.labelEl && edge.labelT0 != null) {
        edge.labelEl.setAttribute("transform", edge.labelT0);
      }
    }
  }

  const layoutReset = document.getElementById("layout-reset");
  if (layoutReset) layoutReset.addEventListener("click", resetLayout);

  function renderScale() {
    const svg = currentSvg();
    if (!svg) return 1;
    const viewBox = svg.viewBox && svg.viewBox.baseVal;
    if (!viewBox || viewBox.width === 0) return 1;
    return svg.clientWidth / viewBox.width || 1;
  }

  // ── Pointer interaction: node drag OR background pan ───────────────────────
  // A 4px threshold keeps node clicks (navigation) working; after a real
  // drag the next click is suppressed.
  let pan = null;
  let nodeDrag = null;
  container.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const nodeEl = event.target instanceof Element ? event.target.closest("g.node[id]") : null;
    const match = nodeEl ? /^flowchart-(.+)-\d+$/.exec(nodeEl.id) : null;
    if (match && layout.nodes.has(match[1])) {
      nodeDrag = {
        nid: match[1],
        x: event.clientX,
        y: event.clientY,
        moved: false,
        id: event.pointerId,
      };
      return;
    }
    pan = { x: event.clientX, y: event.clientY, moved: false, id: event.pointerId };
  });
  container.addEventListener("pointermove", (event) => {
    if (nodeDrag && event.pointerId === nodeDrag.id) {
      const dx = event.clientX - nodeDrag.x;
      const dy = event.clientY - nodeDrag.y;
      if (!nodeDrag.moved && Math.hypot(dx, dy) < 4) return;
      if (!nodeDrag.moved) {
        nodeDrag.moved = true;
        container.setPointerCapture(nodeDrag.id);
      }
      const node = layout.nodes.get(nodeDrag.nid);
      const factor = renderScale();
      node.dx += dx / factor;
      node.dy += dy / factor;
      node.el.setAttribute("transform", `translate(${node.x0 + node.dx}, ${node.y0 + node.dy})`);
      updateEdgesFor(nodeDrag.nid);
      nodeDrag.x = event.clientX;
      nodeDrag.y = event.clientY;
      return;
    }
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
  function endPointer(event) {
    if (nodeDrag && event.pointerId === nodeDrag.id) {
      if (nodeDrag.moved) {
        suppressClick = true;
        try {
          container.releasePointerCapture(nodeDrag.id);
        } catch {
          // capture may already be gone
        }
      }
      nodeDrag = null;
      return;
    }
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
  container.addEventListener("pointerup", endPointer);
  container.addEventListener("pointercancel", endPointer);

  // ── View switcher ──────────────────────────────────────────────────────────
  if (viewSelect) {
    viewSelect.addEventListener("change", () => {
      vscode.postMessage({ type: "setView", view: viewSelect.value });
    });
  }

  // ── Node clicks ────────────────────────────────────────────────────────────
  // Single click → details drawer (nodeDetails); double click → jump to the
  // YAML definition (nodeClick). A short timer disambiguates the two.
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

  // ── Details drawer ─────────────────────────────────────────────────────────
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
      buildLayoutRegistry();
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
    } else if (message.type === "details" && message.details && typeof message.details === "object") {
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
