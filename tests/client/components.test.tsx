import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Badge } from "../../client/src/components/ui/badge";
import { DiagnosticsTab } from "../../client/src/pages/feature-detail/DiagnosticsTab";

afterEach(cleanup);

describe("DiagnosticsTab", () => {
  it("shows an empty state when there are no findings", () => {
    render(<DiagnosticsTab diagnostics={[]} path="features/demo.feature.yaml" />);
    expect(screen.getByText("No findings.")).toBeDefined();
  });

  it("renders code, severity, message and location per finding", () => {
    render(
      <DiagnosticsTab
        diagnostics={[
          {
            code: "LS101",
            severity: "error",
            message: 'Transition targets unknown step "chekout".',
            line: 12,
            column: 5,
          },
          { code: "LS402", severity: "info", message: "Actor is never used." },
        ]}
        path="features/demo.feature.yaml"
      />,
    );
    expect(screen.getByText("LS101")).toBeDefined();
    expect(screen.getByText(/unknown step/)).toBeDefined();
    expect(screen.getByText("features/demo.feature.yaml:12:5")).toBeDefined();
    // A finding without a location renders the bare path.
    expect(screen.getByText("LS402")).toBeDefined();
  });
});

describe("Badge", () => {
  it("renders its variant as a data attribute for styling hooks", () => {
    render(<Badge variant="destructive">3 errors</Badge>);
    const badge = screen.getByText("3 errors");
    expect(badge.getAttribute("data-variant")).toBe("destructive");
    expect(badge.getAttribute("data-slot")).toBe("badge");
  });
});
