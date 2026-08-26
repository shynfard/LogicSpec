/**
 * Client-side diagram export: PNG for the interactive canvas, and
 * SVG / PNG / Mermaid source for the rendered Mermaid views. Everything
 * runs in the browser — the server stays read-only and none of this
 * touches the API.
 */

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Give the click a tick before revoking, or some browsers cancel the save.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(filename: string, text: string, mime: string): void {
  downloadBlob(filename, new Blob([text], { type: mime }));
}

/** The page's effective background, so exported PNGs aren't transparent. */
export function pageBackground(): string {
  const bg = getComputedStyle(document.body).backgroundColor;
  return bg === "" || bg === "rgba(0, 0, 0, 0)" ? "#ffffff" : bg;
}

/** Serializes an SVG element to a standalone SVG document string. */
export function serializeSvg(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  // Mermaid emits width:100%/max-width styling for responsive embedding;
  // a standalone file needs concrete dimensions from the viewBox instead.
  const box = svg.viewBox.baseVal;
  if (box && box.width > 0 && box.height > 0) {
    clone.setAttribute("width", String(box.width));
    clone.setAttribute("height", String(box.height));
    clone.style.maxWidth = "";
  }
  if (!clone.getAttribute("xmlns")) {
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
}

/** Rasterizes an SVG element to a PNG blob at `scale`× its intrinsic size. */
export function svgToPngBlob(svg: SVGSVGElement, scale = 2): Promise<Blob> {
  const box = svg.viewBox.baseVal;
  const width = box && box.width > 0 ? box.width : svg.clientWidth || 800;
  const height = box && box.height > 0 ? box.height : svg.clientHeight || 600;
  const source = serializeSvg(svg);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const context = canvas.getContext("2d");
      if (context === null) {
        reject(new Error("Canvas 2D context unavailable."));
        return;
      }
      context.fillStyle = pageBackground();
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (blob === null) reject(new Error("PNG encoding failed."));
        else resolve(blob);
      }, "image/png");
    };
    image.onerror = () => reject(new Error("Could not rasterize the SVG."));
    image.src = url;
  });
}

export type MermaidExportFormat = "svg" | "png" | "mmd";

/**
 * Exports the currently rendered Mermaid view. `container` is the element
 * carrying the rendered SVG (the `[data-mermaid-view]` div); `source` is the
 * Mermaid text the server produced for this view.
 */
export async function exportMermaidView(
  baseName: string,
  format: MermaidExportFormat,
  source: string,
  container: Element | null,
): Promise<void> {
  if (format === "mmd") {
    downloadText(`${baseName}.mmd`, source, "text/vnd.mermaid; charset=utf-8");
    return;
  }
  const svg = container?.querySelector("svg") ?? null;
  if (svg === null) throw new Error("No rendered diagram to export.");
  if (format === "svg") {
    downloadText(`${baseName}.svg`, serializeSvg(svg), "image/svg+xml; charset=utf-8");
    return;
  }
  downloadBlob(`${baseName}.png`, await svgToPngBlob(svg));
}
