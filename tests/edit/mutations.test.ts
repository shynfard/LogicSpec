import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  addStep,
  addTransition,
  deleteStep,
  type EditableFeature,
  loadEditableFeature,
  removeTransitionAt,
  renameStep,
  reparse,
  serializeFeature,
  setStepField,
} from "../../src/edit/mutations.js";
import { parseFeature } from "../../src/parser/parse-feature.js";
import { STEP_TYPES } from "../../src/schema/feature.js";
import { MINIMAL_FEATURE } from "../helpers.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Booking example normalized to a single trailing newline. */
function bookingSource(): string {
  return fs
    .readFileSync(path.join(ROOT, "examples/booking/booking.feature.yaml"), "utf8")
    .replace(/\n+$/, "\n");
}

function load(source: string): EditableFeature {
  return loadEditableFeature(source);
}

const DECISION_FIXTURE = `version: "1"
feature:
  id: t
  name: T
start: d
steps:
  d:
    type: decision
    cases:
      - when: a
        next: x
      - when: b
        next: keep
    default:
      next: x
  w:
    type: wait
    duration: 1m
    next: x
  keep:
    type: final
    outcome: success
  x:
    type: final
    outcome: success
`;

const MIXED_FIXTURE = `version: "1"
feature:
  id: m
  name: M
start: op
steps:
  op:
    type: operation
    on:
      success:
        next: fin
  boom:
    type: error
  par:
    type: parallel
    branches:
      a:
        flow: other
    next: fin
  waiting:
    type: event
    direction: wait
    event: Thing
    on:
      received:
        next: fin
  announce:
    type: event
    direction: publish
    event: Thing
    next: fin
  pause:
    type: wait
    duration: 5m
    next: fin
  fin:
    type: final
    outcome: success
`;

const BARE_OP_FIXTURE = `version: "1"
feature:
  id: o
  name: O
start: op
steps:
  op:
    type: operation
  fin:
    type: final
    outcome: success
`;

describe("loadEditableFeature / serializeFeature / reparse", () => {
  it("round-trips the booking example byte-identically with zero mutations", () => {
    const source = bookingSource();
    const editable = load(source);
    expect(editable.feature).toBeDefined();
    expect(editable.diagnostics).toEqual([]);
    expect(serializeFeature(editable)).toBe(source);
  });

  it("never throws on invalid YAML; serialize then fails loudly, not lossily", () => {
    const editable = load("version: [unclosed");
    expect(editable.feature).toBeUndefined();
    expect(editable.diagnostics[0]?.code).toBe("LS001");
    expect(() => serializeFeature(editable)).toThrow(/YAML syntax errors/);
  });

  it("reparse refreshes the parsed view after mutations", () => {
    const editable = load(MINIMAL_FEATURE);
    addStep(editable, "extra", "page");
    expect(Object.keys(editable.feature?.steps ?? {})).toHaveLength(2); // stale by design
    reparse(editable);
    expect(Object.keys(editable.feature?.steps ?? {})).toEqual(["home", "done", "extra"]);
  });
});

describe("renameStep", () => {
  it("renames a step in place, updating references but not comments or order", () => {
    const editable = load(bookingSource());
    renameStep(editable, "checkout", "payment-page");
    const serialized = serializeFeature(editable);

    expect(serialized).toContain("# yaml-language-server:");
    expect(serialized).toContain("start: select-service");
    // The step key and every transition target are renamed; plain content
    // like the page's route string is not.
    expect(serialized).not.toContain("checkout:");
    expect(serialized).not.toContain("next: checkout");
    expect(serialized).toContain("route: /booking/checkout");

    const parsed = parseFeature(serialized);
    expect(parsed.ok).toBe(true);
    const keys = Object.keys(parsed.data?.steps ?? {});
    expect(keys[7]).toBe("payment-page"); // same position "checkout" held

    const reserve = parsed.data?.steps["reserve-slot"];
    const on = reserve?.type === "operation" ? reserve.on : undefined;
    expect(on?.success?.next).toBe("payment-page");
  });

  it("updates start when the start step is renamed", () => {
    const editable = load(MINIMAL_FEATURE);
    renameStep(editable, "home", "landing");
    expect(editable.document.getIn(["start"])).toBe("landing");
    const parsed = parseFeature(serializeFeature(editable));
    expect(parsed.ok).toBe(true);
    expect(parsed.data?.start).toBe("landing");
  });

  it("updates cases, default, wait next and event outcomes", () => {
    const decision = load(DECISION_FIXTURE);
    renameStep(decision, "x", "exit");
    const parsedDecision = parseFeature(serializeFeature(decision));
    const d = parsedDecision.data?.steps.d;
    expect(d?.type).toBe("decision");
    if (d?.type === "decision") {
      expect(d.cases?.[0]?.next).toBe("exit");
      expect(d.cases?.[1]?.next).toBe("keep");
      expect(d.default?.next).toBe("exit");
    }
    const w = parsedDecision.data?.steps.w;
    expect(w?.type === "wait" ? w.next : undefined).toBe("exit");

    const mixed = load(MIXED_FIXTURE);
    renameStep(mixed, "fin", "finish");
    const parsedMixed = parseFeature(serializeFeature(mixed));
    const waiting = parsedMixed.data?.steps.waiting;
    expect(waiting?.type === "event" ? waiting.on?.received.next : undefined).toBe("finish");
    const announce = parsedMixed.data?.steps.announce;
    expect(announce?.type === "event" ? announce.next : undefined).toBe("finish");
  });

  it("does not touch subflow flow references sharing the name", () => {
    const source = `version: "1"
feature:
  id: s
  name: S
start: run
steps:
  run:
    type: subflow
    flow: cleanup
    next: cleanup
  cleanup:
    type: final
    outcome: success
`;
    const editable = load(source);
    renameStep(editable, "cleanup", "wrap-up");
    const parsed = parseFeature(serializeFeature(editable));
    const run = parsed.data?.steps.run;
    expect(run?.type).toBe("subflow");
    if (run?.type === "subflow") {
      expect(run.flow).toBe("cleanup"); // feature id namespace, untouched
      expect(run.next).toBe("wrap-up");
    }
  });

  it("rejects collisions, unknown steps and invalid identifiers", () => {
    const editable = load(MINIMAL_FEATURE);
    expect(() => renameStep(editable, "home", "done")).toThrow(/already exists/);
    expect(() => renameStep(editable, "ghost", "somewhere")).toThrow(/does not exist/);
    expect(() => renameStep(editable, "home", "9lives")).toThrow(/not a valid identifier/);
  });
});

describe("setStepField", () => {
  it("sets and deletes scalar fields", () => {
    const editable = load(MINIMAL_FEATURE);
    setStepField(editable, "home", "label", "Home Page");
    let parsed = parseFeature(serializeFeature(editable));
    let home = parsed.data?.steps.home;
    expect(home?.type === "page" ? home.label : undefined).toBe("Home Page");

    setStepField(editable, "home", "label", undefined);
    parsed = parseFeature(serializeFeature(editable));
    home = parsed.data?.steps.home;
    expect(home?.type === "page" ? home.label : undefined).toBeUndefined();
  });

  it("throws for unknown steps", () => {
    const editable = load(MINIMAL_FEATURE);
    expect(() => setStepField(editable, "ghost", "label", "X")).toThrow(/does not exist/);
  });
});

describe("addStep", () => {
  it("inserts a schema-valid block-style template for every step type", () => {
    const editable = load(MINIMAL_FEATURE);
    for (const type of STEP_TYPES) {
      addStep(editable, `add-${type}`, type);
    }
    const serialized = serializeFeature(editable);
    expect(serialized).not.toContain("{");
    expect(serialized).not.toContain("}");

    const parsed = parseFeature(serialized);
    expect(parsed.data).toBeDefined(); // schema-valid even if structurally incomplete
    for (const type of STEP_TYPES) {
      expect(parsed.data?.steps[`add-${type}`]?.type).toBe(type);
    }
    const wait = parsed.data?.steps["add-wait"];
    expect(wait?.type === "wait" ? wait.next : undefined).toBe("home"); // current start
    const parallel = parsed.data?.steps["add-parallel"];
    expect(parallel?.type === "parallel" ? parallel.next : undefined).toBe("home");
  });

  it("rejects duplicates and invalid identifiers", () => {
    const editable = load(MINIMAL_FEATURE);
    expect(() => addStep(editable, "home", "page")).toThrow(/already exists/);
    expect(() => addStep(editable, "not ok", "page")).toThrow(/not a valid identifier/);
  });
});

describe("deleteStep", () => {
  it("removes the step and every transition targeting it", () => {
    const editable = load(bookingSource());
    deleteStep(editable, "checkout");
    const serialized = serializeFeature(editable);
    expect(serialized).not.toContain("checkout");

    const parsed = parseFeature(serialized);
    expect(parsed.data).toBeDefined();
    const reserve = parsed.data?.steps["reserve-slot"];
    const on = reserve?.type === "operation" ? reserve.on : undefined;
    expect(Object.keys(on ?? {})).toEqual(["conflict", "error"]);
  });

  it("filters decision cases, removes default and bare next", () => {
    const editable = load(DECISION_FIXTURE);
    deleteStep(editable, "x");
    const { document } = editable;
    expect(document.hasIn(["steps", "x"])).toBe(false);
    expect(document.hasIn(["steps", "d", "default"])).toBe(false);
    expect(document.hasIn(["steps", "w", "next"])).toBe(false);
    const serialized = serializeFeature(editable);
    expect(serialized).toContain("next: keep");
    expect(serialized).not.toContain("next: x");
  });

  it("drops action containers left empty", () => {
    const editable = load(MINIMAL_FEATURE);
    deleteStep(editable, "done");
    expect(editable.document.hasIn(["steps", "home", "actions"])).toBe(false);
  });

  it("throws for unknown steps", () => {
    const editable = load(MINIMAL_FEATURE);
    expect(() => deleteStep(editable, "ghost")).toThrow(/does not exist/);
  });
});

describe("addTransition", () => {
  it("adds a page action with the first free key", () => {
    const editable = load(MINIMAL_FEATURE);
    const added = addTransition(editable, "home", "done");
    expect(added).toEqual({
      kind: "action",
      path: ["steps", "home", "actions", "go-2", "next"],
    });
    const parsed = parseFeature(serializeFeature(editable));
    const home = parsed.data?.steps.home;
    const actions = home?.type === "page" ? home.actions : undefined;
    expect(Object.keys(actions ?? {})).toEqual(["go", "go-2"]);
  });

  it("adds an error action", () => {
    const editable = load(MIXED_FIXTURE);
    const added = addTransition(editable, "boom", "op");
    expect(added).toEqual({ kind: "action", path: ["steps", "boom", "actions", "go", "next"] });
  });

  it("uses next for a bare operation, then converts next into on when extended", () => {
    const editable = load(BARE_OP_FIXTURE);
    const first = addTransition(editable, "op", "fin");
    expect(first).toEqual({ kind: "next", path: ["steps", "op", "next"] });

    const second = addTransition(editable, "op", "fin");
    expect(second).toEqual({ kind: "outcome", path: ["steps", "op", "on", "outcome", "next"] });
    expect(editable.document.hasIn(["steps", "op", "next"])).toBe(false);

    const parsed = parseFeature(serializeFeature(editable));
    expect(parsed.ok).toBe(true); // no LS301: next was moved into on.done
    const op = parsed.data?.steps.op;
    const on = op?.type === "operation" ? op.on : undefined;
    expect(Object.keys(on ?? {})).toEqual(["done", "outcome"]);
    expect(on?.done?.next).toBe("fin");
  });

  it("appends to an existing on map", () => {
    const editable = load(MIXED_FIXTURE);
    const added = addTransition(editable, "op", "boom");
    expect(added).toEqual({ kind: "outcome", path: ["steps", "op", "on", "outcome", "next"] });
  });

  it("appends decision cases, creating the sequence when missing", () => {
    const editable = load(DECISION_FIXTURE);
    const appended = addTransition(editable, "d", "keep");
    expect(appended).toEqual({ kind: "decision", path: ["steps", "d", "cases", 2, "next"] });

    const bare = load(`version: "1"
feature:
  id: b
  name: B
start: d
steps:
  d:
    type: decision
  fin:
    type: final
    outcome: success
`);
    const created = addTransition(bare, "d", "fin");
    expect(created).toEqual({ kind: "decision", path: ["steps", "d", "cases", 0, "next"] });
    const parsed = parseFeature(serializeFeature(bare));
    const d = parsed.data?.steps.d;
    expect(d?.type === "decision" ? d.cases?.length : 0).toBe(1);
  });

  it("overwrites next for publish events, waits and parallels", () => {
    const editable = load(MIXED_FIXTURE);
    expect(addTransition(editable, "announce", "op").kind).toBe("next");
    expect(addTransition(editable, "pause", "op").kind).toBe("next");
    expect(addTransition(editable, "par", "op").kind).toBe("next");
    const parsed = parseFeature(serializeFeature(editable));
    const pause = parsed.data?.steps.pause;
    expect(pause?.type === "wait" ? pause.next : undefined).toBe("op");
  });

  it("rejects finals, waiting events, unknown sources and invalid targets", () => {
    const editable = load(MIXED_FIXTURE);
    expect(() => addTransition(editable, "fin", "op")).toThrow(/cannot have outgoing/);
    expect(() => addTransition(editable, "waiting", "op")).toThrow(/directly/);
    expect(() => addTransition(editable, "ghost", "op")).toThrow(/does not exist/);
    expect(() => addTransition(editable, "op", "bad id")).toThrow(/not a valid identifier/);
  });
});

describe("removeTransitionAt", () => {
  it("removes an action and its container when it becomes empty", () => {
    const editable = load(MINIMAL_FEATURE);
    removeTransitionAt(editable, ["steps", "home", "actions", "go", "next"]);
    expect(editable.document.hasIn(["steps", "home", "actions"])).toBe(false);
  });

  it("removes an on outcome and its container when it becomes empty", () => {
    const editable = load(MIXED_FIXTURE);
    removeTransitionAt(editable, ["steps", "op", "on", "success", "next"]);
    expect(editable.document.hasIn(["steps", "op", "on"])).toBe(false);
  });

  it("removes decision cases by index and the default", () => {
    const editable = load(DECISION_FIXTURE);
    removeTransitionAt(editable, ["steps", "d", "cases", 0, "next"]);
    const serialized = serializeFeature(editable);
    expect(serialized).toContain("when: b");
    expect(serialized).not.toContain("when: a");

    removeTransitionAt(editable, ["steps", "d", "cases", 0, "next"]);
    expect(editable.document.hasIn(["steps", "d", "cases"])).toBe(false);

    removeTransitionAt(editable, ["steps", "d", "default", "next"]);
    expect(editable.document.hasIn(["steps", "d", "default"])).toBe(false);
  });

  it("removes a bare next", () => {
    const editable = load(MIXED_FIXTURE);
    removeTransitionAt(editable, ["steps", "pause", "next"]);
    expect(editable.document.hasIn(["steps", "pause", "next"])).toBe(false);
  });

  it("throws on unsupported shapes and missing transitions", () => {
    const editable = load(MIXED_FIXTURE);
    expect(() => removeTransitionAt(editable, ["start"])).toThrow(/unsupported/);
    expect(() => removeTransitionAt(editable, ["steps", "op", "weird", "k", "next"])).toThrow(
      /unsupported/,
    );
    expect(() => removeTransitionAt(editable, ["steps", "op", "actions", "nope", "next"])).toThrow(
      /no transition found/,
    );
  });
});
