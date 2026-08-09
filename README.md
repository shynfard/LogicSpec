# LogicSpec

**Define the logic. Generate the software.**

LogicSpec is an open-source, AI-native Application Definition Language for describing how software should behave without tying that behavior to a specific programming language, framework, or implementation.

Instead of treating source code as the only source of truth, LogicSpec lets you describe application behavior declaratively in YAML:

* pages and application states
* user actions
* decisions and business rules
* backend operations
* services and APIs
* Pub/Sub events
* asynchronous workflows
* errors and recovery paths
* feature outcomes

A LogicSpec definition can be validated, visualized automatically, understood by AI coding agents, and used as the source for generating software.

```text
                    LogicSpec
              Application Definition
                       │
         ┌─────────────┼─────────────┐
         │             │             │
         ▼             ▼             ▼
      Validate      Visualize      AI Agent
                        │             │
                     Mermaid          │
                                      ▼
                         ┌────────────┼────────────┐
                         ▼            ▼            ▼
                      Backend      Frontend       Tests
```

Today, LogicSpec focuses on defining and visualizing feature logic.

The long-term vision is larger:

> **The application specification becomes the source. Code becomes a generated implementation artifact.**

LogicSpec is not intended to replace programming languages. It defines **what the application should do**, while AI agents, generators, frameworks, and developers determine **how it is implemented**.
