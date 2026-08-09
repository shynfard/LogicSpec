/** Minimal valid feature used as a base by many tests. */
export const MINIMAL_FEATURE = `
version: "1"
feature:
  id: demo
  name: Demo
start: home
actors:
  web:
    kind: frontend
context:
  itemId:
    type: string
steps:
  home:
    type: page
    label: Home
    actor: web
    actions:
      go:
        next: done
  done:
    type: final
    outcome: success
`;

/** Wraps a steps block in a valid envelope. */
export function featureWith(steps: string, extra = ""): string {
  return `
version: "1"
feature:
  id: demo
  name: Demo
start: start-step
${extra}
steps:
${steps}
`;
}
