# Reflection & Repair

Reflection is what makes Kaizen self-improving. After every run, agents analyze what happened and persist learnings for future use.

## How Reflection Works

After the executor finishes, the reflection agent runs automatically:

1. **Analyzes** the entire run: user request, agent actions, tool results, final output
2. **Identifies gaps**: Did the output fully address the request? Were there errors?
3. **Decides**: Pass (no issues) or fail (gaps found)

Reflection runs up to **2 passes** (configurable via `MAX_REFLECTIONS`). If the first pass finds issues and repair runs, a second reflection pass verifies the fix.

## How Repair Works

When reflection finds gaps, the repair agent takes targeted corrective actions:

- **write-user-memory**: Persists learnings so the same mistake doesn't happen again
- **edit-skill**: Updates skill instructions or guardrails
- **repair-complete**: Signals that repair is done

The repair agent operates in "surgical fix mode." It doesn't re-run the full pipeline. Instead, it makes precise corrections based on reflection's analysis.

## Learning Persistence

When repair succeeds (reflection pass 2 shows the gap is fixed), the learnings are automatically merged into user memory. This creates a feedback loop:

```
Run --> Reflection --> Gap Found --> Repair --> Fix Applied
                                                    |
                                                    v
                                              User Memory Updated
                                                    |
                                                    v
                                              Next Run Benefits
```

## Memory Merge

When new information is written to user memory, it doesn't just append. An LLM-based merge process:

- Deduplicates overlapping information
- Consolidates related facts
- Compresses to maintain a reasonable size
- Preserves the most important details

## Pipeline Quality Flags

Reflection is aware of pipeline status and calibrates accordingly:

| Flag | Meaning | Reflection Behavior |
|------|---------|-------------------|
| **Pipeline passed** | Code was tested and reviewed | Skips repair (output already validated) |
| **Pipeline failed** | Code didn't pass quality checks | Skips repair (repair can't re-validate) |
| **No pipeline** | No code was involved | Normal reflection |

## What Reflection Catches

- Missing requirements from the user's request
- Errors that were ignored or worked around
- Hallucinated claims (actions described but not performed)
- Quality issues in the output
- Opportunities to improve skill instructions or guardrails
