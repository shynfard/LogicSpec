import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const BOOKING = path.join(ROOT, "examples", "booking");

vi.mock("vscode", () => ({
  workspace: { workspaceFolders: [{ uri: { fsPath: BOOKING } }] },
  Uri: { file: (p: string) => ({ fsPath: p }) },
  TreeItem: class TreeItem {
    label: unknown;
    collapsibleState: unknown;
    constructor(label: unknown, collapsibleState: unknown) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  },
  TreeItemCollapsibleState: { None: 0 },
  ThemeIcon: class ThemeIcon {
    constructor(
      public id: string,
      public color?: unknown,
    ) {}
  },
  ThemeColor: class ThemeColor {
    constructor(public id: string) {}
  },
  EventEmitter: class EventEmitter {
    get event() {
      return () => ({ dispose() {} });
    }
    fire() {}
  },
}));

const { FeatureTreeProvider } = await import("../src/features-tree.js");

describe("FeatureTreeProvider", () => {
  it("lists every feature in the workspace, sorted, with a severity icon", () => {
    const provider = new FeatureTreeProvider();
    const items = provider.getChildren();

    expect(items.map((i) => i.label)).toEqual(["Booking", "Booking Notification"]);
    expect(items.every((i) => i.contextValue === "logicspecFeature")).toBe(true);
    expect(items.every((i) => i.iconPath !== undefined)).toBe(true);
    expect(items[0]?.ref.id).toBe("booking");
  });
});
