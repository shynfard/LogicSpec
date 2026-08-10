# Security Policy

## Scope

LogicSpec is a local developer tool. Its security posture is deliberately simple:

* It reads and writes **local files only**. Normal operation (`parse`, `validate`, `render`, `inspect`, `watch`) makes **no network requests**.
* There is **no telemetry** of any kind.
* YAML content is **never executed**. `expression`, `when`, `notes`, `description`, labels, and all other fields are treated strictly as data. The codebase never uses `eval`, `new Function`, or shells out with user-provided content.
* Generated output is plain Markdown/Mermaid text with all user-provided labels escaped.

Relevant threat model: maliciously crafted YAML files. Parsing is delegated to the `yaml` package with schema validation on top; a hostile file should at worst produce diagnostics, never code execution.

## Supported versions

| Version | Supported |
|---------|-----------|
| 0.5.x | ✅ |
| < 0.5 | ❌ |

## Reporting a vulnerability

Please report vulnerabilities privately via GitHub's **Security → Report a vulnerability** (private security advisory) on this repository. Do not open a public issue for security reports.

Include if possible: the affected version, a minimal reproducing file, and the observed vs. expected behavior. You can expect an acknowledgment within a week; fixes are released as patch versions.
