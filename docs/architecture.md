# Architecture

Kaizen uses **handoff orchestration**. Specialized agents pass work through a pipeline, each handling what they're best at.

## Pipeline Overview

```
User --> Router --> Planner --> Executor --> Reviewer
                                  |            |
                              Code Pipeline    |
                              [Developer]      |
                              [Test/Run]       |
                              [Review]         |
                                               |
                              Reflection <-----+
                                  |
                              Repair (if needed)
                                  |
                              Memory (persist learnings)
```

## Agents

| Agent | Role |
|-------|------|
| **Router** | Classifies user intent and picks the right path |
| **Planner** | Researches the task and builds a step-by-step approach |
| **Executor** | Does the work using tools, skills, and integrations |
| **Developer** | Writes and tests code when needed |
| **Reviewer** | Describes what it sees in the output (never suggests code) |
| **Reflection** | Analyzes the run and catches gaps |
| **Repair** | Fixes issues and persists learnings to memory |

## Code Pipeline

When code is needed, the executor triggers a dedicated pipeline:

1. **Developer** writes the code (with access to web search, docs, and code execution tools)
2. **Test/Run** executes the code and captures output
3. **Review** inspects the output visually (for images, dashboards, HTML)

The pipeline runs up to 3 attempts. On attempt 2+, the developer uses patch mode for surgical edits rather than full rewrites.

## Memory System

Kaizen has two layers of memory:

- **User Memory** is a persistent profile that the agent maintains and compacts over time. It remembers your preferences, accounts, and how you like things done.
- **Working Memory** provides per-objective context that improves the agent's approach across runs.

When reflection finds and repairs a gap, the fix is merged into long-term memory so the same mistake doesn't happen twice.
