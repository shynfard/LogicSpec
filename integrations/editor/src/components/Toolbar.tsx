import { useRef, type ChangeEvent } from "react";

export type EditorStatus = "valid" | "invalid" | "broken";

interface ToolbarProps {
  status: EditorStatus;
  errorCount: number;
  onOpen: (text: string) => void;
  onSave: () => void;
  onCopy: () => void;
}

export function Toolbar({ status, errorCount, onOpen, onSave, onCopy }: ToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      void file.text().then(onOpen);
    }
    event.target.value = "";
  };

  const statusText =
    status === "valid"
      ? "✓ valid"
      : status === "broken"
        ? "YAML parse error"
        : `${errorCount} error${errorCount === 1 ? "" : "s"}`;

  return (
    <header className="toolbar">
      <h1>
        LogicSpec Editor <span className="experimental">EXPERIMENTAL</span>
      </h1>
      <div className="toolbar-actions">
        <button type="button" onClick={() => fileInputRef.current?.click()}>
          Open…
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".yaml,.yml"
          hidden
          onChange={handleFile}
        />
        <button type="button" onClick={onSave}>
          Save
        </button>
        <button type="button" onClick={onCopy}>
          Copy YAML
        </button>
      </div>
      <span className={`status status-${status}`}>{statusText}</span>
    </header>
  );
}
