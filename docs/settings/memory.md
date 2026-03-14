# Memory

Kaizen has a persistent memory system that improves its understanding of you and your preferences over time.

## User Memory

User memory is a global profile that the agent maintains across all conversations. It stores things like:

- Your preferences and how you like things done
- Accounts and services you use
- Past decisions and their context
- Patterns the agent has noticed

### Viewing & Editing

Go to **Settings > Memory** (`/settings/memory`) to view and edit the user memory directly. It's a plain text field that auto-saves when you click away.

The agent can also read and write to this memory during runs using the `read-user-memory` and `write-user-memory` tools.

### Memory Compaction

When the agent writes to user memory, it doesn't just append. It uses an LLM-based merge process to deduplicate, consolidate, and compress the information. This keeps the memory concise and relevant as it grows.

## Working Memory

Working memory is per-objective context that helps the agent across multiple runs on the same task. Unlike user memory (which is global), working memory is scoped to a specific objective and captures:

- What was tried in previous runs
- What worked and what didn't
- Context that should carry forward

## Tool Memory

Individual tools can have their own persistent memory. When the agent learns something useful about a tool (quirks, tips, common patterns), it saves it to the tool's memory field. This knowledge is available in future runs.

## Learning Loop

The memory system is tightly connected to Kaizen's reflection and repair cycle:

1. A run completes
2. The reflection agent analyzes what happened
3. If gaps are found, the repair agent fixes them
4. If the repair succeeds, the learnings are merged into user memory
5. Future runs benefit from these accumulated insights

This is what makes Kaizen's "self-improving" claim concrete. The more you use it, the better it gets at understanding your needs and avoiding past mistakes.
