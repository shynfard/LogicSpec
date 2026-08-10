import type { Diagnostic } from "logicspec/core";

interface DiagnosticsPanelProps {
  diagnostics: Diagnostic[];
}

export function DiagnosticsPanel({ diagnostics }: DiagnosticsPanelProps) {
  return (
    <section className="diagnostics">
      <header>
        Diagnostics
        {diagnostics.length > 0 && <span className="count">{diagnostics.length}</span>}
      </header>
      {diagnostics.length === 0 ? (
        <p className="hint">No findings — the specification is clean.</p>
      ) : (
        <ul>
          {diagnostics.map((diagnostic, index) => (
            <li
              key={`${diagnostic.code}-${index}`}
              className={`severity-${diagnostic.severity}`}
            >
              <span className="diag-code">{diagnostic.code}</span>
              <span className="diag-name">{diagnostic.name}</span>
              <span className="diag-message">{diagnostic.message}</span>
              {diagnostic.location && (
                <span className="diag-loc">
                  {diagnostic.location.line}:{diagnostic.location.column}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
