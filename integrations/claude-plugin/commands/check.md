---
description: Validate the LogicSpec workspace and fix every finding
argument-hint: [path (default: whole workspace)]
---

Validate LogicSpec specifications and repair them: $ARGUMENTS

1. Run `logicspec validate $ARGUMENTS --json` (bare `logicspec validate
   --json` when no path was given) and parse the report.
2. For each finding, apply the fix for its LS code per the
   logicspec-authoring skill's diagnostics reference. Fix errors first, then
   warnings; mention infos to the user rather than churning the files.
3. Re-run validation until exit code 0. Then run `logicspec render` on the
   touched features so generated diagrams stay current.
4. Report: files touched, findings fixed by code, anything intentionally
   left (with reasoning).
