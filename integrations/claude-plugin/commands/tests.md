---
description: Derive a test plan (and tests) from a LogicSpec feature spec
argument-hint: <feature id or file> [test framework, e.g. playwright / vitest]
---

Derive tests from the LogicSpec specification for: $ARGUMENTS

Follow the logicspec-implementing skill. Steps:

1. Resolve the feature (`logicspec validate` first — refuse to derive tests
   from an invalid spec) and load its model: `logicspec inspect <file>
   --json`, or the MCP tools (`get_feature`, `get_transitions`,
   `get_data_flow`) when registered.
2. Build the coverage checklist: every transition edge, every operation
   outcome, every final, every boundary handler, every waiting event's
   received/timeout pair.
3. Write the test plan as a table (test name → path/outcome → assertions),
   naming tests after step and outcome ids so failures point into the YAML.
   One E2E per final outcome (pages' `route`s and action `label`s script the
   journey); the per-outcome matrix lands in integration tests with the
   operation outcomes mocked/driven.
4. If a test framework was named (or the repo has one — check package.json),
   write the actual test files in the project's existing test style and run
   them; otherwise deliver the plan and ask which framework to target.
5. Report: edges covered / total (from the checklist), tests written, and
   any spec findings discovered on the way (unreachable behavior, vague
   guards) — those go back through /logicspec:check or the authoring skill.
