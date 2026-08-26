import { type Document, isNode, parseDocument } from "yaml";
import { CODES } from "../diagnostics/codes.js";
import {
  type Diagnostic,
  type DocPath,
  makeDiagnostic,
  type SourceLocation,
} from "../diagnostics/diagnostic.js";

/** Resolves a document path to a 1-based source position, when possible. */
export type PathLocator = (path: DocPath) => SourceLocation | undefined;

export interface LoadedYaml {
  ok: boolean;
  /** Plain-JS value of the document (undefined when parsing failed). */
  value?: unknown;
  diagnostics: Diagnostic[];
  locate: PathLocator;
  document?: Document;
}

function buildLineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

function offsetToLocation(offset: number, lineStarts: number[]): SourceLocation {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if ((lineStarts[mid] as number) <= offset) low = mid;
    else high = mid - 1;
  }
  return { line: low + 1, column: offset - (lineStarts[low] as number) + 1 };
}

/**
 * Parses YAML and returns the plain value plus a locator that maps document
 * paths back to line/column positions for diagnostics.
 */
export function loadYaml(source: string, file?: string): LoadedYaml {
  const document = parseDocument(source, { keepSourceTokens: true });
  const lineStarts = buildLineStarts(source);

  const locate: PathLocator = (path) => {
    if (!document.contents) return undefined;
    // Prefer the exact node; walk up the path until something resolves.
    for (let end = path.length; end >= 0; end--) {
      const node = end === 0 ? document.contents : document.getIn(path.slice(0, end), true);
      if (isNode(node) && node.range) {
        const start = offsetToLocation(node.range[0], lineStarts);
        // In CRLF sources the parser's exclusive end offset can sit after the
        // \r; step back so the underline never covers the carriage return.
        let endOffset = node.range[1];
        while (endOffset > node.range[0] && source[endOffset - 1] === "\r") endOffset -= 1;
        const endPos = offsetToLocation(endOffset, lineStarts);
        return { ...start, endLine: endPos.line, endColumn: endPos.column };
      }
    }
    return undefined;
  };

  if (document.errors.length > 0) {
    const diagnostics = document.errors.map((err) => {
      const pos = err.linePos?.[0];
      return makeDiagnostic(CODES.YAML_PARSE_ERROR, {
        message: err.message.split("\n")[0] ?? "YAML parse error.",
        file,
        location: pos ? { line: pos.line, column: pos.col } : undefined,
      });
    });
    return { ok: false, diagnostics, locate, document };
  }

  return {
    ok: true,
    value: document.toJS({ maxAliasCount: 1000 }),
    diagnostics: [],
    locate,
    document,
  };
}
